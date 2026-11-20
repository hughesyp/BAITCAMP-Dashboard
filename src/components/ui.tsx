import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</div>
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{children}</div>
}

export function Progress({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-green-100 text-green-800',
  done: 'bg-green-100 text-green-800',
  scheduled: 'bg-sky-100 text-sky-800',
  queued: 'bg-amber-100 text-amber-800',
  'in-progress': 'bg-amber-100 text-amber-800',
  doing: 'bg-amber-100 text-amber-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  draft: 'bg-slate-100 text-slate-700',
  todo: 'bg-slate-100 text-slate-700',
}

export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>{label ?? status}</span>
}

export function RangePicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
      {[7, 30, 90].map((d) => (
        <button key={d} onClick={() => onChange(d)} className={`px-3 py-1.5 ${value === d ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          {d} days
        </button>
      ))}
    </div>
  )
}
