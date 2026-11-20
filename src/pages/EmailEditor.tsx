import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { useNavigate, useParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import { Badge, ErrorNote, Notice, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { statusLabel, useGroups, type EmailCampaign } from '../lib/email'
import { callFn, supabase } from '../lib/supabase'

export default function EmailEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const { profile, isAdmin } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const groups = useGroups()

  const [row, setRow] = useState<EmailCampaign | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [idea, setIdea] = useState('')
  const [audience, setAudience] = useState<'us' | 'uk'>('us')
  const [model, setModel] = useState('')
  const models = useQuery({
    queryKey: ['brand-models'],
    queryFn: async () => (await supabase.from('brand_settings').select('ai_models').eq('id', 1).single()).data?.ai_models as string[] | undefined,
  })

  useEffect(() => {
    if (isNew) return
    supabase.from('email_campaigns').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error) { setError(new Error(error.message)); return }
      const c = data as EmailCampaign
      setRow(c); setName(c.name); setSubject(c.subject); setBody(c.body_md ?? ''); setGroupIds(c.group_ids ?? [])
    })
  }, [id, isNew])

  const canEdit = isNew || (!!row && (row.author_id === profile?.id || isAdmin) && (!row.ml_status || row.ml_status === 'draft'))

  async function save(): Promise<string> {
    if (!profile) throw new Error('Not signed in')
    const fields = { name: name.trim() || subject.trim() || 'Untitled email', subject: subject.trim(), body_md: body, group_ids: groupIds, updated_at: new Date().toISOString() }
    if (row) {
      const { error } = await supabase.from('email_campaigns').update(fields).eq('id', row.id)
      if (error) throw new Error(error.message)
      setRow({ ...row, ...fields })
      return row.id
    }
    const { data, error } = await supabase.from('email_campaigns').insert({ ...fields, author_id: profile.id }).select('*').single()
    if (error) throw new Error(error.message)
    setRow(data as EmailCampaign)
    window.history.replaceState(null, '', `/email/drafts/${data.id}`)
    return data.id as string
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setNotice(null)
    try { await fn() } catch (e) { setError(e) }
    setBusy('')
    qc.invalidateQueries({ queryKey: ['email-drafts'] })
  }

  const saveDraft = () => run('save', async () => { await save(); setNotice('Saved in the dashboard.') })

  const push = () => run('push', async () => {
    if (!subject.trim() || !body.trim()) throw new Error('Add a subject and write the email first')
    if (!window.confirm(row?.mailerlite_id ? 'Update the draft in MailerLite with these changes?' : 'Send this to MailerLite as a draft? It will not be sent to anyone until the admin sends it from MailerLite.')) return
    const emailId = await save()
    const res = await callFn<{ content_pushed: boolean }>('mailerlite', { action: 'push', id: emailId })
    const { data } = await supabase.from('email_campaigns').select('*').eq('id', emailId).single()
    if (data) setRow(data as EmailCampaign)
    setNotice(res.content_pushed
      ? 'The draft is in MailerLite. The admin will review and send it from there.'
      : "The draft is in MailerLite, but your MailerLite plan doesn't accept email content from the dashboard. Use “Copy email HTML” and paste it into the draft in MailerLite.")
  })

  const copyHtml = () => run('copy', async () => {
    const emailId = row?.id ?? await save()
    const { html } = await callFn<{ html: string }>('mailerlite', { action: 'html', id: emailId })
    await navigator.clipboard.writeText(html)
    setNotice('Email HTML copied. In MailerLite, open the draft, choose the custom HTML editor and paste it.')
  })

  const runAi = (mode: 'generate' | 'rewrite') => run('ai', async () => {
    const input = mode === 'rewrite' ? (body || idea) : idea
    const res = await callFn<{ email: { subject: string; body: string } }>('ai-write', { channel: 'email', mode, input, audience, model: model || models.data?.[0] })
    if (res.email.subject) setSubject(res.email.subject)
    setBody(res.email.body)
  })

  const remove = () => run('delete', async () => {
    if (!row) return
    if (!window.confirm(`Delete "${row.name}"?${row.mailerlite_id ? ' This only removes it from the dashboard; delete the draft in MailerLite too.' : ''}`)) return
    const { error } = await supabase.from('email_campaigns').delete().eq('id', row.id)
    if (error) throw new Error(error.message)
    nav('/email/drafts')
  })

  const toggleGroup = (g: string) => setGroupIds((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))
  const status = row ? statusLabel(row) : null

  return (
    <div>
      <PageHeader title={isNew ? 'Write an email' : 'Email draft'} subtitle="Written here, reviewed and sent by the admin in MailerLite">
        {status && <Badge status={status.badge} label={status.text} />}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card space-y-3">
            <div>
              <label className="label" htmlFor="subject">Subject line</label>
              <input id="subject" className="input" value={subject} disabled={!canEdit} maxLength={255} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. 3 knots worth learning before your next trip" />
            </div>
            <div>
              <label className="label" htmlFor="ename">Internal name (shown in MailerLite's campaign list)</label>
              <input id="ename" className="input" value={name} disabled={!canEdit} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Cast, 4 Dec" />
            </div>
            <div>
              <div className="label">Send to these groups (the admin can change this in MailerLite)</div>
              {groups.error ? <div className="text-xs text-slate-500">{(groups.error as Error).message}</div> : groups.isLoading ? <div className="text-xs text-slate-500">Loading groups…</div> : (
                <div className="flex flex-wrap gap-2">
                  {(groups.data ?? []).map((g) => (
                    <button key={g.id} disabled={!canEdit} onClick={() => toggleGroup(g.id)} aria-pressed={groupIds.includes(g.id)}
                      className={`rounded-md border px-2.5 py-1 text-xs ${groupIds.includes(g.id) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-ink-2'}`}>
                      {g.name} <span className="opacity-70">({g.active_count})</span>
                    </button>
                  ))}
                  {groups.data?.length === 0 && <span className="text-xs text-slate-500">No groups in MailerLite.</span>}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="body">Email (Markdown: blank line between paragraphs, ## for headings, - for lists, [text](link) for links)</label>
              <textarea id="body" className="input min-h-72 font-mono text-[13px]" value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Preview</div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Subject: <span className="font-medium text-ink">{subject || '(no subject)'}</span></div>
              <div className="bg-brand-500 px-6 py-4 text-xl font-extrabold tracking-tight text-white">BAITCAMP</div>
              <div className="space-y-3 px-6 py-5 text-[15px] leading-relaxed [&_a]:text-brand-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-brand-500 [&_blockquote]:bg-brand-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">
                {body.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown> : <p className="text-slate-400">Your email will appear here.</p>}
              </div>
              <div className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">You're receiving this because you signed up at baitcamp.net. <u>Unsubscribe</u></div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {canEdit && (
            <div className="card space-y-2">
              <div className="text-sm font-semibold">AI writer (uses the Brand guide)</div>
              <textarea className="input min-h-24" placeholder="What's this email about? e.g. this week's tip: how to fish a drop shot rig for bass" value={idea} onChange={(e) => setIdea(e.target.value)} />
              <select className="input" value={audience} onChange={(e) => setAudience(e.target.value as 'us' | 'uk')} aria-label="Audience">
                <option value="us">Audience: US/Canada (primary)</option>
                <option value="uk">Audience: UK (secondary)</option>
              </select>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)} aria-label="AI model">
                {(models.data ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" disabled={!!busy || !idea.trim()} onClick={() => runAi('generate')}>{busy === 'ai' ? 'Writing…' : 'Write email'}</button>
                <button className="btn flex-1" disabled={!!busy || !(body.trim() || idea.trim())} onClick={() => runAi('rewrite')}>Rewrite in voice</button>
              </div>
              <p className="text-xs text-slate-500">Fills the subject and email. Always read and check it before sending to MailerLite.</p>
            </div>
          )}

          <div className="card space-y-3">
            <div className="text-sm font-semibold">MailerLite</div>
            <ErrorNote error={error} />
            {notice && <Notice>{notice}</Notice>}
            {row?.error_message && !error && <ErrorNote error={row.error_message} />}
            {canEdit ? (
              <>
                <button className="btn btn-primary w-full" disabled={!!busy} onClick={push}>{busy === 'push' ? 'Sending…' : row?.mailerlite_id ? 'Update draft in MailerLite' : 'Send to MailerLite as draft'}</button>
                <button className="btn w-full" disabled={!!busy} onClick={saveDraft}>{busy === 'save' ? 'Saving…' : 'Save here only'}</button>
              </>
            ) : <p className="text-sm text-slate-600">This email can no longer be edited here.</p>}
            {(row?.mailerlite_id && !row.content_pushed) || isAdmin ? (
              <button className="btn w-full" disabled={!!busy || !body.trim()} onClick={copyHtml}>Copy email HTML</button>
            ) : null}
            {row && (isAdmin || (row.author_id === profile?.id && !row.mailerlite_id)) && (
              <button className="btn btn-danger w-full" disabled={!!busy} onClick={remove}>Delete</button>
            )}
            <p className="text-xs text-slate-500">Nothing is emailed from the dashboard. Drafts wait in MailerLite until the admin sends them.</p>
            {isAdmin && <a className="block text-xs text-brand-600 hover:text-link-hover hover:underline" href="https://dashboard.mailerlite.com/" target="_blank" rel="noreferrer">Open MailerLite</a>}
          </div>
        </div>
      </div>
    </div>
  )
}
