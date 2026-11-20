// Admin helper for the Settings screen.
// Body: { action: "status" } | { action: "blotato-accounts" }
import { blotato, getCaller, HttpError, serve } from "../_shared/common.ts";

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (caller.role !== "admin") throw new HttpError(403, "Admin only");

  if (body.action === "status") {
    const has = (k: string) => !!Deno.env.get(k);
    return {
      gumroad: has("GUMROAD_ACCESS_TOKEN"),
      blotato: has("BLOTATO_API_KEY"),
      meta: has("META_ACCESS_TOKEN"),
      openrouter: has("OPENROUTER_API_KEY"),
      cron: has("CRON_SECRET"),
    };
  }

  if (body.action === "blotato-accounts") {
    const res = await blotato("/users/me/accounts");
    const accounts = [];
    for (const a of res.items ?? []) {
      let subaccounts: any[] = [];
      if (a.platform === "facebook") {
        try {
          subaccounts = (await blotato(`/users/me/accounts/${a.id}/subaccounts`)).items ?? [];
        } catch { /* none */ }
      }
      accounts.push({ id: a.id, platform: a.platform, name: a.fullname || a.username, username: a.username, subaccounts });
    }
    return { accounts };
  }

  throw new HttpError(400, "Unknown action");
});
