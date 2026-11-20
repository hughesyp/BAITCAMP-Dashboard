import { useState, type FormEvent } from 'react'
import { ErrorNote } from '../components/ui'
import { useAuth } from '../lib/auth'
import logo from '../assets/logo.png'
import { supabase } from '../lib/supabase'

/** Shown after following an invite or password-reset email link. */
export default function SetPassword() {
  const { refreshProfile } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setBusy(false); return }
    window.history.replaceState(null, '', '/')
    await refreshProfile()
    window.location.assign('/')
  }

  return (
    <div className="mx-auto mt-20 max-w-sm px-4">
      <div className="mb-6 flex flex-col items-center gap-3">
        <img src={logo} alt="" width={32} height={32} className="h-12 w-12 rounded-xl" />
        <div className="text-2xl font-extrabold tracking-tight text-ink">BAITCAMP</div>
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <h1 className="text-base font-semibold">Choose your password</h1>
        <div>
          <label className="label" htmlFor="pw">New password (8+ characters)</label>
          <input id="pw" type="password" autoComplete="new-password" minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
      </form>
    </div>
  )
}
