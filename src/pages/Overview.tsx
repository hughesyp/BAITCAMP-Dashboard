import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorNote, PageHeader, Progress, RangePicker, Stat } from '../components/ui'
import { loadMonthData, TARGET_KINDS, targetProgress, useMetrics, usePosts, useSales, type Target } from '../lib/data'
import { supabase } from '../lib/supabase'
import { lastDays, latestFollowers, money, monthStart, num, PLATFORMS, platformLabel, saleCounts, saleNet, sumMetric } from '../lib/util'

export default function Overview() {
  const [days, setDays] = useState(30)
  const sales = useSales(days)
  const metrics = useMetrics(days)
  const posts = usePosts(days)
  const month = monthStart(new Date())
  const targets = useQuery({
    queryKey: ['targets-overview', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('targets').select('*').eq('month', month).is('marketer_id', null)
      if (error) throw new Error(error.message)
      return { targets: data as Target[], data: await loadMonthData(month) }
    },
  })

  const s = sales.data ?? []
  const m = metrics.data ?? []
  const net = s.reduce((a, x) => a + saleNet(x), 0)
  const count = s.filter(saleCounts).length
  const published = (posts.data ?? []).flatMap((p) => p.post_targets).filter((t) => t.status === 'published').length

  const byDay = new Map(lastDays(days).map((d) => [d, 0]))
  for (const x of s) {
    const d = format(new Date(x.created_at), 'yyyy-MM-dd')
    if (byDay.has(d)) byDay.set(d, byDay.get(d)! + saleNet(x) / 100)
  }
  const chart = [...byDay].map(([date, revenue]) => ({ date: format(new Date(date + 'T00:00:00'), 'd MMM'), revenue }))

  const sources = new Map<string, { sales: number; net: number }>()
  for (const x of s.filter(saleCounts)) {
    const k = x.source ?? 'direct'
    const cur = sources.get(k) ?? { sales: 0, net: 0 }
    sources.set(k, { sales: cur.sales + 1, net: cur.net + saleNet(x) })
  }
  const topSources = [...sources].sort((a, b) => b[1].net - a[1].net).slice(0, 6)
  const maxSource = topSources[0]?.[1].net || 1

  const platforms = PLATFORMS.filter((p) => m.some((r) => r.platform === p.id))
  const followerChange = (platform: string) => {
    const rows = m.filter((r) => r.platform === platform && r.metric === 'followers').sort((a, b) => a.date.localeCompare(b.date))
    return rows.length > 1 ? Number(rows[rows.length - 1].value) - Number(rows[0].value) : null
  }

  return (
    <div>
      <PageHeader title="Overview" subtitle={`How BAITCAMP is performing over the last ${days} days`}>
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>
      <ErrorNote error={sales.error ?? metrics.error ?? posts.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Net revenue" value={money(net)} hint="After Gumroad fees and refunds" />
        <Stat label="Sales" value={num(count)} />
        <Stat label="Followers" value={num(latestFollowers(m))} hint="All connected platforms" />
        <Stat label="Reach" value={num(sumMetric(m, 'reach'))} />
        <Stat label="Posts published" value={num(published)} hint={`${num(sumMetric(m, 'engagement'))} engagements`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-2 text-sm font-semibold">Net revenue per day</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
                <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => '$' + v} />
                <Tooltip formatter={(v) => ['$' + Number(v).toFixed(2), 'Net revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">What's driving sales</div>
            <Link to="/revenue" className="text-xs text-blue-600 hover:underline">All sources</Link>
          </div>
          {topSources.length === 0 ? <Empty>No sales in this period yet.</Empty> : (
            <div className="space-y-2.5">
              {topSources.map(([name, v]) => (
                <div key={name}>
                  <div className="flex justify-between text-sm">
                    <span className="truncate">{platformLabel(name)}</span>
                    <span className="text-slate-600">{money(v.net)} · {v.sales}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${(v.net / maxSource) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <div className="mb-2 text-sm font-semibold">Social accounts</div>
          {platforms.length === 0 ? (
            <Empty>No social stats yet. They appear after the first sync once Facebook, Instagram and LinkedIn are connected in Settings.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Platform</th><th className="th">Followers</th><th className="th">Change</th><th className="th">Reach</th><th className="th">Engagements</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((p) => {
                  const ch = followerChange(p.id)
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="td font-medium">{p.label}</td>
                      <td className="td">{num(latestFollowers(m, p.id))}</td>
                      <td className={`td ${ch === null ? 'text-slate-400' : ch >= 0 ? 'text-green-700' : 'text-red-700'}`}>{ch === null ? '–' : (ch >= 0 ? '+' : '') + num(ch)}</td>
                      <td className="td">{num(sumMetric(m, 'reach', p.id))}</td>
                      <td className="td">{num(sumMetric(m, 'engagement', p.id))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">{format(new Date(), 'MMMM')} targets</div>
            <Link to="/targets" className="text-xs text-blue-600 hover:underline">All targets</Link>
          </div>
          {!targets.data?.targets.length ? <Empty>No team targets set for this month.</Empty> : (
            <div className="space-y-3">
              {targets.data.targets.map((t) => {
                const v = targetProgress(t, targets.data!.data)
                return (
                  <div key={t.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{TARGET_KINDS[t.kind]}{t.platform ? ` · ${platformLabel(t.platform)}` : ''}</span>
                      <span className="text-slate-600">{num(v)} / {num(t.target_value)}</span>
                    </div>
                    <Progress value={v} target={t.target_value} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
