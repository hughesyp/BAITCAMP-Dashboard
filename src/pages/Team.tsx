import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorNote, Notice, PageHeader } from '../components/ui'
import { useAuth, type Profile } from '../lib/auth'
import { callFn, supabase } from '../lib/supabase'
import { ymd } from '../lib/util'

export default function Team() {
  const { profile: me } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', start_date: ymd(new Date()), rev_share_pct: '10' })
  const people = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at')
      if (error) throw new Error(error.message)
      return data as Profile[]
    },
  })
  const reload = () => { qc.invalidateQueries({ queryKey: ['profiles'] }); qc.invalidateQueries({ queryKey: ['team'] }) }

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await callFn('invite-user', { ...form, rev_share_pct: Number(form.rev_share_pct), redirect_to: window.location.origin })
      setNotice(`Invite sent to ${form.email}. They set their own password from the email link.`)
      setForm({ ...form, email: '', full_name: '' })
      reload()
    } catch (err) { setError(err) }
    setBusy(false)
  }

  async function update(p: Profile, patch: Partial<Profile>) {
    setError(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) setError(new Error(error.message)); else reload()
  }

  return (
    <div>
      <PageHeader title="Team" subtitle="Invite marketers and set their start date and revenue share" />
      <ErrorNote error={error ?? people.error} />
      {notice && <Notice>{notice}</Notice>}

      <form onSubmit={invite} className="card mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label" htmlFor="iemail">Email</label>
          <input id="iemail" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="iname">Name</label>
          <input id="iname" className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="istart">Start date</label>
          <input id="istart" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="ipct">Revenue share %</label>
          <input id="ipct" type="number" min="0" max="100" step="0.5" className="input" value={form.rev_share_pct} onChange={(e) => setForm({ ...form, rev_share_pct: e.target.value })} required />
        </div>
        <div className="flex items-end"><button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button></div>
      </form>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Start date</th><th className="th">Share %</th><th className="th">Access</th>
            </tr>
          </thead>
          <tbody>
            {(people.data ?? []).map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="td">
                  <input className="input w-40" defaultValue={p.full_name ?? ''} aria-label={`Name for ${p.email}`} onBlur={(e) => e.target.value !== (p.full_name ?? '') && update(p, { full_name: e.target.value })} />
                </td>
                <td className="td text-slate-600">{p.email}</td>
                <td className="td">
                  <select className="input w-28" value={p.role} disabled={p.id === me?.id} aria-label={`Role for ${p.email}`} onChange={(e) => update(p, { role: e.target.value as Profile['role'] })}>
                    <option value="marketer">Marketer</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="td">
                  <input type="date" className="input w-40" defaultValue={p.start_date} aria-label={`Start date for ${p.email}`} onBlur={(e) => e.target.value && e.target.value !== p.start_date && update(p, { start_date: e.target.value })} />
                </td>
                <td className="td">
                  <input type="number" min="0" max="100" step="0.5" className="input w-20" defaultValue={Number(p.rev_share_pct)} aria-label={`Revenue share for ${p.email}`}
                    onBlur={(e) => Number(e.target.value) !== Number(p.rev_share_pct) && update(p, { rev_share_pct: Number(e.target.value) })} />
                </td>
                <td className="td">
                  <button className={`btn ${p.active ? '' : 'btn-danger'}`} disabled={p.id === me?.id} onClick={() => update(p, { active: !p.active })}>
                    {p.active ? 'Active' : 'Deactivated'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Changes save when you leave a field. Deactivating someone blocks their access immediately; their posts and history are kept.</p>
    </div>
  )
}
