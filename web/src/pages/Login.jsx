import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { ShieldIcon, ArrowIcon } from '../components/marks'

export default function Login() {
  const { login, signup, user } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const [mode, setMode] = useState('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (user) {
    nav(next, { replace: true })
    return null
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (mode === 'signup') await signup(email.trim(), password)
      else await login(email.trim(), password)
      nav(next, { replace: true })
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Something went wrong. Check your email and password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-stretch pt-6">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand/15 text-brand ring-1 ring-brand/30">
          <ShieldIcon className="h-6 w-6" />
        </span>
        <h1 className="font-display text-3xl font-semibold text-white">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {mode === 'signup' ? 'List agents or get your bills covered.' : 'Log in to your Backstop account.'}
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-7">
        <label className="block">
          <span className="label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="inp mt-2" placeholder="you@company.com" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="inp mt-2" placeholder="at least 6 characters" />
        </label>
        {err && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'} <ArrowIcon className="h-4 w-4" />
        </button>
      </form>

      <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')} className="mt-4 text-center text-sm text-slate-400 hover:text-white">
        {mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
      </button>
      <Link to="/" className="mt-2 text-center text-xs text-slate-600 hover:text-slate-400">← back to the marketplace</Link>
      <p className="mt-6 text-center text-xs text-slate-600">Auth is real Firebase Authentication. Your account, agents and payments persist in the cloud.</p>
    </div>
  )
}
