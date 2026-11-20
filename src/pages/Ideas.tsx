import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { teamName, useTeam } from '../lib/data'
import { supabase } from '../lib/supabase'

interface Idea {
  id: string; created_by: string | null; assigned_to: string | null; title: string; body: string | null
  status: 'todo' | 'doing' | 'done'; due_date: string | null; created_at: string
}
const COLUMNS: { id: Idea['status']; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done' },
]

export default function Ideas() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const team = useTeam()
  const [error, setError] = useState<unknown>(null)
  const [form, setForm] = useState({ title: '', body: '', assigned_to: '', due_date: '' })
  const ideas = useQuery({
    queryKey: ['ideas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ideas').select('*').order('created_at', { ascending: false }).limit(300)
      if (error) throw new Error(error.message)
      return data as Idea[]
    },
  })
  const reload = () => qc.invalidateQueries({ queryKey: ['ideas'] })

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null)
    const { error } = await supabase.from('ideas').insert({
      title: form.title, body: form.body || null, assigned_to: form.assigned_to || null, due_date: form.due_date || null, created_by: profile!.id,
    })
    if (error) setError(new Error(error.message))
    else { setForm({ title: '', body: '', assigned_to: '', due_date: '' }); reload() }
  }
  async function move(i: Idea, status: Idea['status']) {
    const { error } = await supabase.from('ideas').update({ status }).eq('id', i.id)
    if (error) setError(new Error(error.message)); else reload()
  }
  async function remove(i: Idea) {
    if (!window.confirm('Delete this item?')) return
    const { error } = await supabase.from('ideas').delete().eq('id', i.id)
    if (error) setError(new Error(error.message)); else reload()
  }

  return (
    <div>
      <PageHeader title="Ideas & tasks" subtitle="Post ideas, briefs and to-dos for the team" />
      <ErrorNote error={error ?? ideas.error} />

      <form onSubmit={add} className="card mb-4 grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label" htmlFor="ititle">Idea or task</label>
          <input id="ititle" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="ibody">Details (optional)</label>
          <input id="ibody" className="input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="iassign">Assign to</label>
          <select id="iassign" className="input" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Anyone</option>
            {(team.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="idue">Due</label>
          <input id="idue" type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </div>
        <div className="md:col-span-6"><button className="btn btn-primary">Add</button></div>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = (ideas.data ?? []).filter((i) => i.status === col.id)
          return (
            <div key={col.id}>
              <div className="mb-2 text-sm font-semibold">{col.label} <span className="font-normal text-slate-400">{items.length}</span></div>
              <div className="space-y-2">
                {items.map((i) => (
                  <div key={i.id} className="card p-3">
                    <div className="text-sm font-medium">{i.title}</div>
                    {i.body && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{i.body}</div>}
                    <div className="mt-2 text-xs text-slate-500">
                      {i.assigned_to ? `For ${teamName(team.data, i.assigned_to)}` : 'For anyone'} · from {teamName(team.data, i.created_by)}
                      {i.due_date && ` · due ${format(new Date(i.due_date + 'T00:00:00'), 'd MMM')}`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {COLUMNS.filter((c) => c.id !== i.status).map((c) => (
                        <button key={c.id} className="text-brand-600 hover:text-link-hover hover:underline" onClick={() => move(i, c.id)}>Move to {c.label.toLowerCase()}</button>
                      ))}
                      <Link className="text-brand-600 hover:text-link-hover hover:underline" to={`/compose?idea=${encodeURIComponent(i.title + (i.body ? '\n' + i.body : ''))}`}>Create post</Link>
                      {(isAdmin || i.created_by === profile?.id) && <button className="text-red-700 hover:underline" onClick={() => remove(i)}>Delete</button>}
                    </div>
                  </div>
                ))}
                {items.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Nothing here</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
