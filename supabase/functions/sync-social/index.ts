// Pulls account-level daily stats for Facebook and Instagram into public.metrics_daily.
// Body: { days?: number } (default 3, max 90)
//
// Secret: META_ACCESS_TOKEN (long-lived Page token)
// Settings (integration_settings): meta = { pageId, igUserId }
import { getCaller, getSetting, logSync, requireAdminOrCron, serve } from "../_shared/common.ts";

type Row = { platform: string; date: string; metric: string; value: number };
const day = (d: Date) => d.toISOString().slice(0, 10);

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${res.status}`);
  return data;
}

async function syncMeta(db: any, days: number, rows: Row[], notes: string[]) {
  const token = Deno.env.get("META_ACCESS_TOKEN");
  if (!token) { notes.push("meta: META_ACCESS_TOKEN not set, skipped"); return; }
  const base = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
  const today = day(new Date());
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const { pageId, igUserId } = await getSetting<{ pageId?: string; igUserId?: string }>(db, "meta");

  if (pageId) {
    // Page insights only accept a Page token. If the stored token is a user token, swap it
    // for the Page's own token here (a Page token simply returns itself).
    let pageToken = token;
    try {
      const p = await getJson(`${base}/${pageId}?fields=access_token&access_token=${token}`);
      if (p.access_token) pageToken = p.access_token;
      else notes.push("facebook: could not get a Page token; the login that made the token may not have full access to this Page");
    } catch (e) { notes.push(`facebook page token: ${(e as Error).message}`); }

    try {
      const page = await getJson(`${base}/${pageId}?fields=followers_count,fan_count&access_token=${pageToken}`);
      rows.push({ platform: "facebook", date: today, metric: "followers", value: page.followers_count ?? page.fan_count ?? 0 });
    } catch (e) { notes.push(`facebook followers: ${(e as Error).message}`); }

    // Each metric is requested separately so one retired metric name can't break the rest.
    const fbMetrics: Record<string, string> = {
      // Meta retired page_impressions_unique / page_impressions; these are the named replacements.
      page_total_media_view_unique: "reach",
      page_media_view: "impressions",
      page_post_engagements: "engagement",
      page_views_total: "profile_views",
      page_daily_follows_unique: "new_followers",
    };
    for (const [apiName, metric] of Object.entries(fbMetrics)) {
      try {
        const d = await getJson(`${base}/${pageId}/insights?metric=${apiName}&period=day&since=${since}&until=${until}&access_token=${pageToken}`);
        for (const v of d.data?.[0]?.values ?? []) {
          // end_time marks the end of the day measured
          const date = day(new Date(new Date(v.end_time).getTime() - 86400000));
          rows.push({ platform: "facebook", date, metric, value: Number(v.value) || 0 });
        }
      } catch (e) { notes.push(`facebook ${apiName}: ${(e as Error).message}`); }
    }
  } else notes.push("facebook: no pageId in settings, skipped");

  if (igUserId) {
    try {
      const ig = await getJson(`${base}/${igUserId}?fields=followers_count,media_count&access_token=${token}`);
      rows.push({ platform: "instagram", date: today, metric: "followers", value: ig.followers_count ?? 0 });
    } catch (e) { notes.push(`instagram followers: ${(e as Error).message}`); }

    try {
      const d = await getJson(`${base}/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${token}`);
      for (const v of d.data?.[0]?.values ?? []) {
        const date = day(new Date(new Date(v.end_time).getTime() - 86400000));
        rows.push({ platform: "instagram", date, metric: "reach", value: Number(v.value) || 0 });
      }
    } catch (e) { notes.push(`instagram reach: ${(e as Error).message}`); }

    // total_value metrics return one number per request, so ask one day at a time.
    const igTotals: Record<string, string> = {
      views: "impressions",
      total_interactions: "engagement",
      profile_views: "profile_views",
    };
    for (let i = 1; i <= days; i++) {
      const start = new Date(Date.now() - i * 86400000);
      start.setUTCHours(0, 0, 0, 0);
      const s = Math.floor(start.getTime() / 1000);
      try {
        const d = await getJson(`${base}/${igUserId}/insights?metric=${Object.keys(igTotals).join(",")}&metric_type=total_value&period=day&since=${s}&until=${s + 86400}&access_token=${token}`);
        for (const m of d.data ?? []) {
          const metric = igTotals[m.name];
          if (metric) rows.push({ platform: "instagram", date: day(start), metric, value: Number(m.total_value?.value) || 0 });
        }
      } catch (e) { notes.push(`instagram totals ${day(start)}: ${(e as Error).message}`); break; }
    }
  } else notes.push("instagram: no igUserId in settings, skipped");
}

serve(async (req, body, db) => {
  requireAdminOrCron(await getCaller(req, db));
  const days = Math.min(Math.max(Number(body.days) || 3, 1), 90);
  const rows: Row[] = [];
  const notes: string[] = [];

  await syncMeta(db, days, rows, notes);

  if (rows.length) {
    const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db.from("metrics_daily").upsert(stamped);
    if (error) notes.push(`save failed: ${error.message}`);
  }
  const ok = !notes.some((n) => !n.endsWith("skipped"));
  await logSync(db, "social", ok, `${rows.length} data points. ${notes.join(" | ")}`);
  return { ok, points: rows.length, notes };
});
