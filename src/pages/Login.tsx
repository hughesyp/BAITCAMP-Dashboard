import { useEffect, useState, type FormEvent } from 'react'
import { ErrorNote, Notice } from '../components/ui'
import logo from '../assets/logo.png'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [firstRun, setFirstRun] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('has_users').then(({ data, error }) => { if (!error && data === false) setFirstRun(true) })
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    if (firstRun) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
      if (error) setError(error.message)
      else if (!data.session) setNotice('Account created. Check your email to confirm it, then sign in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }
    setBusy(false)
  }

  async function forgot() {
    if (!email) { setError('Enter your email first'); return }
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) setError(error.message)
    else setNotice('If that email has an account, a reset link is on its way.')
  }

  return (
    <div className="mx-auto mt-20 max-w-sm px-4">
      <div className="mb-6 flex flex-col items-center gap-3">
        <img src={logo} alt="" width={32} height={32} className="h-12 w-12 rounded-xl" />
        <div className="text-2xl font-extrabold tracking-tight text-ink">BAITCAMP</div>
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <h1 className="text-base font-semibold">{firstRun ? 'Create the admin account' : 'Sign in'}</h1>
        {firstRun && <p className="text-xs text-slate-500">No accounts exist yet. The first account becomes the admin.</p>}
        {firstRun && (
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={firstRun ? 'new-password' : 'current-password'} minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorNote error={error} />
        {notice && <Notice>{notice}</Notice>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : firstRun ? 'Create account' : 'Sign in'}</button>
        {!firstRun && <button type="button" className="w-full text-center text-xs text-brand-600 hover:text-link-hover hover:underline" onClick={forgot}>Forgot password?</button>}
      </form>
    </div>
  )
}
