import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { Badge, Empty, ErrorNote, PageHeader, Stat } from '../components/ui'
import { useAuth, type Profile } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { money, monthStart } from '../lib/util'

interface Row { month: string; sales_count: number; net_cents: number; share_cents: number; paid_cents: number; paid_at: string | null }

export default function Earnings() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const [picked, setPicked] = useState('')
  const [error, setError] = useState<unknown>(null)

  const people = useQuery({
    queryKey: ['profiles'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw new Error(error.message)
      return data as Profile[]
    },
  })
  const marketers = (people.data ?? []).filter((p) => Number(p.rev_share_pct) > 0)
  const who: Profile | null | undefined = isAdmin ? (marketers.find((p) => p.id === picked) ?? marketers[0]) : profile

  const statement = useQuery({
    queryKey: ['statement', who?.id],
    enabled: !!who,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('revenue_share_statement', { p_marketer: who!.id })
      if (error) throw new Error(error.message)
      return data as Row[]
    },
  })
  const rows = statement.data ?? []
  const earned = rows.reduce((a, r) => a + Number(r.share_cents), 0)
  const paid = rows.reduce((a, r) => a + Number(r.paid_cents), 0)
  const thisMonth = monthStart(new Date())

  async function markPaid(r: Row) {
    if (!who) return
    if (!window.confirm(`Record ${money(Number(r.share_cents))} as paid to ${who.full_name} for ${format(new Date(r.month + 'T00:00:00'), 'MMMM yyyy')}?`)) return
    const { error } = await supabase.from('payouts').insert({ marketer_id: who.id, month: r.month, amount_cents: r.share_cents })
    if (error) setError(new Error(error.message)); else qc.invalidateQueries({ queryKey: ['statement'] })
  }
  async function undo(r: Row) {
    if (!who || !window.confirm('Remove this payout record?')) return
    const { error } = await supabase.from('payouts').delete().eq('marketer_id', who.id).eq('month', r.month)
    if (error) setError(new Error(error.message)); else qc.invalidateQueries({ queryKey: ['statement'] })
  }

  return (
    <div>
      <PageHeader title="Revenue share" subtitle={who ? `${who.full_name}: ${Number(who.rev_share_pct)}% of net Gumroad revenue since ${format(new Date(who.start_date + 'T00:00:00'), 'd MMM yyyy')}` : 'Share of net Gumroad revenue'}>
        {isAdmin && marketers.length > 0 && (
          <select className="input w-auto" value={who?.id ?? ''} onChange={(e) => setPicked(e.target.value)} aria-label="Choose person">
            {marketers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
      </PageHeader>
      <ErrorNote error={error ?? statement.error ?? people.error} />

      {(isAdmin && people.isLoading) || statement.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : !who ? <Empty>Nobody has a revenue share set yet. Set one on the Team page.</Empty> : Number(who.rev_share_pct) === 0 ? <Empty>No revenue share is set on this account.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Earned to date" value={money(earned)} />
            <Stat label="Paid" value={money(paid)} />
            <Stat label="Outstanding" value={money(earned - paid)} hint="Includes the current month so far" />
            <Stat label="Sales since start" value={String(rows.reduce((a, r) => a + Number(r.sales_count), 0))} />
          </div>
          <div className="card mt-4 overflow-x-auto p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Month</th><th className="th">Sales</th><th className="th">Net revenue</th><th className="th">Share ({Number(who.rev_share_pct)}%)</th><th className="th">Status</th>{isAdmin && <th className="th"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isPaid = !!r.paid_at
                  const current = r.month === thisMonth
                  return (
                    <tr key={r.month} className="border-b border-slate-100 last:border-0">
                      <td className="td font-medium">{format(new Date(r.month + 'T00:00:00'), 'MMMM yyyy')}</td>
                      <td className="td">{r.sales_count}</td>
                      <td className="td">{money(Number(r.net_cents))}</td>
                      <td className="td font-medium">{money(Number(r.share_cents))}</td>
                      <td className="td">
                        {isPaid ? <><Badge status="published" /> <span className="text-xs text-slate-500">paid {money(Number(r.paid_cents))} on {format(new Date(r.paid_at!), 'd MMM')}</span></>
                          : current ? <span className="text-xs text-slate-500">Month in progress</span>
                          : Number(r.share_cents) === 0 ? <span className="text-xs text-slate-400">Nothing due</span> : <Badge status="queued" />}
                      </td>
                      {isAdmin && (
                        <td className="td text-xs">
                          {isPaid ? <button className="text-red-700 hover:underline" onClick={() => undo(r)}>Undo</button>
                            : !current && Number(r.share_cents) > 0 && <button className="text-brand-600 hover:text-link-hover hover:underline" onClick={() => markPaid(r)}>Mark as paid</button>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Net revenue is the sale price minus Gumroad fees; refunded and charged-back sales count as zero. A refund after a month is paid lowers that month's figure.</p>
        </>
      )}
    </div>
  )
}
