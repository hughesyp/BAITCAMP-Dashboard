// Live, read-only access to the configured Notion pages. Nothing is written to the database.
// Secret: NOTION_API_KEY (internal integration token; the pages must be shared with it)
// Settings (integration_settings): notion = { pages: ["<page id or URL>", ...] }
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting, HttpError } from "./common.ts";
import { blocksToMd, type Block } from "./notion-md.ts";

const API = "https://api.notion.com/v1";

export interface NotionPage {
  id: string;
  title: string;
  icon: string | null;
  url: string | null;
  last_edited_at: string | null;
  markdown?: string;
}

/** Accepts a page id (with or without dashes) or any Notion page URL. */
export function pageIdFrom(input: string): string | null {
  const m = String(input).replace(/-/g, "").match(/([0-9a-f]{32})(?![0-9a-f])/i);
  return m ? m[1].toLowerCase() : null;
}

export async function configuredPageIds(db: SupabaseClient): Promise<string[]> {
  const { pages = [] } = await getSetting<{ pages?: string[] }>(db, "notion");
  return [...new Set(pages.map(pageIdFrom).filter((x): x is string => !!x))];
}

async function notion(path: string): Promise<any> {
  const key = Deno.env.get("NOTION_API_KEY");
  if (!key) throw new HttpError(400, "NOTION_API_KEY is not set");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": Deno.env.get("NOTION_VERSION") ?? "2022-06-28" },
    });
    if (res.status === 429) { // rate limited: wait as told, then retry
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 1) * 1000));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 404) throw new Error("Page not found, or not shared with the Notion integration (page ⋯ → Connections)");
      throw new Error(`Notion ${res.status}: ${data?.message ?? "request failed"}`);
    }
    return data;
  }
  throw new Error("Notion is rate limiting requests, try again shortly");
}

async function children(id: string, depth = 0): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const d = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    blocks.push(...d.results);
    cursor = d.has_more ? d.next_cursor : undefined;
  } while (cursor);
  // Nested content (lists, tables, toggles, columns). Child pages are linked, not inlined.
  await Promise.all(blocks.map(async (b) => {
    if (b.has_children && depth < 4 && b.type !== "child_page" && b.type !== "child_database") {
      b.children = await children(b.id, depth + 1);
    }
  }));
  return blocks;
}

function titleOf(page: any): string {
  for (const p of Object.values<any>(page.properties ?? {})) {
    if (p.type === "title") return (p.title ?? []).map((t: any) => t.plain_text).join("") || "Untitled";
  }
  return "Untitled";
}

// Short-lived in-memory cache so a burst of requests doesn't re-read Notion each time.
// It lives only as long as the function instance; nothing is persisted.
const TTL = 60_000;
const cache = new Map<string, { at: number; page: NotionPage }>();

export async function getPage(id: string, withContent: boolean): Promise<NotionPage> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL && (!withContent || hit.page.markdown !== undefined)) return hit.page;
  const p = await notion(`/pages/${id}`);
  const page: NotionPage = {
    id,
    title: titleOf(p),
    icon: p.icon?.type === "emoji" ? p.icon.emoji : null,
    url: p.url ?? null,
    last_edited_at: p.last_edited_time ?? null,
  };
  if (withContent) page.markdown = blocksToMd(await children(id));
  cache.set(id, { at: Date.now(), page });
  return page;
}
