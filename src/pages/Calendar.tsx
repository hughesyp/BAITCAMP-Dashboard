import { useQuery } from '@tanstack/react-query'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, PageHeader } from '../components/ui'
import { loadPosts, postDate, teamName, useTeam } from '../lib/data'
import { platformLabel } from '../lib/util'

const DOT: Record<string, string> = {
  published: 'bg-green-500', scheduled: 'bg-blue-500', queued: 'bg-amber-500', partial: 'bg-amber-500', failed: 'bg-red-500', draft: 'bg-slate-400',
}

export default function Calendar() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const team = useTeam()
  const gridStart = startOfWeek(month, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const posts = useQuery({ queryKey: ['posts', 'calendar', month.toISOString()], queryFn: () => loadPosts(addMonths(gridStart, -1).toISOString()) })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Scheduled, published and draft posts">
        <button className="btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">←</button>
        <div className="w-36 text-center text-sm font-semibold">{format(month, 'MMMM yyyy')}</div>
        <button className="btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">→</button>
        <Link to="/compose" className="btn btn-primary">Create post</Link>
      </PageHeader>
      <ErrorNote error={posts.error} />
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border border-slate-200 bg-slate-200 gap-px">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">{d}</div>
          ))}
          {days.map((d) => {
            const items = (posts.data ?? []).filter((p) => isSameDay(new Date(postDate(p)), d))
            return (
              <div key={d.toISOString()} className={`min-h-24 p-1.5 ${isSameMonth(d, month) ? 'bg-white' : 'bg-slate-50'}`}>
                <div className={`mb-1 text-xs ${isSameDay(d, new Date()) ? 'font-bold text-blue-600' : 'text-slate-500'}`}>{format(d, 'd')}</div>
                <div className="space-y-1">
                  {items.map((p) => (
                    <Link key={p.id} to={p.status === 'draft' ? `/compose?id=${p.id}` : '/posts'}
                      title={`${p.title} — ${teamName(team.data, p.author_id)} — ${p.post_targets.map((t) => platformLabel(t.platform)).join(', ')}`}
                      className="flex items-center gap-1 rounded bg-slate-100 px-1 py-0.5 text-xs hover:bg-slate-200">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.status] ?? 'bg-slate-400'}`} />
                      <span className="truncate">{format(new Date(postDate(p)), 'HH:mm')} {p.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        {Object.entries({ published: 'Published', scheduled: 'Scheduled', queued: 'Sending', failed: 'Failed', draft: 'Draft' }).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[k]}`} />{label}</span>
        ))}
      </div>
    </div>
  )
}
