import { useQuery } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { callFn, fetchAll, supabase } from './supabase'

export interface EmailCampaign {
  id: string
  mailerlite_id: string | null
  author_id: string | null
  name: string
  subject: string
  body_md: string | null
  group_ids: string[]
  ml_status: string | null
  content_pushed: boolean
  pushed_at: string | null
  sent_at: string | null
  stats: Record<string, any>
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface MlGroup { id: string; name: string; active_count: number }

export const useSentCampaigns = (days: number) =>
  useQuery({
    queryKey: ['email-sent', days],
    queryFn: () => fetchAll<EmailCampaign>((from, to) =>
      supabase.from('email_campaigns').select('*').eq('ml_status', 'sent')
        .gte('sent_at', subDays(new Date(), days).toISOString())
        .order('sent_at', { ascending: false }).range(from, to)),
  })

export const useGroups = () =>
  useQuery({
    queryKey: ['ml-groups'],
    queryFn: async () => (await callFn<{ groups: MlGroup[] }>('mailerlite', { action: 'groups' })).groups,
    retry: false,
    staleTime: 10 * 60_000,
  })

/** MailerLite rates come as { float, string }; show the string when there is one. */
export function rate(v: any): string {
  if (v == null) return '–'
  if (typeof v === 'object') {
    if (v.string) return String(v.string)
    v = v.float
  }
  const n = Number(v)
  if (Number.isNaN(n)) return '–'
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`
}

export function rateNumber(v: any): number | null {
  if (v == null) return null
  const n = Number(typeof v === 'object' ? v.float : v)
  if (Number.isNaN(n)) return null
  return n <= 1 ? n * 100 : n
}

export function statusLabel(c: Pick<EmailCampaign, 'ml_status' | 'content_pushed'>): { text: string; badge: string } {
  switch (c.ml_status) {
    case null: return { text: 'Draft (dashboard only)', badge: 'draft' }
    case 'draft': return c.content_pushed ? { text: 'Draft in MailerLite', badge: 'scheduled' } : { text: 'In MailerLite, needs content pasted', badge: 'partial' }
    case 'ready': return { text: 'Ready in MailerLite', badge: 'scheduled' }
    case 'sent': return { text: 'Sent', badge: 'published' }
    case 'deleted': return { text: 'Deleted in MailerLite', badge: 'failed' }
    default: return { text: c.ml_status, badge: 'queued' }
  }
}
