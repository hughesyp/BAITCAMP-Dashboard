// Signed OAuth "state" values for the connect-an-account flows (TikTok, Threads).
// state = time.nonce.signature, tied to the admin who started the sign-in; valid for 15 minutes.
import { HttpError } from "./common.ts";

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(secret: string, text: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}

export async function makeState(secret: string, userId: string) {
  const payload = `${Date.now()}.${crypto.randomUUID().replace(/-/g, "")}`;
  return `${payload}.${await sign(secret, `${payload}.${userId}`)}`;
}

export async function checkState(secret: string, state: unknown, userId: string, service: string) {
  const [ts, nonce, sig] = String(state ?? "").split(".");
  if (!ts || !nonce || !sig || sig !== await sign(secret, `${ts}.${nonce}.${userId}`)) throw new HttpError(400, `The ${service} sign-in link is not valid. Start again from Settings.`);
  if (Date.now() - Number(ts) > 15 * 60_000) throw new HttpError(400, `The ${service} sign-in took too long. Start again from Settings.`);
}

/** Only <https site>/settings/<path>, or localhost over http for development. */
export function checkRedirect(uri: unknown, path: string): string {
  const u = String(uri ?? "");
  const p = path.replace(/[^a-z]/g, "");
  if (!new RegExp(`^https://[^?#]+/settings/${p}$`).test(u) && !new RegExp(`^http://(localhost|127\.0\.0\.1)(:\d+)?/settings/${p}$`).test(u)) {
    throw new HttpError(400, "Invalid redirect address");
  }
  return u;
}
