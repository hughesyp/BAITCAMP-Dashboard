import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorNote, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { listMedia, uploadMedia, type MediaAsset } from '../lib/media'
import { supabase } from '../lib/supabase'
import { isVideo } from '../lib/util'

export default function Media() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const media = useQuery({ queryKey: ['media'], queryFn: listMedia })
  const [filter, setFilter] = useState<'all' | 'brand' | 'image' | 'video'>('all')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const reload = () => qc.invalidateQueries({ queryKey: ['media'] })

  async function onFiles(files: FileList | null) {
    if (!files?.length || !profile) return
    setUploading(true); setError(null)
    try { for (const f of Array.from(files)) await uploadMedia(f, profile.id) } catch (e) { setError(e) }
    setUploading(false); reload()
  }

  async function update(a: MediaAsset, patch: Partial<MediaAsset>) {
    const { error } = await supabase.from('media_assets').update(patch).eq('id', a.id)
    if (error) setError(new Error(error.message)); else reload()
  }

  async function remove(a: MediaAsset) {
    if (!window.confirm(`Delete "${a.file_name}" from the library? Posts already published keep working.`)) return
    await supabase.storage.from('media').remove([a.storage_path])
    const { error } = await supabase.from('media_assets').delete().eq('id', a.id)
    if (error) setError(new Error(error.message)); else reload()
  }

  const items = (media.data ?? []).filter((a) => {
    if (filter === 'brand' && !a.is_brand_asset) return false
    if (filter === 'image' && isVideo(a.public_url)) return false
    if (filter === 'video' && !isVideo(a.public_url)) return false
    const q = search.toLowerCase()
    return !q || a.file_name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))
  })

  return (
    <div>
      <PageHeader title="Media library" subtitle="Shared videos, images and brand assets to reuse in posts">
        <input className="input w-44" placeholder="Search name or tag" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search media" />
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter media">
          <option value="all">All</option><option value="brand">Brand assets</option><option value="image">Images</option><option value="video">Videos</option>
        </select>
        <label className="btn btn-primary cursor-pointer">
          {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
        </label>
      </PageHeader>
      <ErrorNote error={error ?? media.error} />

      {media.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : items.length === 0 ? <Empty>Nothing here yet. Upload images or videos to share them with the team.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((a) => {
            const mine = a.uploaded_by === profile?.id || isAdmin
            return (
              <div key={a.id} className="card p-2">
                <div className="aspect-square overflow-hidden rounded bg-slate-100">
                  {isVideo(a.public_url) ? <video src={a.public_url} className="h-full w-full object-cover" controls preload="metadata" /> : <img src={a.public_url} alt={a.file_name} loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <div className="mt-2 truncate text-xs font-medium" title={a.file_name}>{a.file_name}</div>
                {a.is_brand_asset && <div className="text-xs text-blue-700">Brand asset</div>}
                <input className="input mt-1 px-2 py-1 text-xs" placeholder="tags, comma separated" defaultValue={a.tags.join(', ')} disabled={!mine} aria-label={`Tags for ${a.file_name}`}
                  onBlur={(e) => { const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); if (tags.join() !== a.tags.join()) update(a, { tags }) }} />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <Link to={`/compose?media=${encodeURIComponent(a.public_url)}`} className="text-blue-600 hover:underline">Use in post</Link>
                  <a href={a.public_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a>
                  {isAdmin && <button className="text-blue-600 hover:underline" onClick={() => update(a, { is_brand_asset: !a.is_brand_asset })}>{a.is_brand_asset ? 'Unmark brand' : 'Mark brand'}</button>}
                  {mine && <button className="text-red-700 hover:underline" onClick={() => remove(a)}>Delete</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
