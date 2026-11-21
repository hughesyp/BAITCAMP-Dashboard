import { NavLink, Outlet } from 'react-router-dom'
import logo from '../assets/logo.png'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

interface Item { to: string; label: string }
interface Group { title: string | null; items: Item[]; adminOnly?: boolean }

const GROUPS: Group[] = [
  { title: null, items: [{ to: '/', label: 'Overview' }] },
  {
    title: 'Performance',
    items: [
      { to: '/revenue', label: 'Revenue & sources' },
      { to: '/social', label: 'Social accounts' },
      { to: '/posts', label: 'Post performance' },
      { to: '/email', label: 'Email stats' },
      { to: '/targets', label: 'Targets' },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/calendar', label: 'Calendar' },
      { to: '/email/drafts', label: 'Email drafts' },
      { to: '/ideas', label: 'Ideas & tasks' },
      { to: '/media', label: 'Media library' },
      { to: '/brand', label: 'Brand guide' },
    ],
  },
  { title: 'Earnings', items: [{ to: '/earnings', label: 'Revenue share' }] },
  {
    title: 'Admin',
    adminOnly: true,
    items: [
      { to: '/admin/targets', label: 'Manage targets' },
      { to: '/team', label: 'Team' },
      { to: '/settings', label: 'Settings' },
    ],
  },
]

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `block whitespace-nowrap rounded-md border-l-2 px-3 py-1.5 text-sm ${
    isActive ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-transparent text-ink-2 hover:bg-slate-100 hover:text-ink'
  }`

export default function Layout() {
  const { profile, isAdmin } = useAuth()
  const groups = GROUPS.filter((g) => !g.adminOnly || isAdmin)

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:fixed md:inset-y-0 md:flex md:w-60 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src={logo} alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
          <div className="leading-tight">
            <div className="text-base font-extrabold tracking-tight text-ink">BAITCAMP</div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-brand-600">Marketing dashboard</div>
          </div>
        </div>

        <div className="px-3 pb-3">
          <NavLink to="/compose" className="btn btn-primary w-full">+ Create post</NavLink>
        </div>

        {/* Phone: one horizontal scrolling row. Desktop: grouped column. */}
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:flex-1 md:overflow-y-auto md:pb-4">
          {groups.map((g) => (
            <div key={g.title ?? 'top'} className="flex gap-1 md:mb-3 md:block md:space-y-0.5">
              {g.title && <div className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:block">{g.title}</div>}
              {g.items.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/email'} className={itemClass}>{n.label}</NavLink>)}
            </div>
          ))}
        </nav>

        <div className="hidden border-t border-slate-200 p-3 text-xs text-slate-500 md:block">
          <div className="truncate font-medium text-ink">{profile?.full_name}</div>
          <div className="truncate">{profile?.email}</div>
          <button className="mt-2 text-brand-600 hover:text-link-hover hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:ml-60 md:p-6">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
        <button className="mt-8 text-xs text-brand-600 hover:text-link-hover hover:underline md:hidden" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    </div>
  )
}
