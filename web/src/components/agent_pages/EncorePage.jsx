/* =============================================================================
 * ENCORE — concert/event ticket-buyer desk (bespoke, AI-AUTOMATED "My account" page)
 *
 * PHASE 1 · IDEATE (killer ticket-buyer utilities — NOT a blank artist/date form)
 *   - Encore DRIVES: on load it surfaces a live RADAR of 3-4 hot shows it's tracking
 *     with ZERO input — each with best price vs face value, a price-trend arrow, a
 *     within-budget chip and a fake-ticket scam-risk chip, ready to grab.
 *   - One-tap VIBE/GENRE CHIPS the agent suggests ("Pop arena tour", "EDM festival",
 *     "NBA courtside under $300", "Surprise me") — each re-runs the radar for that vibe.
 *   - A SINGLE natural-language box ("Tell Encore who you want to see…") where Encore
 *     parses artist/city/budget/date out of the sentence itself. Exact fields are
 *     demoted behind a small "refine" toggle, secondary.
 *   - A scam-aware LISTING VERIFIER (safe | caution | scam) for resale listings / DMs —
 *     Encore's insured twist against fake-ticket scalping.
 *   - A client-side PRICE-WATCH list: tap "watch" / set "alert under $X", target vs current.
 *   - A "Have Encore grab these seats" hand-off that runs the REAL insured agent loop and
 *     surfaces that it confirms before spending a cent.
 *
 * PHASE 2 · PLAN (widgets → endpoints)
 *   [TrustStrip]    agent record — no fetch.
 *   [RadarHero]     POST /apps/encore/radar {vibe?, budget?} (auto on mount; chips re-run).
 *   [AskBox]        POST /apps/encore/search {query, budget?} — model parses the sentence.
 *   [RefineForm]    composes a query → /apps/encore/search — secondary, behind a toggle.
 *   [SearchResults] renders the same pick shape as the radar.
 *   [Watchlist]     client state (target vs current) — "watch" on any pick.
 *   [VerifyDesk]    POST /apps/encore/verify-listing → verdict card.
 *   [GrabHandoff]   api.agentTask({task, agent}) → RunTimeline (shared).
 *   [ActivityFeed]  customer.runs → RunTimeline (shared).
 *   [InsuranceStrip] agent.quote → link to /claims.
 *
 * PHASE 3 · BUILD (wired to real structured backend results)
 *   Radar/search/verify call the bespoke /apps/encore/* endpoints, which ground Encore's
 *   REAL system_prompt in ask_json. "Grab these seats" calls the universal agent-task
 *   primitive and renders the honest, insured agent loop. Radar auto-runs exactly once on
 *   mount (ref-guarded) with a retry on error. All copy is framed as the agent acting.
 *
 * PHASE 4 · POLISH ("Mocha Noir", homepage-level — VISUAL + MOTION ONLY)
 *   Cinematic serif HERO over a DotField/GlowBackdrop, a marquee of what Encore watches,
 *   a dedicated ⚡ Auto-pilot card, premium accent-tinted event "cover" cards, staggered
 *   Reveals and Tactile buttons. Every endpoint, prop and branch is byte-for-byte intact.
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../../api'
import { usd, cents } from '../../lib/format'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'
import { Reveal, Stagger, stagItem, Tactile } from '../ui/motion.jsx'
import DotField from '../ui/DotField.jsx'
import { GlowBackdrop, GoldRule } from '../ui/Backdrop.jsx'

/* ------------------------------------------------------------------ helpers */
// Dot-matrix "cover" ramps per accent — original art, espresso → accent → cream.
const COVER_PALETTE = ['#140d0a', '#3a1c11', '#6e3017', '#a8471f', '#c4552d', '#e07a46', '#ffb98c', '#ffded2']
const COVERS = {
  brand: COVER_PALETTE,
  gold: ['#140d0a', '#2a1f0a', '#5c4410', '#8a6410', '#c49320', '#f0bd36', '#f7d777', '#fff0c2'],
  sky: ['#0a1214', '#0d2a30', '#10505c', '#16808a', '#1fa6c0', '#2ac6e4', '#7fdcee', '#d6f6fc'],
  rose: ['#140d0a', '#2a1016', '#5c1f2c', '#8a2f44', '#c44162', '#dd6381', '#ee8ea6', '#ffd6e0'],
}
// accents rotate across the event cards so the grid feels alive (vibrant, but espresso-dark)
const CARD_CYCLE = ['brand', 'gold', 'sky', 'rose']
const CARD_TINT = {
  brand: { fg: 'text-brand-soft', dot: 'bg-brand', ring: 'ring-brand/25', fill: 'rgba(196,85,45,0.14)', bar: 'from-brand/70' },
  gold: { fg: 'text-gold', dot: 'bg-gold', ring: 'ring-gold/25', fill: 'rgba(240,189,54,0.12)', bar: 'from-gold/70' },
  sky: { fg: 'text-sky', dot: 'bg-sky', ring: 'ring-sky/25', fill: 'rgba(42,198,228,0.12)', bar: 'from-sky/70' },
  rose: { fg: 'text-rose', dot: 'bg-rose', ring: 'ring-rose/25', fill: 'rgba(221,99,129,0.12)', bar: 'from-rose/70' },
}

const RISK = {
  none: { label: 'Verified sellers', chip: 'border-safe/30 bg-safe/10 text-safe', dot: 'bg-safe' },
  low: { label: 'Scam risk: low', chip: 'border-warn/30 bg-warn/10 text-warn', dot: 'bg-warn' },
  high: { label: 'Scam risk: high', chip: 'border-bad/30 bg-bad/10 text-bad', dot: 'bg-bad' },
}
const VERDICT = {
  safe: { label: 'Looks legit', ring: 'border-safe/40 bg-safe/10 text-safe', Icon: CheckIcon },
  caution: { label: 'Be careful', ring: 'border-warn/40 bg-warn/10 text-warn', Icon: null },
  scam: { label: 'Likely a scam', ring: 'border-bad/40 bg-bad/10 text-bad', Icon: XIcon },
}
// trend arrow from the buyer's point of view: down is good, up is bad.
const TREND = {
  down: { glyph: '↓', cls: 'text-safe', label: 'price dropping' },
  up: { glyph: '↑', cls: 'text-bad', label: 'price climbing' },
  flat: { glyph: '→', cls: 'text-slate-400', label: 'price steady' },
}

// Vibe/genre chips Encore suggests — each re-runs the radar for that vibe.
const VIBES = [
  { label: 'Pop arena tour', vibe: 'a big pop arena tour everyone is talking about', budget: 0 },
  { label: 'EDM festival', vibe: 'a high-energy EDM festival or DJ show', budget: 0 },
  { label: 'NBA courtside under $300', vibe: 'NBA games with good lower-bowl or courtside seats', budget: 300 },
  { label: 'Indie & small venues', vibe: 'buzzy indie acts in intimate small venues', budget: 0 },
  { label: 'Surprise me', vibe: 'surprise me — a mix of shows I probably would not think of myself', budget: 0 },
]

// Tasteful fallback phrases for the hero marquee before the radar lands (no invented artists).
const MARQUEE_SEED = ['Arena tours', 'EDM festivals', 'NBA courtside', 'Indie nights', 'Sold-out shows', 'Face-value seats', 'No scalpers', 'Playoff games', 'Residencies', 'Festival weekends']

function pickKey(p) {
  return `${p.artist_or_event}|${p.venue}|${p.date}|${p.best_price_usd}`
}

function Panel({ eyebrow, title, subtitle, acc = 'info', right, children, live, id }) {
  const t = accent(acc)
  return (
    <Reveal id={id} className="card relative overflow-hidden p-6 md:p-7">
      <div className="mesh" style={{ top: '-90px', right: '3%', height: 200, width: 240, background: t.fill }} />
      <div className="relative">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <div className={`eyebrow mb-2 ${t.text}`}>
                {live ? (
                  <span className="relative flex h-2 w-2">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-60`} />
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${t.dot}`} />
                  </span>
                ) : (
                  <span className={`inline-block h-3 w-px ${t.dot}`} />
                )}
                {eyebrow}
              </div>
            )}
            {title && <h3 className="font-display text-2xl font-semibold leading-tight tracking-tighter2 text-white">{title}</h3>}
            {subtitle && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">{subtitle}</p>}
          </div>
          {right}
        </div>
        {children}
      </div>
    </Reveal>
  )
}

/* ---------------------------------------------------------------- component */
export default function EncorePage({ agentId, agent, customer, agentName }) {
  const acc = agent?.accent || 'info'
  const t = accent(acc)
  const quote = agent?.quote || {}
  const grade = agent?.grade || {}
  const name = agent?.name || agentName || 'Encore'

  // default per-ticket budget ~ customer cert limit, else insured per-incident limit, else sensible fallback
  const defaultBudget = Math.round(
    customer?.certificate?.per_incident_limit_usd ||
    customer?.certificate?.coverage_limit_usd ||
    400,
  )

  // ---- radar (hero) state ----
  const [radar, setRadar] = useState(null)
  const [scanning, setScanning] = useState(true)
  const [radarErr, setRadarErr] = useState('')
  const [activeVibe, setActiveVibe] = useState(null)
  const scannedOnce = useRef(false)

  // ---- search state (NL box + refine form share one results pane) ----
  const [ask, setAsk] = useState('')
  const [form, setForm] = useState({ artist: '', city: '', date: '', max_price: defaultBudget })
  const [showRefine, setShowRefine] = useState(false)
  const [search, setSearch] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')

  // ---- verify state ----
  const [verifyText, setVerifyText] = useState('')
  const [verify, setVerify] = useState(null)
  const [verifying, setVerifying] = useState(false)

  // ---- watchlist (client state) ----
  const [watch, setWatch] = useState([])

  // ---- grab (agent-execute) state ----
  const [grabbing, setGrabbing] = useState('')     // key of pick being grabbed
  const [ticket, setTicket] = useState(null)       // {pick, confirmation, summary, steps}
  const [grabErr, setGrabErr] = useState('')

  // ---- auto-pilot state ----
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoStage, setAutoStage] = useState('')   // live progress line
  const [autoErr, setAutoErr] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  /* ----------------------------------------------- radar (auto + vibe chips) */
  async function runRadar({ budget = defaultBudget, vibe = '', label = null } = {}) {
    setScanning(true); setRadarErr(''); setActiveVibe(label)
    try {
      const res = await api.post('/apps/encore/radar', { budget, vibe })
      setRadar(res)
    } catch (err) {
      setRadarErr(err?.response?.data?.detail || "I couldn't scan for shows just now.")
    } finally {
      setScanning(false)
    }
  }

  // auto-run exactly once on mount
  useEffect(() => {
    if (scannedOnce.current) return
    scannedOnce.current = true
    runRadar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------- search (NL) */
  async function runAsk(e) {
    e?.preventDefault()
    if (!ask.trim()) return
    setSearching(true); setSearchErr(''); setSearch(null)
    try {
      const res = await api.post('/apps/encore/search', { query: ask })
      setSearch(res)
      scrollTo('encore-results')
    } catch (err) {
      setSearchErr(err?.response?.data?.detail || 'Search is unavailable right now. Try again.')
    } finally {
      setSearching(false)
    }
  }

  async function runRefine(e) {
    e?.preventDefault()
    const parts = []
    if (form.artist) parts.push(`see ${form.artist}`)
    if (form.city) parts.push(`in ${form.city}`)
    if (form.date) parts.push(`around ${form.date}`)
    if (form.max_price) parts.push(`for under $${Number(form.max_price)}`)
    const query = parts.length ? `I want to ${parts.join(' ')}.` : ask
    if (!query.trim()) return
    setSearching(true); setSearchErr(''); setSearch(null)
    try {
      const res = await api.post('/apps/encore/search', { query, budget: Number(form.max_price) || 0 })
      setSearch(res)
      scrollTo('encore-results')
    } catch (err) {
      setSearchErr(err?.response?.data?.detail || 'Search is unavailable right now. Try again.')
    } finally {
      setSearching(false)
    }
  }

  /* ---------------------------------------------------------------- verify */
  async function runVerify(e) {
    e?.preventDefault()
    if (!verifyText.trim()) return
    setVerifying(true); setVerify(null)
    try {
      const res = await api.post('/apps/encore/verify-listing', { text_or_link: verifyText })
      setVerify(res)
    } catch (err) {
      setVerify({ verdict: 'caution', reasons: [err?.response?.data?.detail || 'Verifier unavailable.'], advice: 'Try again — and never pay a stranger off-platform or by gift card / wire.' })
    } finally {
      setVerifying(false)
    }
  }

  /* --------------------------------------------------------- watchlist */
  function addWatch(p) {
    const key = pickKey(p)
    setWatch((cur) => (cur.some((w) => w.key === key) ? cur : [...cur, { ...p, key, target: Math.round(p.best_price_usd) || defaultBudget }]))
  }
  function removeWatch(key) {
    setWatch((cur) => cur.filter((w) => w.key !== key))
  }
  function setTarget(key, val) {
    setWatch((cur) => cur.map((w) => (w.key === key ? { ...w, target: Number(val) || 0 } : w)))
  }

  /* -------------------------------------------------------- grab (execute) */
  function taskFor(p) {
    return (
      `Grab seats to ${p.artist_or_event}${p.venue ? ` at ${p.venue}` : ''}` +
      `${p.city ? `, ${p.city}` : ''}${p.date ? ` on ${p.date}` : ''}. ` +
      `${p.seats_note ? `Preferred seats: ${p.seats_note}. ` : ''}` +
      `Best price ${usd(p.best_price_usd, 0)} (face value ${usd(p.face_value_usd, 0)}). ` +
      `Buy only from verified sellers and don't overpay.`
    )
  }

  async function grabSeats(p) {
    const key = pickKey(p)
    setGrabbing(key); setGrabErr(''); setTicket(null)
    try {
      const res = await api.agentExecute({ task: taskFor(p), agent: agentId, kind: 'ticket' })
      setTicket({ pick: p, confirmation: res?.confirmation, summary: res?.summary, steps: res?.steps || [] })
      scrollTo('encore-handoff')
    } catch (err) {
      setGrabErr(err?.response?.data?.detail || 'Could not reach your agent. Try again.')
    } finally {
      setGrabbing('')
    }
  }

  /* ----------------------------------------------- auto-pilot (zero clicks) */
  async function autoPilot() {
    setAutoRunning(true); setAutoErr(''); setTicket(null)
    try {
      setAutoStage('Scanning for drops…')
      const res = await api.post('/apps/encore/radar', { budget: defaultBudget, vibe: '' })
      setRadar(res); setActiveVibe(null); setScanning(false)

      setAutoStage('Picking the best seats…')
      const picks = res?.picks || []
      // best = within budget + low/none scam risk, then cheapest; fall back gracefully.
      const safe = picks.filter((p) => p.scam_risk !== 'high')
      const ranked = [...safe].sort((a, b) => {
        const aw = a.within_budget ? 0 : 1
        const bw = b.within_budget ? 0 : 1
        if (aw !== bw) return aw - bw
        const ar = a.scam_risk === 'none' ? 0 : 1
        const br = b.scam_risk === 'none' ? 0 : 1
        if (ar !== br) return ar - br
        return (a.best_price_usd || 0) - (b.best_price_usd || 0)
      })
      const best = ranked[0]
      if (!best) { setAutoErr("I couldn't find safe seats within budget just now — try a vibe or tell me who you want to see."); return }

      setAutoStage(`Securing tickets to ${best.artist_or_event}…`)
      const exec = await api.agentExecute({ task: taskFor(best), agent: agentId, kind: 'ticket' })
      setTicket({ pick: best, confirmation: exec?.confirmation, summary: exec?.summary, steps: exec?.steps || [] })
      scrollTo('encore-handoff')
    } catch (err) {
      setAutoErr(err?.response?.data?.detail || "Auto-pilot hit a snag — try again.")
    } finally {
      setAutoRunning(false); setAutoStage('')
    }
  }

  function scrollTo(id) {
    if (typeof document !== 'undefined') {
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }

  const runs = Array.isArray(customer?.runs) ? customer.runs : []
  const watchedKeys = new Set(watch.map((w) => w.key))
  const marqueeItems = (() => {
    const live = (radar?.picks || []).map((p) => p.artist_or_event).filter(Boolean)
    return (live.length >= 4 ? live : MARQUEE_SEED)
  })()

  return (
    <div className="space-y-6">
      {/* ============================ CINEMATIC HERO ============================ */}
      <Reveal as="section" className="card-raised relative overflow-hidden p-7 md:p-10">
        <GlowBackdrop />
        {/* a tall ticket-stub motif dissolving into the right edge (original art) */}
        <div
          className="pointer-events-none absolute right-[-6%] top-1/2 hidden h-[460px] w-[460px] -translate-y-1/2 opacity-[0.5] lg:block"
          style={{ maskImage: 'radial-gradient(58% 58% at 55% 48%, #000 0%, transparent 80%)', WebkitMaskImage: 'radial-gradient(58% 58% at 55% 48%, #000 0%, transparent 80%)' }}
          aria-hidden
        >
          <DotField cell={7} speed={0.055} opacity={0.7} palette={COVER_PALETTE} />
        </div>

        <div className="relative grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.26em] text-brand-soft">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
              Live events{grade.grade ? ` · Grade ${grade.grade}` : ''} · Scam-checked ticket desk
            </div>

            <h1 className="mt-5 font-display text-7xl font-semibold leading-[0.88] tracking-tighter3 text-white md:text-8xl">
              {name}<span className="text-brand">.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
              {agent?.tagline || 'Snag the best seats — no scalping, no surprises. I watch the drops, vet every seller, and grab the tickets end to end.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured against fake tickets
              </span>
            </div>

            <div className="mt-7 max-w-md">
              <GoldRule />
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line/60">
                <div className="bg-ink-900/70 px-4 py-4">
                  <div className={`stat-num text-2xl md:text-3xl ${t.text}`}>{cents(quote.gross_premium_usd)}</div>
                  <div className="label mt-1 !tracking-[0.14em]">Premium / purchase</div>
                </div>
                <div className="bg-ink-900/70 px-4 py-4">
                  <div className="stat-num text-2xl text-white md:text-3xl">{usd(quote.per_incident_limit_usd, 0)}</div>
                  <div className="label mt-1 !tracking-[0.14em]">Covered / incident</div>
                </div>
              </div>
            </div>

            <span className="handwriting mt-5 block text-base text-brand-soft/80">face value, every time.</span>
          </div>

          {/* ticket-stub glyph fills the right cell on mid-width screens */}
          <div className="relative hidden aspect-square w-full self-center overflow-hidden md:block lg:invisible" style={{ maskImage: 'radial-gradient(60% 60% at 50% 48%, #000 0%, transparent 82%)', WebkitMaskImage: 'radial-gradient(60% 60% at 50% 48%, #000 0%, transparent 82%)' }} aria-hidden>
            <DotField cell={7} speed={0.05} opacity={0.65} palette={COVER_PALETTE} />
          </div>
        </div>

        {/* marquee of what Encore watches — a tasteful transform loop */}
        <div className="relative mt-9 overflow-hidden" style={{ maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }} aria-hidden>
          <div className="flex w-max animate-marquee items-center gap-8 whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.24em] text-slate-500">
            {[...marqueeItems, ...marqueeItems].map((m, i) => (
              <span key={i} className="flex items-center gap-8">
                <span className="text-slate-400">{m}</span>
                <span className="text-brand/60">✦</span>
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ============================ ⚡ AUTO-PILOT ============================ */}
      <Reveal className="card relative overflow-hidden border-brand/40 p-6 shadow-glow">
        <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ maskImage: 'radial-gradient(70% 90% at 90% 0%, #000, transparent 72%)', WebkitMaskImage: 'radial-gradient(70% 90% at 90% 0%, #000, transparent 72%)' }} aria-hidden>
          <DotField cell={7} speed={0.05} opacity={0.6} palette={COVER_PALETTE} />
        </div>
        <div className="mesh animate-drift" style={{ top: '-80px', right: '2%', height: 220, width: 300, background: accent('brand').fill }} />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0">
            <div className="eyebrow mb-2">
              <span className="text-base leading-none">⚡</span> Hands-free
            </div>
            <h3 className="font-display text-2xl font-semibold tracking-tighter2 text-white">Auto-pilot the whole grab</h3>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-400">
              {autoRunning
                ? <span className="inline-flex items-center gap-2 text-brand-soft"><Spinner /> {autoStage || 'Working…'}</span>
                : 'Hand me the wheel — I scan for drops, pick the best within-budget seats from verified sellers, and secure them end to end.'}
            </p>
            {autoErr && !autoRunning && (
              <p className="mt-2 text-sm text-bad">
                {autoErr}
                <button onClick={autoPilot} className="ml-2 underline hover:text-white">Try again</button>
              </p>
            )}
          </div>
          <Tactile
            onClick={autoPilot}
            disabled={autoRunning}
            title="Scan, pick the best within-budget seats, and secure them — fully autonomous"
            className="btn-primary whitespace-nowrap px-5 py-3 text-[15px] disabled:opacity-70"
          >
            {autoRunning ? (autoStage || 'Running…') : <>⚡ Run auto-pilot</>}
          </Tactile>
        </div>
      </Reveal>

      {/* ============================ HERO: ENCORE RADAR ============================ */}
      <Panel eyebrow="Encore is on it" title="Shows I'm watching" acc={acc} live={scanning || autoRunning}
        subtitle={radar?.intro || "I scan for drops on hot shows so you don't start from a blank search box."}
        right={
          !scanning && !autoRunning && (
            <Tactile onClick={() => runRadar({ vibe: activeVibe ? VIBES.find((v) => v.label === activeVibe)?.vibe || '' : '', label: activeVibe })} className="btn-ghost !py-2 text-sm whitespace-nowrap">
              Rescan
            </Tactile>
          )
        }
      >
        {/* vibe/genre chips Encore suggests — each re-runs the radar */}
        <div className="mb-3 label !tracking-[0.2em]">Try a vibe</div>
        <div className="mb-5 flex flex-wrap gap-2">
          {VIBES.map((v) => (
            <Tactile
              key={v.label}
              onClick={() => runRadar({ budget: v.budget || defaultBudget, vibe: v.vibe, label: v.label })}
              disabled={scanning}
              className={`chip transition-colors ${activeVibe === v.label ? `${t.bg} ${t.text} ${t.border} ring-1 ${t.ring}` : 'hover:border-brand/40 hover:text-white'}`}
            >
              {v.label}
            </Tactile>
          ))}
        </div>

        {/* single natural-language box — Encore parses the sentence itself */}
        <form onSubmit={runAsk} className="mb-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="inp text-sm"
              placeholder="Tell Encore who you want to see… e.g. 'Sabrina Carpenter in Chicago under $250 this fall'"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
            />
            <Tactile type="submit" disabled={searching || !ask.trim()} className="btn-primary whitespace-nowrap">
              {searching ? 'Searching…' : <>Ask Encore <ArrowIcon className="h-4 w-4" /></>}
            </Tactile>
          </div>
          <button type="button" onClick={() => setShowRefine((s) => !s)} className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 transition-colors hover:text-slate-300">
            {showRefine ? '− hide exact fields' : '+ refine with artist, city, date & max price'}
          </button>
        </form>

        {/* secondary, collapsed refine form */}
        <AnimatePresence initial={false}>
          {showRefine && (
            <motion.form
              onSubmit={runRefine}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mb-5 overflow-hidden"
            >
              <div className="space-y-3 rounded-card border border-line bg-ink-900/50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Artist / event"><input className="inp text-sm" placeholder="Olivia Rodrigo" value={form.artist} onChange={set('artist')} /></Field>
                  <Field label="City"><input className="inp text-sm" placeholder="Atlanta" value={form.city} onChange={set('city')} /></Field>
                  <Field label="Around (date / month)"><input className="inp text-sm" placeholder="Nov 2026" value={form.date} onChange={set('date')} /></Field>
                  <Field label="Max price / ticket (USD)"><input className="inp text-sm" type="number" min="0" value={form.max_price} onChange={set('max_price')} /></Field>
                </div>
                <Tactile type="submit" disabled={searching} className="btn-ghost !py-2 text-sm">{searching ? 'Searching…' : 'Search these exactly'}</Tactile>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* radar picks / skeleton / error */}
        {scanning ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <PickSkeleton key={i} />)}
          </div>
        ) : radarErr ? (
          <div className="rounded-card border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
            {radarErr}
            <button onClick={() => runRadar({ label: activeVibe })} className="ml-3 underline hover:text-white">Retry</button>
          </div>
        ) : (
          <Stagger key={activeVibe || 'default'} className="grid gap-4 md:grid-cols-2" gap={0.08}>
            {(radar?.picks || []).map((p, i) => (
              <motion.div key={i} variants={stagItem}>
                <PickCard p={p} i={i} watched={watchedKeys.has(pickKey(p))} grabbing={grabbing === pickKey(p)}
                  onWatch={() => addWatch(p)} onGrab={() => grabSeats(p)} />
              </motion.div>
            ))}
            {(radar?.picks || []).length === 0 && (
              <p className="text-sm text-slate-500">Nothing on radar right now — tap a vibe above or tell me who you want to see.</p>
            )}
          </Stagger>
        )}
        {grabErr && <div className="mt-4 rounded-card border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{grabErr}</div>}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ============================ SEARCH RESULTS ============================ */}
        <Panel id="encore-results" eyebrow="Seats I found" title="Search results" acc={acc}
          subtitle="Ask me in your own words above and the matching seats land here, scam-checked."
        >
          {searchErr && <div className="mb-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{searchErr}</div>}
          {!search && !searching && (
            <p className="text-sm text-slate-500">Tell me who you want to see and I'll lay out honest, budget-checked seats here.</p>
          )}
          {searching && <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <PickSkeleton key={i} />)}</div>}

          {search && (
            <div className="space-y-4 animate-fade-up">
              {search.summary && (
                <div className="rounded-xl border border-line bg-ink-900/40 p-3 text-sm text-slate-300">
                  <span className={`mr-2 chip !px-2 !py-0.5 text-[11px] ${search.within_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
                    {search.within_budget ? 'Within budget' : 'Over budget'}
                  </span>
                  {search.summary}
                </div>
              )}
              <Stagger className="grid gap-4 sm:grid-cols-2" gap={0.08}>
                {(search.picks || []).map((p, i) => (
                  <motion.div key={i} variants={stagItem}>
                    <PickCard p={p} i={i} watched={watchedKeys.has(pickKey(p))} grabbing={grabbing === pickKey(p)}
                      onWatch={() => addWatch(p)} onGrab={() => grabSeats(p)} />
                  </motion.div>
                ))}
              </Stagger>
              {(search.picks || []).length === 0 && <p className="text-sm text-slate-500">No seats came back — try widening the date or raising the budget.</p>}
            </div>
          )}
        </Panel>

        {/* ============================ RIGHT RAIL ============================ */}
        <div className="space-y-6">
          {/* -------- PRICE WATCHLIST -------- */}
          <Panel eyebrow="Price watch" title="Seats I'm tracking" acc="brand"
            subtitle="Tap watch on any show and set an alert price — I'll ping you when it drops."
          >
            {watch.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing on watch yet. Hit “Watch” on a show and I'll track the price for you.</p>
            ) : (
              <div className="space-y-3">
                {watch.map((w) => {
                  const hit = w.best_price_usd <= w.target
                  return (
                    <div key={w.key} className="rounded-xl border border-line bg-ink-900/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{w.artist_or_event}</div>
                          <div className="truncate font-mono text-[11px] text-slate-500">{[w.venue, w.city, w.date].filter(Boolean).join(' · ')}</div>
                        </div>
                        <button onClick={() => removeWatch(w.key)} className="shrink-0 text-slate-500 hover:text-bad" title="stop watching"><XIcon className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-400">Current <b className="font-mono text-slate-200">{usd(w.best_price_usd, 0)}</b></span>
                        <label className="flex items-center gap-1 text-slate-400">
                          Alert under $
                          <input
                            type="number" min="0" value={w.target}
                            onChange={(e) => setTarget(w.key, e.target.value)}
                            className="w-16 rounded-md border border-line bg-ink-900/60 px-1.5 py-0.5 text-right font-mono text-slate-200"
                          />
                        </label>
                      </div>
                      <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] ${hit ? 'border border-safe/30 bg-safe/10 text-safe' : 'border border-line bg-ink-900/60 text-slate-400'}`}>
                        {hit ? `✓ At/under your target — I'd grab these now.` : `Watching — ${usd(w.best_price_usd - w.target, 0)} above your alert price.`}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* -------- VERIFY A LISTING -------- */}
          <Panel eyebrow="Scam check" title="Verify a resale listing" acc="info"
            subtitle="Paste a listing, a seller's DM or a link — I'll tell you if it's a fake-ticket scam."
          >
            <form onSubmit={runVerify} className="space-y-3">
              <textarea
                className="inp min-h-[96px] resize-y text-sm"
                placeholder="Paste a resale listing, a 'DM me, I'll send the barcode' message, or a link…"
                value={verifyText}
                onChange={(e) => setVerifyText(e.target.value)}
              />
              <Tactile type="submit" disabled={verifying || !verifyText.trim()} className="btn-primary w-full">
                {verifying ? 'Checking…' : 'Check this seller'}
              </Tactile>
            </form>
            {verify && (() => {
              const v = VERDICT[verify.verdict] || VERDICT.caution
              return (
                <div className={`mt-4 animate-fade-up rounded-xl border p-4 ${v.ring}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {v.Icon ? <v.Icon className="h-4 w-4" /> : <span>⚠</span>} {v.label}
                  </div>
                  {verify.reasons?.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                      {verify.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><span className="opacity-60">·</span>{r}</li>)}
                    </ul>
                  )}
                  {verify.advice && <p className="mt-2 border-t border-white/10 pt-2 text-xs italic text-slate-300">→ {verify.advice}</p>}
                </div>
              )
            })()}
          </Panel>
        </div>
      </div>

      {/* ============================ GRAB SUCCESS CARD ============================ */}
      {ticket && (
        <div id="encore-handoff">
          <Reveal className="card relative overflow-hidden border-safe/40 p-6 shadow-glow-safe">
            <div className="pointer-events-none absolute inset-0 opacity-[0.3]" style={{ maskImage: 'radial-gradient(70% 90% at 92% 0%, #000, transparent 72%)', WebkitMaskImage: 'radial-gradient(70% 90% at 92% 0%, #000, transparent 72%)' }} aria-hidden>
              <DotField cell={7} speed={0.04} opacity={0.5} palette={COVER_PALETTE} />
            </div>
            <div className="mesh" style={{ top: '-80px', right: '4%', height: 200, width: 260, background: accent('safe').fill }} />
            <div className="relative animate-fade-up space-y-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-safe/15 text-safe ring-1 ring-safe/40"><CheckIcon className="h-6 w-6" /></span>
                <div>
                  <div className="eyebrow text-safe">Secured · confirmed</div>
                  <h3 className="font-display text-2xl font-semibold tracking-tighter2 text-white">Tickets are yours</h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-safe/30 bg-safe/5 p-4">
                <div className="min-w-0">
                  <div className="font-sans text-lg font-bold text-white">{ticket.pick?.artist_or_event}</div>
                  <div className="truncate font-mono text-[11px] text-slate-400">
                    {[ticket.pick?.venue, ticket.pick?.city, ticket.pick?.date].filter(Boolean).join(' · ')}
                    {ticket.pick?.seats_note ? ` — ${ticket.pick.seats_note}` : ''}
                  </div>
                </div>
                {ticket.confirmation && (
                  <div className="rounded-xl border border-safe/30 bg-safe/10 px-4 py-2.5 text-right">
                    <div className="label !text-[9px] text-safe">Confirmation</div>
                    <div className="stat-num mt-0.5 font-mono text-base text-white">{ticket.confirmation}</div>
                  </div>
                )}
              </div>

              {ticket.summary && <p className="text-sm text-slate-300">{ticket.summary}</p>}

              <div>
                <div className="label mb-2">What I did</div>
                <ol className="space-y-2.5">
                  {(ticket.steps && ticket.steps.length ? ticket.steps : ['Found the best verified seats', 'Vetted the seller', 'Secured the tickets']).map((s, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-slate-200">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-safe/15 text-safe"><CheckIcon className="h-3.5 w-3.5" /></span>
                      {typeof s === 'string' ? s : s?.title || s?.step || JSON.stringify(s)}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex items-center gap-1.5 border-t border-white/10 pt-3 text-xs text-slate-400">
                <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-safe" /> This purchase is insured up to <span className="font-mono text-slate-200">{usd(quote.per_incident_limit_usd, 0)}</span>.
              </div>
            </div>
          </Reveal>
        </div>
      )}

      {/* ============================ ACTIVITY FEED ============================ */}
      <Panel eyebrow="Activity" title="Recent agent runs" acc={acc}>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Pick a show above and let me grab the seats.</p>
        ) : (
          <div className="space-y-5">
            {[...runs].reverse().slice(0, 6).map((run, i) => (
              <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{run.agent_name || run.agent || name}</span>
                  <span className="font-mono">{(run.ts || '').slice(0, 16).replace('T', ' ')}</span>
                </div>
                <RunTimeline run={run} agent={run.agent_name || run.agent || name} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ============================ INSURANCE STRIP ============================ */}
      <Reveal className="card relative flex flex-wrap items-center justify-between gap-4 overflow-hidden border-brand/20 p-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.3]" style={{ maskImage: 'radial-gradient(60% 120% at 0% 50%, #000, transparent 70%)', WebkitMaskImage: 'radial-gradient(60% 120% at 0% 50%, #000, transparent 70%)' }} aria-hidden>
          <DotField cell={7} speed={0.04} opacity={0.55} palette={COVER_PALETTE} />
        </div>
        <div className="relative flex items-center gap-4">
          <span className={`grid h-11 w-11 place-items-center rounded-2xl ${t.bg} ${t.text} ring-1 ${t.ring}`}><ShieldIcon className="h-5 w-5" /></span>
          <div>
            <div className="eyebrow mb-1"><span className="inline-block h-3 w-px bg-brand/70" /> Backed by Backstop</div>
            <div className="font-display text-lg font-semibold tracking-tightish text-white">Every purchase is insured</div>
            <div className="mt-0.5 max-w-xl text-sm leading-relaxed text-slate-400">
              If a covered mistake slips through — a fake ticket, a bad charge — you're protected up to <span className="font-mono text-slate-200">{usd(quote.per_incident_limit_usd, 0)}</span> per incident. File a claim and Backstop adjudicates it.
            </div>
          </div>
        </div>
        <Tactile as={Link} to="/claims" className="btn-ghost relative whitespace-nowrap">File or view a claim <ArrowIcon className="h-4 w-4" /></Tactile>
      </Reveal>
    </div>
  )
}

/* ------------------------------------------------------------------ bits */
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// Premium event "cover" card — accent-tinted dot-matrix header, bold Geist name,
// mono price/seat/date, scalper/scam-risk + under-face chips. Accent rotates per card.
function PickCard({ p, i = 0, watched, grabbing, onWatch, onGrab }) {
  const r = RISK[p.scam_risk] || RISK.none
  const tr = TREND[p.price_trend] || TREND.flat
  const savings = p.face_value_usd > 0 ? p.face_value_usd - p.best_price_usd : 0
  const blocked = p.scam_risk === 'high'
  const key = blocked ? 'rose' : CARD_CYCLE[i % CARD_CYCLE.length]
  const tint = CARD_TINT[key]
  const palette = COVERS[key] || COVER_PALETTE
  return (
    <div className={`group relative flex h-full flex-col overflow-hidden rounded-card border p-4 transition-shadow ${blocked ? 'border-bad/40 bg-bad/5' : 'border-line bg-ink-900/40 hover:shadow-float'}`}>
      {/* accent-tinted dot-matrix "cover" bleeding in from the top-right */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.4]" style={{ maskImage: 'radial-gradient(85% 70% at 92% -8%, #000, transparent 68%)', WebkitMaskImage: 'radial-gradient(85% 70% at 92% -8%, #000, transparent 68%)' }} aria-hidden>
        <DotField cell={6} speed={0.045} opacity={0.6} palette={palette} />
      </div>
      {/* thin accent bar at the very top */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent ${tint.bar}`} aria-hidden />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`eyebrow mb-1.5 !text-[10px] ${tint.fg}`}>
            <span className={`inline-block h-2.5 w-px ${tint.dot}`} /> On radar
          </div>
          <div className="truncate font-sans text-lg font-bold leading-tight text-white">{p.artist_or_event}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
            {[p.venue, p.city].filter(Boolean).join(' · ')}{p.date ? ` · ${p.date}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="stat-num font-mono text-xl text-white">{usd(p.best_price_usd, 0)}</div>
          <div className={`label !text-[9px] mt-0.5 ${tr.cls}`}>{tr.glyph} {tr.label}</div>
        </div>
      </div>

      {(p.face_value_usd > 0 || p.seats_note) && (
        <div className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-500">
          {p.face_value_usd > 0 && <span>Face {usd(p.face_value_usd, 0)}{savings > 0 ? ` · ${usd(savings, 0)} under face` : savings < 0 ? ` · ${usd(-savings, 0)} over face` : ''}</span>}
          {p.seats_note && <span className="truncate">🪑 {p.seats_note}</span>}
        </div>
      )}

      {p.why && <p className="relative mt-2 text-sm leading-relaxed text-slate-300">{p.why}</p>}

      <div className="relative mt-3 flex flex-wrap items-center gap-2">
        <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.label}</span>
        <span className={`chip !px-2 !py-0.5 text-[10px] ${p.within_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
          {p.within_budget ? 'Within budget' : 'Over budget'}
        </span>
        {savings > 0 && !blocked && (
          <span className="chip !px-2 !py-0.5 text-[10px] border-gold/30 bg-gold/10 text-gold">{usd(savings, 0)} under face</span>
        )}
      </div>

      <div className="relative mt-auto flex items-center gap-2 pt-4">
        <Tactile
          onClick={onWatch}
          disabled={watched}
          className={`btn-ghost !py-2 text-sm whitespace-nowrap ${watched ? '!text-safe' : ''}`}
        >
          {watched ? '✓ Watching' : '☆ Watch'}
        </Tactile>
        <Tactile
          onClick={onGrab}
          disabled={grabbing || blocked}
          title={blocked ? 'I flagged this event for high scam risk — I won’t grab these.' : ''}
          className="btn-primary flex-1 !py-2 text-sm whitespace-nowrap disabled:opacity-60"
        >
          {blocked ? 'Flagged — blocked' : grabbing ? 'Securing…' : 'Have Encore grab these'}
        </Tactile>
      </div>
      <div className="relative mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
        <ShieldIcon className="h-3 w-3 shrink-0" /> Verified sellers only · insured purchase
      </div>
    </div>
  )
}

function PickSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-line bg-ink-900/40 p-4">
      <div className="flex items-start justify-between">
        <div className="h-5 w-1/2 rounded bg-ink-800" />
        <div className="h-5 w-14 rounded bg-ink-800" />
      </div>
      <div className="mt-2 h-3 w-2/3 rounded bg-ink-800/70" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded bg-ink-800/60" />
        <div className="h-3 w-5/6 rounded bg-ink-800/60" />
      </div>
      <div className="mt-4 h-8 w-full rounded-lg bg-ink-800/80" />
    </div>
  )
}
