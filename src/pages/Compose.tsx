import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, Notice, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { listMedia, uploadMedia } from '../lib/media'
import { callFn, supabase } from '../lib/supabase'
import { isVideo, PLATFORMS, type PlatformId } from '../lib/util'

type Copy = { caption: string; first_comment: string }
const emptyCopy = (): Record<PlatformId, Copy> =>
  Object.fromEntries(PLATFORMS.map((p) => [p.id, { caption: '', first_comment: '' }])) as Record<PlatformId, Copy>

export default function Compose() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const editId = params.get('id')

  const [postId, setPostId] = useState<string | null>(editId)
  const [title, setTitle] = useState('')
  const [media, setMedia] = useState<string[]>(params.get('media') ? [params.get('media')!] : [])
  const [selected, setSelected] = useState<PlatformId[]>(['facebook', 'instagram'])
  const [copy, setCopy] = useState(emptyCopy)
  const [when, setWhen] = useState('')
  const [showLibrary, setShowLibrary] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // AI helper
  const [aiInput, setAiInput] = useState(params.get('idea') ?? '')
  const [aiModel, setAiModel] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const brand = useQuery({
    queryKey: ['brand-models'],
    queryFn: async () => (await supabase.from('brand_settings').select('ai_models').eq('id', 1).single()).data?.ai_models as string[] | undefined,
  })
  const library = useQuery({ queryKey: ['media'], queryFn: listMedia, enabled: showLibrary })

  // Load an existing draft for editing
  useEffect(() => {
    if (!editId) return
    supabase.from('posts').select('*, post_targets(*)').eq('id', editId).single().then(({ data }) => {
      if (!data) return
      setTitle(data.title ?? '')
      setMedia(data.media_urls ?? [])
      setWhen(data.scheduled_at ? new Date(new Date(data.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
      const c = emptyCopy()
      for (const t of data.post_targets ?? []) c[t.platform as PlatformId] = { caption: t.caption, first_comment: t.first_comment ?? '' }
      setCopy(c)
      setSelected((data.post_targets ?? []).map((t: any) => t.platform))
    })
  }, [editId])

  const setField = (p: PlatformId, f: keyof Copy, v: string) => setCopy((c) => ({ ...c, [p]: { ...c[p], [f]: v } }))
  const toggle = (p: PlatformId) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))

  async function onFiles(files: FileList | null) {
    if (!files?.length || !profile) return
    setUploading(true); setError(null)
    try {
      for (const f of Array.from(files)) {
        const asset = await uploadMedia(f, profile.id)
        setMedia((m) => [...m, asset.public_url])
      }
      qc.invalidateQueries({ queryKey: ['media'] })
    } catch (e) { setError(e) }
    setUploading(false)
  }

  async function runAi(mode: 'generate' | 'rewrite') {
    setAiBusy(true); setError(null)
    try {
      const input = mode === 'rewrite' ? (aiInput || copy[selected[0]]?.caption) : aiInput
      const res = await callFn<{ results: Record<string, Copy> }>('ai-write', { mode, input, platforms: selected, model: aiModel || brand.data?.[0] })
      setCopy((c) => ({ ...c, ...res.results }))
    } catch (e) { setError(e) }
    setAiBusy(false)
  }

  function copyToAll() {
    const src = copy[selected[0]]
    setCopy((c) => {
      const next = { ...c }
      for (const p of selected.slice(1)) next[p] = { ...next[p], caption: src.caption }
      return next
    })
  }

  /** Save the post and its per-platform copy; returns the post id. */
  async function save(): Promise<string> {
    if (!profile) throw new Error('Not signed in')
    if (!selected.length) throw new Error('Select at least one platform')
    const row = {
      title: title || copy[selected[0]].caption.slice(0, 60) || 'Untitled post',
      media_urls: media,
      scheduled_at: when ? new Date(when).toISOString() : null,
    }
    let id = postId
    if (id) {
      const { error } = await supabase.from('posts').update(row).eq('id', id)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await supabase.from('posts').insert({ ...row, author_id: profile.id }).select('id').single()
      if (error) throw new Error(error.message)
      id = data.id as string
      setPostId(id)
    }
    // Only draft/failed targets are replaced, so already-sent platforms are never touched.
    const { data: existing } = await supabase.from('post_targets').select('id, platform, status').eq('post_id', id)
    const locked = new Set((existing ?? []).filter((t) => !['draft', 'failed'].includes(t.status)).map((t) => t.platform))
    const removable = (existing ?? []).filter((t) => !locked.has(t.platform) && !selected.includes(t.platform as PlatformId)).map((t) => t.id)
    if (removable.length) await supabase.from('post_targets').delete().in('id', removable)
    const rows = selected.filter((p) => !locked.has(p)).map((p) => ({
      post_id: id, platform: p, caption: copy[p].caption, first_comment: copy[p].first_comment || null, status: 'draft', error_message: null,
    }))
    if (rows.length) {
      const { error } = await supabase.from('post_targets').upsert(rows, { onConflict: 'post_id,platform' })
      if (error) throw new Error(error.message)
    }
    return id!
  }

  async function saveDraft() {
    setBusy(true); setError(null); setNotice(null)
    try { await save(); setNotice('Draft saved.') } catch (e) { setError(e) }
    setBusy(false)
  }

  async function publish() {
    setError(null); setNotice(null)
    const missing = selected.filter((p) => !copy[p].caption.trim())
    if (missing.length) { setError(new Error(`Add a caption for: ${missing.join(', ')}`)); return }
    if (selected.some((p) => p === 'instagram' || p === 'tiktok') && media.length === 0) {
      setError(new Error('Instagram and TikTok need an image or video')); return
    }
    const label = when ? `Schedule this post to ${selected.length} platform(s)?` : `Publish this post now to ${selected.length} platform(s)?`
    if (!window.confirm(label)) return
    setBusy(true)
    try {
      const id = await save()
      const res = await callFn<{ results: { platform: string; ok: boolean; error?: string }[] }>('publish-post', { post_id: id })
      qc.invalidateQueries({ queryKey: ['posts'] })
      const failed = res.results.filter((r) => !r.ok)
      if (failed.length) setError(new Error('Some platforms failed: ' + failed.map((f) => `${f.platform} (${f.error})`).join('; ')))
      else nav('/posts')
    } catch (e) { setError(e) }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader title="Create post" subtitle="Upload once, tailor the caption per platform, publish through BAITCAMP's accounts" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card space-y-3">
            <div>
              <label className="label" htmlFor="title">Internal title (optional)</label>
              <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Launch week teaser" />
            </div>
            <div>
              <div className="label">Media</div>
              <div className="flex flex-wrap gap-2">
                {media.map((u) => (
                  <div key={u} className="relative h-24 w-24 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {isVideo(u) ? <video src={u} className="h-full w-full object-cover" muted /> : <img src={u} alt="" className="h-full w-full object-cover" />}
                    <button className="absolute right-1 top-1 rounded bg-white/90 px-1 text-xs" onClick={() => setMedia((m) => m.filter((x) => x !== u))} aria-label="Remove">✕</button>
                  </div>
                ))}
                <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50">
                  {uploading ? 'Uploading…' : '+ Upload'}
                  <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
                </label>
                <button className="h-24 w-24 rounded-md border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50" onClick={() => setShowLibrary((s) => !s)}>
                  From library
                </button>
              </div>
              {showLibrary && (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {!library.data?.length ? <div className="p-2 text-sm text-slate-500">{library.isLoading ? 'Loading…' : 'The library is empty.'}</div> : (
                    <div className="flex flex-wrap gap-2">
                      {library.data.map((a) => (
                        <button key={a.id} title={a.file_name} disabled={media.includes(a.public_url)} onClick={() => setMedia((m) => [...m, a.public_url])}
                          className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-100 disabled:opacity-40">
                          {isVideo(a.public_url) ? <video src={a.public_url} className="h-full w-full object-cover" muted /> : <img src={a.public_url} alt={a.file_name} className="h-full w-full object-cover" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="label">Platforms</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button key={p.id} onClick={() => toggle(p.id)} aria-pressed={selected.includes(p.id)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${selected.includes(p.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {selected.length === 0 ? <Empty>Select at least one platform.</Empty> : PLATFORMS.filter((p) => selected.includes(p.id)).map((p, i) => (
            <div key={p.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {i === 0 && selected.length > 1 && <button className="text-blue-600 hover:underline" onClick={copyToAll}>Copy caption to all</button>}
                  <span>{copy[p.id].caption.length} chars</span>
                </div>
              </div>
              <textarea className="input min-h-28" placeholder={`${p.label} caption`} value={copy[p.id].caption} onChange={(e) => setField(p.id, 'caption', e.target.value)} />
              {p.firstComment ? (
                <textarea className="input min-h-16" placeholder={p.id === 'threads' || p.id === 'twitter' ? 'First comment (posted as a reply)' : 'First comment (optional)'}
                  value={copy[p.id].first_comment} onChange={(e) => setField(p.id, 'first_comment', e.target.value)} />
              ) : <div className="text-xs text-slate-400">First comments aren't available on {p.label}.</div>}
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="card space-y-2">
            <div className="text-sm font-semibold">AI writer (brand voice)</div>
            <textarea className="input min-h-28" placeholder="Describe the post idea, or paste a rough draft…" value={aiInput} onChange={(e) => setAiInput(e.target.value)} />
            <select className="input" value={aiModel} onChange={(e) => setAiModel(e.target.value)} aria-label="AI model">
              {(brand.data ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={aiBusy || !selected.length || !aiInput.trim()} onClick={() => runAi('generate')}>{aiBusy ? 'Writing…' : 'Write captions'}</button>
              <button className="btn flex-1" disabled={aiBusy || !selected.length} onClick={() => runAi('rewrite')} title="Rewrites the text above, or your first caption, in the brand voice">Rewrite in voice</button>
            </div>
            <p className="text-xs text-slate-500">Fills the captions for every selected platform. Always read before posting.</p>
          </div>

          <div className="card space-y-3">
            <div className="text-sm font-semibold">Publish</div>
            <div>
              <label className="label" htmlFor="when">Schedule for (leave empty to post now)</label>
              <input id="when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <ErrorNote error={error} />
            {notice && <Notice>{notice}</Notice>}
            <button className="btn btn-primary w-full" disabled={busy || uploading} onClick={publish}>{busy ? 'Working…' : when ? 'Schedule post' : 'Publish now'}</button>
            <button className="btn w-full" disabled={busy || uploading} onClick={saveDraft}>Save draft</button>
          </div>
        </div>
      </div>
    </div>
  )
}
