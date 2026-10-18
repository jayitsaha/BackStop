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
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { usd, cents } from '../../lib/format'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'

/* ------------------------------------------------------------------ helpers */
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

function pickKey(p) {
  return `${p.artist_or_event}|${p.venue}|${p.date}|${p.best_price_usd}`
}

function Panel({ eyebrow, title, subtitle, acc = 'info', right, children, live, id }) {
  const t = accent(acc)
  return (
    <div id={id} className="card relative overflow-hidden p-6">
      <div className="mesh" style={{ top: '-80px', right: '4%', height: 180, width: 220, background: t.fill }} />
      <div className="relative">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <div className={`eyebrow mb-1 ${t.text}`}>
                {live && (
                  <span className="relative flex h-2 w-2">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-60`} />
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${t.dot}`} />
                  </span>
                )}
                {eyebrow}
              </div>
            )}
            {title && <h3 className="font-display text-xl tracking-tightish text-white">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          {right}
        </div>
        {children}
      </div>
    </div>
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

  // ---- grab (agent-task) state ----
  const [grabbing, setGrabbing] = useState('')     // key of pick being grabbed
  const [grabRun, setGrabRun] = useState(null)
  const [grabErr, setGrabErr] = useState('')

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

  /* -------------------------------------------------------- grab hand-off */
  async function grabSeats(p) {
    const key = pickKey(p)
    setGrabbing(key); setGrabErr(''); setGrabRun(null)
    const task =
      `Please grab seats for me to ${p.artist_or_event}${p.venue ? ` at ${p.venue}` : ''}` +
      `${p.city ? `, ${p.city}` : ''}${p.date ? ` on ${p.date}` : ''}. ` +
      `${p.seats_note ? `Preferred seats: ${p.seats_note}. ` : ''}` +
      `The best price I'm seeing is about ${usd(p.best_price_usd, 0)} (face value ${usd(p.face_value_usd, 0)}). ` +
      `Only buy from verified sellers, never overpay, and CONFIRM with me before you spend above ` +
      `${usd(p.best_price_usd, 0)} or anything looks like a fake-ticket scam.`
    try {
      const res = await api.agentTask({ task, agent: agentId })
      setGrabRun(res?.run || null)
      scrollTo('encore-handoff')
    } catch (err) {
      setGrabErr(err?.response?.data?.detail || 'Could not reach your agent. Try again.')
    } finally {
      setGrabbing('')
    }
  }

  function scrollTo(id) {
    if (typeof document !== 'undefined') {
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }

  const runs = Array.isArray(customer?.runs) ? customer.runs : []
  const watchedKeys = new Set(watch.map((w) => w.key))

  return (
    <div className="space-y-6">
      {/* ============================ TRUST / IDENTITY STRIP ============================ */}
      <div className="card relative overflow-hidden p-6">
        <div className="mesh" style={{ top: '-120px', right: '-40px', height: 280, width: 360, background: t.fill }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className={`eyebrow mb-2 ${t.text}`}>
              <span className="text-lg leading-none">🎟️</span> Ticket desk
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">{name}</h1>
            <p className="mt-2 max-w-xl text-slate-400">{agent?.tagline || 'Snag the best seats — no scalping, no surprises.'}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured against fake tickets
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
              <div className={`stat-num text-2xl ${t.text}`}>{cents(quote.gross_premium_usd)}</div>
              <div className="label mt-1">Premium / purchase</div>
            </div>
            <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
              <div className="stat-num text-2xl text-white">{usd(quote.per_incident_limit_usd, 0)}</div>
              <div className="label mt-1">Covered per incident</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ HERO: ENCORE RADAR ============================ */}
      <Panel eyebrow="Encore is on it" title="Shows I'm watching" acc={acc} live={scanning}
        subtitle={radar?.intro || "I scan for drops on hot shows so you don't start from a blank search box."}
        right={
          !scanning && (
            <button onClick={() => runRadar({ vibe: activeVibe ? VIBES.find((v) => v.label === activeVibe)?.vibe || '' : '', label: activeVibe })} className="btn-ghost !py-2 text-sm whitespace-nowrap">
              Rescan
            </button>
          )
        }
      >
        {/* vibe/genre chips Encore suggests — each re-runs the radar */}
        <div className="mb-5 flex flex-wrap gap-2">
          {VIBES.map((v) => (
            <button
              key={v.label}
              onClick={() => runRadar({ budget: v.budget || defaultBudget, vibe: v.vibe, label: v.label })}
              disabled={scanning}
              className={`chip transition ${activeVibe === v.label ? `${t.bg} ${t.text} ${t.border}` : 'hover:border-brand/40 hover:text-white'}`}
            >
              {v.label}
            </button>
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
            <button type="submit" disabled={searching || !ask.trim()} className="btn-primary bg-info whitespace-nowrap">
              {searching ? 'Searching…' : <>Ask Encore <ArrowIcon className="h-4 w-4" /></>}
            </button>
          </div>
          <button type="button" onClick={() => setShowRefine((s) => !s)} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
            {showRefine ? '− hide exact fields' : '+ refine with artist, city, date & max price'}
          </button>
        </form>

        {/* secondary, collapsed refine form */}
        {showRefine && (
          <form onSubmit={runRefine} className="mb-5 animate-fade-up space-y-3 rounded-xl border border-line bg-ink-900/40 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Artist / event"><input className="inp text-sm" placeholder="Olivia Rodrigo" value={form.artist} onChange={set('artist')} /></Field>
              <Field label="City"><input className="inp text-sm" placeholder="Atlanta" value={form.city} onChange={set('city')} /></Field>
              <Field label="Around (date / month)"><input className="inp text-sm" placeholder="Nov 2026" value={form.date} onChange={set('date')} /></Field>
              <Field label="Max price / ticket (USD)"><input className="inp text-sm" type="number" min="0" value={form.max_price} onChange={set('max_price')} /></Field>
            </div>
            <button type="submit" disabled={searching} className="btn-ghost !py-2 text-sm">{searching ? 'Searching…' : 'Search these exactly'}</button>
          </form>
        )}

        {/* radar picks / skeleton / error */}
        {scanning ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <PickSkeleton key={i} />)}
          </div>
        ) : radarErr ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
            {radarErr}
            <button onClick={() => runRadar({ label: activeVibe })} className="ml-3 underline hover:text-white">Retry</button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {(radar?.picks || []).map((p, i) => (
              <PickCard key={i} p={p} watched={watchedKeys.has(pickKey(p))} grabbing={grabbing === pickKey(p)}
                onWatch={() => addWatch(p)} onGrab={() => grabSeats(p)} />
            ))}
            {(radar?.picks || []).length === 0 && (
              <p className="text-sm text-slate-500">Nothing on radar right now — tap a vibe above or tell me who you want to see.</p>
            )}
          </div>
        )}
        {grabErr && <div className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{grabErr}</div>}
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
              <div className="grid gap-4 sm:grid-cols-2">
                {(search.picks || []).map((p, i) => (
                  <PickCard key={i} p={p} watched={watchedKeys.has(pickKey(p))} grabbing={grabbing === pickKey(p)}
                    onWatch={() => addWatch(p)} onGrab={() => grabSeats(p)} />
                ))}
              </div>
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
                          <div className="truncate text-xs text-slate-500">{[w.venue, w.city, w.date].filter(Boolean).join(' · ')}</div>
                        </div>
                        <button onClick={() => removeWatch(w.key)} className="shrink-0 text-slate-500 hover:text-bad" title="stop watching"><XIcon className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-400">Current <b className="text-slate-200">{usd(w.best_price_usd, 0)}</b></span>
                        <label className="flex items-center gap-1 text-slate-400">
                          Alert under $
                          <input
                            type="number" min="0" value={w.target}
                            onChange={(e) => setTarget(w.key, e.target.value)}
                            className="w-16 rounded-md border border-line bg-ink-900/60 px-1.5 py-0.5 text-right text-slate-200"
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
              <button type="submit" disabled={verifying || !verifyText.trim()} className="btn-ghost w-full">
                {verifying ? 'Checking…' : 'Check this seller'}
              </button>
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

      {/* ============================ GRAB HAND-OFF RESULT ============================ */}
      {grabRun && (
        <Panel id="encore-handoff" eyebrow="Encore at work" title="Grabbing your seats" acc={acc} live>
          <p className="mb-4 text-sm text-slate-400">
            Here's exactly what I did — my live tool-call log and honest report. I only buy from verified
            sellers and I pause before spending above your price or on anything that smells like a scam.
          </p>
          <div className="rounded-xl border border-line bg-ink-900/40 p-4">
            <RunTimeline run={grabRun} agent={name} />
          </div>
        </Panel>
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
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.bg} ${t.text}`}><ShieldIcon className="h-5 w-5" /></span>
          <div>
            <div className="font-display text-base text-white">Every purchase is insured</div>
            <div className="text-sm text-slate-400">
              If a covered mistake slips through — a fake ticket, a bad charge — you're protected up to {usd(quote.per_incident_limit_usd, 0)} per incident. File a claim and Backstop adjudicates it.
            </div>
          </div>
        </div>
        <Link to="/claims" className="btn-ghost whitespace-nowrap">File or view a claim <ArrowIcon className="h-4 w-4" /></Link>
      </div>
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

function PickCard({ p, watched, grabbing, onWatch, onGrab }) {
  const r = RISK[p.scam_risk] || RISK.none
  const tr = TREND[p.price_trend] || TREND.flat
  const savings = p.face_value_usd > 0 ? p.face_value_usd - p.best_price_usd : 0
  const blocked = p.scam_risk === 'high'
  return (
    <div className={`flex flex-col rounded-xl border p-4 ${blocked ? 'border-bad/40 bg-bad/5' : 'border-line bg-ink-900/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-lg text-white">{p.artist_or_event}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400">
            {[p.venue, p.city].filter(Boolean).join(' · ')}{p.date ? ` — ${p.date}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="stat-num text-xl text-white">{usd(p.best_price_usd, 0)}</div>
          <div className={`label !text-[9px] mt-0.5 ${tr.cls}`}>{tr.glyph} {tr.label}</div>
        </div>
      </div>

      {(p.face_value_usd > 0 || p.seats_note) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {p.face_value_usd > 0 && <span>Face {usd(p.face_value_usd, 0)}{savings > 0 ? ` · ${usd(savings, 0)} under face` : savings < 0 ? ` · ${usd(-savings, 0)} over face` : ''}</span>}
          {p.seats_note && <span className="truncate">🪑 {p.seats_note}</span>}
        </div>
      )}

      {p.why && <p className="mt-2 text-sm text-slate-300">{p.why}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.label}</span>
        <span className={`chip !px-2 !py-0.5 text-[10px] ${p.within_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
          {p.within_budget ? 'Within budget' : 'Over budget'}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <button
          onClick={onWatch}
          disabled={watched}
          className={`btn-ghost !py-2 text-sm whitespace-nowrap ${watched ? 'text-safe' : ''}`}
        >
          {watched ? '✓ Watching' : '☆ Watch'}
        </button>
        <button
          onClick={onGrab}
          disabled={grabbing || blocked}
          title={blocked ? 'I flagged this event for high scam risk — I won’t grab these.' : ''}
          className="btn-primary flex-1 bg-info !py-2 text-sm whitespace-nowrap disabled:opacity-60"
        >
          {blocked ? 'Flagged — blocked' : grabbing ? 'Handing off…' : 'Have Encore grab these'}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ShieldIcon className="h-3 w-3 shrink-0" /> I'll confirm before I spend a cent.
      </div>
    </div>
  )
}

function PickSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-line bg-ink-900/40 p-4">
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
