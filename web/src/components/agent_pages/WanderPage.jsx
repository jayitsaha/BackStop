/* =============================================================================
 * WANDER — travel-concierge desk (bespoke, AI-AUTOMATED "My account" page)
 *
 * PHASE 1 · IDEATE (killer travel-concierge utilities)
 *   - Wander DRIVES: on load it proactively scouts 2-3 complete, scam-checked
 *     trip ideas with ZERO input and offers to book them.
 *   - One-tap VIBE CHIPS the agent suggests ("Beach escape under $1500", …)
 *     each re-scout fresh ideas; a single natural-language box where Wander
 *     parses origin/dates/budget out of a sentence itself.
 *   - A scam-aware SEARCH + a BOOKING VERIFIER (safe | caution | scam).
 *   - A live TRIP BUDGET tracker that a selected trip auto-fills.
 *   - A "Have Wander book this" hand-off that runs the REAL insured agent loop.
 *
 * PHASE 2 · PLAN (widgets → endpoints)
 *   [TrustStrip]      agent record — no fetch.
 *   [ProposeHero]     POST /apps/wander/propose {budget?, vibe?} (auto on mount).
 *   [DreamBox]        POST /apps/wander/search {query} — model parses the sentence.
 *   [RefineForm]      POST /apps/wander/search {origin,...} — secondary, behind a toggle.
 *   [VerifyDesk]      POST /apps/wander/verify-booking {text, image?} + Gmail widget → verdict.
 *   [ItineraryDesk]   client state (auto-filled from a chosen trip) → api.agentExecute (booking).
 *   [AutoPilot]       propose → auto-pick best within-budget trip → agentExecute → confirmation.
 *   [ActivityFeed]    customer.runs → RunTimeline (shared).
 *   [InsuranceStrip]  agent.quote → link to /claims.
 *
 * PHASE 3 · BUILD (wired to real structured backend results)
 *   Propose/search/verify call the bespoke /apps/wander/* endpoints, which ground
 *   Wander's REAL system_prompt in ask_json. Booking calls api.agentExecute({task, agent,
 *   kind:'booking'}) — an always-completed confirmation (code + summary + steps checklist).
 *   Auto-propose runs once on mount (ref-guarded); ⚡ Auto-pilot runs the whole flow hands-free.
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../../api'
import { usd, cents } from '../../lib/format'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GmailConnect } from '../widgets/guards.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'
import { Reveal, Stagger, stagItem, Tactile } from '../ui/motion.jsx'
import DotField from '../ui/DotField.jsx'
import { GlowBackdrop, GoldRule } from '../ui/Backdrop.jsx'
import AgentGlobe from '../ui/AgentGlobe.jsx'

/* ------------------------------------------------------------------ helpers */
// espresso → mocha → cream dot-matrix ramp used for premium trip "covers" (original art)
const COVER_PALETTE = ['#140d0a', '#3a1c11', '#6e3017', '#a8471f', '#c4552d', '#e07a46', '#ffb98c', '#ffded2']
// a soft edge mask so the globe dissolves into the hero rather than sitting in a box
const GLOBE_MASK = {
  maskImage: 'radial-gradient(60% 60% at 50% 46%, #000 0%, transparent 80%)',
  WebkitMaskImage: 'radial-gradient(60% 60% at 50% 46%, #000 0%, transparent 80%)',
}
const RISK = {
  none: { label: 'Verified', chip: 'border-safe/30 bg-safe/10 text-safe', dot: 'bg-safe' },
  low: { label: 'Check it', chip: 'border-warn/30 bg-warn/10 text-warn', dot: 'bg-warn' },
  high: { label: 'Scam risk', chip: 'border-bad/30 bg-bad/10 text-bad', dot: 'bg-bad' },
}
const VERDICT = {
  safe: { label: 'Looks safe', ring: 'border-safe/40 bg-safe/10 text-safe', Icon: CheckIcon },
  caution: { label: 'Be careful', ring: 'border-warn/40 bg-warn/10 text-warn', Icon: null },
  scam: { label: 'Likely a scam', ring: 'border-bad/40 bg-bad/10 text-bad', Icon: XIcon },
}
const TYPE_ICON = { flight: '✈️', hotel: '🏨', package: '🧳' }

// Vibe chips Wander suggests — each re-scouts fresh ideas via /propose.
const VIBES = [
  { label: 'Beach escape under $1500', vibe: 'a relaxing beach escape on a modest budget', budget: 1500 },
  { label: 'City break', vibe: 'a short, walkable city break with great food and culture', budget: 0 },
  { label: 'Somewhere warm in January', vibe: 'somewhere reliably warm and sunny to visit in January', budget: 0 },
  { label: 'Surprise me', vibe: 'surprise me — somewhere I probably would not think of myself', budget: 0 },
]

function Panel({ eyebrow, title, subtitle, acc = 'safe', right, children, live, id }) {
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
export default function WanderPage({ agentId, agent, customer, agentName }) {
  const acc = agent?.accent || 'safe'
  const t = accent(acc)
  const quote = agent?.quote || {}
  const grade = agent?.grade || {}
  const name = agent?.name || agentName || 'Wander'

  // default budget ~ customer cert limit, else the insured per-incident limit, else sensible fallback
  const defaultBudget = Math.round(
    customer?.certificate?.per_incident_limit_usd ||
    customer?.certificate?.coverage_limit_usd ||
    quote?.per_incident_limit_usd ||
    1800,
  )

  // ---- proposal (hero) state ----
  const [proposals, setProposals] = useState(null)
  const [proposing, setProposing] = useState(true)
  const [proposeErr, setProposeErr] = useState('')
  const [activeVibe, setActiveVibe] = useState(null)
  const proposedOnce = useRef(false)

  // ---- search state (NL box + refine form share one results pane) ----
  const [dream, setDream] = useState('')
  const [form, setForm] = useState({
    origin: '', destination: '', depart: '', return: '', travelers: 2, budget_per_person: defaultBudget, prefs: '',
  })
  const [showRefine, setShowRefine] = useState(false)
  const [search, setSearch] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')

  // ---- verify state ----
  const [verifyText, setVerifyText] = useState('')
  const [verifyImg, setVerifyImg] = useState(null) // { uri, name }
  const [verify, setVerify] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const fileRef = useRef(null)

  // ---- itinerary / budget state ----
  const [tripBudget, setTripBudget] = useState(defaultBudget * 2)
  const [saved, setSaved] = useState([])

  // ---- booking (execute → always-completed confirmation) state ----
  const [booking, setBooking] = useState(false)
  const [bookResult, setBookResult] = useState(null) // { status, success, confirmation, summary, steps[] }
  const [bookErr, setBookErr] = useState('')

  // ---- auto-pilot state ----
  const [autopilot, setAutopilot] = useState(false)
  const [autoStep, setAutoStep] = useState('')
  const [autoErr, setAutoErr] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const savedTotal = saved.reduce((s, o) => s + (Number(o.price_usd) || 0), 0)
  const over = savedTotal > tripBudget && tripBudget > 0

  /* --------------------------------------------------- propose (auto + vibes) */
  async function runPropose({ budget = defaultBudget, vibe = '', label = null } = {}) {
    setProposing(true); setProposeErr(''); setActiveVibe(label)
    try {
      const res = await api.post('/apps/wander/propose', { budget, vibe })
      setProposals(res)
    } catch (err) {
      setProposeErr(err?.response?.data?.detail || "I couldn't scout trips just now.")
    } finally {
      setProposing(false)
    }
  }

  // auto-run exactly once on mount
  useEffect(() => {
    if (proposedOnce.current) return
    proposedOnce.current = true
    runPropose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------- search (NL) */
  async function runDream(e) {
    e?.preventDefault()
    if (!dream.trim()) return
    setSearching(true); setSearchErr(''); setSearch(null)
    try {
      const res = await api.post('/apps/wander/search', { query: dream, travelers: Number(form.travelers) || 2 })
      setSearch(res)
    } catch (err) {
      setSearchErr(err?.response?.data?.detail || 'Search is unavailable right now. Try again.')
    } finally {
      setSearching(false)
    }
  }

  async function runRefine(e) {
    e?.preventDefault()
    setSearching(true); setSearchErr(''); setSearch(null)
    try {
      const res = await api.post('/apps/wander/search', {
        origin: form.origin, destination: form.destination, depart: form.depart, return: form.return,
        travelers: Number(form.travelers) || 1, budget_per_person: Number(form.budget_per_person) || 0, prefs: form.prefs,
      })
      setSearch(res)
    } catch (err) {
      setSearchErr(err?.response?.data?.detail || 'Search is unavailable right now. Try again.')
    } finally {
      setSearching(false)
    }
  }

  /* ---------------------------------------------------------------- verify */
  function onPickScreenshot(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setVerifyImg({ uri: String(reader.result), name: file.name })
    reader.readAsDataURL(file)
    e.target.value = '' // allow re-picking the same file
  }
  function clearScreenshot() {
    setVerifyImg(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function runVerify(e) {
    e?.preventDefault()
    if (!verifyText.trim() && !verifyImg) return
    setVerifying(true); setVerify(null)
    try {
      const res = await api.post('/apps/wander/verify-booking', {
        text_or_link: verifyText,
        image: verifyImg?.uri || '',
      })
      setVerify(res)
    } catch (err) {
      setVerify({ verdict: 'caution', reasons: [err?.response?.data?.detail || 'Verifier unavailable.'], advice: 'Try again — and never wire a deposit to an unverified account.' })
    } finally {
      setVerifying(false)
    }
  }

  /* ----------------------------------------------------- itinerary actions */
  function optKey(o) {
    return `${o.type}|${o.title}|${o.price_usd}`
  }
  function saveOption(o) {
    const key = optKey(o)
    setSaved((cur) => (cur.some((x) => x.key === key) ? cur : [...cur, { ...o, key }]))
  }
  function removeOption(key) {
    setSaved((cur) => cur.filter((x) => x.key !== key))
  }
  // Picking a proposed trip auto-fills the whole tracker + the refine form.
  function pickTrip(tr) {
    const opts = (tr.options || []).filter((o) => o.scam_risk !== 'high').map((o) => ({ ...o, key: optKey(o) }))
    setSaved(opts)
    if (tr.assumed_budget_usd) setTripBudget(Math.round(tr.assumed_budget_usd * (tr.travelers || 1)))
    setForm((f) => ({
      ...f,
      origin: tr.origin || f.origin,
      destination: tr.destination || f.destination,
      depart: tr.depart || f.depart,
      return: tr.return || f.return,
      travelers: tr.travelers || f.travelers,
    }))
    if (typeof document !== 'undefined') {
      document.getElementById('wander-itinerary')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  /* -------------------------------------------------------- booking (execute) */
  function itineraryTask(items, total) {
    const lines = items.map((o) => `- ${o.type.toUpperCase()}: ${o.title} via ${o.provider} — ${usd(o.price_usd)} (${o.itinerary})`).join('\n')
    return (
      `Book this travel itinerary now. Verify every provider is legitimate and keep the total within my ` +
      `budget.\n\n` +
      `Itinerary (${items.length} item${items.length > 1 ? 's' : ''}, total ${usd(total)}):\n${lines}\n\n` +
      `Trip: ${form.origin || '?'} → ${form.destination || '?'}, ${form.depart || 'flexible'} to ${form.return || 'open'}, ` +
      `${form.travelers} traveler(s).`
    )
  }

  async function bookItinerary() {
    if (!saved.length) return
    setBooking(true); setBookErr(''); setBookResult(null)
    try {
      const res = await api.agentExecute({ task: itineraryTask(saved, savedTotal), agent: agentId, kind: 'booking' })
      setBookResult(res)
      scrollToConfirmation()
    } catch (err) {
      setBookErr(err?.response?.data?.detail || 'Could not reach your agent. Try again.')
    } finally {
      setBooking(false)
    }
  }

  /* --------------------------------------------------------- ⚡ auto-pilot */
  function scrollToConfirmation() {
    if (typeof document !== 'undefined') {
      setTimeout(() => document.getElementById('wander-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    }
  }

  async function runAutopilot() {
    setAutopilot(true); setAutoErr(''); setBookErr(''); setBookResult(null)
    try {
      setAutoStep('Scouting trips…')
      const prop = await api.post('/apps/wander/propose', { budget: defaultBudget, vibe: '' })
      setProposals(prop)
      const trips = prop?.trips || []
      if (!trips.length) throw new Error('No trips came back — try again.')

      setAutoStep('Picking the best within budget…')
      const pick =
        trips.find((tr) => tr.within_budget && (tr.scam_risk === 'none' || tr.scam_risk === 'low')) ||
        trips.find((tr) => tr.scam_risk !== 'high') ||
        trips[0]
      pickTrip(pick)
      const opts = (pick.options || []).filter((o) => o.scam_risk !== 'high')
      const total = opts.reduce((s, o) => s + (Number(o.price_usd) || 0), 0)

      setAutoStep(`Booking ${pick.destination}…`)
      const res = await api.agentExecute({ task: itineraryTask(opts, total), agent: agentId, kind: 'booking' })
      setBookResult(res)
      setAutoStep('')
      scrollToConfirmation()
    } catch (err) {
      setAutoErr(err?.response?.data?.detail || err?.message || 'Auto-pilot hit a snag. Try again.')
      setAutoStep('')
    } finally {
      setAutopilot(false)
    }
  }

  const runs = Array.isArray(customer?.runs) ? customer.runs : []

  return (
    <div className="space-y-6">
      {/* ============================ CINEMATIC HERO ============================ */}
      <Reveal as="section" className="card-raised relative overflow-hidden p-7 md:p-10">
        <GlowBackdrop />

        <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.26em] text-brand-soft">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
              Travel{grade.grade ? ` · Grade ${grade.grade}` : ''} · Scam-checked concierge
            </div>

            <h1 className="mt-5 font-display text-7xl font-semibold leading-[0.88] tracking-tighter3 text-white md:text-8xl">
              {name}<span className="text-brand">.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
              {agent?.tagline || 'Book safe, smart travel — no scams, no surprises. I scout the trip, verify every provider, and book it end to end.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured mistakes
              </span>
            </div>

            <div className="mt-7 max-w-md">
              <GoldRule />
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line/60">
                <div className="bg-ink-900/70 px-4 py-4">
                  <div className={`stat-num text-2xl md:text-3xl ${t.text}`}>{cents(quote.gross_premium_usd)}</div>
                  <div className="label mt-1 !tracking-[0.14em]">Premium / booking</div>
                </div>
                <div className="bg-ink-900/70 px-4 py-4">
                  <div className="stat-num text-2xl text-white md:text-3xl">{usd(quote.per_incident_limit_usd, 0)}</div>
                  <div className="label mt-1 !tracking-[0.14em]">Covered / incident</div>
                </div>
              </div>
            </div>

            <span className="handwriting mt-5 block text-base text-brand-soft/80">no scams, no surprises.</span>
          </div>

          {/* the agent-network globe — a destinations / routes motif beside the headline */}
          <div className="relative hidden aspect-square w-full self-center lg:block" style={GLOBE_MASK} aria-hidden>
            <AgentGlobe className="h-full w-full" speed={0.9} />
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.3em] text-brand-soft/70">
              routes · scouted live
            </span>
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
            <h3 className="font-display text-2xl font-semibold tracking-tighter2 text-white">Auto-pilot the whole trip</h3>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-400">
              {autopilot
                ? <span className="inline-flex items-center gap-2 text-brand-soft"><Spinner /> {autoStep || 'Working…'}</span>
                : 'Hand me the wheel — I plan, pick the best trip within your budget, verify every provider, and book it end to end.'}
            </p>
            {autoErr && <p className="mt-2 text-sm text-bad">{autoErr}</p>}
          </div>
          <Tactile onClick={runAutopilot} disabled={autopilot || booking} className="btn-primary whitespace-nowrap px-5 py-3 text-[15px]">
            {autopilot ? (autoStep || 'Running…') : <>⚡ Run auto-pilot</>}
          </Tactile>
        </div>
      </Reveal>

      {/* ============================ HERO: WANDER PROPOSES ============================ */}
      <Panel eyebrow="Wander is on it" title="Trips I scouted for you" acc={acc} live={proposing}
        subtitle={proposals?.intro || "I look for safe, well-priced trips so you don't have to start from a blank page."}
        right={
          !proposing && (
            <Tactile onClick={() => runPropose({ label: null })} className="btn-ghost !py-2 text-sm whitespace-nowrap">
              Scout again
            </Tactile>
          )
        }
      >
        {/* vibe chips the agent suggests */}
        <div className="mb-3 label !tracking-[0.2em]">Try a vibe</div>
        <div className="mb-5 flex flex-wrap gap-2">
          {VIBES.map((v) => (
            <Tactile
              key={v.label}
              onClick={() => runPropose({ budget: v.budget || defaultBudget, vibe: v.vibe, label: v.label })}
              disabled={proposing}
              className={`chip transition-colors ${activeVibe === v.label ? `${t.bg} ${t.text} ${t.border} ring-1 ${t.ring}` : 'hover:border-brand/40 hover:text-white'}`}
            >
              {v.label}
            </Tactile>
          ))}
        </div>

        {/* single natural-language box — Wander parses the sentence itself */}
        <form onSubmit={runDream} className="mb-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="inp text-sm"
              placeholder="Tell Wander where you're dreaming of… e.g. 'somewhere warm from NYC in March under $1200'"
              value={dream}
              onChange={(e) => setDream(e.target.value)}
            />
            <Tactile type="submit" disabled={searching || !dream.trim()} className="btn-primary whitespace-nowrap">
              {searching ? 'Thinking…' : <>Ask Wander <ArrowIcon className="h-4 w-4" /></>}
            </Tactile>
          </div>
          <button type="button" onClick={() => setShowRefine((s) => !s)} className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 transition-colors hover:text-slate-300">
            {showRefine ? '− hide exact fields' : '+ refine with exact dates & budget'}
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
                  <Field label="From"><input className="inp text-sm" placeholder="Atlanta (ATL)" value={form.origin} onChange={set('origin')} /></Field>
                  <Field label="To"><input className="inp text-sm" placeholder="Lisbon (LIS)" value={form.destination} onChange={set('destination')} /></Field>
                  <Field label="Depart"><input className="inp text-sm" type="date" value={form.depart} onChange={set('depart')} /></Field>
                  <Field label="Return"><input className="inp text-sm" type="date" value={form.return} onChange={set('return')} /></Field>
                  <Field label="Travelers"><input className="inp text-sm" type="number" min="1" value={form.travelers} onChange={set('travelers')} /></Field>
                  <Field label="Budget / person (USD)"><input className="inp text-sm" type="number" min="0" value={form.budget_per_person} onChange={set('budget_per_person')} /></Field>
                </div>
                <Field label="Preferences">
                  <input className="inp text-sm" placeholder="nonstop if possible, near old town, breakfast included…" value={form.prefs} onChange={set('prefs')} />
                </Field>
                <Tactile type="submit" disabled={searching} className="btn-ghost !py-2 text-sm">{searching ? 'Searching…' : 'Search these exactly'}</Tactile>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* proposals / skeleton / error */}
        {proposing ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <TripSkeleton key={i} />)}
          </div>
        ) : proposeErr ? (
          <div className="rounded-card border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
            {proposeErr}
            <button onClick={() => runPropose({ label: activeVibe })} className="ml-3 underline hover:text-white">Retry</button>
          </div>
        ) : (
          <Stagger key={activeVibe || 'default'} className="grid gap-4 md:grid-cols-3" gap={0.08}>
            {(proposals?.trips || []).map((tr, i) => (
              <motion.div key={i} variants={stagItem}>
                <TripCard tr={tr} index={i} onPick={() => pickTrip(tr)} />
              </motion.div>
            ))}
            {(proposals?.trips || []).length === 0 && (
              <p className="text-sm text-slate-500">No ideas came back — tap a vibe above or ask me in your own words.</p>
            )}
          </Stagger>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ============================ SEARCH RESULTS ============================ */}
        <Panel eyebrow="Options I found" title="Search results" acc={acc}
          subtitle="When you ask me in your own words or refine the fields, the matches land here."
        >
          {searchErr && <div className="mb-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{searchErr}</div>}
          {!search && !searching && (
            <p className="text-sm text-slate-500">Ask me where you're dreaming of above and I'll lay out budget-checked options here.</p>
          )}
          {searching && <div className="space-y-2.5">{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</div>}

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
              {search.budget?.total > 0 && (
                <BudgetBar label="Trip estimate vs your budget" value={search.total_estimate_usd} max={search.budget.total} />
              )}
              {(search.warnings || []).length > 0 && (
                <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
                  {search.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div className="space-y-2.5">
                {(search.options || []).map((o, i) => (
                  <OptionRow key={i} o={o} saved={saved.some((x) => x.key === optKey(o))} onSave={() => saveOption(o)} />
                ))}
                {(search.options || []).length === 0 && <p className="text-sm text-slate-500">No options — try widening your dates or budget.</p>}
              </div>
            </div>
          )}
        </Panel>

        {/* ============================ RIGHT RAIL ============================ */}
        <div className="space-y-6">
          {/* -------- TRIP BUDGET + ITINERARY -------- */}
          <div id="wander-itinerary">
            <Panel eyebrow="Your trip" title="Itinerary & budget" acc="brand">
              <Field label="Trip budget (USD)">
                <input className="inp text-sm" type="number" min="0" value={tripBudget} onChange={(e) => setTripBudget(Number(e.target.value) || 0)} />
              </Field>
              <div className="mt-4">
                <BudgetBar label="Itinerary total vs budget" value={savedTotal} max={tripBudget} />
                {over && (
                  <div className="mt-2 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                    Over budget by {usd(savedTotal - tripBudget, 0)} — I'd drop an item or you can raise the budget.
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {saved.length === 0 ? (
                  <p className="text-sm text-slate-500">Pick one of my trips above, or add options from a search, and I'll build the itinerary here.</p>
                ) : saved.map((o) => (
                  <div key={o.key} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-900/40 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">{TYPE_ICON[o.type] || '🧳'} {o.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-slate-400">{usd(o.price_usd, 0)}</span>
                      <button onClick={() => removeOption(o.key)} className="text-slate-500 hover:text-bad" title="remove"><XIcon className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                ))}
              </div>

              {saved.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info-soft">
                    <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
                    I verify every provider before I book — and every booking is insured.
                  </div>
                  <Tactile onClick={bookItinerary} disabled={booking} className="btn-primary w-full">
                    {booking ? 'Booking…' : `Have Wander book this · ${usd(savedTotal, 0)}`}
                  </Tactile>
                </div>
              )}
              {bookErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{bookErr}</div>}
            </Panel>
          </div>

          {/* -------- VERIFY A BOOKING -------- */}
          <Panel eyebrow="Scam check" title="Verify a booking" acc="info"
            subtitle="Paste it, upload a screenshot, or pull it from Gmail — I'll tell you if it's a scam."
          >
            <form onSubmit={runVerify} className="space-y-3">
              <textarea
                className="inp min-h-[96px] resize-y text-sm"
                placeholder="Paste a booking email, a 'wire a deposit' message, or a link to a booking site…"
                value={verifyText}
                onChange={(e) => setVerifyText(e.target.value)}
              />

              {/* input methods: paste (above) · screenshot · gmail (below) */}
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickScreenshot} className="hidden" />
                <Tactile
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn-ghost !py-2 text-sm"
                >
                  📷 Upload screenshot
                </Tactile>
                <span className="text-xs text-slate-500">PNG/JPG of the email or booking page</span>
              </div>

              {verifyImg && (
                <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-2 py-1.5">
                  <img src={verifyImg.uri} alt="screenshot" className="h-9 w-9 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{verifyImg.name}</span>
                  <button type="button" onClick={clearScreenshot} className="shrink-0 text-slate-500 hover:text-bad" title="remove screenshot">
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              <Tactile type="submit" disabled={verifying || (!verifyText.trim() && !verifyImg)} className="btn-primary w-full">
                {verifying ? 'Checking…' : verifyImg && !verifyText.trim() ? 'Read screenshot & check it' : 'Check it'}
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

          {/* -------- GMAIL: pull a suspicious email straight in -------- */}
          <GmailConnect section={{ title: 'Pull it from Gmail', props: { eyebrow: 'Gmail · scam triage', query: 'in:inbox newer_than:1y' } }} agentName={name} />
        </div>
      </div>

      {/* ============================ BOOKING CONFIRMATION ============================ */}
      {bookResult && <BookingConfirmation result={bookResult} />}

      {/* ============================ ACTIVITY FEED ============================ */}
      <Panel eyebrow="Activity" title="Recent agent runs" acc={acc}>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Pick a trip and let me book it.</p>
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
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/30"><ShieldIcon className="h-5 w-5" /></span>
          <div>
            <div className="eyebrow mb-1"><span className="inline-block h-3 w-px bg-brand/70" /> Backed by Backstop</div>
            <div className="font-display text-lg font-semibold tracking-tightish text-white">Every booking is insured</div>
            <div className="mt-0.5 max-w-xl text-sm leading-relaxed text-slate-400">
              If a covered mistake slips through, you're protected up to <span className="font-mono text-slate-200">{usd(quote.per_incident_limit_usd, 0)}</span> per incident. File a claim and Backstop adjudicates it.
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

function BudgetBar({ label, value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const over = value > max && max > 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={over ? 'font-semibold text-bad' : 'text-slate-300'}>{usd(value, 0)}{max > 0 ? ` / ${usd(max, 0)}` : ''}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-900">
        <div className={`h-full rounded-full transition-all ${over ? 'bg-bad' : pct > 85 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function TripCard({ tr, onPick, index = 0 }) {
  const r = RISK[tr.scam_risk] || RISK.none
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-ink-850/70 shadow-card backdrop-blur-xl transition-all duration-500 ease-out-expo hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-raised">
      {/* ---- COVER: original dot-matrix "destination" art ---- */}
      <div className="relative h-32 overflow-hidden border-b border-line/60 bg-ink-900">
        <div className="absolute inset-0 transition duration-700 ease-out-expo group-hover:scale-[1.05] group-hover:brightness-[1.18]">
          <DotField cell={6} speed={0.045} opacity={0.78} palette={COVER_PALETTE} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d0a09] via-[#0d0a09]/20 to-[#0d0a09]/60" />
        {/* type eyebrow */}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink-950/55 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300 backdrop-blur-sm">
          <span className="text-slate-500">№ {String(index + 1).padStart(2, '0')}</span>
          {tr.origin ? `${tr.origin} →` : 'Trip'}
        </div>
        {/* price in mono */}
        <div className="absolute right-3 top-3 rounded-full bg-ink-950/55 px-2.5 py-1 text-right backdrop-blur-sm">
          <div className="font-mono text-sm font-semibold text-white">{usd(tr.total_estimate_usd, 0)}</div>
          <div className="label !text-[8px] !tracking-[0.14em]">/ person</div>
        </div>
        {/* masthead destination */}
        <div className="absolute inset-x-4 bottom-3">
          <div className="font-sans text-2xl font-bold leading-[0.95] tracking-tighter3 text-white transition-transform duration-500 ease-out-expo group-hover:-translate-y-0.5">
            {tr.destination}
          </div>
          {tr.headline && <div className="mt-0.5 truncate text-[11px] text-slate-300">{tr.headline}</div>}
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="flex flex-1 flex-col p-4">
        {(tr.depart || tr.origin) && (
          <div className="font-mono text-[11px] text-slate-500">
            {tr.depart}{tr.return ? ` → ${tr.return}` : ''}{tr.travelers ? ` · ${tr.travelers} traveler(s)` : ''}
          </div>
        )}
        {tr.why && <p className="mt-2 text-sm leading-relaxed text-slate-300">{tr.why}</p>}

        <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
          {(tr.options || []).map((o, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span className="min-w-0 truncate">{TYPE_ICON[o.type] || '🧳'} {o.title} <span className="text-slate-600">· {o.provider}</span></span>
              <span className="shrink-0 font-mono text-slate-300">{usd(o.price_usd, 0)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.label}</span>
          <span className={`chip !px-2 !py-0.5 text-[10px] ${tr.within_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
            {tr.within_budget ? 'Within budget' : 'Over budget'}
          </span>
        </div>

        <Tactile onClick={onPick} className="btn-primary mt-4 w-full !py-2 text-sm">I'd book this <ArrowIcon className="h-4 w-4" /></Tactile>
      </div>
    </div>
  )
}

function OptionRow({ o, saved, onSave }) {
  const r = RISK[o.scam_risk] || RISK.none
  return (
    <div className={`rounded-card border p-3.5 transition-colors ${o.scam_risk === 'high' ? 'border-bad/40 bg-bad/5' : 'border-line bg-ink-900/40 hover:border-brand/30'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span>{TYPE_ICON[o.type] || '🧳'}</span><span className="truncate">{o.title}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{o.provider} · {o.itinerary}</div>
          {o.notes && <div className="mt-1 text-xs text-slate-400">{o.notes}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="stat-num font-mono text-lg text-white">{usd(o.price_usd, 0)}</div>
          <div className="label !text-[9px] mt-0.5">{o.type === 'flight' ? 'per person' : 'total'}</div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.label}</span>
        <span className={`chip !px-2 !py-0.5 text-[10px] ${o.fits_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
          {o.fits_budget ? 'Fits budget' : 'Over budget'}
        </span>
        <button
          onClick={onSave}
          disabled={saved || o.scam_risk === 'high'}
          className="ml-auto text-xs font-semibold text-brand-soft transition-colors hover:text-white disabled:text-slate-600"
          title={o.scam_risk === 'high' ? 'I flagged this as a scam risk — not addable' : ''}
        >
          {saved ? '✓ In itinerary' : o.scam_risk === 'high' ? 'Blocked' : '+ Add to itinerary'}
        </button>
      </div>
    </div>
  )
}

function TripSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-line bg-ink-900/40 p-4">
      <div className="h-5 w-2/3 rounded bg-ink-800" />
      <div className="mt-2 h-3 w-1/2 rounded bg-ink-800/70" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded bg-ink-800/60" />
        <div className="h-3 w-5/6 rounded bg-ink-800/60" />
      </div>
      <div className="mt-4 h-8 w-full rounded-lg bg-ink-800/80" />
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-line bg-ink-900/40 p-3.5">
      <div className="h-4 w-1/2 rounded bg-ink-800" />
      <div className="mt-2 h-3 w-1/3 rounded bg-ink-800/70" />
    </div>
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

// Always-success booking confirmation — green ✓, confirmation code, summary, steps checklist.
function BookingConfirmation({ result }) {
  const code = result?.confirmation || result?.confirmation_code || result?.code || '—'
  const summary = result?.summary || result?.report || "You're all booked."
  const rawSteps = Array.isArray(result?.steps) ? result.steps : []
  const steps = rawSteps.map((s) => (typeof s === 'string' ? s : s?.label || s?.text || s?.title || s?.step || JSON.stringify(s)))
  return (
    <div id="wander-confirmation" className="card relative overflow-hidden border-safe/40 p-6 animate-fade-up">
      <div className="mesh" style={{ top: '-80px', right: '4%', height: 200, width: 260, background: accent('safe').fill }} />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-safe/15 text-safe ring-1 ring-safe/40">
            <CheckIcon className="h-6 w-6" />
          </span>
          <div>
            <div className="eyebrow text-safe">Booked · confirmed</div>
            <h3 className="font-display text-xl tracking-tightish text-white">Your trip is booked</h3>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="rounded-xl border border-safe/30 bg-safe/5 px-4 py-3">
            <div className="label !text-[9px] text-safe">Confirmation</div>
            <div className="stat-num mt-0.5 font-mono text-lg text-white">{code}</div>
          </div>
          <p className="text-sm text-slate-300">{summary}</p>
        </div>

        {steps.length > 0 && (
          <div className="mt-5">
            <div className="label mb-2">What I did</div>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-safe/20 text-safe">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
