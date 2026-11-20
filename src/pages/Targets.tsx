import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addMonths, format } from 'date-fns'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorNote, PageHeader, Progress } from '../components/ui'
import { useAuth } from '../lib/auth'
import { loadMonthData, TARGET_KINDS, targetProgress, teamName, useTeam, type Target } from '../lib/data'
import { supabase } from '../lib/supabase'
import { monthStart, num, PLATFORMS, platformLabel } from '../lib/util'

/** Everyone sees progress. With `manage` (admin-only route) targets can be added and deleted. */
export default function Targets({ manage = false }: { manage?: boolean }) {
  const { isAdmin: admin } = useAuth()
  const isAdmin = manage && admin
  const qc = useQueryClient()
  const team = useTeam()
  const [date, setDate] = useState(new Date())
  const month = monthStart(date)
  const [error, setError] = useState<unknown>(null)
  const [form, setForm] = useState({ kind: 'revenue' as Target['kind'], platform: '', marketer_id: '', target_value: '', note: '' })

  const q = useQuery({
    queryKey: ['targets', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('targets').select('*').eq('month', month).order('created_at')
      if (error) throw new Error(error.message)
      return { targets: data as Target[], data: await loadMonthData(month) }
    },
  })
  const reload = () => { qc.invalidateQueries({ queryKey: ['targets'] }); qc.invalidateQueries({ queryKey: ['targets-overview'] }) }

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null)
    const platformOk = !['revenue', 'sales_count', 'email_subscribers', 'email_new_subscribers'].includes(form.kind)
    const { error } = await supabase.from('targets').insert({
      month, kind: form.kind,
      platform: platformOk && form.platform ? form.platform : null,
      marketer_id: form.kind === 'posts' && form.marketer_id ? form.marketer_id : null,
      target_value: Number(form.target_value), note: form.note || null,
    })
    if (error) setError(new Error(error.message))
    else { setForm({ ...form, target_value: '', note: '' }); reload() }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this target?')) return
    const { error } = await supabase.from('targets').delete().eq('id', id)
    if (error) setError(new Error(error.message)); else reload()
  }

  return (
    <div>
      <PageHeader title={isAdmin ? 'Manage targets' : 'Targets'} subtitle={isAdmin ? 'Set the monthly goals everyone sees on Targets and Overview' : 'Monthly goals and progress against them'}>
        {admin && !manage && <Link to="/admin/targets" className="btn">Manage targets</Link>}
        <button className="btn" onClick={() => setDate(addMonths(date, -1))} aria-label="Previous month">←</button>
        <div className="w-36 text-center text-sm font-semibold">{format(date, 'MMMM yyyy')}</div>
        <button className="btn" onClick={() => setDate(addMonths(date, 1))} aria-label="Next month">→</button>
      </PageHeader>
      <ErrorNote error={error ?? q.error} />

      {q.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : !q.data?.targets.length ? (
        <Empty>No targets set for {format(date, 'MMMM')}.{isAdmin ? ' Add one below.' : ''}</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.targets.map((t) => {
            const v = targetProgress(t, q.data!.data)
            const pct = t.target_value > 0 ? Math.round((v / t.target_value) * 100) : 0
            return (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{TARGET_KINDS[t.kind]}</div>
                    <div className="text-xs text-slate-500">
                      {t.kind.startsWith('email_') ? 'MailerLite' : t.platform ? platformLabel(t.platform) : 'All platforms'} · {t.marketer_id ? teamName(team.data, t.marketer_id) : 'Whole team'}
                    </div>
                  </div>
                  {isAdmin && <button className="text-xs text-red-700 hover:underline" onClick={() => remove(t.id)}>Delete</button>}
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <div className="text-2xl font-semibold">{num(v)}<span className="text-sm font-normal text-slate-500"> / {num(t.target_value)}</span></div>
                  <div className={`text-sm font-medium ${pct >= 100 ? 'text-green-700' : 'text-slate-600'}`}>{pct}%</div>
                </div>
                <div className="mt-2"><Progress value={v} target={t.target_value} /></div>
                {t.note && <div className="mt-2 text-xs text-slate-500">{t.note}</div>}
              </div>
            )
          })}
        </div>
      )}

      {isAdmin && (
        <form onSubmit={add} className="card mt-5">
          <div className="mb-3 text-sm font-semibold">Add a target for {format(date, 'MMMM yyyy')}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="label" htmlFor="kind">Type</label>
              <select id="kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Target['kind'] })}>
                {Object.entries(TARGET_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tplatform">Platform</label>
              <select id="tplatform" className="input" value={form.platform} disabled={['revenue', 'sales_count', 'email_subscribers', 'email_new_subscribers'].includes(form.kind)} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="">All platforms</option>
                {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tperson">Person (posts only)</label>
              <select id="tperson" className="input" value={form.marketer_id} disabled={form.kind !== 'posts'} onChange={(e) => setForm({ ...form, marketer_id: e.target.value })}>
                <option value="">Whole team</option>
                {(team.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tvalue">Target</label>
              <input id="tvalue" type="number" min="0" step="any" className="input" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="tnote">Note</label>
              <input id="tnote" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary mt-3">Add target</button>
        </form>
      )}
    </div>
  )
}
