// Updates publishing status and performance metrics of posts sent through Blotato.
// Any signed-in user can trigger it (it only reads from Blotato); also run by the scheduler.
import { blotato, getCaller, logSync, serve } from "../_shared/common.ts";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));

function cleanMetrics(m: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    const n = num(v);
    if (n !== undefined && !Number.isNaN(n)) out[k.replace(/_count$/, "").replace(/Count$/, "")] = n;
  }
  return out;
}

serve(async (req, _body, db) => {
  await getCaller(req, db);
  const notes: string[] = [];
  let statusUpdates = 0;
  let metricUpdates = 0;

  // 1. Status of submissions still in flight
  const { data: pending } = await db.from("post_targets")
    .select("id, post_id, blotato_submission_id")
    .in("status", ["in-progress", "scheduled"])
    .not("blotato_submission_id", "is", null)
    .limit(50);

  for (const t of pending ?? []) {
    try {
      const s = await blotato(`/posts/${t.blotato_submission_id}`);
      if (s.status === "published") {
        await db.from("post_targets").update({
          status: "published", public_url: s.publicUrl ?? null, published_at: new Date().toISOString(), error_message: null,
        }).eq("id", t.id);
        statusUpdates++;
      } else if (s.status === "failed") {
        await db.from("post_targets").update({ status: "failed", error_message: s.errorMessage ?? "Publishing failed" }).eq("id", t.id);
        statusUpdates++;
      }
    } catch (e) { notes.push(`status ${t.id}: ${(e as Error).message}`); }
  }

  // Roll target statuses up to the parent post
  const postIds = [...new Set((pending ?? []).map((t) => t.post_id))];
  for (const id of postIds) {
    const { data: ts } = await db.from("post_targets").select("status").eq("post_id", id);
    const st = (ts ?? []).map((x) => x.status);
    let status: string | null = null;
    if (st.every((x) => x === "published")) status = "published";
    else if (st.every((x) => x === "failed")) status = "failed";
    else if (st.some((x) => x === "failed") && !st.some((x) => x === "in-progress" || x === "scheduled")) status = "partial";
    if (status) await db.from("posts").update({ status }).eq("id", id);
  }

  // 2. Metrics for posts published in the last 90 days. Blotato reports metrics per published
  //    post, matched here by public URL. (Blotato has no LinkedIn analytics.)
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: published } = await db.from("post_targets")
    .select("id, platform, public_url, blotato_post_id")
    .eq("status", "published")
    .gte("published_at", since);

  const platforms = [...new Set((published ?? []).map((p) => p.platform))].filter((p) => p !== "linkedin");
  for (const platform of platforms) {
    try {
      const res = await blotato(`/analytics?since=${encodeURIComponent(since)}&platform=${platform}&limit=100`);
      const items: any[] = res.items ?? res.data ?? (Array.isArray(res) ? res : []);
      for (const p of (published ?? []).filter((x) => x.platform === platform)) {
        const strip = (u?: string | null) => (u ?? "").split("?")[0].replace(/\/$/, "");
        const hit = items.find((i) => (p.blotato_post_id && i.id === p.blotato_post_id) || (p.public_url && strip(i.postUrl) === strip(p.public_url)));
        if (!hit) continue;
        await db.from("post_targets").update({
          blotato_post_id: hit.id,
          metrics: cleanMetrics(hit.latestMetrics),
          metrics_updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        metricUpdates++;
      }
    } catch (e) { notes.push(`analytics ${platform}: ${(e as Error).message}`); }
  }

  await logSync(db, "posts", notes.length === 0, `${statusUpdates} status, ${metricUpdates} metric updates. ${notes.join(" | ")}`);
  return { ok: notes.length === 0, statusUpdates, metricUpdates, notes };
});
