// Pulls account-level daily stats for Facebook, Instagram and LinkedIn into public.metrics_daily.
// Body: { days?: number } (default 3, max 90)
//
// Secrets: META_ACCESS_TOKEN (long-lived Page token), LINKEDIN_ACCESS_TOKEN
// Settings (integration_settings): meta = { pageId, igUserId }, linkedin = { organizationId }
import { getCaller, getSetting, logSync, requireAdminOrCron, serve } from "../_shared/common.ts";

type Row = { platform: string; date: string; metric: string; value: number };
const day = (d: Date) => d.toISOString().slice(0, 10);

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${res.status}`);
  return data;
}

async function syncMeta(days: number, rows: Row[], notes: string[]) {
  const token = Deno.env.get("META_ACCESS_TOKEN");
  if (!token) { notes.push("meta: META_ACCESS_TOKEN not set, skipped"); return; }
  const v = Deno.env.get("META_GRAPH_VERSION") ?? "v23.0";
  const base = `https://graph.facebook.com/${v}`;
  const today = day(new Date());
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  return { base, token, today, since, until };
}

async function syncFacebook(db: any, days: number, rows: Row[], notes: string[]) {
  const ctx = await syncMeta(days, rows, notes);
  if (!ctx) return;
  const { pageId, igUserId } = await getSetting<{ pageId?: string; igUserId?: string }>(db, "meta");
  const { base, token, today, since, until } = ctx;

  if (pageId) {
    try {
      const page = await getJson(`${base}/${pageId}?fields=followers_count,fan_count&access_token=${token}`);
      rows.push({ platform: "facebook", date: today, metric: "followers", value: page.followers_count ?? page.fan_count ?? 0 });
    } catch (e) { notes.push(`facebook followers: ${(e as Error).message}`); }

    // Each metric is requested separately so one retired metric name can't break the rest.
    const fbMetrics: Record<string, string> = {
      page_impressions_unique: "reach",
      page_post_engagements: "engagement",
      page_views_total: "profile_views",
      page_daily_follows_unique: "new_followers",
    };
    for (const [apiName, metric] of Object.entries(fbMetrics)) {
      try {
        const d = await getJson(`${base}/${pageId}/insights?metric=${apiName}&period=day&since=${since}&until=${until}&access_token=${token}`);
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

async function syncLinkedIn(db: any, days: number, rows: Row[], notes: string[]) {
  const token = Deno.env.get("LINKEDIN_ACCESS_TOKEN");
  if (!token) { notes.push("linkedin: LINKEDIN_ACCESS_TOKEN not set, skipped"); return; }
  const { organizationId } = await getSetting<{ organizationId?: string }>(db, "linkedin");
  if (!organizationId) { notes.push("linkedin: no organizationId in settings, skipped"); return; }

  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": Deno.env.get("LINKEDIN_API_VERSION") ?? "202610",
    "X-Restli-Protocol-Version": "2.0.0",
  };
  const urn = encodeURIComponent(`urn:li:organization:${organizationId}`);
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - days * 86400000);
  const interval = `(timeRange:(start:${start.getTime()},end:${end.getTime()}),timeGranularityType:DAY)`;

  try {
    const d = await getJson(`https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, headers);
    rows.push({ platform: "linkedin", date: day(new Date()), metric: "followers", value: d.firstDegreeSize ?? 0 });
  } catch (e) { notes.push(`linkedin followers: ${(e as Error).message}`); }

  try {
    const d = await getJson(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${interval}`, headers);
    for (const el of d.elements ?? []) {
      const date = day(new Date(el.timeRange.start));
      const s = el.totalShareStatistics ?? {};
      rows.push({ platform: "linkedin", date, metric: "impressions", value: s.impressionCount ?? 0 });
      rows.push({ platform: "linkedin", date, metric: "reach", value: s.uniqueImpressionsCount ?? 0 });
      rows.push({ platform: "linkedin", date, metric: "clicks", value: s.clickCount ?? 0 });
      rows.push({ platform: "linkedin", date, metric: "engagement", value: (s.likeCount ?? 0) + (s.commentCount ?? 0) + (s.shareCount ?? 0) + (s.clickCount ?? 0) });
    }
  } catch (e) { notes.push(`linkedin share stats: ${(e as Error).message}`); }

  try {
    const d = await getJson(`https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${interval}`, headers);
    for (const el of d.elements ?? []) {
      const g = el.followerGains ?? {};
      rows.push({ platform: "linkedin", date: day(new Date(el.timeRange.start)), metric: "new_followers", value: (g.organicFollowerGain ?? 0) + (g.paidFollowerGain ?? 0) });
    }
  } catch (e) { notes.push(`linkedin follower stats: ${(e as Error).message}`); }
}

serve(async (req, body, db) => {
  requireAdminOrCron(await getCaller(req, db));
  const days = Math.min(Math.max(Number(body.days) || 3, 1), 90);
  const rows: Row[] = [];
  const notes: string[] = [];

  await syncFacebook(db, days, rows, notes);
  await syncLinkedIn(db, days, rows, notes);

  if (rows.length) {
    const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db.from("metrics_daily").upsert(stamped);
    if (error) notes.push(`save failed: ${error.message}`);
  }
  const ok = !notes.some((n) => !n.endsWith("skipped"));
  await logSync(db, "social", ok, `${rows.length} data points. ${notes.join(" | ")}`);
  return { ok, points: rows.length, notes };
});
