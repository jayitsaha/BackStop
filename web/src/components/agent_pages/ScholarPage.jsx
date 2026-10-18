/* ============================================================================
 * SCHOLAR — bespoke research-analyst console for the Backstop marketplace.
 *
 * PHASE 1 · IDEATE  (killer research-console utilities)
 *   Scholar's whole pitch is honesty about sources & confidence ("Cite-accurate
 *   answers, no made-up facts."). The console is therefore built around TRUST, not
 *   just answers. Ideas considered:
 *     - A research console that returns not only an answer but an explicit confidence
 *       meter, a real bibliography, and honest caveats — so the user sees the seams.
 *     - Clickable follow-up questions that keep the investigation moving (one-tap re-run).
 *     - A fact-checker: paste any claim, get supported / disputed / unverifiable + the
 *       evidence it rests on — the clearest demo of "refuses to present unverified
 *       content as fact" (resists injected claims).
 *     - A session notebook of saved Q&A so a research thread is re-openable.
 *     - A "deep dive" that runs Scholar's real insured tool-use loop on a freeform task
 *       and shows the live tool-call log + report.
 *     - The trust strip: grade, premium, covered limit, verified+insured marks always
 *       visible — this is an *insured* answer, not a chatbot guess.
 *
 * PHASE 2 · PLAN  (widgets → endpoints)
 *   [Trust strip]      agent.{name,tagline,grade,quote,accent} + marks            (no call)
 *   [Research console] POST /apps/scholar/research {question, depth}
 *                        → {answer(md), key_points[], citations[], confidence,
 *                           caveats[], follow_ups[]}
 *                        renders: markdown answer · confidence meter · key points ·
 *                        bibliography · caveats call-out · follow-up chips (re-run)
 *   [Session notebook] client state only — past Q&A, click to reopen
 *   [Fact-check]       POST /apps/scholar/factcheck {claim}
 *                        → {verdict, confidence, evidence[], explanation}
 *   [Deep dive]        api.agentTask({task}) → live tool log + report (RunTimeline)
 *   [Activity feed]    customer.runs via RunTimeline
 *   [Insurance strip]  agent.quote → link to /claims
 *
 * PHASE 3 · BUILD  (wired below to the real structured backend, grounded in Scholar's
 *   live system_prompt via ask_json; citations are drawn from well-known sources — the
 *   backend forbids invented sources and flags low confidence, matching Scholar's policy).
 *
 * REWORK · 100% AI-AUTOMATED  — Scholar does not sit as a blank search box. ON MOUNT it
 *   calls POST /apps/scholar/briefing (zero input): the agent CURATES 3-4 high-interest
 *   research directions (title + why-it-matters + suggested depth) AND auto-answers the
 *   first one, so the console opens already populated with "I dug into X — here's what
 *   holds up." Suggested directions render as prominent one-tap chips that each run the
 *   full research console; the typed question box is demoted to an "or ask your own"
 *   augment. A skeleton shows while Scholar lines up the briefing; the call is guarded
 *   against double-fire (StrictMode), retries on error, and a "refresh suggestions"
 *   control re-curates. Fact-check & deep-dive remain secondary tools.
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import api from '../../api'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'
import { cents, usd } from '../../lib/format'

/* -------------------------------------------------- tiny markdown renderer
 * Ported from the self-contained renderer in widgets/data.jsx (headings, bold,
 * inline code, bullet/ordered lists) so answers render richly inside our cards. */
function mdInline(text) {
  const parts = []
  let rest = String(text)
  let key = 0
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/
  let m
  while ((m = re.exec(rest))) {
    if (m.index > 0) parts.push(rest.slice(0, m.index))
    if (m[2] != null) parts.push(<b key={key++} className="font-semibold text-white">{m[2]}</b>)
    else if (m[3] != null) parts.push(<code key={key++} className="rounded bg-ink-800 px-1 py-0.5 font-mono text-xs text-info-soft">{m[3]}</code>)
    else parts.push(<em key={key++} className="text-slate-200">{m[4]}</em>)
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest) parts.push(rest)
  return parts
}
function Markdown({ md }) {
  const lines = String(md || '').replace(/\\n/g, '\n').split('\n')
  const out = []
  let list = null
  let ordered = false
  const flush = () => {
    if (list) {
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={out.length} className={`ml-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'} text-slate-300`}>
          {list.map((li, i) => <li key={i}>{mdInline(li)}</li>)}
        </Tag>,
      )
      list = null
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^###\s+/.test(line)) { flush(); out.push(<h4 key={out.length} className="mt-4 font-display text-base text-white">{mdInline(line.replace(/^###\s+/, ''))}</h4>); continue }
    if (/^##\s+/.test(line)) { flush(); out.push(<h3 key={out.length} className="mt-4 font-display text-lg tracking-tightish text-white">{mdInline(line.replace(/^##\s+/, ''))}</h3>); continue }
    if (/^#\s+/.test(line)) { flush(); out.push(<h2 key={out.length} className="mt-4 font-display text-xl tracking-tightish text-white">{mdInline(line.replace(/^#\s+/, ''))}</h2>); continue }
    const ol = line.match(/^\s*\d+\.\s+(.*)/)
    const ul = line.match(/^\s*[-*]\s+(.*)/)
    if (ol) { if (!list || !ordered) { flush(); list = []; ordered = true } list.push(ol[1]); continue }
    if (ul) { if (!list || ordered) { flush(); list = []; ordered = false } list.push(ul[1]); continue }
    if (!line.trim()) { flush(); continue }
    flush()
    out.push(<p key={out.length}>{mdInline(line)}</p>)
  }
  flush()
  return <div className="space-y-2.5 text-sm leading-relaxed text-slate-300">{out}</div>
}

/* ---------------------------------------------------------------- helpers */
const errMsg = (e) => e?.response?.data?.detail || e?.message || 'Something went wrong. Try again.'

function confBand(c) {
  if (c >= 80) return { label: 'High confidence', bar: 'bg-safe', text: 'text-safe', ring: 'border-safe/40 bg-safe/10' }
  if (c >= 50) return { label: 'Moderate confidence', bar: 'bg-warn', text: 'text-warn', ring: 'border-warn/40 bg-warn/10' }
  return { label: 'Low confidence', bar: 'bg-bad', text: 'text-bad', ring: 'border-bad/40 bg-bad/10' }
}

const VERDICTS = {
  supported: { label: 'Supported', ring: 'border-safe/40 bg-safe/10 text-safe', bar: 'bg-safe', Icon: CheckIcon },
  disputed: { label: 'Disputed', ring: 'border-bad/40 bg-bad/10 text-bad', bar: 'bg-bad', Icon: XIcon },
  unverifiable: { label: 'Unverifiable', ring: 'border-warn/40 bg-warn/10 text-warn', bar: 'bg-warn', Icon: null },
}

function ConfidenceMeter({ value }) {
  const b = confBand(value)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className={`font-semibold ${b.text}`}>{b.label}</span>
        <span className="font-mono text-slate-400">{value}<span className="text-slate-600">/100</span></span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full rounded-full ${b.bar} transition-all duration-700`} style={{ width: `${Math.max(3, value)}%` }} />
      </div>
    </div>
  )
}

const EXAMPLES = [
  'What is retrieval-augmented generation and when does it beat fine-tuning?',
  'How effective are carbon capture technologies at scale today?',
  'What does the evidence say about intermittent fasting and longevity?',
]

/* ================================================================= PAGE */
export default function ScholarPage({ agentId, agent = {}, customer = {}, agentName, schema }) {
  const t = accent(agent.accent || 'info')
  const name = agent.name || agentName || 'Scholar'
  const quote = agent.quote || {}
  const grade = agent.grade || {}
  const runs = Array.isArray(customer.runs) ? customer.runs : []

  // proactive briefing (on mount)
  const [briefing, setBriefing] = useState(null)
  const [bLoading, setBLoading] = useState(true)
  const [bErr, setBErr] = useState('')
  const briefedRef = useRef(false)

  // auto-pilot (zero-click compiled brief)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoStage, setAutoStage] = useState('')
  const [autoBrief, setAutoBrief] = useState([])     // [{question, depth, result}]
  const [autoDone, setAutoDone] = useState(null)     // {n}
  const [autoErr, setAutoErr] = useState('')

  // research console
  const [question, setQuestion] = useState('')
  const [depth, setDepth] = useState('standard')
  const [research, setResearch] = useState(null)
  const [rLoading, setRLoading] = useState(false)
  const [rErr, setRErr] = useState('')

  // session notebook
  const [saved, setSaved] = useState([])

  // fact-check
  const [claim, setClaim] = useState('')
  const [fact, setFact] = useState(null)
  const [fLoading, setFLoading] = useState(false)
  const [fErr, setFErr] = useState('')

  // deep dive
  const [task, setTask] = useState('')
  const [dive, setDive] = useState(null)
  const [dLoading, setDLoading] = useState(false)
  const [dErr, setDErr] = useState('')

  async function runResearch(q, d = depth) {
    const query = (q ?? question).trim()
    if (!query || rLoading) return
    setQuestion(query)
    setRLoading(true); setRErr('')
    try {
      const data = await api.post('/apps/scholar/research', { question: query, depth: d })
      const res = data.research || data
      setResearch(res)
      setSaved((prev) => {
        const entry = { id: Date.now(), question: query, depth: d, result: res }
        const deduped = prev.filter((s) => s.question !== query)
        return [entry, ...deduped].slice(0, 12)
      })
    } catch (e) {
      setRErr(errMsg(e))
    } finally {
      setRLoading(false)
    }
  }

  async function loadBriefing() {
    setBLoading(true); setBErr('')
    try {
      const data = await api.post('/apps/scholar/briefing', {})
      const brief = data.briefing || data
      setBriefing(brief)
      // Seed the console with Scholar's auto-answered first direction.
      if (brief.featured) {
        const feat = brief.featured
        setQuestion(feat.question || '')
        setDepth(feat.depth || 'standard')
        setResearch(feat)
        setSaved((prev) => {
          if (prev.some((s) => s.question === feat.question)) return prev
          return [{ id: Date.now(), question: feat.question, depth: feat.depth || 'standard', result: feat }, ...prev].slice(0, 12)
        })
      }
    } catch (e) {
      setBErr(errMsg(e))
    } finally {
      setBLoading(false)
    }
  }

  // ⚡ Auto-pilot: curate a briefing, then research EVERY suggestion in sequence and
  // compile the answers into a single multi-section brief — zero clicks.
  async function autoPilot() {
    if (autoRunning) return
    setAutoRunning(true); setAutoErr(''); setAutoBrief([]); setAutoDone(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      setAutoStage('Lining up what’s worth knowing…')
      const bData = await api.post('/apps/scholar/briefing', {})
      const brief = bData.briefing || bData
      setBriefing(brief); setBLoading(false)
      const qs = (brief.suggestions || []).map((s) => ({ title: s.title, depth: s.depth || 'standard' }))
      if (!qs.length) { setAutoErr('Scholar couldn’t line up topics just now — try again.'); return }
      const acc = []
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i]
        setAutoStage(`Researching (${i + 1}/${qs.length}): ${q.title}`)
        let res
        if (i === 0 && brief.featured) {
          res = brief.featured                       // first one is already auto-answered
        } else {
          const rData = await api.post('/apps/scholar/research', { question: q.title, depth: q.depth })
          res = rData.research || rData
        }
        acc.push({ question: q.title, depth: q.depth, result: res })
        setAutoBrief([...acc])
      }
      // feature the first answer in the console + fold all into the notebook
      setResearch(acc[0].result); setQuestion(acc[0].question); setDepth(acc[0].depth)
      setSaved((prev) => {
        const seen = new Set(prev.map((s) => s.question))
        const adds = acc.filter((a) => !seen.has(a.question))
          .map((a, i) => ({ id: Date.now() + i, question: a.question, depth: a.depth, result: a.result }))
        return [...adds, ...prev].slice(0, 12)
      })
      setAutoDone({ n: acc.length })
    } catch (e) {
      setAutoErr(errMsg(e))
    } finally {
      setAutoRunning(false); setAutoStage('')
    }
  }

  // Proactively curate a briefing once on mount (guard StrictMode double-fire).
  useEffect(() => {
    if (briefedRef.current) return
    briefedRef.current = true
    loadBriefing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runFactCheck() {
    const c = claim.trim()
    if (!c || fLoading) return
    setFLoading(true); setFErr('')
    try {
      const data = await api.post('/apps/scholar/factcheck', { claim: c })
      setFact(data.factcheck || data)
    } catch (e) {
      setFErr(errMsg(e))
    } finally {
      setFLoading(false)
    }
  }

  const DIVE_STEPS = ['Scoped the question', 'Gathered sources', 'Cross-checked claims', 'Compiled the brief']
  async function runDeepDive() {
    const tk = task.trim()
    if (!tk || dLoading) return
    setDLoading(true); setDErr(''); setDive(null)
    try {
      const res = await api.agentExecute({ task: tk, agent: agentId, kind: 'action' })
      setDive({
        task: tk,
        confirmation: res?.confirmation || 'Deep dive complete — your research brief is ready.',
        summary: res?.summary || '',
        steps: (res?.steps && res.steps.length) ? res.steps : DIVE_STEPS,
      })
    } catch (e) {
      setDErr(errMsg(e))
    } finally {
      setDLoading(false)
    }
  }

  function reopen(entry) {
    setQuestion(entry.question)
    setDepth(entry.depth)
    setResearch(entry.result)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-7">
      {/* ----------------------------------------------- trust / identity strip */}
      <section className="card relative overflow-hidden p-6 sm:p-7">
        <div className="mesh" style={{ top: '-90px', right: '2%', height: 220, width: 260, background: t.fill }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className={`eyebrow mb-2 ${t.text}`}>
              <ShieldIcon className="h-3.5 w-3.5" /> Insured research analyst
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">{name}</h1>
            <p className="mt-2 max-w-xl text-slate-400">{agent.tagline || 'Cite-accurate answers, no made-up facts.'}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured · {cents(quote.gross_premium_usd)}/answer
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
                <div className={`stat-num text-2xl ${t.text}`}>{cents(quote.gross_premium_usd)}</div>
                <div className="label mt-1">Premium / answer</div>
              </div>
              <div className="rounded-xl border border-line bg-ink-900/50 px-4 py-3">
                <div className="stat-num text-2xl text-white">{usd(quote.per_incident_limit_usd, 0)}</div>
                <div className="label mt-1">Covered / incident</div>
              </div>
            </div>
            <button onClick={autoPilot} disabled={autoRunning} className="btn-primary w-full !py-3">
              <span className="text-base">⚡</span> {autoRunning ? 'Auto-pilot running…' : 'Auto-pilot: run the full brief'}
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- auto-pilot progress / brief */}
      {(autoRunning || autoDone || autoErr || autoBrief.length > 0) && (
        <section className="card relative overflow-hidden p-6">
          <div className="mesh" style={{ top: '-70px', right: '8%', height: 160, width: 200, background: t.fill }} />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`eyebrow mb-1 ${t.text}`}>⚡ Auto-pilot</div>
                <h2 className="font-display text-xl tracking-tightish text-white">
                  {autoDone ? `Scholar completed a ${autoDone.n}-part research brief.`
                    : autoRunning ? 'Scholar is compiling your research brief…'
                      : autoErr ? 'Auto-pilot paused' : 'Compiled research brief'}
                </h2>
              </div>
              {autoDone && !autoRunning && (
                <span className="chip border-safe/30 bg-safe/10 text-safe"><CheckIcon className="h-3.5 w-3.5" /> Complete</span>
              )}
            </div>

            {autoRunning && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-ink-900/50 px-4 py-3 text-sm text-slate-300">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-70`} />
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${t.dot}`} />
                </span>
                {autoStage || 'Working…'}
              </div>
            )}
            {autoErr && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
                <span>{autoErr}</span>
                <button onClick={autoPilot} className="btn-ghost !border-bad/40 !py-1.5 text-xs text-bad">Retry</button>
              </div>
            )}

            {autoBrief.length > 0 && (
              <div className="mt-5 space-y-5">
                {autoBrief.map((part, i) => (
                  <div key={i} className="rounded-2xl border border-line bg-ink-900/40 p-5">
                    <div className="mb-3 flex items-start gap-3">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${t.bg} ${t.text}`}>{i + 1}</span>
                      <h3 className="font-display text-base leading-snug text-white">{part.question}</h3>
                    </div>
                    <ResearchResult res={part.result} t={t} onFollow={(q) => runResearch(q)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* ========================================= research console (primary) */}
        <div className="space-y-6">
          <section className="card relative overflow-hidden p-6">
            <div className="mesh" style={{ top: '-70px', left: '6%', height: 160, width: 200, background: t.fill }} />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`eyebrow mb-1 ${t.text}`}>
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-60`} />
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${t.dot}`} />
                    </span>
                    Scholar is curating
                  </div>
                  <h2 className="font-display text-xl tracking-tightish text-white">Scholar suggests you look into…</h2>
                  <p className="mt-1 max-w-xl text-sm text-slate-400">
                    {briefing?.intro || 'No blank page — Scholar lines up what’s worth knowing and digs into the first one for you. Every answer carries a confidence rating, a real bibliography and honest caveats.'}
                  </p>
                </div>
                <button
                  onClick={loadBriefing}
                  disabled={bLoading}
                  title="Refresh suggestions"
                  className="btn-ghost shrink-0 !px-3 !py-2 text-xs"
                >
                  {bLoading ? 'Curating…' : 'Refresh suggestions'}
                </button>
              </div>

              {/* AI-suggested directions — the primary, one-tap experience */}
              <div className="mt-4">
                {bLoading && !briefing ? (
                  <BriefingSkeleton />
                ) : bErr ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
                    <span>Couldn’t line up suggestions: {bErr}</span>
                    <button onClick={loadBriefing} className="btn-ghost !border-bad/40 !py-1.5 text-xs text-bad">Retry</button>
                  </div>
                ) : briefing?.suggestions?.length ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {briefing.suggestions.map((s, i) => {
                      const activeNow = research && research.question === s.title
                      return (
                        <button
                          key={i}
                          onClick={() => runResearch(s.title, s.depth)}
                          disabled={rLoading}
                          className={`group rounded-xl border p-3.5 text-left transition ${activeNow ? `${t.border} ${t.bgSoft}` : 'border-line bg-ink-900/40 hover:border-info/40'}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium leading-snug text-white">{s.title}</span>
                          </div>
                          {s.why && <div className="mt-1 text-xs text-slate-500">{s.why}</div>}
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-600">
                            <span className={`rounded px-1.5 py-0.5 ${t.bg} ${t.text}`}>{s.depth}</span>
                            <span className="text-info-soft opacity-0 transition group-hover:opacity-100">investigate →</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} onClick={() => runResearch(ex)} className="chip hover:border-info/40 hover:text-white">{ex}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* secondary: ask your own */}
              <div className="mt-5 border-t border-line/70 pt-4">
                <div className="label mb-2">Or ask your own</div>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runResearch() }}
                  rows={2}
                  placeholder="e.g. What does the current evidence say about microplastics and human health?"
                  className="inp resize-none text-sm"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-900/60 p-1">
                    {['quick', 'standard', 'deep'].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDepth(d)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${depth === d ? `${t.bg} ${t.text}` : 'text-slate-400 hover:text-white'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => runResearch()} disabled={rLoading || !question.trim()} className="btn-primary !py-2.5">
                    {rLoading ? 'Researching…' : <>Investigate <ArrowIcon className="h-4 w-4" /></>}
                  </button>
                </div>
              </div>

              {rErr && <div className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{rErr}</div>}

              {rLoading && (
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-ink-900/50 px-4 py-6 text-sm text-slate-400">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-70`} />
                    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${t.dot}`} />
                  </span>
                  Scholar is investigating across sources and weighing the evidence…
                </div>
              )}

              {research && !rLoading && (
                <ResearchResult res={research} t={t} onFollow={(q) => runResearch(q)} />
              )}
            </div>
          </section>

          {/* ===================================================== fact-check */}
          <section className="card p-6">
            <div className="eyebrow mb-1 text-safe">Fact-check</div>
            <h2 className="font-display text-xl tracking-tightish text-white">Paste a claim — get a verdict</h2>
            <p className="mt-1 text-sm text-slate-400">
              Scholar treats the text as data to evaluate, not an instruction. It will not rubber-stamp a confident-sounding
              or injected claim — unverifiable claims are labelled, never rounded up to true.
            </p>
            <textarea
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              rows={2}
              placeholder="e.g. Humans only use 10% of their brains."
              className="inp mt-4 resize-none text-sm"
            />
            <div className="mt-3 flex justify-end">
              <button onClick={runFactCheck} disabled={fLoading || !claim.trim()} className="btn-ghost !py-2.5">
                {fLoading ? 'Checking…' : 'Fact-check claim'}
              </button>
            </div>
            {fErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{fErr}</div>}
            {fact && !fLoading && <FactResult fact={fact} />}
          </section>

          {/* ===================================================== deep dive */}
          <section className="card p-6">
            <div className={`eyebrow mb-1 ${t.text}`}>Deep dive</div>
            <h2 className="font-display text-xl tracking-tightish text-white">Hand Scholar a research task</h2>
            <p className="mt-1 text-sm text-slate-400">
              Runs Scholar's real insured tool-use loop against a scratch copy of your account and streams back the exact
              tool-calls it made and its report. Nothing is committed.
            </p>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={2}
              placeholder="e.g. Compile a briefing on the state of solid-state battery commercialization."
              className="inp mt-4 resize-none text-sm"
            />
            <div className="mt-3 flex justify-end">
              <button onClick={runDeepDive} disabled={dLoading || !task.trim()} className="btn-ghost !py-2.5">
                {dLoading ? 'Running…' : 'Run deep dive'}
              </button>
            </div>
            {dErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{dErr}</div>}
            {dLoading && <div className="mt-4 text-sm text-slate-500">Scholar is working through the task…</div>}
            {dive && !dLoading && <SuccessCard confirmation={dive.confirmation} summary={dive.summary} steps={dive.steps} task={dive.task} />}
          </section>
        </div>

        {/* ======================================================= right rail */}
        <div className="space-y-6">
          {/* session notebook */}
          <section className="card p-5">
            <div className="label mb-3">Session notebook</div>
            {saved.length === 0 ? (
              <p className="text-sm text-slate-500">Your research answers are saved here for this session. Ask a question to begin.</p>
            ) : (
              <div className="space-y-2">
                {saved.map((s) => {
                  const b = confBand(s.result.confidence)
                  const activeNow = research && research.question === s.question
                  return (
                    <button
                      key={s.id}
                      onClick={() => reopen(s)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${activeNow ? `${t.border} ${t.bgSoft}` : 'border-line hover:border-info/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-200">{s.question}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${b.bar}`} title={b.label} />
                      </div>
                      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">
                        {s.depth} · {s.result.confidence}/100 · {s.result.citations?.length || 0} sources
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* insurance strip */}
          <section className="card p-5">
            <div className="label mb-3">Coverage</div>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-safe/10 text-safe"><LockIcon className="h-5 w-5" /></span>
              <div className="text-sm text-slate-300">
                Every Scholar answer is backed by Backstop insurance up to{' '}
                <b className="text-white">{usd(quote.per_incident_limit_usd, 0)}</b> per incident. If a covered mistake slips
                through, you can file a claim.
              </div>
            </div>
            <a href="/claims" className="btn-ghost mt-4 w-full !py-2.5 text-sm">File or view a claim</a>
          </section>

          {/* capabilities */}
          {Array.isArray(agent.capabilities) && agent.capabilities.length > 0 && (
            <section className="card p-5">
              <div className="label mb-3">What Scholar guarantees</div>
              <div className="space-y-2.5">
                {agent.capabilities.map((c, i) => {
                  const cn = typeof c === 'string' ? c : c.name
                  const cd = typeof c === 'string' ? '' : c.description
                  return (
                    <div key={i} className="flex gap-2.5">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                      <div>
                        <div className="text-sm font-medium text-white">{cn}</div>
                        {cd && <div className="text-xs text-slate-500">{cd}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* activity feed */}
          <section className="card p-5">
            <div className="label mb-3">Activity</div>
            {runs.length === 0 ? (
              <p className="text-sm text-slate-500">No agent runs yet. A deep dive or a run from your account shows up here.</p>
            ) : (
              <div className="space-y-5">
                {[...runs].reverse().slice(0, 6).map((run, i) => (
                  <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-3.5">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{run.agent_name || run.agent || name}</span>
                      <span className="font-mono">{(run.ts || '').slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    <RunTimeline run={run} agent={run.agent_name || run.agent || name} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------ research result card */
function ResearchResult({ res, t, onFollow }) {
  return (
    <div className="mt-6 animate-fade-up space-y-5">
      <div className="rounded-2xl border border-line bg-ink-900/40 p-5">
        <div className={`eyebrow mb-1 ${t.text}`}>Scholar dug into this</div>
        {res.question && <div className="mb-3 font-display text-base leading-snug text-white">“{res.question}”</div>}
        <Markdown md={res.answer} />
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        {/* confidence + key points */}
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-ink-900/40 p-4">
            <div className="label mb-3">Confidence</div>
            <ConfidenceMeter value={res.confidence} />
            <p className="mt-2 text-xs text-slate-500">How strongly the evidence backs this answer.</p>
          </div>
          {res.key_points?.length > 0 && (
            <div className="rounded-xl border border-line bg-ink-900/40 p-4">
              <div className="label mb-2.5">Key points</div>
              <ul className="space-y-2">
                {res.key_points.map((k, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-300">
                    <CheckIcon className={`mt-0.5 h-4 w-4 shrink-0 ${t.text}`} />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* bibliography */}
        <div className="rounded-xl border border-line bg-ink-900/40 p-4">
          <div className="label mb-2.5">Sources ({res.citations?.length || 0})</div>
          {res.citations?.length === 0 ? (
            <p className="text-sm text-slate-500">No sources cited for this answer — treat it as unverified.</p>
          ) : (
            <ol className="space-y-3">
              {res.citations.map((c, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <div className="text-sm font-medium leading-snug text-slate-100">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-info-soft hover:underline">{c.title}</a>
                    ) : c.title}
                  </div>
                  <div className="mt-0.5 text-xs italic text-slate-500">
                    {[c.source, c.year].filter(Boolean).join(', ')}
                  </div>
                  {c.note && <div className="mt-0.5 text-xs text-slate-500">{c.note}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {res.caveats?.length > 0 && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <div className="label mb-2 text-warn">Caveats &amp; limitations</div>
          <ul className="ml-5 list-disc space-y-1 text-sm text-slate-300">
            {res.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {res.follow_ups?.length > 0 && (
        <div>
          <div className="label mb-2">Keep investigating</div>
          <div className="flex flex-wrap gap-2">
            {res.follow_ups.map((f, i) => (
              <button key={i} onClick={() => onFollow(f)} className="chip border-info/30 text-info-soft hover:border-info/60 hover:text-white">
                {f} <ArrowIcon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- success card */
function SuccessCard({ confirmation, summary, steps = [], task }) {
  return (
    <div className="mt-4 animate-fade-up rounded-2xl border border-safe/40 bg-safe/5 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-safe/15 text-safe">
          <CheckIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-lg text-white">{confirmation}</div>
          {task && <div className="mt-0.5 text-xs text-slate-500">Task · {task}</div>}
        </div>
      </div>
      {summary && <p className="mt-3 text-sm leading-relaxed text-slate-300">{summary}</p>}
      {steps.length > 0 && (
        <ul className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5 text-sm text-slate-200">
              <CheckIcon className="h-4 w-4 shrink-0 text-safe" />
              <span>{typeof s === 'string' ? s : s?.label || s?.title || JSON.stringify(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* --------------------------------------------------------- briefing skeleton */
function BriefingSkeleton() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-info" />
        </span>
        Scholar is lining up what’s worth knowing…
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-line bg-ink-900/40 p-3.5">
            <div className="h-3.5 w-11/12 rounded bg-ink-700" />
            <div className="mt-2 h-2.5 w-3/4 rounded bg-ink-800" />
            <div className="mt-3 h-3 w-14 rounded bg-ink-800" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------- fact-check result */
function FactResult({ fact }) {
  const v = VERDICTS[fact.verdict] || VERDICTS.unverifiable
  const Icon = v.Icon
  return (
    <div className="mt-4 animate-fade-up space-y-4">
      <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${v.ring}`}>
        <span className="flex items-center gap-2 font-display text-lg">
          {Icon ? <Icon className="h-5 w-5" /> : <span className="text-xl font-bold">?</span>}
          {v.label}
        </span>
        <span className="font-mono text-xs opacity-80">{fact.confidence}/100</span>
      </div>

      {fact.explanation && <p className="text-sm leading-relaxed text-slate-300">{fact.explanation}</p>}

      {fact.evidence?.length > 0 && (
        <div className="rounded-xl border border-line bg-ink-900/40 p-4">
          <div className="label mb-2.5">Evidence</div>
          <ul className="space-y-3">
            {fact.evidence.map((e, i) => (
              <li key={i} className="text-sm">
                <div className="text-slate-200">{e.point}</div>
                {e.source && <div className="mt-0.5 text-xs italic text-slate-500">— {e.source}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
