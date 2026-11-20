// Pulls sales from the Gumroad API into public.sales.
// Body: { days?: number }  (default 35; use a large number for a first backfill)
import { getCaller, HttpError, logSync, requireAdminOrCron, serve } from "../_shared/common.ts";

function normaliseSource(referrer: string | null | undefined): string {
  if (!referrer) return "direct";
  const r = referrer.toLowerCase().trim();
  if (r === "direct" || r === "") return "direct";
  let host = r;
  try { host = new URL(r.startsWith("http") ? r : `https://${r}`).hostname; } catch { /* keep as is */ }
  host = host.replace(/^(www|m|l|lm|mobile)\./, "");
  if (host.includes("facebook") || host === "fb.com" || host === "fb.me") return "facebook";
  if (host.includes("instagram")) return "instagram";
  if (host.includes("threads.")) return "threads";
  if (host === "t.co" || host.includes("twitter") || host === "x.com") return "x";
  if (host.includes("tiktok")) return "tiktok";
  if (host.includes("youtube") || host === "youtu.be") return "youtube";
  if (host.includes("google")) return "google";
  if (host.includes("bing")) return "bing";
  if (host.includes("gumroad")) return "gumroad";
  if (host.includes("mail") || host.includes("outlook")) return "email";
  return host;
}

serve(async (req, body, db) => {
  requireAdminOrCron(await getCaller(req, db));
  const token = Deno.env.get("GUMROAD_ACCESS_TOKEN");
  if (!token) throw new HttpError(400, "GUMROAD_ACCESS_TOKEN is not set");

  const days = Math.min(Math.max(Number(body.days) || 35, 1), 3650);
  const after = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  let pageKey: string | null = null;
  let total = 0;
  try {
    for (let page = 0; page < 500; page++) {
      const url = new URL("https://api.gumroad.com/v2/sales");
      url.searchParams.set("after", after);
      if (pageKey) url.searchParams.set("page_key", pageKey);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(`Gumroad ${res.status}: ${data?.message ?? "request failed"}`);
      }
      const rows = (data.sales ?? []).map((s: any) => ({
        id: String(s.id),
        created_at: s.created_at,
        product_id: s.product_id ?? null,
        product_name: s.product_name ?? null,
        price_cents: Number(s.price) || 0,
        fee_cents: Number(s.gumroad_fee) || 0,
        currency: (s.currency ?? s.currency_symbol ?? "usd").toString().toLowerCase(),
        refunded: !!s.refunded,
        partially_refunded: !!s.partially_refunded,
        chargedback: !!(s.chargedback ?? s.disputed),
        referrer: s.referrer ?? null,
        source: normaliseSource(s.referrer),
        quantity: Number(s.quantity) || 1,
        raw: s,
        synced_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error } = await db.from("sales").upsert(rows);
        if (error) throw new Error(error.message);
        total += rows.length;
      }
      pageKey = data.next_page_key ?? null;
      if (!pageKey) break;
    }
    await logSync(db, "gumroad", true, `Synced ${total} sales since ${after}`);
    return { ok: true, synced: total, since: after };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(db, "gumroad", false, msg);
    throw new HttpError(502, msg);
  }
});
