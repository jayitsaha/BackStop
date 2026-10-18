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
 *   [VerifyDesk]      POST /apps/wander/verify-booking → verdict card.
 *   [ItineraryDesk]   client state (auto-filled from a chosen trip) → api.agentTask({task}).
 *   [ActivityFeed]    customer.runs → RunTimeline (shared).
 *   [InsuranceStrip]  agent.quote → link to /claims.
 *
 * PHASE 3 · BUILD (wired to real structured backend results)
 *   Propose/search/verify call the bespoke /apps/wander/* endpoints, which ground
 *   Wander's REAL system_prompt in ask_json. "Book this" calls the universal
 *   agent-task primitive and renders the honest, insured agent loop. Auto-propose
 *   runs exactly once on mount (ref-guarded), with a retry on error.
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { usd, cents } from '../../lib/format'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'

/* ------------------------------------------------------------------ helpers */
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

function Panel({ eyebrow, title, subtitle, acc = 'safe', right, children, live }) {
  const t = accent(acc)
  return (
    <div className="card relative overflow-hidden p-6">
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
  const [verify, setVerify] = useState(null)
  const [verifying, setVerifying] = useState(false)

  // ---- itinerary / budget state ----
  const [tripBudget, setTripBudget] = useState(defaultBudget * 2)
  const [saved, setSaved] = useState([])

  // ---- booking (agent-task) state ----
  const [booking, setBooking] = useState(false)
  const [bookRun, setBookRun] = useState(null)
  const [bookErr, setBookErr] = useState('')

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
  async function runVerify(e) {
    e?.preventDefault()
    if (!verifyText.trim()) return
    setVerifying(true); setVerify(null)
    try {
      const res = await api.post('/apps/wander/verify-booking', { text_or_link: verifyText })
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

  /* -------------------------------------------------------- book hand-off */
  async function bookItinerary() {
    if (!saved.length) return
    setBooking(true); setBookErr(''); setBookRun(null)
    const lines = saved.map((o) => `- ${o.type.toUpperCase()}: ${o.title} via ${o.provider} — ${usd(o.price_usd)} (${o.itinerary})`).join('\n')
    const task =
      `Please book this travel itinerary for me. Confirm with me before moving any money, verify every ` +
      `provider, and refuse anything that looks like a scam or exceeds my budget of ${usd(tripBudget)}.\n\n` +
      `Itinerary (${saved.length} item${saved.length > 1 ? 's' : ''}, total ${usd(savedTotal)}):\n${lines}\n\n` +
      `Trip: ${form.origin || '?'} → ${form.destination || '?'}, ${form.depart || 'flexible'} to ${form.return || 'open'}, ` +
      `${form.travelers} traveler(s).`
    try {
      const res = await api.agentTask({ task })
      setBookRun(res?.run || null)
    } catch (err) {
      setBookErr(err?.response?.data?.detail || 'Could not reach your agent. Try again.')
    } finally {
      setBooking(false)
    }
  }

  const runs = Array.isArray(customer?.runs) ? customer.runs : []

  return (
    <div className="space-y-6">
      {/* ============================ TRUST / IDENTITY STRIP ============================ */}
      <div className="card relative overflow-hidden p-6">
        <div className="mesh" style={{ top: '-120px', right: '-40px', height: 280, width: 360, background: t.fill }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className={`eyebrow mb-2 ${t.text}`}>
              <span className="text-lg leading-none">✈️</span> Travel concierge desk
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">{name}</h1>
            <p className="mt-2 max-w-xl text-slate-400">{agent?.tagline || 'Book safe, smart travel — no scams, no surprises.'}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured mistakes
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
              <div className={`stat-num text-2xl ${t.text}`}>{cents(quote.gross_premium_usd)}</div>
              <div className="label mt-1">Premium / booking</div>
            </div>
            <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
              <div className="stat-num text-2xl text-white">{usd(quote.per_incident_limit_usd, 0)}</div>
              <div className="label mt-1">Covered per incident</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ HERO: WANDER PROPOSES ============================ */}
      <Panel eyebrow="Wander is on it" title="Trips I scouted for you" acc={acc} live={proposing}
        subtitle={proposals?.intro || "I look for safe, well-priced trips so you don't have to start from a blank page."}
        right={
          !proposing && (
            <button onClick={() => runPropose({ label: null })} className="btn-ghost !py-2 text-sm whitespace-nowrap">
              Scout again
            </button>
          )
        }
      >
        {/* vibe chips the agent suggests */}
        <div className="mb-5 flex flex-wrap gap-2">
          {VIBES.map((v) => (
            <button
              key={v.label}
              onClick={() => runPropose({ budget: v.budget || defaultBudget, vibe: v.vibe, label: v.label })}
              disabled={proposing}
              className={`chip transition ${activeVibe === v.label ? `${t.bg} ${t.text} border-safe/40` : 'hover:border-brand/40 hover:text-white'}`}
            >
              {v.label}
            </button>
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
            <button type="submit" disabled={searching || !dream.trim()} className="btn-primary bg-safe whitespace-nowrap">
              {searching ? 'Thinking…' : <>Ask Wander <ArrowIcon className="h-4 w-4" /></>}
            </button>
          </div>
          <button type="button" onClick={() => setShowRefine((s) => !s)} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
            {showRefine ? '− hide exact fields' : '+ refine with exact dates & budget'}
          </button>
        </form>

        {/* secondary, collapsed refine form */}
        {showRefine && (
          <form onSubmit={runRefine} className="mb-5 animate-fade-up space-y-3 rounded-xl border border-line bg-ink-900/40 p-4">
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
            <button type="submit" disabled={searching} className="btn-ghost !py-2 text-sm">{searching ? 'Searching…' : 'Search these exactly'}</button>
          </form>
        )}

        {/* proposals / skeleton / error */}
        {proposing ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <TripSkeleton key={i} />)}
          </div>
        ) : proposeErr ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
            {proposeErr}
            <button onClick={() => runPropose({ label: activeVibe })} className="ml-3 underline hover:text-white">Retry</button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {(proposals?.trips || []).map((tr, i) => (
              <TripCard key={i} tr={tr} onPick={() => pickTrip(tr)} />
            ))}
            {(proposals?.trips || []).length === 0 && (
              <p className="text-sm text-slate-500">No ideas came back — tap a vibe above or ask me in your own words.</p>
            )}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ============================ SEARCH RESULTS ============================ */}
        <Panel eyebrow="Options I found" title="Search results" acc={acc}
          subtitle="When you ask me in your own words or refine the fields, the matches land here."
        >
          {searchErr && <div className="mb-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{searchErr}</div>}
          {!search && !searching && (
            <p className="text-sm text-slate-500">Ask me where you're dreaming of above and I'll lay out honest, budget-checked options here.</p>
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
                    I'll confirm with you and verify every provider before I spend a cent.
                  </div>
                  <button onClick={bookItinerary} disabled={booking} className="btn-primary w-full bg-brand">
                    {booking ? 'Handing off to Wander…' : `Have Wander book this · ${usd(savedTotal, 0)}`}
                  </button>
                </div>
              )}
              {bookErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{bookErr}</div>}
            </Panel>
          </div>

          {/* -------- VERIFY A BOOKING -------- */}
          <Panel eyebrow="Scam check" title="Verify a booking" acc="info"
            subtitle="Paste a confirmation email, deposit request or link — I'll tell you if it's a scam."
          >
            <form onSubmit={runVerify} className="space-y-3">
              <textarea
                className="inp min-h-[96px] resize-y text-sm"
                placeholder="Paste a booking email, a 'wire a deposit' message, or a link to a booking site…"
                value={verifyText}
                onChange={(e) => setVerifyText(e.target.value)}
              />
              <button type="submit" disabled={verifying || !verifyText.trim()} className="btn-ghost w-full">
                {verifying ? 'Checking…' : 'Check it'}
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

      {/* ============================ BOOKING HAND-OFF RESULT ============================ */}
      {bookRun && (
        <Panel eyebrow="Wander at work" title="Booking hand-off" acc="brand" live>
          <p className="mb-4 text-sm text-slate-400">
            Here's exactly what I did with your itinerary — my live tool-call log and honest report.
            I pause before moving money and tell you what I held and why.
          </p>
          <div className="rounded-xl border border-line bg-ink-900/40 p-4">
            <RunTimeline run={bookRun} agent={name} />
          </div>
        </Panel>
      )}

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
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.bg} ${t.text}`}><ShieldIcon className="h-5 w-5" /></span>
          <div>
            <div className="font-display text-base text-white">Every booking is insured</div>
            <div className="text-sm text-slate-400">
              If a covered mistake slips through, you're protected up to {usd(quote.per_incident_limit_usd, 0)} per incident. File a claim and Backstop adjudicates it.
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

function TripCard({ tr, onPick }) {
  const r = RISK[tr.scam_risk] || RISK.none
  return (
    <div className="flex flex-col rounded-xl border border-line bg-ink-900/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-lg text-white">{tr.destination}</div>
          {tr.headline && <div className="mt-0.5 truncate text-xs text-slate-400">{tr.headline}</div>}
        </div>
        <span className="stat-num shrink-0 text-right text-base text-white">{usd(tr.total_estimate_usd, 0)}<div className="label !text-[9px]">/ person</div></span>
      </div>
      {(tr.depart || tr.origin) && (
        <div className="mt-2 text-xs text-slate-500">
          {tr.origin ? `${tr.origin} · ` : ''}{tr.depart}{tr.return ? ` → ${tr.return}` : ''}{tr.travelers ? ` · ${tr.travelers} traveler(s)` : ''}
        </div>
      )}
      {tr.why && <p className="mt-2 text-sm text-slate-300">{tr.why}</p>}

      <div className="mt-3 space-y-1">
        {(tr.options || []).map((o, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs text-slate-400">
            <span className="min-w-0 truncate">{TYPE_ICON[o.type] || '🧳'} {o.title} <span className="text-slate-600">· {o.provider}</span></span>
            <span className="shrink-0 text-slate-300">{usd(o.price_usd, 0)}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />{r.label}</span>
        <span className={`chip !px-2 !py-0.5 text-[10px] ${tr.within_budget ? 'border-safe/30 bg-safe/10 text-safe' : 'border-warn/30 bg-warn/10 text-warn'}`}>
          {tr.within_budget ? 'Within budget' : 'Over budget'}
        </span>
      </div>

      <button onClick={onPick} className="btn-primary mt-4 w-full bg-safe !py-2 text-sm">I'd book this →</button>
    </div>
  )
}

function OptionRow({ o, saved, onSave }) {
  const r = RISK[o.scam_risk] || RISK.none
  return (
    <div className={`rounded-xl border p-3.5 ${o.scam_risk === 'high' ? 'border-bad/40 bg-bad/5' : 'border-line bg-ink-900/40'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span>{TYPE_ICON[o.type] || '🧳'}</span><span className="truncate">{o.title}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{o.provider} · {o.itinerary}</div>
          {o.notes && <div className="mt-1 text-xs text-slate-400">{o.notes}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="stat-num text-lg text-white">{usd(o.price_usd, 0)}</div>
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
          className="ml-auto text-xs font-semibold text-safe hover:text-white disabled:text-slate-600"
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
