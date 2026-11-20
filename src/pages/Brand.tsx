import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Empty, ErrorNote, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { callFn } from '../lib/supabase'

interface NotionPage { id: string; title: string; icon: string | null; url: string | null; last_edited_at: string | null; markdown?: string; error?: string }

const HEX = /^#[0-9a-f]{6}$/i

// Plain-Tailwind styling for the rendered Notion content.
const components: Components = {
  h1: ({ children }) => <h2 className="mb-2 mt-6 text-lg font-semibold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-4 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-3 rounded-md border-l-4 border-slate-300 bg-slate-50 px-4 py-1 text-slate-700">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-ink underline decoration-brand-500 underline-offset-2 hover:text-link-hover">{children}</a>,
  hr: () => <hr className="my-5 border-slate-200" />,
  table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-slate-200 px-3 py-1.5 align-top">{children}</td>,
  code: ({ children }) => {
    const text = String(children)
    return (
      <code className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]">
        {HEX.test(text) && <span className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: text }} />}
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md bg-slate-100 p-3 text-xs">{children}</pre>,
}

export default function Brand() {
  const { isAdmin } = useAuth()
  const list = useQuery({ queryKey: ['notion-pages'], queryFn: () => callFn<{ pages: NotionPage[] }>('notion-pages', { action: 'list' }), retry: false })
  const pages = list.data?.pages ?? []
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { if (!selected && pages.length) setSelected(pages[0].id) }, [pages, selected])

  const page = useQuery({
    queryKey: ['notion-page', selected],
    enabled: !!selected,
    queryFn: () => callFn<{ page: NotionPage }>('notion-pages', { action: 'page', page_id: selected }),
    retry: false,
  })
  const p = page.data?.page

  return (
    <div>
      <PageHeader title="Brand guide" subtitle="Brand voice, branding and who we're talking to. Read only: these come straight from Notion.">
        <button className="btn" disabled={page.isFetching} onClick={() => { list.refetch(); page.refetch() }}>{page.isFetching ? 'Loading…' : 'Refresh'}</button>
      </PageHeader>
      <ErrorNote error={list.error} />

      {list.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : list.error ? null : pages.length === 0 ? (
        <Empty>No Notion pages are set up yet.{isAdmin ? ' Add them in Settings.' : ''}</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="tablist">
            {pages.map((x) => (
              <button key={x.id} role="tab" aria-selected={selected === x.id} onClick={() => setSelected(x.id)}
                className={`rounded-md border px-3 py-1.5 text-sm ${selected === x.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {x.icon ? `${x.icon} ` : ''}{x.title}
              </button>
            ))}
          </div>

          <div className="card max-w-4xl">
            {page.isLoading ? <div className="text-sm text-slate-500">Loading from Notion…</div> : page.error ? <ErrorNote error={page.error} /> : !p ? null : (
              <>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
                  <h1 className="text-xl font-semibold">{p.icon ? `${p.icon} ` : ''}{p.title}</h1>
                  <div className="text-xs text-slate-500">
                    {p.last_edited_at && `Updated ${format(new Date(p.last_edited_at), 'd MMM yyyy')}`}
                    {p.url && <> · <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-link-hover hover:underline">Edit in Notion</a></>}
                  </div>
                </div>
                <div className="text-sm text-slate-800">
                  {p.markdown ? <Markdown remarkPlugins={[remarkGfm]} components={components}>{p.markdown}</Markdown> : <span className="text-slate-400">This page is empty.</span>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
