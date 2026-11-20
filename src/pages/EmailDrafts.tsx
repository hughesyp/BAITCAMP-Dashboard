import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Empty, ErrorNote, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { teamName, useTeam } from '../lib/data'
import { statusLabel, type EmailCampaign } from '../lib/email'
import { supabase } from '../lib/supabase'

export default function EmailDrafts() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const team = useTeam()
  const [error, setError] = useState<unknown>(null)
  const drafts = useQuery({
    queryKey: ['email-drafts'],
    queryFn: async () => {
      // Emails written in the dashboard that haven't been sent yet.
      const { data, error } = await supabase.from('email_campaigns').select('*')
        .not('author_id', 'is', null).or('ml_status.is.null,ml_status.neq.sent')
        .order('updated_at', { ascending: false }).limit(200)
      if (error) throw new Error(error.message)
      return data as EmailCampaign[]
    },
  })

  async function remove(c: EmailCampaign) {
    const extra = c.mailerlite_id ? ' This only removes it from the dashboard; delete the draft in MailerLite too.' : ''
    if (!window.confirm(`Delete "${c.name}"?${extra}`)) return
    const { error } = await supabase.from('email_campaigns').delete().eq('id', c.id)
    if (error) setError(new Error(error.message)); else qc.invalidateQueries({ queryKey: ['email-drafts'] })
  }

  const rows = drafts.data ?? []
  return (
    <div>
      <PageHeader title="Email drafts" subtitle="Write emails here and send them to MailerLite as drafts. The admin reviews and sends them in MailerLite.">
        <Link to="/email/drafts/new" className="btn btn-primary">Write an email</Link>
      </PageHeader>
      <ErrorNote error={error ?? drafts.error} />
      {drafts.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : rows.length === 0 ? (
        <Empty>No email drafts yet. <Link to="/email/drafts/new" className="text-brand-600 hover:text-link-hover hover:underline">Write the first one.</Link></Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Email</th><th className="th">By</th><th className="th">Status</th><th className="th">Updated</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = statusLabel(c)
                const mine = c.author_id === profile?.id || isAdmin
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="td max-w-96">
                      <Link to={`/email/drafts/${c.id}`} className="block truncate font-medium hover:text-link-hover hover:underline">{c.subject || '(no subject)'}</Link>
                      <div className="truncate text-xs text-slate-500">{c.name}</div>
                    </td>
                    <td className="td whitespace-nowrap">{teamName(team.data, c.author_id)}</td>
                    <td className="td"><Badge status={s.badge} label={s.text} /></td>
                    <td className="td whitespace-nowrap">{format(new Date(c.updated_at), 'd MMM HH:mm')}</td>
                    <td className="td whitespace-nowrap text-xs">
                      <Link to={`/email/drafts/${c.id}`} className="text-brand-600 hover:text-link-hover hover:underline">{mine && (!c.ml_status || c.ml_status === 'draft') ? 'Edit' : 'View'}</Link>
                      {(isAdmin || (mine && !c.mailerlite_id)) && <button className="ml-3 text-red-700 hover:underline" onClick={() => remove(c)}>Delete</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
