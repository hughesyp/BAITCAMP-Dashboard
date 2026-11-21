// Every post on the connected accounts, with stats from the platform itself, into public.social_posts.
// Covers posts from the last 90 days on Facebook (Page), Instagram, Threads and TikTok. X isn't
// covered (its API is paid); its stats still come from Blotato on post_targets.
// Posts published through the dashboard are linked to their post_targets row by matching links.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting } from "./common.ts";
import { getJson, metaBase, pageToken } from "./meta.ts";
import { threads, threadsToken } from "./threads.ts";
import { tiktok, tiktokToken } from "./tiktok.ts";

const WINDOW_DAYS = 90;
const MAX_POSTS = 100; // per platform, newest first

interface SocialPost {
  platform: string; native_id: string; permalink: string | null; caption: string | null;
  media_type: string | null; thumbnail_url: string | null; published_at: string | null;
  metrics: Record<string, number>;
}

const n = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
function clean(m: Record<string, unknown>) {
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

// ---------- Facebook ----------
async function facebook(token: string, pageId: string, since: number, notes: string[]): Promise<SocialPost[]> {
  const base = metaBase();
  const pt = await pageToken(pageId, token, notes);
  const fields = "id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
  let url: string | null = `${base}/${pageId}/posts?fields=${fields}&since=${since}&limit=50&access_token=${pt}`;
  const items: any[] = [];
  while (url && items.length < MAX_POSTS) {
    const d = await getJson(url);
    items.push(...(d.data ?? []));
    url = d.paging?.next ?? null;
  }
  // Meta retired post_impressions*; these are the named replacements. Metrics are asked for together,
  // and one at a time if Meta refuses the set (so one retired name can't block the others).
  const wanted: Record<string, string> = { post_media_view: "views", post_total_media_view_unique: "reach", post_clicks: "clicks" };
  const refused = new Set<string>();
  const out: SocialPost[] = [];
  for (const p of items.slice(0, MAX_POSTS)) {
    const m: Record<string, unknown> = {
      likes: p.reactions?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count ?? 0,
    };
    const ask = Object.keys(wanted).filter((k) => !refused.has(k));
    let got: Record<string, number> = {};
    try {
      got = insightValues(await getJson(`${base}/${p.id}/insights?metric=${ask.join(",")}&access_token=${pt}`));
    } catch {
      for (const k of ask) {
        try { Object.assign(got, insightValues(await getJson(`${base}/${p.id}/insights?metric=${k}&access_token=${pt}`))); }
        catch (e) { refused.add(k); notes.push(`facebook post ${k}: ${(e as Error).message}`); }
      }
    }
    for (const [k, v] of Object.entries(got)) if (wanted[k]) m[wanted[k]] = v;
    out.push({
      platform: "facebook", native_id: String(p.id), permalink: p.permalink_url ?? null, caption: p.message ?? null,
      media_type: p.status_type ?? null, thumbnail_url: p.full_picture ?? null, published_at: p.created_time ?? null, metrics: clean(m),
    });
  }
  return out;
}

// ---------- Instagram ----------
async function instagram(token: string, igUserId: string, sinceMs: number, notes: string[]): Promise<SocialPost[]> {
  const base = metaBase();
  const fields = "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count";
  let url: string | null = `${base}/${igUserId}/media?fields=${fields}&limit=50&access_token=${token}`;
  const items: any[] = [];
  outer: while (url && items.length < MAX_POSTS) {
    const d = await getJson(url);
    for (const p of d.data ?? []) {
      if (p.timestamp && new Date(p.timestamp).getTime() < sinceMs) break outer; // newest first
      items.push(p);
    }
    url = d.paging?.next ?? null;
  }
  const out: SocialPost[] = [];
  let insightErrors = 0;
  for (const p of items.slice(0, MAX_POSTS)) {
    const m: Record<string, unknown> = { likes: p.like_count, comments: p.comments_count };
    // "views" is newer; if a post type refuses it, ask again without it.
    for (const set of ["reach,views,saved,shares", "reach,saved,shares"]) {
      try {
        const v = insightValues(await getJson(`${base}/${p.id}/insights?metric=${set}&access_token=${token}`));
        Object.assign(m, { reach: v.reach, views: v.views, saves: v.saved, shares: v.shares });
        break;
      } catch (e) {
        if (set === "reach,saved,shares" && insightErrors++ < 3) notes.push(`instagram post insights: ${(e as Error).message}`);
      }
    }
    out.push({
      platform: "instagram", native_id: String(p.id), permalink: p.permalink ?? null, caption: p.caption ?? null,
      media_type: p.media_product_type === "REELS" ? "REEL" : p.media_type ?? null,
      thumbnail_url: p.thumbnail_url ?? (p.media_type === "IMAGE" ? p.media_url : null) ?? null,
      published_at: p.timestamp ?? null, metrics: clean(m),
    });
  }
  return out;
}

// ---------- Threads ----------
async function threadsPosts(token: string, userId: string, since: number, notes: string[]): Promise<SocialPost[]> {
  const items: any[] = [];
  let after: string | undefined;
  do {
    const d = await threads(token, `/${userId}/threads?fields=id,text,permalink,timestamp,media_type,thumbnail_url,media_url&since=${since}&limit=50${after ? `&after=${after}` : ""}`);
    items.push(...(d.data ?? []).filter((p: any) => p.media_type !== "REPOST_FACADE"));
    after = (d.data ?? []).length && d.paging?.cursors?.after ? d.paging.cursors.after : undefined;
  } while (after && items.length < MAX_POSTS);
  const out: SocialPost[] = [];
  let insightErrors = 0;
  for (const p of items.slice(0, MAX_POSTS)) {
    let v: Record<string, number> = {};
    try { v = insightValues(await threads(token, `/${p.id}/insights?metric=views,likes,replies,reposts,quotes,shares`)); }
    catch (e) { if (insightErrors++ < 3) notes.push(`threads post insights: ${(e as Error).message}`); }
    out.push({
      platform: "threads", native_id: String(p.id), permalink: p.permalink ?? null, caption: p.text ?? null,
      media_type: p.media_type ?? null, thumbnail_url: p.thumbnail_url ?? (p.media_type === "IMAGE" ? p.media_url : null) ?? null,
      published_at: p.timestamp ?? null,
      metrics: clean({ views: v.views, likes: v.likes, comments: v.replies, reposts: v.reposts, quotes: v.quotes, shares: v.shares }),
    });
  }
  return out;
}

// ---------- TikTok ----------
async function tiktokPosts(token: string, sinceSec: number): Promise<SocialPost[]> {
  const out: SocialPost[] = [];
  let cursor: number | undefined, pages = 0, done = false;
  const fields = "id,create_time,cover_image_url,share_url,title,video_description,view_count,like_count,comment_count,share_count";
  do {
    const d = await tiktok(token, `/v2/video/list/?fields=${fields}`, { method: "POST", body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) });
    for (const v of d.videos ?? []) {
      if (Number(v.create_time) < sinceSec) { done = true; break; } // newest first
      out.push({
        platform: "tiktok", native_id: String(v.id), permalink: v.share_url ?? null, caption: v.video_description || v.title || null,
        media_type: "VIDEO", thumbnail_url: v.cover_image_url ?? null,
        published_at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
        metrics: clean({ views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count }),
      });
    }
    cursor = d.has_more ? d.cursor : undefined;
  } while (!done && cursor && out.length < MAX_POSTS && ++pages < 5);
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

export async function syncAccountPosts(db: SupabaseClient, notes: string[]): Promise<number> {
  const sinceMs = Date.now() - WINDOW_DAYS * 86400000;
  const since = Math.floor(sinceMs / 1000);
  const found: SocialPost[] = [];

  const metaToken = Deno.env.get("META_ACCESS_TOKEN");
  if (metaToken) {
    const { pageId, igUserId } = await getSetting<{ pageId?: string; igUserId?: string }>(db, "meta");
    if (pageId) {
      try { found.push(...await facebook(metaToken, pageId, since, notes)); } catch (e) { notes.push(`facebook posts: ${(e as Error).message}`); }
    }
    if (igUserId) {
      try { found.push(...await instagram(metaToken, igUserId, sinceMs, notes)); } catch (e) { notes.push(`instagram posts: ${(e as Error).message}`); }
    }
  }
  try {
    const t = await threadsToken(db);
    if (t) found.push(...await threadsPosts(t.token, t.userId, since, notes));
  } catch (e) { notes.push(`threads posts: ${(e as Error).message}`); }
  try {
    const t = await tiktokToken(db);
    if (t) found.push(...await tiktokPosts(t, since));
  } catch (e) { notes.push(`tiktok posts: ${(e as Error).message}`); }

  if (!found.length) return 0;

  // Link to dashboard posts by matching links.
  const { data: targets } = await db.from("post_targets").select("id, platform, public_url")
    .eq("status", "published").not("public_url", "is", null).gte("published_at", new Date(sinceMs - 7 * 86400000).toISOString());
  const byKey = new Map<string, string>();
  for (const t of targets ?? []) for (const k of postKeys(t.platform, t.public_url)) byKey.set(`${t.platform}|${k}`, t.id);

  const now = new Date().toISOString();
  const rows = found.map((p) => {
    const target = postKeys(p.platform, p.permalink, p.native_id).map((k) => byKey.get(`${p.platform}|${k}`)).find(Boolean) ?? null;
    return { ...p, post_target_id: target, metrics_updated_at: now, updated_at: now };
  });
  const { error } = await db.from("social_posts").upsert(rows);
  if (error) notes.push(`save posts: ${error.message}`);
  return rows.length;
}
