import { format, subDays } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorNote, PageHeader, RangePicker, Stat } from '../components/ui'
import { useMetrics, usePosts } from '../lib/data'
import { lastDays, num, PLATFORMS, platformLabel, ymd, type Metric } from '../lib/util'

const pick = (m: Record<string, number> | null, ...keys: string[]) => {
  for (const k of keys) if (m && m[k] !== undefined) return Number(m[k])
  return 0
}

/** Change as "+12% vs previous 30 days", or null when there is nothing to compare with. */
function change(cur: number, prev: number, days: number) {
  if (!prev) return undefined
  const pct = ((cur - prev) / prev) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs previous ${days} days`
}

/** Followers at the start and end of the rows given (per platform, summed). */
function followerSpan(rows: Metric[], platform?: string) {
  const byPlatform = new Map<string, Metric[]>()
  for (const r of rows) {
    if (r.metric !== 'followers' || (platform && r.platform !== platform)) continue
    byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r])
  }
  let first = 0, last = 0, known = false
  for (const list of byPlatform.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    first += Number(list[0].value); last += Number(list[list.length - 1].value); known = known || list.length > 1
  }
  return { first, last, change: last - first, known }
}

export default function Social() {
  const [days, setDays] = useState(30)
  const [platform, setPlatform] = useState('')
  // Load twice the range so each figure can be compared with the period before it.
  const metrics = useMetrics(days * 2)
  const posts = usePosts(days)

  const cutoff = ymd(subDays(new Date(), days - 1))
  const social = (metrics.data ?? []).filter((r) => r.platform !== 'mailerlite')
  const available = PLATFORMS.filter((p) => social.some((r) => r.platform === p.id))
  const scoped = social.filter((r) => !platform || r.platform === platform)
  const cur = scoped.filter((r) => r.date >= cutoff)
  const prev = scoped.filter((r) => r.date < cutoff)

  const sum = (rows: Metric[], metric: string, p?: string) =>
    rows.filter((r) => r.metric === metric && (!p || r.platform === p)).reduce((a, r) => a + Number(r.value), 0)
  const engRate = (rows: Metric[], p?: string) => {
    const reach = sum(rows, 'reach', p)
    return reach ? (sum(rows, 'engagement', p) / reach) * 100 : null
  }

  const f = followerSpan(cur)
  const fPrev = followerSpan(prev)
  const rate = engRate(cur)
  const ratePrev = engRate(prev)

  // Charts
  const range = lastDays(days)
  const shown = platform ? available.filter((p) => p.id === platform) : available
  const followersChart = range.map((d) => {
    const row: Record<string, string | number | null> = { date: format(new Date(d + 'T00:00:00'), 'd MMM') }
    for (const p of shown) {
      const v = cur.find((r) => r.platform === p.id && r.metric === 'followers' && r.date === d)
      row[p.label] = v ? Number(v.value) : null
    }
    return row
  })
  const hasFollowerHistory = followersChart.filter((r) => shown.some((p) => r[p.label] !== null)).length > 1
  const dailyChart = range.map((d) => ({
    date: format(new Date(d + 'T00:00:00'), 'd MMM'),
    Reach: sum(cur.filter((r) => r.date === d), 'reach'),
    Engagements: sum(cur.filter((r) => r.date === d), 'engagement'),
  }))

  // Posts published in the period, with their Blotato stats
  const published = (posts.data ?? []).flatMap((p) => p.post_targets.map((t) => ({ post: p, t })))
    .filter(({ t }) => t.status === 'published' && (!platform || t.platform === platform))
  const engagementOf = (m: Record<string, number> | null) => pick(m, 'likes', 'reactions') + pick(m, 'comments') + pick(m, 'shares') + pick(m, 'saves')
  const topPosts = [...published].sort((a, b) => engagementOf(b.t.metrics) - engagementOf(a.t.metrics)).slice(0, 5)

  const pct = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`)

  return (
    <div>
      <PageHeader title="Social accounts" subtitle={`Account growth and reach over the last ${days} days`}>
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>
      <ErrorNote error={metrics.error ?? posts.error} />

      {available.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ id: '', label: 'All platforms' }, ...available].map((p) => (
            <button key={p.id} onClick={() => setPlatform(p.id)} aria-pressed={platform === p.id}
              className={`rounded-md border px-3 py-1.5 text-sm ${platform === p.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-ink-2 hover:bg-slate-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {metrics.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : available.length === 0 ? (
        <Empty>No social stats yet. They appear after the first sync once Facebook and Instagram are connected in Settings.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Followers" value={num(f.last)}
              hint={f.known ? `${f.change >= 0 ? '+' : ''}${num(f.change)} in ${days} days` : 'Growth shows after a second daily sync'} />
            <Stat label="Follower growth" value={f.known && f.first ? `${((f.change / f.first) * 100).toFixed(1)}%` : '–'}
              hint={fPrev.known ? `${fPrev.change >= 0 ? '+' : ''}${num(fPrev.change)} in the previous ${days} days` : undefined} />
            <Stat label="Reach" value={num(sum(cur, 'reach'))} hint={change(sum(cur, 'reach'), sum(prev, 'reach'), days)} />
            <Stat label="Impressions" value={num(sum(cur, 'impressions'))} hint={change(sum(cur, 'impressions'), sum(prev, 'impressions'), days)} />
            <Stat label="Engagements" value={num(sum(cur, 'engagement'))} hint={change(sum(cur, 'engagement'), sum(prev, 'engagement'), days)} />
            <Stat label="Engagement rate" value={pct(rate)}
              hint={rate !== null && ratePrev !== null ? `${pct(ratePrev)} in the previous ${days} days` : 'Engagements ÷ reach'} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="mb-2 text-sm font-semibold">Followers</div>
              {!hasFollowerHistory ? (
                <Empty>Follower counts are recorded once a day from when the account was connected, so the growth line builds up over time.</Empty>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={followersChart} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
                      <YAxis tick={{ fontSize: 11 }} width={52} domain={['auto', 'auto']} tickFormatter={(v) => num(Number(v))} />
                      <Tooltip formatter={(v) => num(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {shown.map((p) => <Line key={p.id} type="monotone" dataKey={p.label} stroke={p.color} strokeWidth={2} dot={false} connectNulls />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card">
              <div className="mb-2 text-sm font-semibold">Reach (bars) and engagements (line) per day</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChart} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
                    <YAxis yAxisId="reach" tick={{ fontSize: 11 }} width={52} tickFormatter={(v) => num(Number(v))} />
                    <YAxis yAxisId="eng" orientation="right" tick={{ fontSize: 11 }} width={40} tickFormatter={(v) => num(Number(v))} />
                    <Tooltip formatter={(v) => num(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="reach" dataKey="Reach" fill="#f6b39c" />
                    <Line yAxisId="eng" type="monotone" dataKey="Engagements" stroke="#c53c11" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="card mt-4 overflow-x-auto">
            <div className="mb-2 text-sm font-semibold">By platform</div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Platform</th><th className="th">Followers</th><th className="th">Growth</th><th className="th">New follows</th>
                  <th className="th">Reach</th><th className="th">Impressions</th><th className="th">Engagements</th><th className="th">Eng. rate</th>
                  <th className="th">Profile views</th><th className="th">Posts</th>
                </tr>
              </thead>
              <tbody>
                {available.map((p) => {
                  const all = social.filter((r) => r.platform === p.id && r.date >= cutoff)
                  const span = followerSpan(all)
                  const newFollows = sum(all, 'new_followers')
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="td font-medium">{p.label}</td>
                      <td className="td">{num(span.last)}</td>
                      <td className={`td ${!span.known ? 'text-slate-400' : span.change >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {span.known ? `${span.change >= 0 ? '+' : ''}${num(span.change)}${span.first ? ` (${((span.change / span.first) * 100).toFixed(1)}%)` : ''}` : '–'}
                      </td>
                      <td className="td">{all.some((r) => r.metric === 'new_followers') ? num(newFollows) : '–'}</td>
                      <td className="td">{num(sum(all, 'reach'))}</td>
                      <td className="td">{num(sum(all, 'impressions'))}</td>
                      <td className="td">{num(sum(all, 'engagement'))}</td>
                      <td className="td">{pct(engRate(all))}</td>
                      <td className="td">{num(sum(all, 'profile_views'))}</td>
                      <td className="td">{num((posts.data ?? []).flatMap((x) => x.post_targets).filter((t) => t.platform === p.id && t.status === 'published').length)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="card mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">Top posts in this period</div>
              <Link to="/posts" className="text-xs text-brand-600 hover:text-link-hover hover:underline">All post performance</Link>
            </div>
            {topPosts.length === 0 ? <Empty>No posts published through the dashboard in this period.</Empty> : (
              <div className="divide-y divide-slate-100">
                {topPosts.map(({ post, t }) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{t.caption || post.title || '(no caption)'}</div>
                      <div className="text-xs text-slate-500">{platformLabel(t.platform)}{t.published_at && ` · ${format(new Date(t.published_at), 'd MMM')}`}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-600">
                      <div className="font-medium text-ink">{num(engagementOf(t.metrics))} engagements</div>
                      <div>{num(pick(t.metrics, 'views', 'impressions'))} views{t.public_url && <> · <a href={t.public_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">Open</a></>}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Account stats come from Meta (Facebook and Instagram) and refresh daily. Post stats come from Blotato.
            Instagram doesn't report new follows per day, so that column shows “–” for it.
          </p>
        </>
      )}
    </div>
  )
}
