import { supabase } from './supabase'

export interface MediaAsset {
  id: string
  uploaded_by: string | null
  storage_path: string
  public_url: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  tags: string[]
  is_brand_asset: boolean
  created_at: string
}

/** Upload a file to the media bucket and record it in the library. */
export async function uploadMedia(file: File, userId: string): Promise<MediaAsset> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  const { data: pub } = supabase.storage.from('media').getPublicUrl(path)
  const { data, error: insErr } = await supabase.from('media_assets').insert({
    uploaded_by: userId,
    storage_path: path,
    public_url: pub.publicUrl,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  }).select().single()
  if (insErr) throw new Error(insErr.message)
  return data as MediaAsset
}

export async function listMedia(): Promise<MediaAsset[]> {
  const { data, error } = await supabase.from('media_assets').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return data as MediaAsset[]
}
