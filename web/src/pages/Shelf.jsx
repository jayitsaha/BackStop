import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { Loading, ErrorNote } from '../components/states'
import { VerifiedMark, GradePill, ProtectedMark, ArrowIcon, ShieldIcon, LockIcon, CheckIcon } from '../components/marks'
import { AGENT_BLURB, cents, oneIn, gradeTheme, accentTheme, CATEGORY_ICON } from '../lib/format'
import { accent as accentOf, iconFor as iconSvg } from '../components/widgets/shared.jsx'
import { rankAgents, reasonText } from '../lib/agentSearch'
import { Reveal, Stagger, stagItem, Tactile, EASE } from '../components/ui/motion.jsx'
import DotField from '../components/ui/DotField.jsx'
import AgentGlobe from '../components/ui/AgentGlobe.jsx'
import { GlowBackdrop, GoldRule } from '../components/ui/Backdrop.jsx'

// keep the three reference agents up front
const PRIMARY_ORDER = { Sage: 0, Quill: 1, Dash: 2 }

/* ---------------------------------------------------------- cover palettes */
// Derive an 8-step DotField palette from an agent accent hex: espresso-dark lows
// rising through the accent into a warm cream highlight. Original Backstop art.
const hexRgb = (hex) => {
  const h = (hex || '#c4552d').replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgbHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
const INK = [13, 10, 9]
const CREAM = [255, 233, 219]
const PALETTE_CACHE = {}
function coverPalette(hex) {
  if (PALETTE_CACHE[hex]) return PALETTE_CACHE[hex]
  const c = hexRgb(hex)
  const pal = [
    rgbHex(mixRgb(INK, c, 0.05)),
    rgbHex(mixRgb(INK, c, 0.14)),
    rgbHex(mixRgb(INK, c, 0.27)),
    rgbHex(mixRgb(INK, c, 0.44)),
    rgbHex(mixRgb(INK, c, 0.64)),
    rgbHex(mixRgb(INK, c, 0.88)),
    rgbHex(mixRgb(c, CREAM, 0.38)),
    rgbHex(mixRgb(c, CREAM, 0.74)),
  ]
  PALETTE_CACHE[hex] = pal
  return pal
}

export default function Shelf() {
  const { data, loading, error } = useAsync(() => api.listings(), [])
  const [active, setActive] = useState('All')
  const [q, setQ] = useState('')

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

  const query = q.trim()
  const searching = query.length > 0
  // instant, intent-aware ranking — recomputed only when the query or shelf changes
  const ranked = useMemo(() => (searching ? rankAgents(sorted, query) : null), [searching, query, sorted])

  if (loading) return <Loading label="Opening the marketplace…" />
  if (error) return <ErrorNote error={error} />

  const live = data.filter((l) => l.kind === 'llm').length
  const best = data.reduce((m, l) => Math.max(m, l.grade.score), 0)
  const listed = data.filter((l) => l.listed)
  const minPrem = listed.length ? Math.min(...listed.map((l) => l.quote.gross_premium_usd)) : 0

  const shown = active === 'All' ? sorted : sorted.filter((l) => (l.category || 'Other') === active)

  return (
    <div className="space-y-24">
      <Hero
        stats={{ agents: data.length, live, best, minPrem, cats: categories.length }}
        q={q}
        setQ={setQ}
        listings={sorted}
        resultCount={ranked?.length ?? 0}
      />

      {searching ? (
        <SearchResults query={query} ranked={ranked} onClear={() => setQ('')} />
      ) : (
        <>
          <FeaturedCarousel listings={sorted} />

          <TrustMarquee categories={categories} />

          <section>
            <Reveal className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="eyebrow mb-3"><Tick /> On the shelf</div>
                <h2 className="font-display text-4xl font-semibold tracking-tighter2 text-white md:text-5xl">
                  Verified agents,<br className="hidden sm:block" /> graded &amp; priced.
                </h2>
              </div>
              <Link to="/pricing" className="hidden items-center gap-1.5 text-sm text-brand-soft hover:text-white sm:inline-flex">
                How the grade sets the price <ArrowIcon className="h-4 w-4" />
              </Link>
            </Reveal>

            {/* category filter */}
            <Reveal delay={0.08} className="mb-8 flex flex-wrap gap-2">
              <FilterChip label="All" count={sorted.length} active={active === 'All'} onClick={() => setActive('All')} />
              {categories.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  icon={iconSvg(CATEGORY_ICON[c] || 'sparkle', 'h-3.5 w-3.5')}
                  count={sorted.filter((l) => (l.category || 'Other') === c).length}
                  active={active === c}
                  accent={accentTheme((sorted.find((l) => (l.category || 'Other') === c) || {}).accent)}
                  onClick={() => setActive(c)}
                />
              ))}
            </Reveal>

            <Stagger key={active} className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" gap={0.07}>
              {shown.map((l, i) => (
                <motion.div key={l.agent} variants={stagItem}>
                  <CoverCard l={l} index={i} />
                </motion.div>
              ))}
            </Stagger>
          </section>
        </>
      )}

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
    <Tactile
      type="button"
      onClick={onClick}
      className={`chip transition-all duration-200 ${
        active ? `${a.bg} ${a.text} ${a.ring} ring-1 border-transparent` : 'hover:border-brand/40 hover:text-white'
      }`}
    >
      {icon && <span className="text-[13px] leading-none">{icon}</span>}
      {label}
      {count != null && <span className="text-slate-500">· {count}</span>}
    </Tactile>
  )
}

/* ------------------------------------------------------------------- hero */
function Hero({ stats, q, setQ, listings, resultCount }) {
  return (
    <section className="relative -mx-5 overflow-hidden px-5 pb-10 pt-6 md:pb-16">
      {/* warm ambient backdrop: dots + mocha glow + vignette */}
      <GlowBackdrop />

      {/* the agent-network globe breathing behind the headline */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[620px] w-full max-w-4xl opacity-[0.38]"
        style={{
          maskImage: 'radial-gradient(58% 52% at 50% 42%, #000 0%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(58% 52% at 50% 42%, #000 0%, transparent 78%)',
        }}
        aria-hidden
      >
        <AgentGlobe className="h-full w-full" />
      </div>

      <div className="relative mx-auto max-w-5xl pt-10 text-center">
        <Reveal as="div" y={10}>
          <span className="chip mx-auto border-brand/30 bg-brand/5 text-brand-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            Live crash-test rig · real LLM agents
          </span>
        </Reveal>

        <Reveal as="h1" delay={0.06} y={22} className="mx-auto mt-8 max-w-4xl font-display text-6xl font-semibold leading-[0.92] tracking-tighter3 text-white md:text-8xl">
          A secure marketplace
          <br />
          for AI agents that <span className="text-gold">act for you.</span>
        </Reveal>

        <Reveal as="p" delay={0.14} className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-slate-400">
          Every agent on Backstop is <b className="text-slate-200">identity-verified</b>,{' '}
          <b className="text-slate-200">crash-tested</b>, and <b className="text-slate-200">insured</b> — fraud
          guardians, ticket buyers, bot hunters, travel planners, traders, researchers and more. The test result sets
          the price. If an insured agent errs inside your rules, we pay the claim.
        </Reveal>

        {/* ===== AI search — the primary way to find an agent ===== */}
        <Reveal delay={0.2} className="mx-auto mt-10 max-w-2xl">
          <MarketSearch q={q} setQ={setQ} listings={listings} resultCount={resultCount} />
        </Reveal>

        <Reveal delay={0.26} className="mt-4 flex items-center justify-center gap-4 text-sm text-slate-500">
          <Link to="/studio" className="inline-flex items-center gap-1.5 text-brand-soft transition hover:text-white">
            or build &amp; crash-test your own <ArrowIcon className="h-3.5 w-3.5" />
          </Link>
        </Reveal>

        <span className="handwriting mt-5 block text-base text-brand-soft/80">no cover, no shelf.</span>

        <Reveal delay={0.26} className="mx-auto mt-9 max-w-3xl">
          <GoldRule />
        </Reveal>

        {/* live stats band */}
        <Stagger className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line/60 sm:grid-cols-4" gap={0.08}>
          <Stat big={stats.agents} label="agents listed" />
          <Stat big={stats.cats} label="categories" accent />
          <Stat big={`${stats.best}`} label="top crash score" />
          <Stat big={cents(stats.minPrem)} label="from, per action" />
        </Stagger>

        <Reveal delay={0.1} className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-slate-500">
          <Mark icon={<ShieldIcon className="h-4 w-4 text-info" />} t="Verified identity" />
          <Mark icon={<CheckIcon className="h-4 w-4 text-safe" />} t="20 attacks × live runs" />
          <Mark icon={<LockIcon className="h-4 w-4 text-brand" />} t="Covered claims, auto-paid" />
        </Reveal>
      </div>
    </section>
  )
}

function Stat({ big, label, accent }) {
  return (
    <motion.div variants={stagItem} className="bg-ink-900/80 px-4 py-6 text-center">
      <div className={`stat-num text-3xl md:text-4xl ${accent ? 'text-gold' : 'text-white'}`}>{big}</div>
      <div className="label mt-1 !tracking-[0.12em]">{label}</div>
    </motion.div>
  )
}

function Mark({ icon, t }) {
  return <span className="inline-flex items-center gap-2">{icon} {t}</span>
}

/* ===================================================== AI marketplace search */
function SearchGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.4-3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
function SparkGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M12 3l1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9L12 3z" fill="currentColor" />
      <path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9L19 15z" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

// example prompts that cycle through the placeholder — teaching users it's semantic
const EXAMPLE_QUERIES = [
  'protect me from refund scams',
  'book a cheap flight somewhere warm',
  'rebalance my portfolio within risk limits',
  'stop bots scraping my site',
  'buy concert tickets without getting scammed',
  'cite real sources for my research',
]
// one-tap intents → seed the query
const INTENTS = [
  { label: 'Stop fraud', q: 'stop payment fraud and scams' },
  { label: 'Fight bots', q: 'block bots and scrapers' },
  { label: 'Book travel', q: 'book a safe trip within budget' },
  { label: 'Trade', q: 'rebalance my portfolio' },
  { label: 'Research', q: 'research with cited sources' },
  { label: 'Buy tickets', q: 'buy event tickets safely' },
]

function MarketSearch({ q, setQ, listings, resultCount }) {
  const nav = useNavigate()
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(-1)
  const [ph, setPh] = useState(0)

  const suggestions = useMemo(() => (q.trim() ? rankAgents(listings, q).slice(0, 5) : []), [q, listings])

  // rotate the placeholder while the box is empty & unfocused
  useEffect(() => {
    if (q || focused) return
    const t = setInterval(() => setPh((p) => (p + 1) % EXAMPLE_QUERIES.length), 2800)
    return () => clearInterval(t)
  }, [q, focused])

  // "/" focuses the bar from anywhere (unless already typing somewhere)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // click-outside closes the suggestion panel
  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => { setHi(-1) }, [q])

  const openAgent = (l) => { if (l) nav(`/agent/${l.agent}`) }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)) }
    else if (e.key === 'Enter') {
      if (hi >= 0 && suggestions[hi]) { e.preventDefault(); openAgent(suggestions[hi].l); setFocused(false) }
      else inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      if (q) { setQ('') } else inputRef.current?.blur()
      setFocused(false)
    }
  }

  const showPanel = focused && q.trim().length > 0
  const empty = q.trim().length > 0 && suggestions.length === 0

  return (
    <div ref={boxRef} className="relative">
      {/* the bar */}
      <div
        className={`group relative flex items-center gap-3 rounded-full border bg-ink-900/70 px-4 py-3 text-left backdrop-blur-xl transition-all duration-300 sm:px-5 sm:py-3.5 ${
          focused ? 'border-brand/60 shadow-glow' : 'border-line shadow-panel hover:border-brand/35'
        }`}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-brand-soft ring-1 ring-brand/25">
          <motion.span animate={{ rotate: focused ? [0, 15, -10, 0] : 0, scale: focused ? [1, 1.15, 1] : 1 }} transition={{ duration: 0.6 }}>
            <SparkGlyph className="h-3.5 w-3.5" />
          </motion.span>
          AI
        </span>
        <SearchGlyph className="h-5 w-5 shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={`Describe what you need — ${EXAMPLE_QUERIES[ph]}`}
          aria-label="Search agents by description, name, or utility"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-slate-500"
          autoComplete="off"
          spellCheck="false"
        />
        {q ? (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus() }}
            aria-label="Clear search"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-slate-400 transition hover:border-brand/50 hover:text-white"
          >
            <span className="text-sm leading-none">×</span>
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-line bg-ink-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:block">/</kbd>
        )}
      </div>

      {/* instant suggestion panel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-3xl border border-line bg-ink-850/95 p-2 text-left shadow-float backdrop-blur-xl"
          >
            {empty ? (
              <div className="px-4 py-6 text-center">
                <div className="font-display text-lg text-white">No agent matches “{q.trim()}”.</div>
                <p className="mt-1 text-sm text-slate-500">Try a capability — “stop scams”, “book travel”, “buy tickets”.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-3 pb-2 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  <span>{resultCount} {resultCount === 1 ? 'match' : 'matches'}</span>
                  <span className="hidden sm:inline">↑↓ to move · ⏎ to open</span>
                </div>
                {suggestions.map((r, i) => {
                  const l = r.l
                  const t = gradeTheme(l.grade.grade)
                  const hex = accentOf(l.accent).stroke
                  return (
                    <button
                      key={l.agent}
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={() => { openAgent(l); setFocused(false) }}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${hi === i ? 'bg-brand/12' : 'hover:bg-ink-800/70'}`}
                    >
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-sm font-semibold ring-1 ${t.bg} ${t.text} ${t.ring}`}>
                        {l.grade.grade}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-sans text-[15px] font-semibold text-white">{l.name}<span style={{ color: hex }}>.</span></span>
                          <span className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">{l.category || 'Other'}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-slate-400">{l.tagline || 'A verified, insured agent.'}</span>
                      </span>
                      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-soft/70 sm:block">{reasonText(r.reasons)}</span>
                    </button>
                  )
                })}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* one-tap intents */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {INTENTS.map((it) => (
          <Tactile
            key={it.label}
            type="button"
            onClick={() => { setQ(it.q); inputRef.current?.focus() }}
            className="chip hover:border-brand/40 hover:text-white"
          >
            {it.label}
          </Tactile>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- search results */
function SearchResults({ query, ranked, onClear }) {
  const n = ranked.length
  return (
    <section>
      <Reveal className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow mb-3"><Tick /> AI search · {n} {n === 1 ? 'result' : 'results'}</div>
          <h2 className="font-display text-4xl font-semibold tracking-tighter2 text-white md:text-5xl">
            {n ? <>Agents for <span className="text-gold">“{query}”</span></> : <>Nothing matched <span className="text-gold">“{query}”</span></>}
          </h2>
          {!n && <p className="mt-3 max-w-lg text-slate-400">Describe a capability instead — try “protect me from scams”, “book travel”, or “buy concert tickets”.</p>}
        </div>
        <button type="button" onClick={onClear} className="inline-flex shrink-0 items-center gap-1.5 self-start text-sm text-brand-soft transition hover:text-white sm:self-auto">
          Clear search &amp; browse all <ArrowIcon className="h-4 w-4" />
        </button>
      </Reveal>

      {n > 0 && (
        <Stagger key={query} className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" gap={0.06}>
          {ranked.map((r, i) => (
            <motion.div key={r.l.agent} variants={stagItem}>
              <CoverCard l={r.l} index={i} reason={reasonText(r.reasons)} />
            </motion.div>
          ))}
        </Stagger>
      )}
    </section>
  )
}

/* ----------------------------------------------------- featured carousel */
const AUTOPLAY_MS = 8000

const slideVar = {
  enter: (d) => ({ x: d > 0 ? 64 : -64, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.65, ease: EASE } },
  exit: (d) => ({ x: d > 0 ? -64 : 64, opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }),
}

function FeaturedCarousel({ listings }) {
  const feats = useMemo(() => {
    const bound = listings.filter((l) => l.quote?.status === 'bound')
    const As = bound.filter((l) => l.grade?.grade === 'A')
    const pool = As.length ? As : bound.length ? bound : listings
    return [...pool].sort((a, b) => (b.grade?.score ?? 0) - (a.grade?.score ?? 0)).slice(0, 5)
  }, [listings])

  const [[idx, dir], setIdx] = useState([0, 1])
  const n = feats.length
  const go = (d) => setIdx(([p]) => [(((p + d) % n) + n) % n, d])

  useEffect(() => {
    if (n < 2) return
    const t = setTimeout(() => go(1), AUTOPLAY_MS)
    return () => clearTimeout(t)
  }, [idx, n]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!n) return null
  const l = feats[idx]
  const declined = l.quote?.status !== 'bound'
  const hex = accentOf(l.accent).stroke
  const pal = coverPalette(hex)
  const t = gradeTheme(l.grade.grade)
  const blurb = AGENT_BLURB[l.name] || {}
  const tagline = l.tagline || blurb.tagline || 'A verified, insured autonomous agent.'
  const category = l.category || 'Other'
  const isLive = l.kind === 'llm'

  return (
    <Reveal as="section" className="relative">
      <div className="relative overflow-hidden rounded-card border border-line bg-ink-850/70 shadow-raised backdrop-blur-xl">
        {/* accent ribbon riding the top edge */}
        <span className="absolute inset-x-0 top-0 z-20 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${hex}, transparent)` }} />

        {/* slide viewport */}
        <div className="relative">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={l.agent}
              custom={dir}
              variants={slideVar}
              initial="enter"
              animate="center"
              exit="exit"
              className="grid lg:grid-cols-[1.05fr_0.95fr]"
            >
              {/* ---- left: editorial copy ---- */}
              <div className="relative z-10 flex flex-col p-7 md:p-10 lg:pr-8">
                <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.24em] text-brand-soft">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                  </span>
                  Featured agent · {category}
                </div>

                <h3 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-[1.02] tracking-tighter2 md:text-5xl">
                  <span className="text-white">{l.name}<span style={{ color: hex }}>.</span></span>{' '}
                  <span className="text-slate-500">{tagline}</span>
                </h3>

                <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-400">
                  Identity-verified by <b className="text-slate-200">{l.developer}</b>, graded{' '}
                  <b className={t.text}>{l.grade.grade}</b> after twenty live attacks
                  {isLive && l.model ? <> on <span className="font-mono text-[13px] text-slate-300">{l.model.split('/').pop()}</span></> : null}
                  {declined
                    ? <>. Cover was <b className="text-bad">declined</b> — no cover, no shelf.</>
                    : <>, insured at <b className="text-slate-200">{cents(l.quote.gross_premium_usd)}/action</b> and anchored on-chain.</>}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {l.verified && <VerifiedMark />}
                  <GradePill grade={l.grade.grade} score={l.grade.score} />
                  <ProtectedMark quote={l.quote} />
                  <span className="chip border-transparent bg-ink-800/80 font-mono !text-[11px] text-slate-400">
                    {oneIn(l.quote.frequency)} mistake rate
                  </span>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Tactile as={Link} to={`/agent/${l.agent}`} className="btn-primary px-5 py-2.5 text-sm">
                    View {l.name}&rsquo;s listing <ArrowIcon className="h-4 w-4" />
                  </Tactile>
                  <span className="handwriting text-sm text-brand-soft/70">crash-tested live, not on slides</span>
                </div>
              </div>

              {/* ---- right: original network cover art ---- */}
              <div className="relative order-first h-48 overflow-hidden border-b border-line/60 sm:h-60 lg:order-last lg:h-auto lg:min-h-[380px] lg:border-b-0 lg:border-l">
                <div className="absolute inset-0">
                  <DotField cell={6} speed={0.055} opacity={0.65} palette={pal} />
                </div>
                <div className="absolute inset-0 p-4 lg:p-8">
                  <AgentGlobe className="h-full w-full" />
                </div>
                {/* blend into the card */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-[#171310] lg:bg-gradient-to-r lg:from-[#171310] lg:to-transparent" />
                {/* corner glyph + grade chips */}
                <div className="absolute right-4 top-4 flex items-center gap-2">
                  <span className={`grid h-9 w-9 place-items-center rounded-full ring-1 ${t.bg} ${t.ring} ${t.text} font-display text-sm font-semibold backdrop-blur`}>
                    {l.grade.grade}
                  </span>
                </div>
                <div className="absolute bottom-4 right-4 hidden items-center gap-2 rounded-full bg-ink-950/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 backdrop-blur lg:flex">
                  {iconSvg(l.icon || CATEGORY_ICON[category], 'h-3.5 w-3.5 text-brand-soft')}
                  identity · rig · cover · chain
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ---- controls rail ---- */}
        <div className="relative z-10 flex items-center gap-4 border-t border-line/60 bg-ink-900/40 px-6 py-4 md:px-9">
          <div className="flex items-center gap-2">
            <RoundBtn flip onClick={() => go(-1)} label="Previous featured agent" />
            <RoundBtn onClick={() => go(1)} label="Next featured agent" />
          </div>

          <span className="hidden font-mono text-[11px] tracking-[0.2em] text-slate-500 sm:inline">
            {String(idx + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </span>

          {/* thin autoplay progress bar */}
          <div className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-ink-700">
            {n > 1 && (
              <motion.div
                key={idx}
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-brand"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: AUTOPLAY_MS / 1000, ease: 'linear' }}
              />
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {feats.map((f, i) => (
              <button
                key={f.agent}
                type="button"
                aria-label={`Show ${f.name}`}
                onClick={() => setIdx(([p]) => [i, i > p ? 1 : -1])}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? 'w-5 bg-brand' : 'w-1.5 bg-ink-600 hover:bg-slate-500'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </Reveal>
  )
}

function RoundBtn({ onClick, flip, label }) {
  return (
    <Tactile
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-full border border-line bg-ink-800/80 text-slate-300 transition-colors hover:border-brand/50 hover:text-white"
    >
      <ArrowIcon className={`h-4 w-4 ${flip ? 'rotate-180' : ''}`} />
    </Tactile>
  )
}

/* ---------------------------------------------------------- trust marquee */
// A seamless marquee of the live categories + trust words — the "as featured in" rhythm.
function TrustMarquee({ categories }) {
  const words = [
    ...categories.map((c) => ({ label: c, icon: iconSvg(CATEGORY_ICON[c] || 'sparkle', 'h-4 w-4') })),
    { label: 'Identity-verified', icon: <ShieldIcon className="h-4 w-4" /> },
    { label: 'Crash-tested', icon: <CheckIcon className="h-4 w-4" /> },
    { label: 'Insured', icon: <LockIcon className="h-4 w-4" /> },
    { label: 'Auto-paid claims', icon: iconSvg('bank', 'h-4 w-4') },
  ]
  const run = [...words, ...words]
  return (
    <section className="relative -mx-5 overflow-hidden border-y border-line/50 bg-ink-900/40 py-5">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-950 to-transparent" />
      <div className="flex w-max animate-marquee items-center gap-4 whitespace-nowrap">
        {run.map((w, i) => (
          <span key={i} className="inline-flex items-center gap-2 text-sm font-medium text-slate-400">
            {w.icon && <span className="text-brand-soft/75">{w.icon}</span>}
            {w.label}
            <span className="mx-2 inline-block h-1 w-1 rounded-full bg-brand/50" />
          </span>
        ))}
      </div>
    </section>
  )
}

function CategoryPill({ category, accent }) {
  const a = accentTheme(accent)
  return (
    <span className={`chip ${a.bg} ${a.text} ${a.ring} ring-1 border-transparent`}>
      {iconSvg(CATEGORY_ICON[category] || 'sparkle', 'h-3.5 w-3.5')}
      {category || 'Other'}
    </span>
  )
}

/* ------------------------------------------------------------ cover cards */
function CoverCard({ l, index = 0, reason = '' }) {
  const blurb = AGENT_BLURB[l.name] || {}
  const tagline = l.tagline || blurb.tagline || l.blurb || 'A verified, insured autonomous agent.'
  const declined = l.quote?.status !== 'bound'
  const isLive = l.kind === 'llm'
  const t = gradeTheme(l.grade.grade)
  const category = l.category || 'Other'
  const hex = accentOf(l.accent).stroke
  const pal = coverPalette(hex)
  const caps = (l.capabilities || []).filter(Boolean).slice(0, 3)
  const capName = (c) => (typeof c === 'string' ? c : c?.name)

  return (
    <Link
      to={`/agent/${l.agent}`}
      className={`glass-sweep group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-ink-850/70 shadow-card backdrop-blur-xl transition-all duration-500 ease-out-expo hover:-translate-y-2 hover:border-brand/40 hover:shadow-raised ${
        declined ? 'opacity-70 saturate-[0.35]' : ''
      }`}
    >
      {/* ---- COVER: original dot-matrix art tinted to the agent accent ---- */}
      <div className="relative aspect-[4/3] overflow-hidden border-b border-line/60 bg-ink-900">
        <div className="absolute inset-0 transition duration-700 ease-out-expo group-hover:scale-[1.04] group-hover:brightness-[1.22]">
          <DotField cell={6} speed={0.045} opacity={0.72} palette={pal} />
        </div>
        {/* legibility veil */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d0a09] via-[#0d0a09]/10 to-[#0d0a09]/70" />

        {/* eyebrow — category · grade */}
        <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-ink-950/55 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-300 backdrop-blur-sm">
          {iconSvg(CATEGORY_ICON[category] || 'sparkle', 'h-3 w-3 text-brand-soft')}
          {category} · Grade {l.grade.grade}
        </div>

        {/* grade pill */}
        <span className={`absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full font-display text-sm font-semibold ring-1 backdrop-blur-sm ${t.bg} ${t.text} ${t.ring}`}>
          {l.grade.grade}
        </span>

        {/* search-match reason (only when surfaced by a query) */}
        {reason && (
          <span className="absolute right-4 top-14 inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-brand-soft ring-1 ring-brand/25 backdrop-blur-sm">
            {reason}
          </span>
        )}

        {/* the big masthead name */}
        <div className="absolute inset-x-5 bottom-4">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            <span className="text-slate-600">№ {String(index + 1).padStart(2, '0')}</span>
            {isLive ? (
              <span className="text-brand-soft">live · {l.model?.split('/').pop()}</span>
            ) : (
              <span>reference build</span>
            )}
          </div>
          <div className="mt-1.5 font-sans text-[2.7rem] font-bold leading-[0.95] tracking-tighter3 text-white transition-transform duration-500 ease-out-expo group-hover:-translate-y-0.5">
            {l.name}<span style={{ color: hex }}>.</span>
          </div>
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="flex flex-1 flex-col p-5">
        <p className="min-h-[44px] text-sm leading-relaxed text-slate-400">{tagline}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CategoryPill category={category} accent={l.accent} />
          {l.verified && <VerifiedMark />}
          <ProtectedMark quote={l.quote} />
        </div>

        {caps.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {caps.map((c, i) => (
              <span key={i} className="rounded-md border border-line/70 bg-ink-800/60 px-2 py-0.5 text-[11px] text-slate-400">
                {capName(c)}
              </span>
            ))}
          </div>
        )}

        {/* meta row */}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line/70 pt-4">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-300">{l.developer}</div>
            <div className={`mt-0.5 text-xs ${declined ? 'text-bad' : 'text-slate-500'}`}>
              {declined ? 'Not listed — no cover, no shelf' : <>Insured · <span className="font-mono text-slate-300">{cents(l.quote.gross_premium_usd)}</span>/action</>}
            </div>
          </div>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line/80 text-slate-500 transition-all duration-300 group-hover:border-brand/50 group-hover:text-brand">
            <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>

      {/* ---- rig telemetry strip ---- */}
      <div className="grid grid-cols-3 divide-x divide-line/60 border-t border-line/60 bg-ink-900/50 font-mono">
        <TeleCell value={`${l.grade.score}`} sub={`${l.grade.passed_tests}/${l.grade.total_tests}`} label="crash score" />
        <TeleCell value={oneIn(l.quote.frequency)} sub="covered" label="mistake rate" />
        <TeleCell value={declined ? '—' : cents(l.quote.gross_premium_usd)} sub={declined ? 'declined' : 'per action'} label="premium" danger={declined} />
      </div>
    </Link>
  )
}

function TeleCell({ value, sub, label, danger }) {
  return (
    <div className="px-3.5 py-3">
      <div className={`text-[13px] ${danger ? 'text-bad' : 'text-slate-200'}`}>
        {value} <span className="text-[10px] text-slate-500">{sub}</span>
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- how row */
function HowRow() {
  const steps = [
    ['Verify', 'KYA checks the developer and signs an agent ID bound to the exact code + model.'],
    ['Crash-test', '20 attacks — forged messages, smuggled instructions, out-of-mandate actions — run live against the agent.'],
    ['Price', 'The grade is a frequency estimate. A is 1-in-10,000: about two cents an action.'],
    ['Cover', 'Mistakes inside your mandate are covered. A claim auto-pays; the incident becomes test 21.'],
  ]
  return (
    <Reveal as="section" className="relative overflow-hidden rounded-card border border-line bg-ink-900/50 p-8 md:p-12">
      <div className="pointer-events-none absolute inset-0 opacity-[0.4]" style={{ maskImage: 'radial-gradient(60% 60% at 80% 10%, #000, transparent 75%)', WebkitMaskImage: 'radial-gradient(60% 60% at 80% 10%, #000, transparent 75%)' }} aria-hidden>
        <DotField cell={7} speed={0.04} opacity={0.5} />
      </div>
      <div className="mesh" style={{ top: '-80px', right: '10%', height: 220, width: 220, background: 'rgba(196,85,45,0.12)' }} />
      <div className="eyebrow relative mb-10"><Tick /> No cover, no shelf — how an agent earns its place</div>
      <Stagger className="relative grid gap-8 md:grid-cols-4" gap={0.09}>
        {steps.map(([t, d], i) => (
          <motion.div key={t} variants={stagItem} className="relative">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 font-display text-brand ring-1 ring-brand/30">{i + 1}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="font-display text-xl text-white">{t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{d}</p>
          </motion.div>
        ))}
      </Stagger>
    </Reveal>
  )
}

function ClosingBand() {
  return (
    <Reveal as="section" className="relative overflow-hidden rounded-card border border-brand/20 bg-gradient-to-br from-ink-850 to-ink-900 p-8 md:p-14">
      <div className="pointer-events-none absolute inset-0 opacity-[0.45]" style={{ maskImage: 'radial-gradient(70% 90% at 50% 120%, #000, transparent 70%)', WebkitMaskImage: 'radial-gradient(70% 90% at 50% 120%, #000, transparent 70%)' }} aria-hidden>
        <DotField cell={6} speed={0.05} opacity={0.55} />
      </div>
      <div className="mesh animate-drift" style={{ bottom: '-120px', right: '-40px', height: 300, width: 300, background: 'rgba(196,85,45,0.18)' }} />
      <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <div className="eyebrow mb-4"><Tick /> The shelf is open</div>
          <h3 className="font-display text-4xl font-semibold leading-[0.95] tracking-tighter2 text-white md:text-6xl">Ship an agent<br />people can trust.</h3>
          <p className="mt-4 text-lg text-slate-300">Write a policy, pick a model, and watch Backstop classify, grade and price it live against twenty real attacks. Earn a grade, get a custom dashboard, go on the shelf.</p>
        </div>
        <Tactile as={Link} to="/studio" className="btn-primary whitespace-nowrap px-5 py-3 text-[15px]">
          Open the studio <ArrowIcon className="h-4 w-4" />
        </Tactile>
      </div>
    </Reveal>
  )
}
