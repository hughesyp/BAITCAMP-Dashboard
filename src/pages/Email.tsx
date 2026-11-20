import { format } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorNote, PageHeader, RangePicker, Stat } from '../components/ui'
import { teamName, useMetrics, useTeam } from '../lib/data'
import { rate, rateNumber, useSentCampaigns } from '../lib/email'
import { lastDays, num } from '../lib/util'

export default function Email() {
  const [days, setDays] = useState(30)
  const metrics = useMetrics(days)
  const sent = useSentCampaigns(days)
  const team = useTeam()

  const m = (metrics.data ?? []).filter((r) => r.platform === 'mailerlite')
  const latest = m.filter((r) => r.metric === 'subscribers').sort((a, b) => b.date.localeCompare(a.date))[0]
  const sum = (metric: string) => m.filter((r) => r.metric === metric).reduce((a, r) => a + Number(r.value), 0)
  const added = sum('new_subscribers')
  const lost = sum('unsubscribes')

  const byDay = new Map(lastDays(days).map((d) => [d, { new: 0, unsub: 0 }]))
  for (const r of m) {
    const d = byDay.get(r.date)
    if (!d) continue
    if (r.metric === 'new_subscribers') d.new = Number(r.value)
    if (r.metric === 'unsubscribes') d.unsub = Number(r.value)
  }
  const chart = [...byDay].map(([date, v]) => ({ date: format(new Date(date + 'T00:00:00'), 'd MMM'), 'New subscribers': v.new, Unsubscribes: v.unsub }))

  const campaigns = sent.data ?? []
  const avg = (key: string) => {
    const vals = campaigns.map((c) => rateNumber(c.stats?.[key])).filter((v): v is number => v !== null)
    return vals.length ? `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}%` : '–'
  }

  return (
    <div>
      <PageHeader title="Email stats" subtitle="MailerLite subscribers and campaign performance">
        <RangePicker value={days} onChange={setDays} />
        <Link to="/email/drafts/new" className="btn btn-primary">Write an email</Link>
      </PageHeader>
      <ErrorNote error={metrics.error ?? sent.error} />

      {!m.length && !campaigns.length && !metrics.isLoading ? (
        <Empty>No MailerLite data yet. It appears after the first sync once MailerLite is connected (admin: Settings).</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Active subscribers" value={latest ? num(Number(latest.value)) : '–'} hint={latest ? `as of ${format(new Date(latest.date + 'T00:00:00'), 'd MMM')}` : undefined} />
            <Stat label="New subscribers" value={num(added)} hint={`Net ${added - lost >= 0 ? '+' : ''}${num(added - lost)}`} />
            <Stat label="Unsubscribes" value={num(lost)} />
            <Stat label="Avg open rate" value={avg('open_rate')} hint={`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} sent`} />
            <Stat label="Avg click rate" value={avg('click_rate')} />
          </div>

          <div className="card mt-4">
            <div className="mb-2 text-sm font-semibold">Subscribers gained and lost per day</div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
                  <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="New subscribers" fill="#eb4f1e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Unsubscribes" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card mt-4 overflow-x-auto p-0">
            <div className="px-4 pt-4 text-sm font-semibold">Campaigns sent</div>
            {campaigns.length === 0 ? <div className="p-4"><Empty>No campaigns sent in this period.</Empty></div> : (
              <table className="mt-2 w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="th">Sent</th><th className="th">Campaign</th><th className="th">Written by</th><th className="th">Recipients</th>
                    <th className="th">Open rate</th><th className="th">Click rate</th><th className="th">Unsubscribes</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="td whitespace-nowrap">{c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy') : '–'}</td>
                      <td className="td max-w-80"><div className="truncate font-medium">{c.subject || c.name}</div><div className="truncate text-xs text-slate-500">{c.name}</div></td>
                      <td className="td whitespace-nowrap">{c.author_id ? teamName(team.data, c.author_id) : <span className="text-slate-400">MailerLite</span>}</td>
                      <td className="td">{c.stats?.sent != null ? num(Number(c.stats.sent)) : '–'}</td>
                      <td className="td">{rate(c.stats?.open_rate)}</td>
                      <td className="td">{rate(c.stats?.click_rate)}</td>
                      <td className="td">{c.stats?.unsubscribes_count != null ? num(Number(c.stats.unsubscribes_count)) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">MailerLite doesn't keep a history of the subscriber total, so "Active subscribers" builds up from the day it was connected. New subscribers counts everyone who signed up that day, including anyone who later unsubscribed.</p>
        </>
      )}
    </div>
  )
}
