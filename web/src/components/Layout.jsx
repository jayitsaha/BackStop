import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BackstopMark, ArrowIcon } from './marks'
import { GoldRule } from './ui/Backdrop.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useWallet } from '../lib/wallet.jsx'

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

function WalletButton() {
  const { account, connect, connecting, onTargetChain, available } = useWallet()
  if (account) {
    return (
      <span
        className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line bg-ink-900/60 px-2.5 py-1.5 font-mono text-xs text-slate-300 sm:inline-flex"
        title={onTargetChain ? `${account} · on testnet` : `${account} · wrong network — switch to Sepolia`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${onTargetChain ? 'bg-safe' : 'bg-warn'}`} />
        {shortAddr(account)}
      </span>
    )
  }
  return (
    <button
      onClick={connect}
      className="btn-ghost hidden shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs sm:inline-flex"
      title={available ? 'Connect MetaMask' : 'Install MetaMask'}
    >
      {connecting ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}

const NAV = [
  { to: '/', label: 'Marketplace', end: true },
  { to: '/pricing', label: 'Pricing' },
  { to: '/studio', label: 'Build' },
  { to: '/app', label: 'My account' },
  { to: '/claims', label: 'Claims' },
  { to: '/chain', label: 'On-chain' },
  { to: '/loop', label: 'How it works' },
]

// grouped links for the editorial footer (all point to existing routes)
const FOOT = {
  Marketplace: [
    { to: '/', label: 'Browse agents' },
    { to: '/pricing', label: 'Pricing model' },
    { to: '/app', label: 'My account' },
  ],
  Build: [
    { to: '/studio', label: 'Agent studio' },
    { to: '/loop', label: 'How it works' },
    { to: '/calls', label: 'Live calls' },
  ],
  Trust: [
    { to: '/claims', label: 'Claims ledger' },
    { to: '/chain', label: 'On-chain proof' },
    { to: '/login', label: 'Log in / Sign up' },
  ],
}

function Wordmark({ small = false, tagClass = '' }) {
  return (
    <span className="group flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-xl text-white shadow-glow ring-1 ring-brand/40 transition group-hover:brightness-110"
        style={{
          height: small ? 32 : 38,
          width: small ? 32 : 38,
          background: 'linear-gradient(135deg, #e8865f 0%, #c4552d 52%, #8a3d20 100%)',
        }}
      >
        <BackstopMark className={small ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-semibold tracking-tighter2 text-white">Backstop</span>
        <span className={`text-[10px] uppercase tracking-[0.2em] text-slate-500 ${tagClass}`}>A secure agentic marketplace</span>
      </span>
    </span>
  )
}

export default function Layout({ children }) {
  const loc = useLocation()
  const nav = useNavigate()
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-ink-950/75 backdrop-blur-xl">
        {/* hairline mocha glow riding the header edge */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-paper/10 to-transparent" />
        <div className="relative mx-auto grid h-[68px] max-w-7xl grid-cols-[1fr_auto] items-center px-5 lg:grid-cols-[1fr_auto_1fr]">
          <Link to="/" aria-label="Backstop home" className="justify-self-start">
            <Wordmark tagClass="hidden xl:block" />
          </Link>

          {/* centered nav group — hairline pill, sliding mocha underline on the active link */}
          <nav className="hidden items-center gap-0.5 rounded-full border border-line/70 bg-ink-900/60 p-1 shadow-card lg:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="group/nav relative">
                {({ isActive }) => (
                  <span
                    className={`relative block whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium tracking-tightish transition-colors duration-200 xl:px-3.5 ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover/nav:text-slate-200'
                    }`}
                  >
                    {n.label}
                    {isActive && (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute inset-x-2.5 bottom-[3px] h-[2px] rounded-full bg-brand xl:inset-x-3.5"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex min-w-0 items-center gap-2.5 justify-self-end">
            <WalletButton />
            {user ? (
              <>
                <span className="hidden max-w-[150px] truncate text-xs text-slate-400 xl:inline">{user.email}</span>
                <button
                  onClick={() => {
                    logout()
                    nav('/')
                  }}
                  className="btn-ghost shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs"
                >
                  Log out
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary shrink-0 whitespace-nowrap hidden sm:inline-flex">
                Log in / Sign up
              </Link>
            )}
          </div>
        </div>
      </header>

      <main key={loc.pathname} className="mx-auto max-w-7xl animate-fade-up px-5 py-8 md:py-10">{children}</main>

      {/* editorial footer */}
      <footer className="relative mt-10 overflow-hidden border-t border-line/60">
        <div className="pointer-events-none absolute -top-24 right-[8%] h-64 w-64 rounded-full opacity-60" style={{ background: 'rgba(196,85,45,0.14)', filter: 'blur(80px)' }} aria-hidden />
        <div className="mx-auto max-w-7xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="max-w-xs">
              <Wordmark small />
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                A marketplace where every AI agent is identity-verified, crash-tested twenty ways, and insured. If an
                insured agent errs inside your rules, we pay the claim.
              </p>
              <Link to="/" className="mt-5 inline-flex items-center gap-1.5 text-sm text-brand-soft hover:text-white">
                Browse the shelf <ArrowIcon className="h-4 w-4" />
              </Link>
            </div>
            {Object.entries(FOOT).map(([group, links]) => (
              <div key={group}>
                <div className="label mb-4">{group}</div>
                <ul className="space-y-2.5">
                  {links.map((l) => (
                    <li key={l.to + l.label}>
                      <Link to={l.to} className="text-sm text-slate-400 transition hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <GoldRule className="my-10" />

          <div className="flex flex-col items-start justify-between gap-3 text-xs text-slate-500 sm:flex-row sm:items-center">
            <span>
              Backstop — verified, crash-tested &amp; insured AI agents. Live LLMs · Firebase auth + storage.
            </span>
            <span className="font-mono text-slate-600">Verified · Crash-tested · Insured · On-chain · HackATL</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
