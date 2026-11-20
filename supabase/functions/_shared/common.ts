import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export interface Caller {
  id: string | null; // null when called by the scheduler
  role: "admin" | "marketer" | "cron";
}

/** Identify the caller: a logged-in active user, or the scheduler via x-cron-secret. */
export async function getCaller(req: Request, db: SupabaseClient): Promise<Caller> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const given = req.headers.get("x-cron-secret");
  if (cronSecret && given && given === cronSecret) return { id: null, role: "cron" };

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  const { data: prof } = await db.from("profiles").select("role, active").eq("id", data.user.id).single();
  if (!prof || !prof.active) throw new HttpError(403, "Account is not active");
  return { id: data.user.id, role: prof.role };
}

export function requireAdminOrCron(c: Caller) {
  if (c.role !== "admin" && c.role !== "cron") throw new HttpError(403, "Admin only");
}

export async function logSync(db: SupabaseClient, source: string, ok: boolean, message: string) {
  await db.from("sync_log").insert({ source, ok, message: message.slice(0, 2000) });
}

/** Wrap a handler with CORS, JSON parsing and error handling. */
export function serve(handler: (req: Request, body: any, db: SupabaseClient) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const result = await handler(req, body, adminClient());
      return json(result ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  });
}

export async function getSetting<T = Record<string, any>>(db: SupabaseClient, key: string): Promise<T> {
  const { data } = await db.from("integration_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? {}) as T;
}

// ---------- Blotato ----------
const BLOTATO = "https://backend.blotato.com/v2";

export async function blotato(path: string, init: RequestInit = {}): Promise<any> {
  const key = Deno.env.get("BLOTATO_API_KEY");
  if (!key) throw new HttpError(400, "BLOTATO_API_KEY is not set");
  const res = await fetch(BLOTATO + path, {
    ...init,
    headers: { "blotato-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new HttpError(502, `Blotato ${res.status}: ${data?.message ?? data?.errorMessage ?? text.slice(0, 300)}`);
  }
  return data;
}
