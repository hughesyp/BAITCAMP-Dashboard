// Converts Notion API blocks to Markdown (GitHub-flavoured, for react-markdown + remark-gfm).
// Pure functions, no Deno or network APIs, so it can be tested with Node.

export interface RichText {
  plain_text: string;
  href?: string | null;
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean };
}

export interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  children?: Block[];
  [key: string]: any;
}

/** Wrap text in a marker, keeping leading/trailing spaces outside it (Markdown requires that). */
function wrap(text: string, marker: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : text;
}

export function richText(rt: RichText[] | undefined): string {
  return (rt ?? []).map((t) => {
    let s = t.plain_text ?? "";
    if (!s) return "";
    const a = t.annotations ?? {};
    if (a.code) s = wrap(s, "`");
    else {
      if (a.bold) s = wrap(s, "**");
      if (a.italic) s = wrap(s, "_");
      if (a.strikethrough) s = wrap(s, "~~");
    }
    if (t.href) s = `[${s}](${t.href})`;
    return s;
  }).join("");
}

const indent = (text: string, pad: string) => text.split("\n").map((l) => (l ? pad + l : l)).join("\n");
const quote = (text: string) => text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
const cell = (rt: RichText[]) => richText(rt).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

function table(b: Block): string {
  const rows = (b.children ?? []).filter((r) => r.type === "table_row").map((r) => (r.table_row.cells as RichText[][]).map(cell));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  // GFM tables need a header row; Notion tables without one get an empty header.
  const header = b.table?.has_column_header ? pad(rows.shift()!) : Array(width).fill(" ");
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

function blockToMd(b: Block, notionUrl: (id: string) => string): string {
  const v = b[b.type] ?? {};
  const text = richText(v.rich_text);
  const kids = b.children?.length ? blocksToMd(b.children, notionUrl) : "";

  switch (b.type) {
    case "paragraph":
      return [text, kids].filter(Boolean).join("\n\n");
    case "heading_1":
      return `## ${text}` + (kids ? `\n\n${kids}` : "");
    case "heading_2":
      return `### ${text}` + (kids ? `\n\n${kids}` : "");
    case "heading_3":
      return `#### ${text}` + (kids ? `\n\n${kids}` : "");
    case "bulleted_list_item":
      return `- ${text}` + (kids ? `\n${indent(kids, "  ")}` : "");
    case "numbered_list_item":
      return `1. ${text}` + (kids ? `\n${indent(kids, "   ")}` : "");
    case "to_do":
      return `- [${v.checked ? "x" : " "}] ${text}` + (kids ? `\n${indent(kids, "  ")}` : "");
    case "toggle":
      return `**${text}**` + (kids ? `\n\n${kids}` : "");
    case "quote":
      return quote([text, kids].filter(Boolean).join("\n\n"));
    case "callout": {
      const icon = v.icon?.type === "emoji" ? `${v.icon.emoji} ` : "";
      return quote([icon + text, kids].filter(Boolean).join("\n\n"));
    }
    case "code":
      return "```" + (v.language && v.language !== "plain text" ? v.language : "") + "\n" + richText(v.rich_text) + "\n```";
    case "divider":
      return "---";
    case "table":
      return table(b);
    case "child_page":
      return `📄 [${v.title}](${notionUrl(b.id)})`;
    case "child_database":
      return `🗂️ [${v.title || "Database"}](${notionUrl(b.id)})`;
    case "bookmark":
    case "embed":
    case "link_preview":
      return v.url ? `[${richText(v.caption) || v.url}](${v.url})` : "";
    case "image": {
      // Notion-hosted file URLs expire after an hour, so only external images are embedded.
      const caption = richText(v.caption);
      if (v.type === "external" && v.external?.url) return `![${caption}](${v.external.url})`;
      return `_Image${caption ? `: ${caption}` : ""} (view in Notion)_`;
    }
    case "column_list":
    case "column":
    case "synced_block":
      return kids;
    default:
      return kids; // unsupported block: keep any child content
  }
}

const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);

export function blocksToMd(blocks: Block[], notionUrl: (id: string) => string = (id) => `https://www.notion.so/${id.replace(/-/g, "")}`): string {
  const out: string[] = [];
  let prevList = false;
  for (const b of blocks) {
    const md = blockToMd(b, notionUrl);
    if (!md) continue;
    const isList = LIST_TYPES.has(b.type);
    // consecutive list items are joined with a single newline so they stay one list
    if (isList && prevList && out.length) out[out.length - 1] += "\n" + md;
    else out.push(md);
    prevList = isList;
  }
  return out.join("\n\n");
}
