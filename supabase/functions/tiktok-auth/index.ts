// Connect the BAITCAMP TikTok account (admin only).
// Body:
//   { action: "status" }
//   { action: "start", redirect_uri }                 -> { url } to send the browser to TikTok
//   { action: "exchange", code, state, redirect_uri } -> saves the tokens
//   { action: "disconnect" }
// redirect_uri is <site>/settings/tiktok and must be registered exactly in the TikTok app.
import { getCaller, HttpError, serve } from "../_shared/common.ts";
import { checkRedirect, checkState, makeState } from "../_shared/oauth-state.ts";
import { tiktok, TIKTOK_AUTH_URL, TIKTOK_SCOPES, tiktokKeys, tokenRequest, tokenRow } from "../_shared/tiktok.ts";

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
      redirect_uri: checkRedirect(body.redirect_uri, "tiktok"),
      state: await makeState(tiktokKeys().secret, caller.id!),
    }).toString();
    return { url: url.toString() };
  }

  if (body.action === "exchange") {
    await checkState(tiktokKeys().secret, body.state, caller.id!, "TikTok");
    if (!body.code) throw new HttpError(400, "No sign-in code from TikTok");
    const t = await tokenRequest({ grant_type: "authorization_code", code: String(body.code), redirect_uri: checkRedirect(body.redirect_uri, "tiktok") });

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
