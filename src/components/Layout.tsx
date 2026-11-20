import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/revenue', label: 'Revenue & sources' },
  { to: '/posts', label: 'Post performance' },
  { to: '/compose', label: 'Create post' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/media', label: 'Media library' },
  { to: '/targets', label: 'Targets' },
  { to: '/ideas', label: 'Ideas & tasks' },
  { to: '/brand', label: 'Brand voice' },
  { to: '/earnings', label: 'Revenue share' },
]
const ADMIN_NAV = [
  { to: '/team', label: 'Team' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { profile, isAdmin } = useAuth()
  const link = ({ isActive }: { isActive: boolean }) =>
    `block whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-slate-900 font-medium text-white' : 'text-slate-700 hover:bg-slate-100'}`

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:fixed md:inset-y-0 md:w-56 md:border-b-0 md:border-r">
        <div className="px-4 py-4 text-base font-bold tracking-tight">BAITCAMP</div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5 md:overflow-visible">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={link}>{n.label}</NavLink>)}
          {isAdmin && <div className="hidden px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 md:block">Admin</div>}
          {isAdmin && ADMIN_NAV.map((n) => <NavLink key={n.to} to={n.to} className={link}>{n.label}</NavLink>)}
        </nav>
        <div className="hidden border-t border-slate-200 p-3 text-xs text-slate-500 md:absolute md:inset-x-0 md:bottom-0 md:block">
          <div className="truncate font-medium text-slate-700">{profile?.full_name}</div>
          <div className="truncate">{profile?.email}</div>
          <button className="mt-2 text-blue-600 hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:ml-56 md:p-6">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
        <button className="mt-8 text-xs text-blue-600 hover:underline md:hidden" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    </div>
  )
}
