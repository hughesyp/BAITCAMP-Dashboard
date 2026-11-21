// Meta Graph API helpers (Facebook Page + Instagram). Secret: META_ACCESS_TOKEN.

// META_API_URL is overridable for local testing against a stand-in server.
export const metaBase = () => `${Deno.env.get("META_API_URL") ?? "https://graph.facebook.com"}/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;

export async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${res.status}`);
  return data;
}

/** Page insights and posts only accept a Page token. If the stored token is a user token, swap it
 *  for the Page's own token (a Page token simply returns itself). */
export async function pageToken(pageId: string, token: string, notes: string[]): Promise<string> {
  try {
    const p = await getJson(`${metaBase()}/${pageId}?fields=access_token&access_token=${token}`);
    if (p.access_token) return p.access_token;
    notes.push("facebook: could not get a Page token; the login that made the token may not have full access to this Page");
  } catch (e) { notes.push(`facebook page token: ${(e as Error).message}`); }
  return token;
}
