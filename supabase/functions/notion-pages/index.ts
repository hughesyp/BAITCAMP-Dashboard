// Read-only view of the configured Notion pages, fetched live. Nothing is stored.
// Body: { action: "list" }                 -> { pages: [{ id, title, icon, last_edited_at }] }
//       { action: "page", page_id: "..." } -> { page: { ..., markdown } }
// Only pages listed in Settings can be read, whatever else the integration can see.
import { getCaller, HttpError, serve } from "../_shared/common.ts";
import { configuredPageIds, getPage } from "../_shared/notion.ts";

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (!Deno.env.get("NOTION_API_KEY")) {
    throw new HttpError(400, caller.role === "admin" ? "NOTION_API_KEY is not set (see SETUP.md)" : "The brand guide isn't connected yet. Ask the admin.");
  }
  const ids = await configuredPageIds(db);
  // The Notion link is only useful to the admin (marketers don't have Notion access).
  const strip = <T extends { url: string | null }>(p: T) => (caller.role === "admin" ? p : { ...p, url: null });

  if (body.action === "list") {
    const pages = await Promise.all(ids.map(async (id) => {
      try { const { markdown: _m, ...p } = await getPage(id, false); return strip(p); }
      catch (e) { return { id, title: "Unavailable", icon: null, url: null, last_edited_at: null, error: (e as Error).message }; }
    }));
    return { pages };
  }

  if (body.action === "page") {
    const id = String(body.page_id ?? "");
    if (!ids.includes(id)) throw new HttpError(404, "That page isn't one of the dashboard's Notion pages");
    return { page: strip(await getPage(id, true)) };
  }

  throw new HttpError(400, "Unknown action");
});
