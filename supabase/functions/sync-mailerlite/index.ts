// Pulls MailerLite stats: subscriber counts into metrics_daily (platform "mailerlite") and
// campaigns (status + stats) into email_campaigns.
// Body: { days?: number } (default 3, max 90) — how many past days of new/unsubscribed counts to (re)build.
import { getCaller, logSync, requireAdminOrCron, serve } from "../_shared/common.ts";
import { ml, MailerLiteError } from "../_shared/mailerlite.ts";

const day = (d: Date) => d.toISOString().slice(0, 10);

serve(async (req, body, db) => {
  requireAdminOrCron(await getCaller(req, db));
  const days = Math.min(Math.max(Number(body.days) || 3, 1), 90);
  const notes: string[] = [];
  const rows: { platform: string; date: string; metric: string; value: number }[] = [];
  const today = day(new Date());

  // 1. Active subscribers right now (MailerLite keeps no history, so this builds up day by day).
  try {
    const r = await ml("/subscribers?limit=0&filter[status]=active");
    rows.push({ platform: "mailerlite", date: today, metric: "subscribers", value: Number(r.total) || 0 });
  } catch (e) { notes.push(`subscribers: ${(e as Error).message}`); }

  // 2. New subscribers per day (includes people who later unsubscribed, i.e. gross signups).
  for (let i = 0; i < days; i++) {
    const d = day(new Date(Date.now() - i * 86400000));
    try {
      const r = await ml(`/subscribers?limit=0&filter[subscribed_from]=${d}&filter[subscribed_to]=${d}`);
      rows.push({ platform: "mailerlite", date: d, metric: "new_subscribers", value: Number(r.total) || 0 });
    } catch (e) { notes.push(`new ${d}: ${(e as Error).message}`); break; }
  }

  // 3. Unsubscribes per day: newest unsubscribes first, until older than the window.
  try {
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const counts = new Map<string, number>();
    for (let i = 0; i < days; i++) counts.set(day(new Date(Date.now() - i * 86400000)), 0);
    let cursor: string | null = null;
    outer: for (let page = 0; page < 20; page++) {
      const r = await ml(`/subscribers?filter[status]=unsubscribed&sort=-unsubscribed_at&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const s of r.data ?? []) {
        if (!s.unsubscribed_at) continue;
        const at = new Date(s.unsubscribed_at.replace(" ", "T") + (s.unsubscribed_at.includes("Z") || s.unsubscribed_at.includes("+") ? "" : "Z"));
        if (at < since) break outer;
        const k = day(at);
        if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
      }
      cursor = r.meta?.next_cursor ?? null;
      if (!cursor) break;
    }
    for (const [d, v] of counts) rows.push({ platform: "mailerlite", date: d, metric: "unsubscribes", value: v });
  } catch (e) { notes.push(`unsubscribes: ${(e as Error).message}`); }

  if (rows.length) {
    const { error } = await db.from("metrics_daily").upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
    if (error) notes.push(`save metrics: ${error.message}`);
  }

  // 4. Sent campaigns and their stats (most recent 500).
  let campaigns = 0;
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await ml(`/campaigns?filter[status]=sent&limit=100&page=${page}`);
      for (const c of r.data ?? []) {
        const email = c.emails?.[0] ?? {};
        const row = {
          mailerlite_id: String(c.id),
          name: c.name ?? email.subject ?? "Campaign",
          subject: email.subject ?? "",
          ml_status: c.status ?? "sent",
          sent_at: c.finished_at ?? c.started_at ?? c.scheduled_for ?? c.updated_at ?? null,
          stats: c.stats ?? email.stats ?? {},
          updated_at: new Date().toISOString(),
        };
        const { data: existing } = await db.from("email_campaigns").select("id").eq("mailerlite_id", row.mailerlite_id).maybeSingle();
        const { error } = existing
          ? await db.from("email_campaigns").update(row).eq("id", existing.id)
          : await db.from("email_campaigns").insert(row);
        if (error) notes.push(`campaign ${c.id}: ${error.message}`);
        else campaigns++;
      }
      if (!r.meta || page >= (r.meta.last_page ?? 1)) break;
    }
  } catch (e) { notes.push(`campaigns: ${(e as Error).message}`); }

  // 5. Drafts pushed from the dashboard: pick up status changes made in MailerLite.
  const { data: pending } = await db.from("email_campaigns").select("id, mailerlite_id")
    .not("mailerlite_id", "is", null).neq("ml_status", "sent").limit(50);
  for (const p of pending ?? []) {
    try {
      const r = await ml(`/campaigns/${p.mailerlite_id}`);
      const c = r.data ?? r;
      await db.from("email_campaigns").update({
        ml_status: c.status, stats: c.stats ?? {}, sent_at: c.finished_at ?? c.scheduled_for ?? null, updated_at: new Date().toISOString(),
      }).eq("id", p.id);
    } catch (e) {
      if (e instanceof MailerLiteError && e.status === 404) {
        await db.from("email_campaigns").update({ ml_status: "deleted" }).eq("id", p.id);
      } else notes.push(`draft ${p.mailerlite_id}: ${(e as Error).message}`);
    }
  }

  const ok = notes.length === 0;
  await logSync(db, "mailerlite", ok, `${rows.length} data points, ${campaigns} campaigns. ${notes.join(" | ")}`);
  return { ok, points: rows.length, campaigns, notes };
});
