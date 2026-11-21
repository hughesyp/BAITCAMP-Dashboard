// Every post on the connected accounts, with stats from the platform itself, into public.social_posts.
// Covers posts from the last 90 days on Facebook (Page), Instagram, Threads and TikTok. X isn't
// covered (its API is paid); its stats still come from Blotato on post_targets.
// Posts published through the dashboard are linked to their post_targets row by matching links.
//
// Edge Functions have a time limit, so: platforms run side by side, per-post stats are fetched
// several at a time, posts older than a week only get their per-post stats refreshed once a day,
// each platform is saved as soon as it's done, and work stops at a deadline (the rest is picked
// up next run).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting } from "./common.ts";
import { getJson, metaBase, pageToken } from "./meta.ts";
import { threads, threadsToken } from "./threads.ts";
import { tiktok, tiktokToken } from "./tiktok.ts";

const WINDOW_DAYS = 90;
const MAX_POSTS = 500;   // per platform, newest first (enough for 90 days at several posts a day)
const MAX_PAGES = 12;    // when listing posts (50 a page; TikTok gives 20 a page, so it gets more pages)
const CONCURRENCY = 6;   // per-post stats requests at once, per platform
const BUDGET_MS = 70_000;
const FRESH_DAYS = 7;    // posts newer than this get per-post stats every run; older ones once a day

type Metrics = Record<string, unknown>;
interface Found {
  platform: string; native_id: string; permalink: string | null; caption: string | null;
  media_type: string | null; thumbnail_url: string | null; published_at: string | null;
  metrics: Metrics;                       // from the post list itself (cheap)
  insights?: () => Promise<Metrics>;      // per-post stats (one request or more)
}

const n = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
function clean(m: Metrics) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) { const x = n(v); if (x !== undefined) out[k] = x; }
  return out;
}
/** Lifetime insights response -> { metricName: value } */
function insightValues(d: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of d?.data ?? []) {
    const v = m.values?.[0]?.value ?? m.total_value?.value;
    if (typeof v === "number" || typeof v === "string") out[m.name] = Number(v);
  }
  return out;
}

/** Follow `paging.next` links (Meta), stopping at empty pages, MAX_PAGES or MAX_POSTS. */
async function listPages(first: string, keep: (p: any) => boolean | "stop"): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = first;
  for (let page = 0; url && page < MAX_PAGES && items.length < MAX_POSTS; page++) {
    const d = await getJson(url);
    const data = d.data ?? [];
    if (!data.length) break;
    for (const p of data) {
      const k = keep(p);
      if (k === "stop") return items;
      if (k) items.push(p);
    }
    url = d.paging?.next ?? null;
  }
  return items.slice(0, MAX_POSTS);
}

// ---------- Facebook ----------
async function facebook(token: string, pageId: string, since: number, notes: string[]): Promise<Found[]> {
  const base = metaBase();
  const pt = await pageToken(pageId, token, notes);
  const fields = "id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
  const items = await listPages(`${base}/${pageId}/posts?fields=${fields}&since=${since}&limit=50&access_token=${pt}`, () => true);
  // Meta retired post_impressions*; these are the named replacements. Asked for together, and one at
  // a time if Meta refuses the set, so one retired name can't block the others.
  const wanted: Record<string, string> = { post_media_view: "views", post_total_media_view_unique: "reach", post_clicks: "clicks" };
  const refused = new Set<string>();
  return items.map((p) => ({
    platform: "facebook", native_id: String(p.id), permalink: p.permalink_url ?? null, caption: p.message ?? null,
    media_type: p.status_type ?? null, thumbnail_url: p.full_picture ?? null, published_at: p.created_time ?? null,
    metrics: { likes: p.reactions?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count ?? 0 },
    insights: async () => {
      const ask = Object.keys(wanted).filter((k) => !refused.has(k));
      if (!ask.length) return {};
      let got: Record<string, number> = {};
      try {
        got = insightValues(await getJson(`${base}/${p.id}/insights?metric=${ask.join(",")}&access_token=${pt}`));
      } catch {
        for (const k of ask) {
          try { Object.assign(got, insightValues(await getJson(`${base}/${p.id}/insights?metric=${k}&access_token=${pt}`))); }
          catch (e) { if (!refused.has(k)) { refused.add(k); notes.push(`facebook post ${k}: ${(e as Error).message}`); } }
        }
      }
      const m: Metrics = {};
      for (const [k, v] of Object.entries(got)) if (wanted[k]) m[wanted[k]] = v;
      return m;
    },
  }));
}

// ---------- Instagram ----------
async function instagram(token: string, igUserId: string, sinceMs: number, notes: string[]): Promise<Found[]> {
  const base = metaBase();
  const fields = "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count";
  const items = await listPages(`${base}/${igUserId}/media?fields=${fields}&limit=50&access_token=${token}`,
    (p) => (p.timestamp && new Date(p.timestamp).getTime() < sinceMs ? "stop" : true)); // newest first
  let errors = 0;
  return items.map((p) => ({
    platform: "instagram", native_id: String(p.id), permalink: p.permalink ?? null, caption: p.caption ?? null,
    media_type: p.media_product_type === "REELS" ? "REEL" : p.media_type ?? null,
    thumbnail_url: p.thumbnail_url ?? (p.media_type === "IMAGE" ? p.media_url : null) ?? null,
    published_at: p.timestamp ?? null,
    metrics: { likes: p.like_count, comments: p.comments_count },
    insights: async () => {
      // "views" is newer; if a post type refuses it, ask again without it.
      for (const set of ["reach,views,saved,shares", "reach,saved,shares"]) {
        try {
          const v = insightValues(await getJson(`${base}/${p.id}/insights?metric=${set}&access_token=${token}`));
          return { reach: v.reach, views: v.views, saves: v.saved, shares: v.shares };
        } catch (e) {
          if (set === "reach,saved,shares" && errors++ < 3) notes.push(`instagram post insights: ${(e as Error).message}`);
        }
      }
      return {};
    },
  }));
}

// ---------- Threads ----------
async function threadsPosts(token: string, userId: string, since: number, notes: string[]): Promise<Found[]> {
  const items: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES && items.length < MAX_POSTS; page++) {
    const d = await threads(token, `/${userId}/threads?fields=id,text,permalink,timestamp,media_type,thumbnail_url,media_url&since=${since}&limit=50${after ? `&after=${after}` : ""}`);
    const data = d.data ?? [];
    items.push(...data.filter((p: any) => p.media_type !== "REPOST_FACADE"));
    after = data.length && d.paging?.cursors?.after ? d.paging.cursors.after : undefined;
    if (!after) break;
  }
  let errors = 0;
  return items.slice(0, MAX_POSTS).map((p) => ({
    platform: "threads", native_id: String(p.id), permalink: p.permalink ?? null, caption: p.text ?? null,
    media_type: p.media_type ?? null, thumbnail_url: p.thumbnail_url ?? (p.media_type === "IMAGE" ? p.media_url : null) ?? null,
    published_at: p.timestamp ?? null,
    metrics: {},
    insights: async () => {
      try {
        const v = insightValues(await threads(token, `/${p.id}/insights?metric=views,likes,replies,reposts,quotes,shares`));
        return { views: v.views, likes: v.likes, comments: v.replies, reposts: v.reposts, quotes: v.quotes, shares: v.shares };
      } catch (e) {
        if (errors++ < 3) notes.push(`threads post insights: ${(e as Error).message}`);
        return {};
      }
    },
  }));
}

// ---------- TikTok (stats come with the list, no per-post requests) ----------
async function tiktokPosts(token: string, sinceSec: number): Promise<Found[]> {
  const out: Found[] = [];
  let cursor: number | undefined, done = false;
  const fields = "id,create_time,cover_image_url,share_url,title,video_description,view_count,like_count,comment_count,share_count";
  for (let page = 0; page < MAX_PAGES * 2.5 && !done && out.length < MAX_POSTS; page++) {
    const d = await tiktok(token, `/v2/video/list/?fields=${fields}`, { method: "POST", body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) });
    for (const v of d.videos ?? []) {
      if (Number(v.create_time) < sinceSec) { done = true; break; } // newest first
      out.push({
        platform: "tiktok", native_id: String(v.id), permalink: v.share_url ?? null, caption: v.video_description || v.title || null,
        media_type: "VIDEO", thumbnail_url: v.cover_image_url ?? null,
        published_at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
        metrics: { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count },
      });
    }
    if (!d.has_more || !(d.videos ?? []).length) break;
    cursor = d.cursor;
  }
  return out;
}

// ---------- matching dashboard posts ----------
/** Keys that identify a post from its link (and native id), so links in different forms still match. */
export function postKeys(platform: string, url?: string | null, nativeId?: string | null): string[] {
  const keys = new Set<string>();
  if (url) {
    const u = url.trim().split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, "");
    keys.add(u);
    const code = u.match(/\/(?:p|reel|reels|tv|post)\/([a-z0-9_-]+)/i)?.[1];
    if (code) keys.add(`code:${code}`);
    for (const id of url.match(/\d{8,}/g) ?? []) keys.add(`id:${id}`);
  }
  if (nativeId) {
    keys.add(`id:${nativeId}`);
    if (platform === "facebook" && nativeId.includes("_")) keys.add(`id:${nativeId.split("_")[1]}`);
  }
  return [...keys];
}

/** Run fn over items, `limit` at a time, not starting new ones after the deadline. */
async function mapLimit<T>(items: T[], limit: number, deadline: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) { const t = items[i++]; await fn(t); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function syncAccountPosts(db: SupabaseClient, notes: string[]): Promise<number> {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const sinceMs = started - WINDOW_DAYS * 86400000;
  const since = Math.floor(sinceMs / 1000);

  // Dashboard posts to link to, by matching links.
  const { data: targets } = await db.from("post_targets").select("id, platform, public_url")
    .eq("status", "published").not("public_url", "is", null).gte("published_at", new Date(sinceMs - 7 * 86400000).toISOString());
  const byKey = new Map<string, string>();
  for (const t of targets ?? []) for (const k of postKeys(t.platform, t.public_url)) byKey.set(`${t.platform}|${k}`, t.id);

  async function run(platform: string, list: () => Promise<Found[]>): Promise<number> {
    const found = await list();
    if (!found.length) return 0;
    const { data: prevRows } = await db.from("social_posts").select("native_id, metrics, metrics_updated_at").eq("platform", platform);
    const prev = new Map((prevRows ?? []).map((r) => [r.native_id, r]));
    const extra = new Map<string, Metrics>();
    const fetchedAt = new Map<string, string>();

    const due = found.filter((p) => {
      if (!p.insights) return false;
      const old = prev.get(p.native_id);
      const recent = p.published_at && Date.now() - new Date(p.published_at).getTime() < FRESH_DAYS * 86400000;
      return !old?.metrics_updated_at || recent || Date.now() - new Date(old.metrics_updated_at).getTime() > 20 * 3600000;
    });
    await mapLimit(due, CONCURRENCY, deadline, async (p) => {
      extra.set(p.native_id, await p.insights!());
      fetchedAt.set(p.native_id, new Date().toISOString());
    });
    if (due.length > fetchedAt.size) notes.push(`${platform}: stats for ${due.length - fetchedAt.size} older posts left for the next run`);

    const now = new Date().toISOString();
    const rows = found.map(({ insights: _i, ...p }) => {
      const old = prev.get(p.native_id);
      return {
        ...p,
        metrics: clean({ ...(old?.metrics ?? {}), ...p.metrics, ...(extra.get(p.native_id) ?? {}) }),
        metrics_updated_at: fetchedAt.get(p.native_id) ?? old?.metrics_updated_at ?? (p.platform === "tiktok" ? now : null),
        post_target_id: postKeys(p.platform, p.permalink, p.native_id).map((k) => byKey.get(`${p.platform}|${k}`)).find(Boolean) ?? null,
        updated_at: now,
      };
    });
    const { error } = await db.from("social_posts").upsert(rows);
    if (error) { notes.push(`${platform} save: ${error.message}`); return 0; }
    return rows.length;
  }

  const jobs: Promise<number>[] = [];
  const guard = (name: string, p: Promise<number>) => p.catch((e) => { notes.push(`${name} posts: ${(e as Error).message}`); return 0; });

  const metaToken = Deno.env.get("META_ACCESS_TOKEN");
  if (metaToken) {
    const { pageId, igUserId } = await getSetting<{ pageId?: string; igUserId?: string }>(db, "meta");
    if (pageId) jobs.push(guard("facebook", run("facebook", () => facebook(metaToken, pageId, since, notes))));
    if (igUserId) jobs.push(guard("instagram", run("instagram", () => instagram(metaToken, igUserId, sinceMs, notes))));
  }
  jobs.push(guard("threads", (async () => {
    const t = await threadsToken(db);
    return t ? run("threads", () => threadsPosts(t.token, t.userId, since, notes)) : 0;
  })()));
  jobs.push(guard("tiktok", (async () => {
    const t = await tiktokToken(db);
    return t ? run("tiktok", () => tiktokPosts(t, since)) : 0;
  })()));

  const counts = await Promise.all(jobs);
  return counts.reduce((a, b) => a + b, 0);
}
