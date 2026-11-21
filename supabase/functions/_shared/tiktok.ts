// TikTok API v2 (Login Kit + Display API).
// Secrets: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET.
// Tokens live in public.oauth_tokens (provider 'tiktok'); the access token lasts hours and is
// refreshed here when needed. Each refresh returns a NEW refresh token, which must replace the old one.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./common.ts";

// Overridable for local testing against a stand-in server.
export const TIKTOK_API = Deno.env.get("TIKTOK_API_URL") ?? "https://open.tiktokapis.com";
export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";

export function tiktokKeys() {
  const key = Deno.env.get("TIKTOK_CLIENT_KEY");
  const secret = Deno.env.get("TIKTOK_CLIENT_SECRET");
  if (!key || !secret) throw new HttpError(400, "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not set");
  return { key, secret };
}

interface TokenResponse {
  access_token: string; expires_in: number; open_id: string;
  refresh_token: string; refresh_expires_in: number; scope: string;
}

/** POST to the token endpoint (form-encoded). Errors come back as { error, error_description }. */
export async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { key, secret } = tiktokKeys();
  const res = await fetch(`${TIKTOK_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, ...params }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    const msg = data?.error_description ?? data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new HttpError(502, `TikTok sign-in: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

const inSeconds = (s: number) => new Date(Date.now() + (Number(s) || 0) * 1000).toISOString();

export function tokenRow(t: TokenResponse, extra: Record<string, unknown> = {}) {
  return {
    provider: "tiktok",
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: inSeconds(t.expires_in),
    refresh_expires_at: inSeconds(t.refresh_expires_in),
    account_id: t.open_id,
    scope: t.scope,
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

/** A valid access token, refreshing it (and saving the new refresh token) when close to expiry. */
export async function tiktokToken(db: SupabaseClient): Promise<string | null> {
  const { data: row } = await db.from("oauth_tokens").select("*").eq("provider", "tiktok").maybeSingle();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 5 * 60_000) return row.access_token;
  if (!row.refresh_token) throw new Error("TikTok sign-in has expired; reconnect it in Settings");
  let t: TokenResponse;
  try {
    t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  } catch (e) {
    throw new Error(`${(e as Error).message.replace(/\.$/, "")}. If this keeps happening, reconnect TikTok in Settings`);
  }
  const { error } = await db.from("oauth_tokens").update(tokenRow(t, { account_name: row.account_name })).eq("provider", "tiktok");
  if (error) throw new Error(`could not save the refreshed TikTok token: ${error.message}`);
  return t.access_token;
}

/** Call a TikTok API endpoint. Success responses carry error.code === "ok". */
export async function tiktok(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(TIKTOK_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  const code = data?.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(`TikTok ${res.status}: ${data?.error?.message || code || "request failed"}`);
  }
  return data?.data ?? {};
}
