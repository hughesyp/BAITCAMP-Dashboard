import { format, subDays } from 'date-fns'

export const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', firstComment: true, color: '#1877f2' },
  { id: 'instagram', label: 'Instagram', firstComment: true, color: '#d6249f' },
  { id: 'linkedin', label: 'LinkedIn', firstComment: false, color: '#0a66c2' },
  { id: 'threads', label: 'Threads', firstComment: true, color: '#111111' },
  { id: 'twitter', label: 'X', firstComment: true, color: '#555555' },
  { id: 'tiktok', label: 'TikTok', firstComment: false, color: '#fe2c55' },
] as const

export type PlatformId = (typeof PLATFORMS)[number]['id']
export const platformLabel = (id: string) => PLATFORMS.find((p) => p.id === id)?.label ?? id

export const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const num = (n: number) => Math.round(n).toLocaleString()

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
export const monthStart = (d: Date) => format(d, 'yyyy-MM-01')

/** List of yyyy-MM-dd strings for the last `days` days, oldest first, ending today. */
export function lastDays(days: number): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(ymd(subDays(new Date(), i)))
  return out
}

export const isVideo = (url: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)

export interface Sale {
  id: string
  created_at: string
  product_name: string | null
  price_cents: number
  fee_cents: number
  refunded: boolean
  chargedback: boolean
  referrer: string | null
  source: string | null
}
export const saleNet = (s: Sale) => (s.refunded || s.chargedback ? 0 : s.price_cents - s.fee_cents)
export const saleCounts = (s: Sale) => !(s.refunded || s.chargedback)

export interface Metric { platform: string; date: string; metric: string; value: number }

/** Sum of a metric in a set of rows, optionally for one platform. */
export function sumMetric(rows: Metric[], metric: string, platform?: string | null) {
  return rows.filter((r) => r.metric === metric && (!platform || r.platform === platform)).reduce((a, r) => a + Number(r.value), 0)
}

/** Latest follower count per platform, summed (or for one platform). */
export function latestFollowers(rows: Metric[], platform?: string | null) {
  const latest = new Map<string, Metric>()
  for (const r of rows) {
    if (r.metric !== 'followers' || (platform && r.platform !== platform)) continue
    const cur = latest.get(r.platform)
    if (!cur || r.date > cur.date) latest.set(r.platform, r)
  }
  return [...latest.values()].reduce((a, r) => a + Number(r.value), 0)
}
