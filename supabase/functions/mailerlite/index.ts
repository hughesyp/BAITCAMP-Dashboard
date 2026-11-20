// MailerLite actions for the dashboard.
// Body: { action: "groups" }                 -> { groups: [{ id, name, active_count }] }
//       { action: "push", id: "<uuid>" }     -> creates or updates the MailerLite DRAFT for a dashboard email.
//       { action: "html", id: "<uuid>" }     -> { html } the email as it will be sent (for copying in by hand)
// Nothing here sends or schedules an email; that is done by the admin inside MailerLite.
// Settings (integration_settings): mailerlite = { from, from_name, reply_to? }
import { marked } from "npm:marked@12";
import { getCaller, getSetting, HttpError, serve } from "../_shared/common.ts";
import { ml, MailerLiteError } from "../_shared/mailerlite.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** BAITCAMP email layout (stands in for MailerLite templates, which the API can't list). */
export function emailHtml(subject: string, bodyMd: string): string {
  const body = marked.parse(bodyMd ?? "", { async: false }) as string;
  const style = {
    p: "margin:0 0 16px;font-size:16px;line-height:1.6;color:#2b2b2b;",
    h2: "margin:24px 0 12px;font-size:20px;line-height:1.3;color:#2b2b2b;",
    a: "color:#c53c11;text-decoration:underline;",
    li: "margin:0 0 8px;font-size:16px;line-height:1.6;color:#2b2b2b;",
    quote: "margin:0 0 16px;padding:8px 16px;border-left:4px solid #eb4f1e;background:#fdf2ee;color:#474747;",
  };
  const styled = body
    .replace(/<p>/g, `<p style="${style.p}">`)
    .replace(/<h[1-3]>/g, `<h2 style="${style.h2}">`).replace(/<\/h[1-3]>/g, "</h2>")
    .replace(/<a /g, `<a style="${style.a}" `)
    .replace(/<li>/g, `<li style="${style.li}">`)
    .replace(/<blockquote>/g, `<blockquote style="${style.quote}">`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Inter,Arial,Helvetica,sans-serif;">
<tr><td style="background:#eb4f1e;padding:18px 28px;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">BAITCAMP</td></tr>
<tr><td style="padding:28px;">${styled}</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:12px;line-height:1.5;color:#6b7280;border-top:1px solid #eeeeee;">
You're receiving this because you signed up at <a href="https://baitcamp.net" style="color:#6b7280;">baitcamp.net</a>.
<a href="{$unsubscribe}" style="color:#6b7280;">Unsubscribe</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);

  if (body.action === "groups") {
    const r = await ml("/groups?limit=1000&sort=name");
    return { groups: (r.data ?? []).map((g: any) => ({ id: String(g.id), name: g.name, active_count: g.active_count ?? 0 })) };
  }

  const { data: row } = await db.from("email_campaigns").select("*").eq("id", String(body.id ?? "")).maybeSingle();
  if (!row) throw new HttpError(404, "Email not found");
  if (caller.role !== "admin" && row.author_id !== caller.id) throw new HttpError(403, "Not your email");

  if (body.action === "html") return { html: emailHtml(row.subject, row.body_md ?? "") };

  if (body.action === "push") {
    if (row.ml_status && row.ml_status !== "draft") throw new HttpError(400, `It's already ${row.ml_status} in MailerLite and can't be changed from here`);
    if (!row.subject.trim()) throw new HttpError(400, "Add a subject first");
    if (!(row.body_md ?? "").trim()) throw new HttpError(400, "Write the email first");
    const sender = await getSetting<{ from?: string; from_name?: string; reply_to?: string }>(db, "mailerlite");
    if (!sender.from || !sender.from_name) throw new HttpError(400, "The sender email and name aren't set yet (admin: Settings → MailerLite)");

    const email: Record<string, string> = { subject: row.subject, from_name: sender.from_name, from: sender.from };
    if (sender.reply_to) email.reply_to = sender.reply_to;
    const payload = (withContent: boolean) => ({
      name: row.name,
      type: "regular",
      emails: [withContent ? { ...email, content: emailHtml(row.subject, row.body_md) } : email],
      groups: row.group_ids ?? [],
    });
    const send = (p: unknown) => row.mailerlite_id
      ? ml(`/campaigns/${row.mailerlite_id}`, { method: "PUT", body: JSON.stringify(p) })
      : ml("/campaigns", { method: "POST", body: JSON.stringify(p) });

    let res: any;
    let contentPushed = true;
    try {
      res = await send(payload(true));
    } catch (e) {
      // Some MailerLite plans refuse email content via the API. Create the draft without it;
      // the admin pastes the content in MailerLite (the dashboard offers the HTML to copy).
      const plan = e instanceof MailerLiteError && e.status === 422 && /content|plan/i.test(JSON.stringify(e.body ?? {}));
      if (!plan) {
        await db.from("email_campaigns").update({ error_message: (e as Error).message.slice(0, 500) }).eq("id", row.id);
        throw new HttpError(502, (e as Error).message);
      }
      res = await send(payload(false));
      contentPushed = false;
    }
    const c = res.data ?? res;
    await db.from("email_campaigns").update({
      mailerlite_id: String(c.id), ml_status: c.status ?? "draft", content_pushed: contentPushed,
      pushed_at: new Date().toISOString(), error_message: null,
    }).eq("id", row.id);
    return { ok: true, content_pushed: contentPushed };
  }

  throw new HttpError(400, "Unknown action");
});
