import { useQuery } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { fetchAll, supabase } from './supabase'
import { latestFollowers, saleCounts, saleNet, sumMetric, ymd, type Metric, type Sale } from './util'

export interface TeamMember { id: string; full_name: string | null; role: string; active: boolean }

export interface PostTarget {
  id: string
  post_id: string
  platform: string
  caption: string
  first_comment: string | null
  status: string
  public_url: string | null
  error_message: string | null
  published_at: string | null
  metrics: Record<string, number>
  metrics_updated_at: string | null
}

export interface Post {
  id: string
  author_id: string | null
  title: string | null
  media_urls: string[]
  scheduled_at: string | null
  status: string
  created_at: string
  post_targets: PostTarget[]
}

export interface Target {
  id: string
  month: string
  kind: 'revenue' | 'sales_count' | 'posts' | 'followers' | 'reach' | 'engagement' | 'email_subscribers' | 'email_new_subscribers'
  platform: string | null
  marketer_id: string | null
  target_value: number
  note: string | null
}

const SALE_COLS = 'id, created_at, product_name, price_cents, fee_cents, refunded, chargedback, referrer, source'

export async function loadSales(fromIso: string, toIso?: string): Promise<Sale[]> {
  return fetchAll<Sale>((from, to) => {
    let q = supabase.from('sales').select(SALE_COLS).gte('created_at', fromIso).order('created_at', { ascending: false }).range(from, to)
    if (toIso) q = q.lt('created_at', toIso)
    return q
  })
}

export async function loadMetrics(fromDate: string, toDate?: string): Promise<Metric[]> {
  return fetchAll<Metric>((from, to) => {
    let q = supabase.from('metrics_daily').select('platform, date, metric, value').gte('date', fromDate).order('date').range(from, to)
    if (toDate) q = q.lt('date', toDate)
    return q
  })
}

export async function loadPosts(fromIso: string): Promise<Post[]> {
  return fetchAll<Post>((from, to) =>
    supabase.from('posts').select('*, post_targets(*)').gte('created_at', fromIso).order('created_at', { ascending: false }).range(from, to) as any)
}

export const useSales = (days: number) =>
  useQuery({ queryKey: ['sales', days], queryFn: () => loadSales(subDays(new Date(), days).toISOString()) })

export const useMetrics = (days: number) =>
  useQuery({ queryKey: ['metrics', days], queryFn: () => loadMetrics(ymd(subDays(new Date(), days))) })

export const usePosts = (days: number) =>
  useQuery({ queryKey: ['posts', days], queryFn: () => loadPosts(subDays(new Date(), days).toISOString()) })

export const useTeam = () =>
  useQuery({
    queryKey: ['team'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team').select('*').order('full_name')
      if (error) throw new Error(error.message)
      return data as TeamMember[]
    },
  })

export function teamName(team: TeamMember[] | undefined, id: string | null) {
  return team?.find((t) => t.id === id)?.full_name ?? 'Unknown'
}

/** The date a post counts against: publish time, else schedule, else creation. */
export const postDate = (p: Post) => p.scheduled_at ?? p.created_at

// ---------- targets ----------
export interface MonthData { sales: Sale[]; metrics: Metric[]; posts: Post[] }

export async function loadMonthData(month: string): Promise<MonthData> {
  const start = new Date(month + 'T00:00:00')
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const [sales, metrics, posts] = await Promise.all([
    loadSales(start.toISOString(), end.toISOString()),
    loadMetrics(ymd(start), ymd(end)),
    loadPosts(subDays(start, 31).toISOString()),
  ])
  return { sales, metrics, posts }
}

export function targetProgress(t: Target, d: MonthData): number {
  const start = new Date(t.month + 'T00:00:00')
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  switch (t.kind) {
    case 'revenue':
      return d.sales.reduce((a, s) => a + saleNet(s), 0) / 100
    case 'email_subscribers': {
      // latest active-subscriber count recorded in the month
      const latest = d.metrics.filter((r) => r.platform === 'mailerlite' && r.metric === 'subscribers').sort((a, b) => b.date.localeCompare(a.date))[0]
      return latest ? Number(latest.value) : 0
    }
    case 'email_new_subscribers':
      return sumMetric(d.metrics, 'new_subscribers', 'mailerlite')
    case 'sales_count':
      return d.sales.filter(saleCounts).length
    case 'posts':
      return d.posts
        .filter((p) => !t.marketer_id || p.author_id === t.marketer_id)
        .flatMap((p) => p.post_targets)
        .filter((pt) => pt.status === 'published' && pt.published_at && new Date(pt.published_at) >= start && new Date(pt.published_at) < end)
        .filter((pt) => !t.platform || pt.platform === t.platform).length
    case 'followers':
      return latestFollowers(d.metrics, t.platform)
    case 'reach':
      return sumMetric(d.metrics, 'reach', t.platform)
    case 'engagement':
      return sumMetric(d.metrics, 'engagement', t.platform)
  }
}

export const TARGET_KINDS: Record<Target['kind'], string> = {
  revenue: 'Net revenue ($)',
  sales_count: 'Number of sales',
  email_subscribers: 'Email subscribers (total)',
  email_new_subscribers: 'New email subscribers',
  posts: 'Posts published',
  followers: 'Followers (total)',
  reach: 'Reach',
  engagement: 'Engagements',
}
