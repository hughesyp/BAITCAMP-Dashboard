// MailerLite API client (https://connect.mailerlite.com/api). Secret: MAILERLITE_API_KEY
import { HttpError } from "./common.ts";

// MAILERLITE_API_URL is only for local testing against a stand-in server.
const API = Deno.env.get("MAILERLITE_API_URL") ?? "https://connect.mailerlite.com/api";

export class MailerLiteError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(`MailerLite ${status}: ${body?.message ?? "request failed"}${body?.errors ? " " + JSON.stringify(body.errors).slice(0, 300) : ""}`);
    this.status = status;
    this.body = body;
  }
}

export async function ml(path: string, init: RequestInit = {}): Promise<any> {
  const key = Deno.env.get("MAILERLITE_API_KEY");
  if (!key) throw new HttpError(400, "MAILERLITE_API_KEY is not set");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 429) { // 120 requests/minute; wait as told and retry
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text.slice(0, 200) }; } })() : null;
    if (!res.ok) throw new MailerLiteError(res.status, data);
    return data;
  }
  throw new HttpError(429, "MailerLite rate limit, try again in a minute");
}
