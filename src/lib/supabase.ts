import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = !!url && !!anon && !url.includes('YOUR_PROJECT_REF')

// Invite and password-reset emails land here with "#...type=invite|recovery".
// Read it before the client consumes the hash.
export const authLinkType = new URLSearchParams(window.location.hash.slice(1)).get('type')

export const supabase = createClient(url || 'http://localhost:54321', anon || 'missing')

/** Call an Edge Function; throws with the server's error message. */
export async function callFn<T = any>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let msg = error.message
    try {
      const ctx = await (error as any).context?.json?.()
      if (ctx?.error) msg = ctx.error
    } catch { /* keep default */ }
    throw new Error(msg)
  }
  return data as T
}

/** Fetch every row of a query, past the 1000-row page limit. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < size) break
  }
  return out
}
