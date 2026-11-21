// Connect the BAITCAMP TikTok account (admin only).
// Body:
//   { action: "status" }
//   { action: "start", redirect_uri }                 -> { url } to send the browser to TikTok
//   { action: "exchange", code, state, redirect_uri } -> saves the tokens
//   { action: "disconnect" }
// redirect_uri is <site>/settings/tiktok and must be registered exactly in the TikTok app.
import { getCaller, HttpError, serve } from "../_shared/common.ts";
import { tiktok, TIKTOK_AUTH_URL, TIKTOK_SCOPES, tiktokKeys, tokenRequest, tokenRow } from "../_shared/tiktok.ts";

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(text: string) {
  const { secret } = tiktokKeys();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}

/** state = time.nonce.signature, tied to the admin who started the sign-in; valid for 15 minutes. */
async function makeState(userId: string) {
  const payload = `${Date.now()}.${crypto.randomUUID().replace(/-/g, "")}`;
  return `${payload}.${await sign(`${payload}.${userId}`)}`;
}
async function checkState(state: string, userId: string) {
  const [ts, nonce, sig] = String(state ?? "").split(".");
  if (!ts || !nonce || !sig || sig !== await sign(`${ts}.${nonce}.${userId}`)) throw new HttpError(400, "The TikTok sign-in link is not valid. Start again from Settings.");
  if (Date.now() - Number(ts) > 15 * 60_000) throw new HttpError(400, "The TikTok sign-in took too long. Start again from Settings.");
}

function checkRedirect(uri: unknown): string {
  const u = String(uri ?? "");
  if (!/^https:\/\/[^?#]+\/settings\/tiktok$/.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/settings\/tiktok$/.test(u)) {
    throw new HttpError(400, "Invalid redirect address");
  }
  return u;
}

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (caller.role !== "admin") throw new HttpError(403, "Admin only");

  if (body.action === "status") {
    const configured = !!Deno.env.get("TIKTOK_CLIENT_KEY") && !!Deno.env.get("TIKTOK_CLIENT_SECRET");
    const { data } = await db.from("oauth_tokens").select("account_name, refresh_expires_at, updated_at, scope").eq("provider", "tiktok").maybeSingle();
    return { configured, connected: !!data, ...(data ?? {}) };
  }

  if (body.action === "start") {
    const { key } = tiktokKeys();
    const url = new URL(TIKTOK_AUTH_URL);
    url.search = new URLSearchParams({
      client_key: key,
      response_type: "code",
      scope: TIKTOK_SCOPES,
      redirect_uri: checkRedirect(body.redirect_uri),
      state: await makeState(caller.id!),
    }).toString();
    return { url: url.toString() };
  }

  if (body.action === "exchange") {
    await checkState(body.state, caller.id!);
    if (!body.code) throw new HttpError(400, "No sign-in code from TikTok");
    const t = await tokenRequest({ grant_type: "authorization_code", code: String(body.code), redirect_uri: checkRedirect(body.redirect_uri) });

    // Check the scopes we need were granted (the user can untick them on TikTok's consent screen).
    const granted = String(t.scope ?? "").split(",").map((s) => s.trim());
    const missing = TIKTOK_SCOPES.split(",").filter((s) => !granted.includes(s));

    let name = "";
    try {
      const d = await tiktok(t.access_token, "/v2/user/info/?fields=open_id,display_name,username");
      name = d.user?.username ? `@${d.user.username}` : d.user?.display_name ?? "";
    } catch { /* name is only for display */ }

    const { error } = await db.from("oauth_tokens").upsert(tokenRow(t, { account_name: name || null }));
    if (error) throw new Error(error.message);
    return { ok: true, account_name: name, missing_scopes: missing };
  }

  if (body.action === "disconnect") {
    await db.from("oauth_tokens").delete().eq("provider", "tiktok");
    return { ok: true };
  }

  throw new HttpError(400, "Unknown action");
});
