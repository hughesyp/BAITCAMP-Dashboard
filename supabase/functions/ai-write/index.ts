// Writes or rewrites captions in the brand voice via OpenRouter.
// Body: { mode: "generate" | "rewrite", input: string, platforms: string[], model?: string, audience?: "us" | "uk" }
// Brand voice, branding and ideal-customer pages are read live from Notion for each request.
// Returns: { results: { [platform]: { caption, first_comment } } }
import { getCaller, HttpError, serve } from "../_shared/common.ts";
import { configuredPageIds, getPage } from "../_shared/notion.ts";

const PLATFORM_NOTES: Record<string, string> = {
  facebook: "Facebook page post. Conversational, 1-3 short paragraphs. Links work in the caption; a link can also go in the first comment.",
  instagram: "Instagram. Strong first line, line breaks, links are not clickable in captions. Put hashtags in the first comment.",
  threads: "Threads. Under 500 characters, casual, conversational. First comment is posted as a reply.",
  twitter: "X (Twitter). Under 280 characters. First comment is posted as a reply (good place for the link).",
  tiktok: "TikTok caption. Very short, punchy, a few relevant hashtags. No first comment available (leave it empty).",
};

serve(async (req, body, db) => {
  await getCaller(req, db);
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new HttpError(400, "OPENROUTER_API_KEY is not set");

  const input = String(body.input ?? "").trim();
  const platforms: string[] = (body.platforms ?? []).filter((p: string) => PLATFORM_NOTES[p]);
  if (!input) throw new HttpError(400, "Write an idea or draft first");
  if (!platforms.length) throw new HttpError(400, "Select at least one platform");

  const { data: brand } = await db.from("brand_settings").select("*").eq("id", 1).single();
  const allowed: string[] = brand?.ai_models ?? [];
  const model = allowed.includes(body.model) ? body.model : allowed[0];
  if (!model) throw new HttpError(400, "No AI models are configured (admin: Settings)");

  // Live read of the Notion brand pages. A page that fails is skipped rather than blocking the writer.
  const docs = (await Promise.all((await configuredPageIds(db)).map((id) => getPage(id, true).catch(() => null))))
    .filter((p) => p && p.markdown)
    .map((p) => `# ${p!.title}\n\n${p!.markdown}`);
  if (!docs.length) throw new HttpError(400, "Couldn't read the brand pages from Notion (admin: check Settings)");
  const brandText = docs.join("\n\n---\n\n").slice(0, 60_000);
  const audience = body.audience === "uk"
    ? "Write for the UK (secondary) ideal customer: UK spelling, units and vocabulary as set out in the brand pages."
    : "Write for the US/Canada (primary) ideal customer: US spelling, units and vocabulary as set out in the brand pages.";

  const system = [
    "You write social media posts for BAITCAMP. Follow the brand voice and its rules exactly; where the brand pages are about long-form posts (blog structure, length, tables), apply only what makes sense for a social caption.",
    "## Brand pages\n\n" + brandText,
    "## Audience\n" + audience,
    "## Platforms\n" + platforms.map((p) => `- ${p}: ${PLATFORM_NOTES[p]}`).join("\n"),
    `Respond with JSON only, in the shape {"<platform>": {"caption": "...", "first_comment": "..."}} with exactly these platform keys: ${platforms.join(", ")}. Use an empty string when no first comment is appropriate. Never invent facts, prices or claims that are not in the brief or the brand information.`,
  ].filter(Boolean).join("\n\n");

  const user = body.mode === "rewrite"
    ? `Rewrite this draft in the brand voice, tailored to each platform. Keep its meaning.\n\n${input}`
    : `Write a post for each platform from this idea or brief.\n\n${input}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Social dashboard" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(502, `OpenRouter ${res.status}: ${data?.error?.message ?? "request failed"}`);

  const text: string = data?.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new HttpError(502, "The AI model returned an unreadable answer. Try again or pick another model.");
  }
  const results: Record<string, { caption: string; first_comment: string }> = {};
  for (const p of platforms) {
    results[p] = {
      caption: String(parsed?.[p]?.caption ?? ""),
      first_comment: String(parsed?.[p]?.first_comment ?? ""),
    };
  }
  return { results, model };
});
