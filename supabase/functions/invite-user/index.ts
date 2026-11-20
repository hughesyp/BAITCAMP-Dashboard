// Admin invites a marketer by email and sets their terms.
// Body: { email, full_name, start_date (YYYY-MM-DD), rev_share_pct, role?, redirect_to }
import { getCaller, HttpError, serve } from "../_shared/common.ts";

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (caller.role !== "admin") throw new HttpError(403, "Admin only");

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email");
  const pct = Number(body.rev_share_pct ?? 0);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) throw new HttpError(400, "Revenue share must be 0-100");

  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    data: { full_name: body.full_name ?? "" },
    redirectTo: body.redirect_to || undefined,
  });
  if (error || !data.user) throw new HttpError(400, error?.message ?? "Invite failed");

  const { error: upErr } = await db.from("profiles").update({
    full_name: body.full_name || email.split("@")[0],
    role: body.role === "admin" ? "admin" : "marketer",
    start_date: body.start_date || new Date().toISOString().slice(0, 10),
    rev_share_pct: pct,
    active: true,
  }).eq("id", data.user.id);
  if (upErr) throw new HttpError(500, upErr.message);

  return { ok: true, id: data.user.id };
});
