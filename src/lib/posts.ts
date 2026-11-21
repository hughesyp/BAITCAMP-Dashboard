import { useQuery } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { postDate, type Post, type PostTarget } from './data'
import { fetchAll, supabase } from './supabase'

/** A post on one of the connected accounts, with stats from the platform (filled by sync-posts). */
export interface SocialPost {
  platform: string
  native_id: string
  permalink: string | null
  caption: string | null
  media_type: string | null
  thumbnail_url: string | null
  published_at: string | null
  metrics: Record<string, number>
  metrics_updated_at: string | null
  post_target_id: string | null
  post_targets: { id: string; post_id: string; posts: { id: string; author_id: string | null; title: string | null } | null } | null
}

export async function loadSocialPosts(fromIso: string): Promise<SocialPost[]> {
  return fetchAll<SocialPost>((from, to) =>
    supabase.from('social_posts').select('*, post_targets(id, post_id, posts(id, author_id, title))')
      .gte('published_at', fromIso).order('published_at', { ascending: false }).range(from, to) as any)
}

export const useSocialPosts = (days: number) =>
  useQuery({ queryKey: ['social-posts', days], queryFn: () => loadSocialPosts(subDays(new Date(), days).toISOString()) })

/** One row on Post performance: an account post, a dashboard post, or both (linked). */
export interface PostRow {
  key: string
  platform: string
  date: string
  caption: string
  title: string | null
  authorId: string | null
  status: string
  /** Created in the dashboard */
  dashboard: boolean
  metrics: Record<string, number>
  /** Where the stats come from */
  source: 'platform' | 'blotato' | null
  url: string | null
  thumbnail: string | null
  post?: Post
  target?: PostTarget
}

export const metricOf = (m: Record<string, number> | null | undefined, ...keys: string[]) => {
  for (const k of keys) if (m && m[k] !== undefined) return Number(m[k])
  return undefined
}
export const engagementOf = (m: Record<string, number> | null | undefined) =>
  (metricOf(m, 'likes', 'reactions') ?? 0) + ['comments', 'shares', 'saves', 'reposts', 'quotes'].reduce((a, k) => a + (metricOf(m, k) ?? 0), 0)

/** Every account post, plus dashboard posts the platforms didn't return (drafts, scheduled, X, not yet synced). */
export function combinePosts(posts: Post[], social: SocialPost[]): PostRow[] {
  const linked = new Set(social.map((s) => s.post_target_id).filter(Boolean))
  const targets = new Map<string, { post: Post; t: PostTarget }>()
  for (const p of posts) for (const t of p.post_targets) targets.set(t.id, { post: p, t })

  const rows: PostRow[] = social.map((s) => {
    const own = s.post_target_id ? targets.get(s.post_target_id) : undefined
    const dash = s.post_targets?.posts
    return {
      key: `${s.platform}:${s.native_id}`,
      platform: s.platform,
      date: s.published_at ?? s.metrics_updated_at ?? '',
      caption: s.caption ?? own?.t.caption ?? '',
      title: dash?.title ?? own?.post.title ?? null,
      authorId: dash?.author_id ?? own?.post.author_id ?? null,
      status: 'published',
      dashboard: !!s.post_target_id,
      metrics: s.metrics ?? {},
      source: 'platform',
      url: s.permalink ?? own?.t.public_url ?? null,
      thumbnail: s.thumbnail_url,
      post: own?.post,
      target: own?.t,
    }
  })
  for (const { post, t } of targets.values()) {
    if (linked.has(t.id)) continue
    rows.push({
      key: t.id,
      platform: t.platform,
      date: t.published_at ?? postDate(post),
      caption: t.caption,
      title: post.title,
      authorId: post.author_id,
      status: t.status,
      dashboard: true,
      metrics: t.metrics ?? {},
      source: Object.keys(t.metrics ?? {}).length ? 'blotato' : null,
      url: t.public_url,
      thumbnail: null,
      post,
      target: t,
    })
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}
