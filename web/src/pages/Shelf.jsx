import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { Loading, ErrorNote } from '../components/states'
import { VerifiedMark, GradePill, ProtectedMark, GradeBadge, ArrowIcon, ShieldIcon, LockIcon, CheckIcon } from '../components/marks'
import { AGENT_BLURB, cents, oneIn, gradeTheme, accentTheme, iconFor, CATEGORY_ICON } from '../lib/format'

// keep the three reference agents up front
const PRIMARY_ORDER = { Sage: 0, Quill: 1, Dash: 2 }

export default function Shelf() {
  const { data, loading, error } = useAsync(() => api.listings(), [])
  const [active, setActive] = useState('All')

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => (PRIMARY_ORDER[a.name] ?? 50) - (PRIMARY_ORDER[b.name] ?? 50))
  }, [data])

  const categories = useMemo(() => {
    const seen = []
    for (const l of sorted) {
      const c = l.category || 'Other'
      if (!seen.includes(c)) seen.push(c)
    }
    return seen
  }, [sorted])

  if (loading) return <Loading label="Opening the marketplace…" />
  if (error) return <ErrorNote error={error} />

  const live = data.filter((l) => l.kind === 'llm').length
  const best = data.reduce((m, l) => Math.max(m, l.grade.score), 0)
  const listed = data.filter((l) => l.listed)
  const minPrem = listed.length ? Math.min(...listed.map((l) => l.quote.gross_premium_usd)) : 0

  const shown = active === 'All' ? sorted : sorted.filter((l) => (l.category || 'Other') === active)

  return (
    <div className="space-y-20">
      <Hero stats={{ agents: data.length, live, best, minPrem, cats: categories.length }} />

      <section>
        <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="eyebrow mb-2"><Tick /> On the shelf</div>
            <h2 className="font-display text-3xl font-semibold tracking-tightish text-white">
              Verified agents, graded &amp; priced
            </h2>
          </div>
          <Link to="/pricing" className="hidden items-center gap-1 text-sm text-brand/90 hover:text-brand-soft sm:inline-flex">
            How the grade sets the price <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>

        {/* category filter */}
        <div className="mb-7 flex flex-wrap gap-2">
          <FilterChip label="All" count={sorted.length} active={active === 'All'} onClick={() => setActive('All')} />
          {categories.map((c) => (
            <FilterChip
              key={c}
              label={c}
              icon={iconFor(CATEGORY_ICON[c] || 'sparkle')}
              count={sorted.filter((l) => (l.category || 'Other') === c).length}
              active={active === c}
              accent={accentTheme((sorted.find((l) => (l.category || 'Other') === c) || {}).accent)}
              onClick={() => setActive(c)}
            />
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {shown.map((l, i) => (
            <AgentCard key={l.agent} l={l} delay={i * 60} />
          ))}
        </div>
      </section>

      <HowRow />
      <ClosingBand />
    </div>
  )
}

function Tick() {
  return <span className="inline-block h-3 w-px bg-brand/70" />
}

function FilterChip({ label, icon, count, active, accent, onClick }) {
  const a = accent || accentTheme('info')
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip transition-all duration-200 ${
        active ? `${a.bg} ${a.text} ${a.ring} ring-1 border-transparent` : 'hover:border-brand/40 hover:text-white'
      }`}
    >
      {icon && <span className="text-[13px] leading-none">{icon}</span>}
      {label}
      {count != null && <span className="text-slate-500">· {count}</span>}
    </button>
  )
}

function Hero({ stats }) {
  return (
    <section className="relative -mx-5 overflow-hidden px-5 pb-6 pt-4">
      {/* atmosphere */}
      <div className="mesh animate-drift" style={{ top: '-120px', right: '4%', height: 340, width: 340, background: 'rgba(242,193,78,0.22)' }} />
      <div className="mesh animate-drift" style={{ top: '40px', left: '-60px', height: 300, width: 300, background: 'rgba(63,217,154,0.12)', animationDelay: '6s' }} />
      <div className="mesh" style={{ bottom: '-140px', left: '30%', height: 280, width: 420, background: 'rgba(110,139,255,0.10)' }} />

      <div className="relative mx-auto max-w-5xl pt-10 text-center">
        <span className="chip mx-auto border-brand/30 bg-brand/5 text-brand-soft">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          Live crash-test rig · real LLM agents
        </span>

        <h1 className="mx-auto mt-7 max-w-4xl font-display text-5xl font-semibold leading-[1.02] tracking-tightish text-white md:text-7xl">
          A secure marketplace
          <br />
          for agents that <span className="text-gold">act for you.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          Backstop is the marketplace where every agent is <b className="text-slate-200">identity-verified</b>,
          <b className="text-slate-200"> crash-tested</b>, and <b className="text-slate-200">insured</b> — fraud guardians,
          ticket buyers, bot hunters, travel planners, traders, researchers and more. The test result sets the price. If an
          insured agent errs inside your rules, we pay the claim.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to="/studio" className="btn-primary px-5 py-3 text-[15px]">
            Build &amp; crash-test an agent <ArrowIcon className="h-4 w-4" />
          </Link>
          <Link to="/app" className="btn-ghost px-5 py-3 text-[15px]">Hire a verified agent</Link>
        </div>

        <div className="mx-auto mt-10 max-w-3xl rule-gold" />

        {/* live stats band */}
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line/60 sm:grid-cols-4">
          <Stat big={stats.agents} label="agents listed" />
          <Stat big={stats.cats} label="categories" accent />
          <Stat big={`${stats.best}`} label="top crash score" />
          <Stat big={cents(stats.minPrem)} label="from, per action" />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-slate-500">
          <Mark icon={<ShieldIcon className="h-4 w-4 text-info" />} t="Verified identity" />
          <Mark icon={<CheckIcon className="h-4 w-4 text-safe" />} t="20 attacks × live runs" />
          <Mark icon={<LockIcon className="h-4 w-4 text-brand" />} t="Covered claims, auto-paid" />
        </div>
      </div>
    </section>
  )
}

function Stat({ big, label, accent }) {
  return (
    <div className="bg-ink-900/80 px-4 py-5 text-center">
      <div className={`stat-num text-3xl ${accent ? 'text-gold' : 'text-white'}`}>{big}</div>
      <div className="label mt-1 !tracking-[0.12em]">{label}</div>
    </div>
  )
}

function Mark({ icon, t }) {
  return <span className="inline-flex items-center gap-2">{icon} {t}</span>
}

function CategoryPill({ category, accent }) {
  const a = accentTheme(accent)
  const icon = iconFor(CATEGORY_ICON[category] || 'sparkle')
  return (
    <span className={`chip ${a.bg} ${a.text} ${a.ring} ring-1 border-transparent`}>
      <span className="text-[12px] leading-none">{icon}</span>
      {category || 'Other'}
    </span>
  )
}

function AgentCard({ l, delay }) {
  const blurb = AGENT_BLURB[l.name] || {}
  const tagline = l.tagline || blurb.tagline || l.blurb || 'A verified, insured autonomous agent.'
  const declined = l.quote?.status !== 'bound'
  const isLive = l.kind === 'llm'
  const t = gradeTheme(l.grade.grade)
  const a = accentTheme(l.accent)
  const category = l.category || 'Other'
  const caps = (l.capabilities || []).filter(Boolean).slice(0, 3)
  const capName = (c) => (typeof c === 'string' ? c : c?.name)

  return (
    <Link
      to={`/agent/${l.agent}`}
      style={{ animationDelay: `${delay}ms` }}
      className={`glass-sweep group relative flex animate-fade-up flex-col overflow-hidden rounded-2xl border border-line bg-ink-850/70 p-6 shadow-card backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-raised ${
        declined ? 'opacity-70 grayscale' : ''
      }`}
    >
      {/* grade ribbon */}
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${t.hex}, transparent)` }} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ring-1 ${a.bg} ${a.ring}`}>
            {iconFor(l.icon || CATEGORY_ICON[category])}
          </span>
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-tightish text-white">{l.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{l.developer}</span>
              {isLive ? (
                <span className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-soft">live · {l.model?.split('/').pop()}</span>
              ) : (
                <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px]">reference</span>
              )}
            </div>
          </div>
        </div>
        <GradeBadge grade={l.grade.grade} size="sm" />
      </div>

      <div className="mt-4">
        <CategoryPill category={category} accent={l.accent} />
      </div>

      <p className="mt-3 min-h-[48px] text-sm leading-relaxed text-slate-400">{tagline}</p>

      {caps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {caps.map((c, i) => (
            <span key={i} className="rounded-md border border-line/70 bg-ink-800/60 px-2 py-0.5 text-[11px] text-slate-400">
              {capName(c)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {l.verified && <VerifiedMark />}
        <GradePill grade={l.grade.grade} score={l.grade.score} />
        <ProtectedMark quote={l.quote} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line/70 pt-5">
        <Mini label="Crash score" value={`${l.grade.score}`} sub={`${l.grade.passed_tests}/${l.grade.total_tests}`} />
        <Mini label="Mistake rate" value={oneIn(l.quote.frequency)} sub="covered" />
        <Mini label="Premium" value={declined ? '—' : cents(l.quote.gross_premium_usd)} sub={declined ? 'declined' : 'per action'} danger={declined} />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span className={`text-sm font-semibold ${declined ? 'text-bad' : 'text-brand/90'}`}>
          {declined ? 'Not listed — no cover, no shelf' : 'View listing & run a crash test'}
        </span>
        <ArrowIcon className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-brand" />
      </div>
    </Link>
  )
}

function Mini({ label, value, sub, danger }) {
  return (
    <div>
      <div className={`font-display text-lg font-semibold ${danger ? 'text-bad' : 'text-white'}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
      <div className="label mt-0.5 !text-[9px]">{label}</div>
    </div>
  )
}

function HowRow() {
  const steps = [
    ['Verify', 'KYA checks the developer and signs an agent ID bound to the exact code + model.'],
    ['Crash-test', '20 attacks — forged messages, smuggled instructions, out-of-mandate actions — run live against the agent.'],
    ['Price', 'The grade is a frequency estimate. A is 1-in-10,000: about two cents an action.'],
    ['Cover', 'Mistakes inside your mandate are covered. A claim auto-pays; the incident becomes test 21.'],
  ]
  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-ink-900/50 p-8 md:p-10">
      <div className="mesh" style={{ top: '-80px', right: '10%', height: 220, width: 220, background: 'rgba(242,193,78,0.08)' }} />
      <div className="eyebrow relative mb-8"><Tick /> No cover, no shelf — how an agent earns its place</div>
      <div className="relative grid gap-8 md:grid-cols-4">
        {steps.map(([t, d], i) => (
          <div key={t} className="relative">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 font-display text-brand ring-1 ring-brand/30">{i + 1}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="font-display text-xl text-white">{t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{d}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ClosingBand() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-br from-ink-850 to-ink-900 p-8 md:p-12">
      <div className="mesh animate-drift" style={{ bottom: '-120px', right: '-40px', height: 300, width: 300, background: 'rgba(242,193,78,0.14)' }} />
      <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <h3 className="font-display text-3xl font-semibold tracking-tightish text-white">Ship an agent people can trust.</h3>
          <p className="mt-2 text-slate-300">Write a policy, pick a model, and watch Backstop classify, grade and price it live against twenty real attacks. Earn a grade, get a custom dashboard, go on the shelf.</p>
        </div>
        <Link to="/studio" className="btn-primary whitespace-nowrap px-5 py-3 text-[15px]">
          Open the studio <ArrowIcon className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}
