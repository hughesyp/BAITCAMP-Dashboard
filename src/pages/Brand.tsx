import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ErrorNote, Notice, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const FIELDS = [
  { key: 'product_summary', label: 'About the product', hint: 'What BAITCAMP is, who it is for, price, key benefits.' },
  { key: 'voice', label: 'Brand voice', hint: 'Tone, personality, how it should sound. Include example sentences.' },
  { key: 'guidelines', label: 'Guidelines', hint: 'Formatting rules, emoji use, calls to action, anything else.' },
  { key: 'dos', label: 'Do', hint: 'Things every post should do.' },
  { key: 'donts', label: "Don't", hint: 'Words, claims and topics to avoid.' },
  { key: 'hashtags', label: 'Approved hashtags', hint: '' },
  { key: 'links', label: 'Links to use', hint: 'Gumroad link, website, tracking links.' },
] as const

type BrandRow = Record<(typeof FIELDS)[number]['key'], string> & { ai_models: string[] }

export default function Brand() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const brand = useQuery({
    queryKey: ['brand'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brand_settings').select('*').eq('id', 1).single()
      if (error) throw new Error(error.message)
      return data as BrandRow
    },
  })
  const [form, setForm] = useState<BrandRow | null>(null)
  const [models, setModels] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (brand.data) { setForm(brand.data); setModels(brand.data.ai_models.join('\n')) }
  }, [brand.data])

  async function save() {
    if (!form) return
    setError(null); setSaved(false)
    const ai_models = models.split('\n').map((m) => m.trim()).filter(Boolean)
    const patch = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key]]))
    const { error } = await supabase.from('brand_settings').update({ ...patch, ai_models, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) { setError(new Error(error.message)); return }
    setSaved(true); setEditing(false)
    qc.invalidateQueries({ queryKey: ['brand'] }); qc.invalidateQueries({ queryKey: ['brand-models'] })
  }

  if (!form) return <div className="text-sm text-slate-500">{brand.error ? <ErrorNote error={brand.error} /> : 'Loading…'}</div>

  return (
    <div>
      <PageHeader title="Brand voice & guidelines" subtitle="How BAITCAMP should sound. The AI writer follows this too.">
        {isAdmin && !editing && <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
        {editing && <button className="btn" onClick={() => { setForm(brand.data!); setEditing(false) }}>Cancel</button>}
        {editing && <button className="btn btn-primary" onClick={save}>Save</button>}
      </PageHeader>
      <ErrorNote error={error} />
      {saved && <Notice>Saved.</Notice>}

      <div className="mt-3 space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="card">
            <label className="text-sm font-semibold" htmlFor={f.key}>{f.label}</label>
            {editing ? (
              <>
                {f.hint && <div className="mb-1 text-xs text-slate-500">{f.hint}</div>}
                <textarea id={f.key} className="input mt-1 min-h-28" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              </>
            ) : (
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{form[f.key] || <span className="text-slate-400">Not set yet.</span>}</div>
            )}
          </div>
        ))}
        {isAdmin && (
          <div className="card">
            <label className="text-sm font-semibold" htmlFor="models">AI models marketers can choose (OpenRouter ids, one per line)</label>
            {editing ? <textarea id="models" className="input mt-1 min-h-24 font-mono" value={models} onChange={(e) => setModels(e.target.value)} />
              : <div className="mt-1 whitespace-pre-wrap font-mono text-sm text-slate-700">{models}</div>}
            <div className="mt-1 text-xs text-slate-500">The first one is the default. Find ids at openrouter.ai/models.</div>
          </div>
        )}
      </div>
    </div>
  )
}
