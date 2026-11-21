// Connect the BAITCAMP Threads account (admin only).
// Body:
//   { action: "status" }
//   { action: "start", redirect_uri }                 -> { url } to send the browser to Threads
//   { action: "exchange", code, state, redirect_uri } -> saves a long-lived token
//   { action: "disconnect" }
// redirect_uri is <site>/settings/threads and must be registered exactly in the Meta app's Threads settings.
import { getCaller, HttpError, serve } from "../_shared/common.ts";
import { checkRedirect, checkState, makeState } from "../_shared/oauth-state.ts";
import { exchangeCode, expiresAt, threads, THREADS_AUTH_URL, THREADS_SCOPES, threadsKeys } from "../_shared/threads.ts";

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (caller.role !== "admin") throw new HttpError(403, "Admin only");

  if (body.action === "status") {
    const configured = !!Deno.env.get("THREADS_APP_ID") && !!Deno.env.get("THREADS_APP_SECRET");
    const { data } = await db.from("oauth_tokens").select("account_name, expires_at, updated_at").eq("provider", "threads").maybeSingle();
    return { configured, connected: !!data, ...(data ?? {}) };
  }

  if (body.action === "start") {
    const { id, secret } = threadsKeys();
    const url = new URL(THREADS_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: id,
      redirect_uri: checkRedirect(body.redirect_uri, "threads"),
      scope: THREADS_SCOPES,
      response_type: "code",
      state: await makeState(secret, caller.id!),
    }).toString();
    return { url: url.toString() };
  }

  if (body.action === "exchange") {
    await checkState(threadsKeys().secret, body.state, caller.id!, "Threads");
    // Threads appends "#_" to the code; strip it in case it came through.
    const code = String(body.code ?? "").replace(/#_$/, "");
    if (!code) throw new HttpError(400, "No sign-in code from Threads");
    const t = await exchangeCode(code, checkRedirect(body.redirect_uri, "threads"));

    let name = "", userId = t.user_id;
    try {
      const me = await threads(t.access_token, "/me?fields=id,username");
      if (me.username) name = `@${me.username}`;
      if (me.id) userId = String(me.id);
    } catch { /* name is only for display */ }
    if (!userId) throw new HttpError(502, "Threads didn't say which account signed in. Try connecting again.");

    // Check insights access was granted (it can be unticked on the consent screen).
    let insights = true;
    try { await threads(t.access_token, `/${userId}/threads_insights?metric=followers_count`); } catch { insights = false; }

    const now = new Date().toISOString();
    const { error } = await db.from("oauth_tokens").upsert({
      provider: "threads", access_token: t.access_token, refresh_token: null, expires_at: expiresAt(t.expires_in),
      refresh_expires_at: null, account_id: userId, account_name: name || null, scope: THREADS_SCOPES, updated_at: now,
    });
    if (error) throw new Error(error.message);
    return { ok: true, account_name: name, missing_scopes: insights ? [] : ["threads_manage_insights"] };
  }

  if (body.action === "disconnect") {
    await db.from("oauth_tokens").delete().eq("provider", "threads");
    return { ok: true };
  }

  throw new HttpError(400, "Unknown action");
});
