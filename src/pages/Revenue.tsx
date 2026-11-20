import { format } from 'date-fns'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Empty, ErrorNote, PageHeader, RangePicker, Stat } from '../components/ui'
import { useSales } from '../lib/data'
import { lastDays, money, num, platformLabel, saleCounts, saleNet, type Sale } from '../lib/util'

function group(sales: Sale[], key: (s: Sale) => string) {
  const map = new Map<string, { sales: number; gross: number; net: number }>()
  for (const s of sales.filter(saleCounts)) {
    const k = key(s)
    const cur = map.get(k) ?? { sales: 0, gross: 0, net: 0 }
    map.set(k, { sales: cur.sales + 1, gross: cur.gross + s.price_cents, net: cur.net + saleNet(s) })
  }
  return [...map].sort((a, b) => b[1].net - a[1].net)
}

function Breakdown({ title, rows, total }: { title: string; rows: ReturnType<typeof group>; total: number }) {
  return (
    <div className="card overflow-x-auto">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200"><th className="th">Name</th><th className="th">Sales</th><th className="th">Gross</th><th className="th">Net</th><th className="th">Share</th></tr>
          </thead>
          <tbody>
            {rows.map(([name, v]) => (
              <tr key={name} className="border-b border-slate-100 last:border-0">
                <td className="td max-w-56 truncate font-medium">{platformLabel(name)}</td>
                <td className="td">{v.sales}</td>
                <td className="td">{money(v.gross)}</td>
                <td className="td">{money(v.net)}</td>
                <td className="td text-slate-500">{total ? Math.round((v.net / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Revenue() {
  const [days, setDays] = useState(30)
  const { data, error, isLoading } = useSales(days)
  const s = data ?? []
  const net = s.reduce((a, x) => a + saleNet(x), 0)
  const gross = s.filter(saleCounts).reduce((a, x) => a + x.price_cents, 0)
  const refunds = s.filter((x) => !saleCounts(x)).length

  const byDay = new Map(lastDays(days).map((d) => [d, 0]))
  for (const x of s.filter(saleCounts)) {
    const d = format(new Date(x.created_at), 'yyyy-MM-dd')
    if (byDay.has(d)) byDay.set(d, byDay.get(d)! + 1)
  }
  const chart = [...byDay].map(([date, sales]) => ({ date: format(new Date(date + 'T00:00:00'), 'd MMM'), sales }))

  return (
    <div>
      <PageHeader title="Revenue & sources" subtitle="Gumroad sales and where buyers came from">
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>
      <ErrorNote error={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net revenue" value={money(net)} hint="After fees and refunds" />
        <Stat label="Gross revenue" value={money(gross)} />
        <Stat label="Sales" value={num(s.filter(saleCounts).length)} />
        <Stat label="Refunds / chargebacks" value={num(refunds)} />
      </div>

      <div className="card mt-4">
        <div className="mb-2 text-sm font-semibold">Sales per day</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="sales" fill="#eb4f1e" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Breakdown title="Sales by source" rows={group(s, (x) => x.source ?? 'direct')} total={net} />
        <Breakdown title="Sales by product" rows={group(s, (x) => x.product_name ?? 'Unknown')} total={net} />
      </div>

      <div className="card mt-4 overflow-x-auto">
        <div className="mb-2 text-sm font-semibold">Recent sales</div>
        {isLoading ? <div className="text-sm text-slate-500">Loading…</div> : s.length === 0 ? (
          <Empty>No sales found for this period. Sales appear after the Gumroad sync runs (admin: Settings).</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200"><th className="th">Date</th><th className="th">Product</th><th className="th">Source</th><th className="th">Referrer</th><th className="th">Price</th><th className="th">Net</th></tr>
            </thead>
            <tbody>
              {s.slice(0, 50).map((x) => (
                <tr key={x.id} className="border-b border-slate-100 last:border-0">
                  <td className="td whitespace-nowrap">{format(new Date(x.created_at), 'd MMM HH:mm')}</td>
                  <td className="td max-w-48 truncate">{x.product_name}</td>
                  <td className="td">{platformLabel(x.source ?? 'direct')}</td>
                  <td className="td max-w-48 truncate text-slate-500">{x.referrer ?? '–'}</td>
                  <td className="td">{money(x.price_cents)}</td>
                  <td className="td">{saleCounts(x) ? money(saleNet(x)) : <Badge status="failed" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
