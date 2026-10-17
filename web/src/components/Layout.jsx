import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { ShieldIcon } from './marks'
import { useAuth } from '../lib/auth.jsx'

const NAV = [
  { to: '/', label: 'Marketplace', end: true },
  { to: '/pricing', label: 'Pricing' },
  { to: '/studio', label: 'Build an agent' },
  { to: '/app', label: 'My account' },
  { to: '/loop', label: 'How it works' },
]

export default function Layout({ children }) {
  const loc = useLocation()
  const nav = useNavigate()
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-ink-950 shadow-glow ring-1 ring-brand/40 transition group-hover:brightness-110" style={{ background: 'linear-gradient(135deg,#f8d98a,#f2c14e 55%,#d7a63a)' }}>
              <ShieldIcon className="h-5 w-5" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-lg font-semibold tracking-tightish text-white">Backstop</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Insurance for AI agents</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-2 text-sm font-medium transition ${isActive ? 'bg-brand/10 text-brand-soft ring-1 ring-brand/20' : 'text-slate-400 hover:text-white'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-slate-400 sm:inline">{user.email}</span>
              <button
                onClick={() => {
                  logout()
                  nav('/')
                }}
                className="btn-ghost !px-3 !py-1.5 text-xs"
              >
                Log out
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn-primary hidden sm:inline-flex">
              Log in / Sign up
            </Link>
          )}
        </div>
      </header>

      <main key={loc.pathname} className="mx-auto max-w-7xl animate-fade-up px-5 py-8 md:py-10">{children}</main>

      <footer className="border-t border-line/70 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 text-xs text-slate-500 sm:flex-row">
          <span>Backstop — verified, crash-tested & insured AI agents. Live LLMs · Firebase auth + storage.</span>
          <span className="font-mono">MGA model · mocked money · HackATL</span>
        </div>
      </footer>
    </div>
  )
}
