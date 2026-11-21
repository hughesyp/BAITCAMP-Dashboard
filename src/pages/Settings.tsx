import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ErrorNote, Notice, PageHeader } from '../components/ui'
import { callFn, supabase } from '../lib/supabase'
import { PLATFORMS } from '../lib/util'

interface BlotatoAccount { id: string; platform: string; name: string; username: string; subaccounts: { id: string; name: string }[] }
type Mapping = Record<string, { accountId?: string; pageId?: string }>

const SECRETS = [
  { key: 'gumroad', label: 'Gumroad', secret: 'GUMROAD_ACCESS_TOKEN' },
  { key: 'blotato', label: 'Blotato', secret: 'BLOTATO_API_KEY' },
  { key: 'meta', label: 'Facebook + Instagram', secret: 'META_ACCESS_TOKEN' },
  { key: 'openrouter', label: 'OpenRouter (AI)', secret: 'OPENROUTER_API_KEY' },
  { key: 'notion', label: 'Notion (brand guide)', secret: 'NOTION_API_KEY' },
  { key: 'mailerlite', label: 'MailerLite', secret: 'MAILERLITE_API_KEY' },
  { key: 'tiktok', label: 'TikTok app', secret: 'TIKTOK_CLIENT_KEY + _SECRET' },
  { key: 'threads', label: 'Threads app', secret: 'THREADS_APP_ID + _SECRET' },
  { key: 'cron', label: 'Scheduler', secret: 'CRON_SECRET' },
]

const redirectFor = (path: string) => `${window.location.origin}/settings/${path}`
const tiktokRedirect = () => redirectFor('tiktok')
const threadsRedirect = () => redirectFor('threads')

interface TikTokStatus { configured: boolean; connected: boolean; account_name?: string | null; refresh_expires_at?: string; updated_at?: string }
interface ThreadsStatus { configured: boolean; connected: boolean; account_name?: string | null; expires_at?: string; updated_at?: string }

/** TikTok or Threads sends the admin back here after they approve access. */
function ConnectCallback({ service, fn, path }: { service: string; fn: string; path: string }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const q = new URLSearchParams(window.location.search)
    if (q.get('error')) { setError(`${service} didn't connect: ${q.get('error_description') || q.get('error')}`); return }
    callFn<{ account_name: string; missing_scopes: string[] }>(fn, { action: 'exchange', code: q.get('code'), state: q.get('state'), redirect_uri: redirectFor(path) })
      .then((r) => {
        qc.invalidateQueries({ queryKey: [`${path}-status`] })
        const warn = r.missing_scopes.length ? ` Some permissions weren't granted (${r.missing_scopes.join(', ')}), so some stats will be missing; reconnect and leave them ticked.` : ''
        nav('/settings', { replace: true, state: { notice: `${service} connected${r.account_name ? ` (${r.account_name})` : ''}.${warn}` } })
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [nav, qc, service, fn, path])

  return (
    <div className="card max-w-lg space-y-3">
      <div className="text-sm font-semibold">Connecting {service}</div>
      {error ? <><ErrorNote error={error} /><Link to="/settings" className="btn">Back to Settings</Link></> : <div className="text-sm text-slate-500">Finishing the connection…</div>}
    </div>
  )
}

export const TikTokCallback = () => <ConnectCallback service="TikTok" fn="tiktok-auth" path="tiktok" />
export const ThreadsCallback = () => <ConnectCallback service="Threads" fn="threads-auth" path="threads" />

export default function Settings() {
  const qc = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)
  const [busy, setBusy] = useState('')
  const tiktokStatus = useQuery({ queryKey: ['tiktok-status'], queryFn: () => callFn<TikTokStatus>('tiktok-auth', { action: 'status' }), retry: false })
  const connectTikTok = () => run('tiktok', async () => {
    const { url } = await callFn<{ url: string }>('tiktok-auth', { action: 'start', redirect_uri: tiktokRedirect() })
    window.location.href = url
  }, () => 'Opening TikTok…')
  const disconnectTikTok = () => {
    if (!window.confirm('Disconnect TikTok? Stats already collected are kept; new ones stop until you reconnect.')) return
    run('tiktok', () => callFn('tiktok-auth', { action: 'disconnect' }), () => 'TikTok disconnected.').then(() => qc.invalidateQueries({ queryKey: ['tiktok-status'] }))
  }
  const threadsStatus = useQuery({ queryKey: ['threads-status'], queryFn: () => callFn<ThreadsStatus>('threads-auth', { action: 'status' }), retry: false })
  const connectThreads = () => run('threads', async () => {
    const { url } = await callFn<{ url: string }>('threads-auth', { action: 'start', redirect_uri: threadsRedirect() })
    window.location.href = url
  }, () => 'Opening Threads…')
  const disconnectThreads = () => {
    if (!window.confirm('Disconnect Threads? Stats already collected are kept; new ones stop until you reconnect.')) return
    run('threads', () => callFn('threads-auth', { action: 'disconnect' }), () => 'Threads disconnected.').then(() => qc.invalidateQueries({ queryKey: ['threads-status'] }))
  }
  const [xProfile, setXProfile] = useState('')
  const [accounts, setAccounts] = useState<BlotatoAccount[] | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [meta, setMeta] = useState({ pageId: '', igUserId: '' })
  const [notionPages, setNotionPages] = useState('')
  const [models, setModels] = useState('')
  const [sender, setSender] = useState({ from: '', from_name: '', reply_to: '' })

  const status = useQuery({ queryKey: ['integration-status'], queryFn: () => callFn<Record<string, boolean>>('integrations', { action: 'status' }), retry: false })
  const settings = useQuery({
    queryKey: ['integration-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('integration_settings').select('*')
      if (error) throw new Error(error.message)
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, any>
    },
  })
  const log = useQuery({
    queryKey: ['sync-log'],
    queryFn: async () => (await supabase.from('sync_log').select('*').order('ran_at', { ascending: false }).limit(15)).data ?? [],
  })

  useEffect(() => {
    if (!settings.data) return
    setMapping(settings.data.blotato ?? {})
    setMeta({ pageId: '', igUserId: '', ...(settings.data.meta ?? {}) })
    setNotionPages((settings.data.notion?.pages ?? []).join('\n'))
    setSender({ from: '', from_name: '', reply_to: '', ...(settings.data.mailerlite ?? {}) })
  }, [settings.data])

  const brand = useQuery({
    queryKey: ['brand-models'],
    queryFn: async () => (await supabase.from('brand_settings').select('ai_models').eq('id', 1).single()).data?.ai_models as string[] | undefined,
  })
  useEffect(() => { if (brand.data) setModels(brand.data.join('\n')) }, [brand.data])
  const links = useQuery({
    queryKey: ['profile-links'],
    queryFn: async () => ((await supabase.from('brand_settings').select('profile_links').eq('id', 1).single()).data?.profile_links ?? {}) as Record<string, string>,
  })
  useEffect(() => { if (links.data) setXProfile(links.data.twitter ?? '') }, [links.data])
  const saveXProfile = () => run('x-profile', async () => {
    let url = xProfile.trim()
    if (url && !/^https?:\/\//.test(url)) url = `https://x.com/${url.replace(/^@/, '')}`
    if (url && !/^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]+\/?$/.test(url)) throw new Error('Enter an X profile address like https://x.com/yourhandle, or just the handle')
    const next = { ...(links.data ?? {}) }
    if (url) next.twitter = url; else delete next.twitter
    const { error } = await supabase.from('brand_settings').update({ profile_links: next, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) throw new Error(error.message)
    setXProfile(url)
    qc.invalidateQueries({ queryKey: ['profile-links'] })
  }, () => 'Saved.')

  const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)
  const saveModels = () => run('models', async () => {
    const { error } = await supabase.from('brand_settings').update({ ai_models: lines(models), updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) throw new Error(error.message)
    qc.invalidateQueries({ queryKey: ['brand-models'] })
  }, () => 'Saved.')

  async function run(label: string, fn: () => Promise<unknown>, done?: (r: any) => string) {
    setBusy(label); setError(null); setNotice(null)
    try { const r = await fn(); setNotice(done ? done(r) : 'Done.') } catch (e) { setError(e) }
    setBusy('')
    qc.invalidateQueries({ queryKey: ['sync-log'] })
  }

  const saveSetting = (key: string, value: unknown) => run('save-' + key, async () => {
    const { error } = await supabase.from('integration_settings').upsert({ key, value, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
    qc.invalidateQueries({ queryKey: ['integration-settings'] })
  }, () => 'Saved.')

  const syncNote = (r: any) => (r?.notes?.length ? `Finished with notes: ${r.notes.join(' | ')}` : `Sync finished. ${r?.synced ?? r?.points ?? ''}`)

  return (
    <div>
      <PageHeader title="Settings" subtitle="Connections, account mapping and data syncs" />
      <div className="space-y-2">
        <ErrorNote error={error ?? status.error} />
        {notice && <Notice>{notice}</Notice>}
      </div>

      <div className="card mt-3">
        <div className="mb-2 text-sm font-semibold">Connections</div>
        <p className="mb-3 text-xs text-slate-500">API keys are stored as Supabase Edge Function secrets, never in this app. Add them with <code>supabase secrets set NAME=value</code> (see SETUP.md).</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SECRETS.map((s) => (
            <div key={s.key} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="font-mono text-xs text-slate-500">{s.secret}</div>
              </div>
              <span className={`text-xs font-medium ${status.data?.[s.key] ? 'text-green-700' : 'text-slate-400'}`}>{status.isLoading ? '…' : status.data?.[s.key] ? 'Connected' : 'Not set'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Blotato accounts used for publishing</div>
          <button className="btn" disabled={busy === 'accounts'} onClick={() => run('accounts', async () => setAccounts((await callFn<{ accounts: BlotatoAccount[] }>('integrations', { action: 'blotato-accounts' })).accounts), () => 'Loaded accounts from Blotato.')}>
            {busy === 'accounts' ? 'Loading…' : 'Load from Blotato'}
          </button>
        </div>
        <div className="space-y-2">
          {PLATFORMS.map((p) => {
            const options = (accounts ?? []).filter((a) => a.platform === p.id)
            const cur = mapping[p.id] ?? {}
            const subs = options.find((a) => a.id === cur.accountId)?.subaccounts ?? []
            const needsPage = p.id === 'facebook'
            return (
              <div key={p.id} className="grid items-center gap-2 sm:grid-cols-3">
                <div className="text-sm font-medium">{p.label}</div>
                {accounts ? (
                  <select className="input" value={cur.accountId ?? ''} aria-label={`${p.label} account`} onChange={(e) => setMapping({ ...mapping, [p.id]: { accountId: e.target.value || undefined } })}>
                    <option value="">Not used</option>
                    {options.map((a) => <option key={a.id} value={a.id}>{a.name} {a.username ? `(@${a.username})` : ''}</option>)}
                  </select>
                ) : <div className="text-sm text-slate-500">{cur.accountId ? `Account ${cur.accountId}` : 'Not linked'}</div>}
                {needsPage && (accounts ? (
                  <select className="input" value={cur.pageId ?? ''} aria-label={`${p.label} page`} onChange={(e) => setMapping({ ...mapping, [p.id]: { ...cur, pageId: e.target.value || undefined } })}>
                    <option value="">Choose page</option>
                    {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : <div className="text-sm text-slate-500">{cur.pageId ? `Page ${cur.pageId}` : ''}</div>)}
              </div>
            )
          })}
        </div>
        <button className="btn btn-primary mt-3" disabled={!accounts || busy === 'save-blotato'} onClick={() => saveSetting('blotato', mapping)}>Save account mapping</button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <div className="text-sm font-semibold">Facebook + Instagram stats</div>
          <div>
            <label className="label" htmlFor="pageId">Facebook Page ID</label>
            <input id="pageId" className="input" value={meta.pageId} onChange={(e) => setMeta({ ...meta, pageId: e.target.value.trim() })} />
          </div>
          <div>
            <label className="label" htmlFor="igId">Instagram business account ID</label>
            <input id="igId" className="input" value={meta.igUserId} onChange={(e) => setMeta({ ...meta, igUserId: e.target.value.trim() })} />
          </div>
          <button className="btn btn-primary" onClick={() => saveSetting('meta', meta)}>Save</button>
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold">TikTok stats</div>
          {tiktokStatus.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : tiktokStatus.error ? <ErrorNote error={tiktokStatus.error} /> : !tiktokStatus.data?.configured ? (
            <p className="text-sm text-slate-600">Set <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> first (SETUP.md section 6d). In the TikTok app, the redirect URI must be <code className="break-all">{tiktokRedirect()}</code></p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {tiktokStatus.data.connected
                  ? <>Connected{tiktokStatus.data.account_name ? <> as <span className="font-medium text-ink">{tiktokStatus.data.account_name}</span></> : ''}. The sign-in renews itself with each daily sync{tiktokStatus.data.refresh_expires_at ? `; if syncing stops, reconnect before ${format(new Date(tiktokStatus.data.refresh_expires_at), 'd MMM yyyy')}` : ''}.</>
                  : 'Not connected. Sign in with the BAITCAMP TikTok account and allow access to its profile, stats and videos.'}
              </p>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={!!busy} onClick={connectTikTok}>{busy === 'tiktok' ? 'Opening…' : tiktokStatus.data.connected ? 'Reconnect TikTok' : 'Connect TikTok'}</button>
                {tiktokStatus.data.connected && <button className="btn" disabled={!!busy} onClick={disconnectTikTok}>Disconnect</button>}
              </div>
              <p className="text-xs text-slate-500">Redirect URI registered in the TikTok app: <code className="break-all">{tiktokRedirect()}</code></p>
            </>
          )}
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold">Threads stats</div>
          {threadsStatus.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : threadsStatus.error ? <ErrorNote error={threadsStatus.error} /> : !threadsStatus.data?.configured ? (
            <p className="text-sm text-slate-600">Set <code>THREADS_APP_ID</code> and <code>THREADS_APP_SECRET</code> first (SETUP.md section 6e). In the Meta app's Threads settings, the redirect callback URL must be <code className="break-all">{threadsRedirect()}</code></p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {threadsStatus.data.connected
                  ? <>Connected{threadsStatus.data.account_name ? <> as <span className="font-medium text-ink">{threadsStatus.data.account_name}</span></> : ''}. The sign-in renews itself with each daily sync{threadsStatus.data.expires_at ? `; if syncing stops, reconnect before ${format(new Date(threadsStatus.data.expires_at), 'd MMM yyyy')}` : ''}.</>
                  : 'Not connected. Sign in with the BAITCAMP Threads account and allow access to its profile and insights.'}
              </p>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={!!busy} onClick={connectThreads}>{busy === 'threads' ? 'Opening…' : threadsStatus.data.connected ? 'Reconnect Threads' : 'Connect Threads'}</button>
                {threadsStatus.data.connected && <button className="btn" disabled={!!busy} onClick={disconnectThreads}>Disconnect</button>}
              </div>
              <p className="text-xs text-slate-500">Redirect callback URL registered in the Meta app: <code className="break-all">{threadsRedirect()}</code></p>
            </>
          )}
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold">X (Twitter) profile</div>
          <p className="text-sm text-slate-600">X stats aren't pulled in, because X charges for API access. The Social accounts page links to the profile instead.</p>
          <div>
            <label className="label" htmlFor="xProfile">X profile address or handle</label>
            <input id="xProfile" className="input" placeholder="https://x.com/yourhandle" value={xProfile} onChange={(e) => setXProfile(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy === 'x-profile'} onClick={saveXProfile}>Save</button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          <div className="text-sm font-semibold">Brand guide pages (Notion)</div>
          <label className="label" htmlFor="notionPages">Notion page links or IDs, one per line, in the order they should appear</label>
          <textarea id="notionPages" className="input min-h-28 font-mono text-xs" value={notionPages} onChange={(e) => setNotionPages(e.target.value)} />
          <p className="text-xs text-slate-500">Shown read-only on the Brand guide page and used by the AI writer. Each page must be shared with the Notion integration (page ⋯ → Connections). Nothing is copied: pages are read live from Notion.</p>
          <button className="btn btn-primary" onClick={() => { saveSetting('notion', { pages: lines(notionPages) }); qc.invalidateQueries({ queryKey: ['notion-pages'] }) }}>Save</button>
        </div>
        <div className="card space-y-2">
          <div className="text-sm font-semibold">AI models</div>
          <label className="label" htmlFor="models">OpenRouter model IDs marketers can choose, one per line (the first is the default)</label>
          <textarea id="models" className="input min-h-28 font-mono text-xs" value={models} onChange={(e) => setModels(e.target.value)} />
          <p className="text-xs text-slate-500">Find IDs at openrouter.ai/models.</p>
          <button className="btn btn-primary" disabled={busy === 'models'} onClick={saveModels}>Save</button>
        </div>
      </div>

      <div className="card mt-4 space-y-3">
        <div className="text-sm font-semibold">MailerLite sender (used for drafts from the dashboard)</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="mlFrom">From email (must be verified in MailerLite)</label>
            <input id="mlFrom" type="email" className="input" value={sender.from} onChange={(e) => setSender({ ...sender, from: e.target.value.trim() })} />
          </div>
          <div>
            <label className="label" htmlFor="mlName">From name</label>
            <input id="mlName" className="input" value={sender.from_name} onChange={(e) => setSender({ ...sender, from_name: e.target.value })} placeholder="e.g. Phil from BAITCAMP" />
          </div>
          <div>
            <label className="label" htmlFor="mlReply">Reply-to (optional, must be verified)</label>
            <input id="mlReply" type="email" className="input" value={sender.reply_to} onChange={(e) => setSender({ ...sender, reply_to: e.target.value.trim() })} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => saveSetting('mailerlite', { from: sender.from, from_name: sender.from_name.trim(), ...(sender.reply_to ? { reply_to: sender.reply_to } : {}) })}>Save</button>
      </div>

      <div className="card mt-4">
        <div className="mb-2 text-sm font-semibold">Sync now</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!!busy} onClick={() => run('g', () => callFn('sync-gumroad', { days: 35 }), syncNote)}>{busy === 'g' ? 'Syncing…' : 'Gumroad (35 days)'}</button>
          <button className="btn" disabled={!!busy} onClick={() => run('gf', () => callFn('sync-gumroad', { days: 3650 }), syncNote)}>{busy === 'gf' ? 'Syncing…' : 'Gumroad (all history)'}</button>
          <button className="btn" disabled={!!busy} onClick={() => run('s', () => callFn('sync-social', { days: 30 }), syncNote)}>{busy === 's' ? 'Syncing…' : 'Social stats (30 days)'}</button>
          <button className="btn" disabled={!!busy} onClick={() => run('p', () => callFn('sync-posts'), syncNote)}>{busy === 'p' ? 'Syncing…' : 'Post status + stats'}</button>
          <button className="btn" disabled={!!busy} onClick={() => run('ml', () => callFn('sync-mailerlite', { days: 90 }), syncNote)}>{busy === 'ml' ? 'Syncing…' : 'MailerLite (90 days)'}</button>
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent syncs</div>
        <div className="mt-1 divide-y divide-slate-100">
          {(log.data ?? []).map((l: any) => (
            <div key={l.id} className="flex gap-3 py-1.5 text-xs">
              <span className="w-24 shrink-0 text-slate-500">{format(new Date(l.ran_at), 'd MMM HH:mm')}</span>
              <span className={`w-16 shrink-0 font-medium ${l.ok ? 'text-green-700' : 'text-red-700'}`}>{l.source}</span>
              <span className="min-w-0 break-words text-slate-600">{l.message}</span>
            </div>
          ))}
          {!log.data?.length && <div className="py-2 text-xs text-slate-400">No syncs have run yet.</div>}
        </div>
      </div>
    </div>
  )
}
