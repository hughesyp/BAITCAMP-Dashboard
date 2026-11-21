// Threads API (Meta). Secrets: THREADS_APP_ID, THREADS_APP_SECRET (the Threads app ID and
// secret from the Meta app's Threads use case, not the main Meta app ID).
// Token lives in public.oauth_tokens (provider 'threads'). It is a long-lived token (60 days);
// each sync renews it once it is a day old, which resets the 60 days.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./common.ts";

// Overridable for local testing against a stand-in server.
export const THREADS_API = Deno.env.get("THREADS_API_URL") ?? "https://graph.threads.com";
export const THREADS_AUTH_URL = "https://threads.com/oauth/authorize";
export const THREADS_SCOPES = "threads_basic,threads_manage_insights";

export function threadsKeys() {
  const id = Deno.env.get("THREADS_APP_ID");
  const secret = Deno.env.get("THREADS_APP_SECRET");
  if (!id || !secret) throw new HttpError(400, "THREADS_APP_ID and THREADS_APP_SECRET are not set");
  return { id, secret };
}

async function call(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error || data?.error_message) {
    const msg = data?.error?.message ?? data?.error_message ?? `HTTP ${res.status}`;
    throw new Error(`Threads ${res.status}: ${msg}`);
  }
  return data;
}

/** Sign-in code -> short-lived token -> long-lived (60 day) token. */
export async function exchangeCode(code: string, redirectUri: string) {
  const { id, secret } = threadsKeys();
  let short: any;
  try {
    short = await call(`${THREADS_API}/oauth/access_token`, {
      method: "POST",
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
    });
  } catch (e) { throw new HttpError(502, `Threads sign-in: ${(e as Error).message}`); }
  try {
    const long = await call(`${THREADS_API}/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: secret, access_token: short.access_token })}`);
    return { access_token: String(long.access_token), expires_in: Number(long.expires_in) || 60 * 86400, user_id: String(short.user_id ?? "") };
  } catch (e) { throw new HttpError(502, `Threads sign-in (long-lived token): ${(e as Error).message}`); }
}

export const expiresAt = (s: number) => new Date(Date.now() + s * 1000).toISOString();

/** A valid access token, renewing it when it is over a day old. Null when not connected. */
export async function threadsToken(db: SupabaseClient): Promise<{ token: string; userId: string; note?: string } | null> {
  const { data: row } = await db.from("oauth_tokens").select("*").eq("provider", "threads").maybeSingle();
  if (!row) return null;
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
  if (expired) throw new Error("Threads sign-in has expired; reconnect Threads in Settings");
  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  if (ageMs < 86400_000) return { token: row.access_token, userId: row.account_id };
  try {
    const r = await call(`${THREADS_API}/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: row.access_token })}`);
    const { error } = await db.from("oauth_tokens").update({
      access_token: r.access_token, expires_at: expiresAt(Number(r.expires_in) || 60 * 86400), updated_at: new Date().toISOString(),
    }).eq("provider", "threads");
    if (error) throw new Error(`could not save the renewed token: ${error.message}`);
    return { token: r.access_token, userId: row.account_id };
  } catch (e) {
    // The current token still works until it expires, so carry on with it and report the problem.
    const until = row.expires_at ? ` It stops working on ${String(row.expires_at).slice(0, 10)}; reconnect Threads in Settings before then` : "";
    return { token: row.access_token, userId: row.account_id, note: `could not renew the sign-in (${(e as Error).message.replace(/\.$/, "")}).${until}` };
  }
}

/** GET a Threads Graph API path (e.g. "/me?fields=id,username"). */
export function threads(token: string, path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  return call(`${THREADS_API}/v1.0${path}${sep}access_token=${encodeURIComponent(token)}`);
}
