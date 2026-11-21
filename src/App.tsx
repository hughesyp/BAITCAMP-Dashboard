import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useAuth } from './lib/auth'
import { authLinkType, configured } from './lib/supabase'
import Brand from './pages/Brand'
import Calendar from './pages/Calendar'
import Compose from './pages/Compose'
import Earnings from './pages/Earnings'
import Email from './pages/Email'
import EmailDrafts from './pages/EmailDrafts'
import EmailEditor from './pages/EmailEditor'
import Ideas from './pages/Ideas'
import Login from './pages/Login'
import Media from './pages/Media'
import Overview from './pages/Overview'
import Posts from './pages/Posts'
import Revenue from './pages/Revenue'
import SetPassword from './pages/SetPassword'
import Settings, { ThreadsCallback, TikTokCallback } from './pages/Settings'
import Social from './pages/Social'
import Targets from './pages/Targets'
import Team from './pages/Team'

const needsPassword = authLinkType === 'invite' || authLinkType === 'recovery'

export default function App() {
  const { session, profile, loading, isAdmin } = useAuth()

  if (!configured) {
    return (
      <div className="mx-auto mt-24 max-w-md card">
        <h1 className="text-lg font-semibold">Almost there</h1>
        <p className="mt-2 text-sm text-slate-600">
          Supabase isn't connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then restart the app. See <code>SETUP.md</code>.
        </p>
      </div>
    )
  }
  if (loading) return <div className="p-10 text-sm text-slate-500">Loading…</div>
  if (!session) return <Login />
  if (needsPassword) return <SetPassword />
  if (!profile) return <div className="p-10 text-sm text-slate-500">Loading your account…</div>
  if (!profile.active) {
    return (
      <div className="mx-auto mt-24 max-w-md card text-sm text-slate-600">
        This account isn't active. Ask the BAITCAMP admin to invite or re-activate you.
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="posts" element={<Posts />} />
        <Route path="social" element={<Social />} />
        <Route path="compose" element={<Compose />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="media" element={<Media />} />
        <Route path="targets" element={<Targets />} />
        <Route path="ideas" element={<Ideas />} />
        <Route path="brand" element={<Brand />} />
        <Route path="email" element={<Email />} />
        <Route path="email/drafts" element={<EmailDrafts />} />
        <Route path="email/drafts/:id" element={<EmailEditor />} />
        <Route path="earnings" element={<Earnings />} />
        {isAdmin && <Route path="admin/targets" element={<Targets manage />} />}
        {isAdmin && <Route path="team" element={<Team />} />}
        {isAdmin && <Route path="settings" element={<Settings />} />}
        {isAdmin && <Route path="settings/tiktok" element={<TikTokCallback />} />}
        {isAdmin && <Route path="settings/threads" element={<ThreadsCallback />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
