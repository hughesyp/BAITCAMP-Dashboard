import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Empty, ErrorNote, PageHeader, RangePicker, Stat } from '../components/ui'
import { useAuth } from '../lib/auth'
import { postDate, teamName, usePosts, useTeam } from '../lib/data'
import { callFn, supabase } from '../lib/supabase'
import { num, PLATFORMS, platformLabel } from '../lib/util'

const metric = (m: Record<string, number> | null, ...keys: string[]) => {
  for (const k of keys) if (m && m[k] !== undefined) return m[k]
  return undefined
}

export default function Posts() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const [days, setDays] = useState(30)
  const [author, setAuthor] = useState('')
  const [platform, setPlatform] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const posts = usePosts(days)
  const team = useTeam()

  const rows = (posts.data ?? [])
    .filter((p) => !author || p.author_id === author)
    .flatMap((p) => p.post_targets.filter((t) => !platform || t.platform === platform).map((t) => ({ post: p, t })))

  const published = rows.filter((r) => r.t.status === 'published')
  const total = (...keys: string[]) => published.reduce((a, r) => a + (metric(r.t.metrics, ...keys) ?? 0), 0)

  async function refresh() {
    setBusy(true); setError(null)
    try { await callFn('sync-posts'); await qc.invalidateQueries({ queryKey: ['posts'] }) } catch (e) { setError(e) }
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
      <PageHeader title="Post performance" subtitle="Every post sent through the dashboard and how it did">
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
      <ErrorNote error={error ?? posts.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Published" value={num(published.length)} />
        <Stat label="Views" value={num(total('views', 'impressions'))} />
        <Stat label="Likes" value={num(total('likes', 'reactions'))} />
        <Stat label="Comments" value={num(total('comments'))} />
      </div>

      {posts.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : rows.length === 0 ? (
        <Empty>No posts yet for this filter. <Link to="/compose" className="text-blue-600 hover:underline">Create the first one.</Link></Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Date</th><th className="th">Post</th><th className="th">Platform</th><th className="th">By</th><th className="th">Status</th>
                <th className="th">Views</th><th className="th">Reach</th><th className="th">Likes</th><th className="th">Comments</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ post, t }) => {
                const mine = post.author_id === profile?.id || isAdmin
                const cell = (...keys: string[]) => { const v = metric(t.metrics, ...keys); return v === undefined ? '–' : num(v) }
                return (
                  <tr key={t.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="td whitespace-nowrap">{format(new Date(t.published_at ?? postDate(post)), 'd MMM HH:mm')}</td>
                    <td className="td max-w-72">
                      <div className="truncate font-medium">{post.title}</div>
                      <div className="line-clamp-2 text-xs text-slate-500">{t.caption}</div>
                      {t.error_message && <div className="mt-1 text-xs text-red-700">{t.error_message}</div>}
                    </td>
                    <td className="td">{platformLabel(t.platform)}</td>
                    <td className="td whitespace-nowrap">{teamName(team.data, post.author_id)}</td>
                    <td className="td"><Badge status={t.status} /></td>
                    <td className="td">{cell('views', 'impressions')}</td>
                    <td className="td">{cell('reach')}</td>
                    <td className="td">{cell('likes', 'reactions')}</td>
                    <td className="td">{cell('comments')}</td>
                    <td className="td whitespace-nowrap text-xs">
                      {t.public_url && <a href={t.public_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a>}
                      {mine && ['draft', 'failed'].includes(t.status) && <Link to={`/compose?id=${post.id}`} className="ml-2 text-blue-600 hover:underline">{t.status === 'failed' ? 'Fix & retry' : 'Edit'}</Link>}
                      {mine && post.status === 'draft' && <button className="ml-2 text-red-700 hover:underline" onClick={() => remove(post.id)}>Delete</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Post stats come from Blotato and update a few times over 30 days.</p>
    </div>
  )
}
