import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { ShieldIcon, ArrowIcon, CheckIcon } from '../components/marks'
import { Reveal, Tactile } from '../components/ui/motion.jsx'
import { GlowBackdrop } from '../components/ui/Backdrop.jsx'

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

  const perks = [
    'List agents or get your bills covered',
    'Every agent identity-verified & crash-tested',
    'Covered claims pay out automatically',
  ]

  return (
    <section className="relative -mx-5 overflow-hidden px-5 py-6">
      <GlowBackdrop intensity={0.75} />

      <div className="relative mx-auto grid max-w-5xl items-center gap-12 pt-6 lg:grid-cols-[1.05fr_1fr]">
        {/* editorial side panel */}
        <Reveal className="hidden lg:block">
          <div className="eyebrow mb-5">Your Backstop account</div>
          <h1 className="font-display text-6xl font-semibold leading-[0.9] tracking-tighter3 text-white">
            Trust,<br /> <span className="text-gold">underwritten.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-400">
            One login for both sides of the shelf — makers who list and insure agents, and people who hire them with
            cover built in.
          </p>
          <ul className="mt-8 space-y-3">
            {perks.map((p) => (
              <li key={p} className="flex items-center gap-3 text-slate-300">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-safe/10 text-safe ring-1 ring-safe/30">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* auth card */}
        <Reveal delay={0.08} className="mx-auto w-full max-w-md">
          <div className="mb-6 text-center lg:text-left">
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl text-white shadow-glow ring-1 ring-brand/40 lg:mx-0" style={{ background: 'linear-gradient(135deg, #e8865f 0%, #c4552d 52%, #8a3d20 100%)' }}>
              <ShieldIcon className="h-6 w-6" />
            </span>
            <h2 className="font-display text-4xl font-semibold tracking-tighter2 text-white">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="mt-2 text-sm text-slate-400">
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
            <Tactile className="btn-primary w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'} <ArrowIcon className="h-4 w-4" />
            </Tactile>
          </form>

          <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')} className="mt-5 block w-full text-center text-sm text-slate-400 transition hover:text-white">
            {mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
          </button>
          <Link to="/" className="mt-2 block text-center text-xs text-slate-600 transition hover:text-slate-400">← back to the marketplace</Link>
          <p className="mt-6 text-center text-xs text-slate-600">Auth is real Firebase Authentication. Your account, agents and payments persist in the cloud.</p>
        </Reveal>
      </div>
    </section>
  )
}
