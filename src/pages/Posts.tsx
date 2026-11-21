import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, DashboardTag, Empty, ErrorNote, PageHeader, RangePicker, Stat } from '../components/ui'
import { useAuth } from '../lib/auth'
import { teamName, usePosts, useTeam } from '../lib/data'
import { combinePosts, metricOf, useSocialPosts } from '../lib/posts'
import { callFn, supabase } from '../lib/supabase'
import { num, PLATFORMS, platformLabel } from '../lib/util'

export default function Posts() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const [days, setDays] = useState(30)
  const [author, setAuthor] = useState('')
  const [platform, setPlatform] = useState('')
  const [origin, setOrigin] = useState<'' | 'dashboard' | 'other'>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const posts = usePosts(days)
  const social = useSocialPosts(days)
  const team = useTeam()

  const all = combinePosts(posts.data ?? [], social.data ?? [])
  const rows = all
    .filter((r) => !platform || r.platform === platform)
    .filter((r) => !author || r.authorId === author)
    .filter((r) => !origin || (origin === 'dashboard') === r.dashboard)

  const published = rows.filter((r) => r.status === 'published')
  const total = (...keys: string[]) => published.reduce((a, r) => a + (metricOf(r.metrics, ...keys) ?? 0), 0)
  const fromDashboard = published.filter((r) => r.dashboard).length

  async function refresh() {
    setBusy(true); setError(null)
    try {
      await callFn('sync-posts', { force: true })
      await Promise.all([qc.invalidateQueries({ queryKey: ['posts'] }), qc.invalidateQueries({ queryKey: ['social-posts'] })])
    } catch (e) { setError(e) }
    setBusy(false)
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this draft?')) return
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) setError(new Error(error.message))
    else qc.invalidateQueries({ queryKey: ['posts'] })
  }

  return (
    <div>
      <PageHeader title="Post performance" subtitle="Every post on the connected accounts and how it did">
        <select className="input w-auto" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} aria-label="Filter by where the post was made">
          <option value="">All posts</option>
          <option value="dashboard">Made in the dashboard</option>
          <option value="other">Posted elsewhere</option>
        </select>
        <select className="input w-auto" value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Filter by person">
          <option value="">Everyone</option>
          {(team.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
        <select className="input w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter by platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <RangePicker value={days} onChange={setDays} />
        <button className="btn" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh stats'}</button>
        <Link to="/compose" className="btn btn-primary">Create post</Link>
      </PageHeader>
      <ErrorNote error={error ?? posts.error ?? social.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Published" value={num(published.length)} hint={published.length ? `${num(fromDashboard)} made in the dashboard` : undefined} />
        <Stat label="Views" value={num(total('views', 'impressions'))} />
        <Stat label="Likes" value={num(total('likes', 'reactions'))} />
        <Stat label="Comments" value={num(total('comments'))} />
      </div>

      {posts.isLoading || social.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : rows.length === 0 ? (
        <Empty>No posts for this filter. <Link to="/compose" className="text-brand-600 hover:text-link-hover hover:underline">Create one.</Link></Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Date</th><th className="th">Post</th><th className="th">Platform</th><th className="th">By</th><th className="th">Status</th>
                <th className="th">Views</th><th className="th">Reach</th><th className="th">Likes</th><th className="th">Comments</th><th className="th">Shares</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = !!r.post && (r.post.author_id === profile?.id || isAdmin)
                const cell = (...keys: string[]) => { const v = metricOf(r.metrics, ...keys); return v === undefined ? '–' : num(v) }
                return (
                  <tr key={r.key} className={`border-b border-slate-100 align-top last:border-0 ${r.dashboard ? 'bg-brand-50' : ''}`}>
                    <td className={`td whitespace-nowrap ${r.dashboard ? 'border-l-4 border-l-brand-500' : 'border-l-4 border-l-transparent'}`}>{r.date ? format(new Date(r.date), 'd MMM HH:mm') : '–'}</td>
                    <td className="td max-w-80">
                      <div className="flex gap-2">
                        {r.thumbnail && <img src={r.thumbnail} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                        <div className="min-w-0">
                          {r.dashboard && <div className="mb-0.5 flex items-center gap-1.5"><DashboardTag />{r.title && <span className="truncate text-xs font-medium">{r.title}</span>}</div>}
                          <div className="line-clamp-2 text-xs text-slate-600">{r.caption || '(no caption)'}</div>
                          {r.target?.error_message && <div className="mt-1 text-xs text-red-700">{r.target.error_message}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="td">{platformLabel(r.platform)}</td>
                    <td className="td whitespace-nowrap">{r.dashboard ? teamName(team.data, r.authorId) : <span className="text-slate-400">–</span>}</td>
                    <td className="td"><Badge status={r.status} /></td>
                    <td className="td">{cell('views', 'impressions')}</td>
                    <td className="td">{cell('reach')}</td>
                    <td className="td">{cell('likes', 'reactions')}</td>
                    <td className="td">{cell('comments')}</td>
                    <td className="td">{cell('shares', 'reposts')}</td>
                    <td className="td whitespace-nowrap text-xs">
                      {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-link-hover hover:underline">View</a>}
                      {mine && r.target && ['draft', 'failed'].includes(r.target.status) && <Link to={`/compose?id=${r.post!.id}`} className="ml-2 text-brand-600 hover:text-link-hover hover:underline">{r.target.status === 'failed' ? 'Fix & retry' : 'Edit'}</Link>}
                      {mine && r.post?.status === 'draft' && <button className="ml-2 text-red-700 hover:underline" onClick={() => remove(r.post!.id)}>Delete</button>}
                      {r.source === 'blotato' && <div className="mt-0.5 text-slate-400">via Blotato</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Posts marked <DashboardTag /> were made in the dashboard. Stats for Facebook, Instagram, Threads and TikTok come from the platforms and refresh hourly, covering the last 90 days.
        X stats come from Blotato (marked “via Blotato”) and only for posts made here. Threads and TikTok appear once they're connected in Settings.
      </p>
    </div>
  )
}
