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
import { motion, AnimatePresence } from 'framer-motion'
import api from '../../api'
import { accent, RunTimeline } from '../widgets/shared.jsx'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'
import { cents, usd } from '../../lib/format'
import { Reveal, Stagger, stagItem, Tactile } from '../../components/ui/motion.jsx'
import DotField from '../../components/ui/DotField.jsx'
import { GlowBackdrop, GoldRule } from '../../components/ui/Backdrop.jsx'

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

  const gradeLabel = grade?.grade ? `GRADE ${String(grade.grade).toUpperCase()}` : 'UNGRADED'

  return (
    <div className="space-y-8">
      {/* ===================================================== editorial hero */}
      <section className="card-raised relative overflow-hidden px-6 py-10 sm:px-9 md:px-11 md:py-14">
        {/* warm ambient backdrop: mocha glow + dot-matrix field + vignette */}
        <GlowBackdrop intensity={1.1} />
        {/* a quiet margin of dots along the top edge, like a printed register */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60"
          style={{ maskImage: 'linear-gradient(180deg,#000,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000,transparent)' }}
          aria-hidden
        >
          <DotField cell={8} speed={0.05} opacity={0.5} />
        </div>

        <div className="relative mx-auto max-w-5xl">
          <Reveal as="div" y={10}>
            <span className="eyebrow !font-mono !tracking-[0.3em]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              Research&nbsp;·&nbsp;{gradeLabel}
            </span>
          </Reveal>

          <Reveal as="h1" delay={0.06} y={22} className="mt-6 font-display text-6xl font-semibold leading-[0.85] tracking-tighter3 text-white md:text-[7.5rem]">
            {name}<span className="text-gold">.</span>
          </Reveal>

          <Reveal as="div" delay={0.12} className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-display text-xl italic text-brand-soft md:text-2xl">the insured reading desk</p>
            <span className="handwriting text-base text-brand-soft/70">no made-up facts.</span>
          </Reveal>

          <Reveal as="p" delay={0.16} className="mt-5 max-w-2xl text-base leading-[1.75] text-slate-300">
            {agent.tagline || 'Cite-accurate answers you can stand behind — every finding carries a confidence rating, a real bibliography and the caveats most chatbots quietly drop.'}
          </Reveal>

          <Reveal delay={0.2} className="mt-6 flex flex-wrap items-center gap-2">
            <VerifiedMark />
            <GradePill grade={grade.grade} score={grade.score} />
            <span className="chip border-safe/30 bg-safe/10 text-safe">
              <LockIcon className="h-3.5 w-3.5" /> Insured · {cents(quote.gross_premium_usd)}/answer
            </span>
            <span className="chip border-brand/30 bg-brand/5 !font-mono text-[11px] text-brand-soft">cite-first · caveats shown</span>
          </Reveal>

          <Reveal delay={0.26} className="mt-8">
            <GoldRule />
          </Reveal>

          {/* reading-room stats band — figures in mono */}
          <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
            <Stagger className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4" gap={0.07}>
              <HeroStat label="Premium / answer" value={cents(quote.gross_premium_usd)} tone="text-brand-soft" />
              <HeroStat label="Covered / incident" value={usd(quote.per_incident_limit_usd, 0)} tone="text-safe" />
              <HeroStat label="Crash grade" value={grade?.grade || '—'} tone="text-gold" />
              <HeroStat label="Grade score" value={grade?.score != null ? String(grade.score) : '—'} tone="text-white" />
            </Stagger>
            <Reveal delay={0.32} className="w-full sm:w-auto">
              <Tactile onClick={autoPilot} disabled={autoRunning} className="btn-primary w-full !py-3 sm:w-auto">
                <span className="text-base">⚡</span> {autoRunning ? 'Auto-pilot running…' : 'Auto-pilot: run the full brief'}
              </Tactile>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- auto-pilot progress / brief */}
      <AnimatePresence>
        {(autoRunning || autoDone || autoErr || autoBrief.length > 0) && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="card-raised relative overflow-hidden p-6 sm:p-8"
          >
            <div className="mesh" style={{ top: '-80px', right: '6%', height: 180, width: 220, background: 'rgba(196,85,45,0.16)' }} />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow mb-2 !font-mono">⚡ Auto-pilot&nbsp;·&nbsp;compiled brief</div>
                  <h2 className="font-display text-3xl leading-[0.95] tracking-tighter2 text-white">
                    {autoDone ? `A ${autoDone.n}-part research brief.`
                      : autoRunning ? 'Compiling your research brief…'
                        : autoErr ? 'Auto-pilot paused.' : 'Compiled research brief.'}
                  </h2>
                  <p className="handwriting mt-2 text-sm text-brand-soft/70">Scholar read the room so you don’t start from a blank page.</p>
                </div>
                {autoDone && !autoRunning && (
                  <span className="chip border-safe/30 bg-safe/10 text-safe"><CheckIcon className="h-3.5 w-3.5" /> Complete</span>
                )}
              </div>

              <GoldRule className="mt-5" />

              {autoRunning && (
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-ink-900/50 px-4 py-3 text-sm text-slate-300">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                  </span>
                  {autoStage || 'Working…'}
                </div>
              )}
              {autoErr && (
                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
                  <span>{autoErr}</span>
                  <button onClick={autoPilot} className="btn-ghost !border-bad/40 !py-1.5 text-xs text-bad">Retry</button>
                </div>
              )}

              {autoBrief.length > 0 && (
                <Stagger className="mt-6 space-y-5" gap={0.08}>
                  {autoBrief.map((part, i) => (
                    <motion.div key={i} variants={stagItem} className="rounded-2xl border border-line bg-ink-900/40 p-5 sm:p-6">
                      <div className="mb-3 flex items-start gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-brand/30 bg-brand/10 font-mono text-sm text-brand-soft">{i + 1}</span>
                        <h3 className="font-display text-lg leading-snug tracking-tightish text-white">{part.question}</h3>
                      </div>
                      <ResearchResult res={part.result} t={t} onFollow={(q) => runResearch(q)} />
                    </motion.div>
                  ))}
                </Stagger>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        {/* ========================================= research console (primary) */}
        <div className="space-y-6">
          <Reveal as="section" className="card-raised relative overflow-hidden p-6 sm:p-7">
            <div className="mesh" style={{ top: '-70px', left: '4%', height: 170, width: 210, background: 'rgba(196,85,45,0.14)' }} />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow mb-2 !font-mono">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                    </span>
                    Reading list&nbsp;·&nbsp;curated live
                  </div>
                  <h2 className="font-display text-3xl leading-[0.95] tracking-tighter2 text-white">Worth looking into.</h2>
                  <p className="mt-2 max-w-xl text-[15px] leading-[1.7] text-slate-300">
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
                  <Stagger className="grid gap-2.5 sm:grid-cols-2" gap={0.05}>
                    {briefing.suggestions.map((s, i) => {
                      const activeNow = research && research.question === s.title
                      return (
                        <motion.button
                          key={i}
                          variants={stagItem}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => runResearch(s.title, s.depth)}
                          disabled={rLoading}
                          className={`group relative rounded-2xl border p-4 text-left transition ${activeNow ? 'border-brand/50 bg-brand/5 shadow-glow' : 'border-line bg-ink-900/40 hover:border-brand/40 hover:bg-ink-800/50'}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 font-mono text-xs text-brand-soft/70">{String(i + 1).padStart(2, '0')}</span>
                            <span className="font-display text-[15px] font-medium leading-snug tracking-tightish text-white">{s.title}</span>
                          </div>
                          {s.why && <div className="mt-2 pl-7 text-xs leading-relaxed text-slate-400">{s.why}</div>}
                          <div className="mt-3 flex items-center justify-between gap-1.5 pl-7">
                            <span className="rounded-full border border-brand/25 bg-brand/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-soft">{s.depth}</span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-brand-soft opacity-0 transition group-hover:opacity-100">investigate <ArrowIcon className="h-3 w-3" /></span>
                          </div>
                        </motion.button>
                      )
                    })}
                  </Stagger>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} onClick={() => runResearch(ex)} className="chip hover:border-brand/40 hover:text-white">{ex}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* secondary: ask your own */}
              <div className="mt-6 border-t border-line/70 pt-5">
                <div className="eyebrow mb-2.5 !font-mono !tracking-[0.22em]">Or ask your own</div>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runResearch() }}
                  rows={2}
                  placeholder="e.g. What does the current evidence say about microplastics and human health?"
                  className="inp resize-none text-[15px]"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-full border border-line bg-ink-900/60 p-1">
                    {['quick', 'standard', 'deep'].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDepth(d)}
                        className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide transition ${depth === d ? 'bg-brand/15 text-brand-soft' : 'text-slate-400 hover:text-white'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <Tactile onClick={() => runResearch()} disabled={rLoading || !question.trim()} className="btn-primary !py-2.5">
                    {rLoading ? 'Researching…' : <>Investigate <ArrowIcon className="h-4 w-4" /></>}
                  </Tactile>
                </div>
              </div>

              {rErr && <div className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{rErr}</div>}

              {rLoading && (
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-ink-900/50 px-4 py-6 text-sm text-slate-400">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                  </span>
                  Scholar is investigating across sources and weighing the evidence…
                </div>
              )}

              {research && !rLoading && (
                <ResearchResult res={research} t={t} onFollow={(q) => runResearch(q)} />
              )}
            </div>
          </Reveal>

          {/* ===================================================== fact-check */}
          <Reveal as="section" className="card relative overflow-hidden p-6 sm:p-7">
            <div className="eyebrow mb-2 text-safe !font-mono">Fact-check</div>
            <h2 className="font-display text-2xl leading-[0.95] tracking-tighter2 text-white">Paste a claim — get a verdict.</h2>
            <p className="mt-2 text-sm leading-[1.7] text-slate-300">
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
              <Tactile onClick={runFactCheck} disabled={fLoading || !claim.trim()} className="btn-ghost !py-2.5">
                {fLoading ? 'Checking…' : 'Fact-check claim'}
              </Tactile>
            </div>
            {fErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{fErr}</div>}
            {fact && !fLoading && <FactResult fact={fact} />}
          </Reveal>

          {/* ===================================================== deep dive */}
          <Reveal as="section" className="card relative overflow-hidden p-6 sm:p-7">
            <div className="eyebrow mb-2 !font-mono">Deep dive</div>
            <h2 className="font-display text-2xl leading-[0.95] tracking-tighter2 text-white">Hand Scholar a research task.</h2>
            <p className="mt-2 text-sm leading-[1.7] text-slate-300">
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
              <Tactile onClick={runDeepDive} disabled={dLoading || !task.trim()} className="btn-ghost !py-2.5">
                {dLoading ? 'Running…' : 'Run deep dive'}
              </Tactile>
            </div>
            {dErr && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{dErr}</div>}
            {dLoading && <div className="mt-4 text-sm text-slate-500">Scholar is working through the task…</div>}
            {dive && !dLoading && <SuccessCard confirmation={dive.confirmation} summary={dive.summary} steps={dive.steps} task={dive.task} />}
          </Reveal>
        </div>

        {/* ======================================================= right rail */}
        <div className="space-y-6">
          {/* session notebook */}
          <Reveal as="section" delay={0.04} className="card p-5">
            <div className="eyebrow mb-1 !font-mono">Session notebook</div>
            <h3 className="mb-3 font-display text-lg tracking-tightish text-white">Your research thread</h3>
            {saved.length === 0 ? (
              <p className="text-sm leading-relaxed text-slate-400">Your research answers are saved here for this session. Ask a question to begin.</p>
            ) : (
              <div className="space-y-2">
                {saved.map((s) => {
                  const b = confBand(s.result.confidence)
                  const activeNow = research && research.question === s.question
                  return (
                    <motion.button
                      key={s.id}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => reopen(s)}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition ${activeNow ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-brand/40 hover:bg-ink-800/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-display text-sm font-medium leading-snug text-slate-100">{s.question}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${b.bar}`} title={b.label} />
                      </div>
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                        {s.depth} · {s.result.confidence}/100 · {s.result.citations?.length || 0} sources
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            )}
          </Reveal>

          {/* insurance strip */}
          <Reveal as="section" delay={0.08} className="card relative overflow-hidden p-5">
            <div className="mesh" style={{ bottom: '-60px', right: '-10px', height: 120, width: 140, background: 'rgba(61,154,85,0.12)' }} />
            <div className="relative">
              <div className="eyebrow mb-1 text-safe !font-mono">Protected by Backstop</div>
              <h3 className="mb-3 font-display text-lg tracking-tightish text-white">Insurance &amp; claims</h3>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-safe/10 text-safe"><LockIcon className="h-5 w-5" /></span>
                <div className="text-sm leading-relaxed text-slate-300">
                  Every Scholar answer is backed by Backstop insurance up to{' '}
                  <b className="text-white">{usd(quote.per_incident_limit_usd, 0)}</b> per incident. If a covered mistake slips
                  through, you can file a claim.
                </div>
              </div>
              <Tactile as="a" href="/claims" className="btn-ghost mt-4 w-full !py-2.5 text-sm">File or view a claim</Tactile>
            </div>
          </Reveal>

          {/* capabilities */}
          {Array.isArray(agent.capabilities) && agent.capabilities.length > 0 && (
            <Reveal as="section" delay={0.12} className="card p-5">
              <div className="eyebrow mb-1 !font-mono">The guarantee</div>
              <h3 className="mb-3 font-display text-lg tracking-tightish text-white">What Scholar stands behind</h3>
              <div className="space-y-3">
                {agent.capabilities.map((c, i) => {
                  const cn = typeof c === 'string' ? c : c.name
                  const cd = typeof c === 'string' ? '' : c.description
                  return (
                    <div key={i} className="flex gap-2.5">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft" />
                      <div>
                        <div className="text-sm font-medium text-white">{cn}</div>
                        {cd && <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{cd}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Reveal>
          )}

          {/* activity feed */}
          <Reveal as="section" delay={0.16} className="card p-5">
            <div className="eyebrow mb-1 !font-mono">Activity</div>
            <h3 className="mb-3 font-display text-lg tracking-tightish text-white">Reading-room log</h3>
            {runs.length === 0 ? (
              <p className="text-sm leading-relaxed text-slate-400">No agent runs yet. A deep dive or a run from your account shows up here.</p>
            ) : (
              <div className="space-y-5">
                {[...runs].reverse().slice(0, 6).map((run, i) => (
                  <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-3.5">
                    <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-slate-500">
                      <span>{run.agent_name || run.agent || name}</span>
                      <span>{(run.ts || '').slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    <RunTimeline run={run} agent={run.agent_name || run.agent || name} />
                  </div>
                ))}
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- hero stat tile */
function HeroStat({ label, value, tone = 'text-white' }) {
  return (
    <motion.div variants={stagItem} className="rounded-xl border border-line bg-ink-900/50 px-4 py-3 backdrop-blur-sm">
      <div className={`font-mono text-2xl font-medium tracking-tight ${tone}`}>{value}</div>
      <div className="label mt-1">{label}</div>
    </motion.div>
  )
}

/* ------------------------------------------------------ research result card */
function ResearchResult({ res, t, onFollow }) {
  return (
    <div className="mt-6 animate-fade-up space-y-5">
      {/* the article — editorial serif column */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-900/40 p-5 sm:p-6">
        <div className="mesh" style={{ top: '-50px', right: '-20px', height: 120, width: 150, background: 'rgba(196,85,45,0.1)' }} />
        <div className="relative">
          <div className="eyebrow mb-2 !font-mono text-brand-soft">Scholar dug into this</div>
          {res.question && (
            <blockquote className="mb-4 border-l-2 border-brand/50 pl-4 font-display text-xl italic leading-snug tracking-tightish text-white">
              “{res.question}”
            </blockquote>
          )}
          <div className="text-[15px] leading-[1.8]">
            <Markdown md={res.answer} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        {/* confidence + key points */}
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-ink-900/40 p-4">
            <div className="eyebrow mb-3 !font-mono">Confidence</div>
            <ConfidenceMeter value={res.confidence} />
            <p className="handwriting mt-2.5 text-sm text-brand-soft/60">how hard the evidence leans this way.</p>
          </div>
          {res.key_points?.length > 0 && (
            <div className="rounded-xl border border-line bg-ink-900/40 p-4">
              <div className="eyebrow mb-3 !font-mono">Key points</div>
              <ul className="space-y-2.5">
                {res.key_points.map((k, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-300">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* bibliography — real footnotes with credibility chips */}
        <div className="rounded-xl border border-line bg-ink-900/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="eyebrow !font-mono">References</div>
            <span className="font-mono text-[11px] text-slate-500">{res.citations?.length || 0} cited</span>
          </div>
          {res.citations?.length === 0 ? (
            <p className="text-sm italic leading-relaxed text-slate-500">No sources cited for this answer — treat it as unverified.</p>
          ) : (
            <ol className="space-y-3.5">
              {res.citations.map((c, i) => {
                const meta = [c.source, c.year].filter(Boolean).join(', ')
                return (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 font-mono text-xs text-brand-soft/70">[{i + 1}]</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug text-slate-100">
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" className="decoration-brand/40 underline-offset-2 hover:text-brand-soft hover:underline">{c.title}</a>
                        ) : c.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {meta && (
                          <span className="rounded-full border border-line bg-ink-800/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">{meta}</span>
                        )}
                        {c.url && (
                          <span className="rounded-full border border-safe/25 bg-safe/5 px-2 py-0.5 font-mono text-[10px] text-safe">linked</span>
                        )}
                      </div>
                      {c.note && <div className="mt-1 text-xs italic leading-relaxed text-slate-500">{c.note}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      {res.caveats?.length > 0 && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <div className="eyebrow mb-2 text-warn !font-mono">Caveats &amp; limitations</div>
          <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-slate-300">
            {res.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {res.follow_ups?.length > 0 && (
        <div>
          <div className="eyebrow mb-2.5 !font-mono">Keep investigating</div>
          <div className="flex flex-wrap gap-2">
            {res.follow_ups.map((f, i) => (
              <motion.button
                key={i}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onFollow(f)}
                className="chip border-brand/30 text-brand-soft hover:border-brand/60 hover:text-white"
              >
                {f} <ArrowIcon className="h-3.5 w-3.5" />
              </motion.button>
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
    <div className="mt-4 animate-fade-up rounded-2xl border border-safe/40 bg-safe/5 p-5 shadow-glow-safe">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-safe/15 text-safe">
          <CheckIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-xl leading-snug tracking-tightish text-white">{confirmation}</div>
          {task && <div className="mt-1 font-mono text-[11px] text-slate-500">Task · {task}</div>}
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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
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
        <span className="flex items-center gap-2 font-display text-xl tracking-tightish">
          {Icon ? <Icon className="h-5 w-5" /> : <span className="text-xl font-bold">?</span>}
          {v.label}
        </span>
        <span className="font-mono text-xs opacity-80">{fact.confidence}<span className="opacity-60">/100</span></span>
      </div>

      {fact.explanation && <p className="text-[15px] leading-[1.75] text-slate-300">{fact.explanation}</p>}

      {fact.evidence?.length > 0 && (
        <div className="rounded-xl border border-line bg-ink-900/40 p-4">
          <div className="eyebrow mb-3 !font-mono">Evidence</div>
          <ul className="space-y-3">
            {fact.evidence.map((e, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 font-mono text-xs text-brand-soft/70">[{i + 1}]</span>
                <div>
                  <div className="leading-relaxed text-slate-200">{e.point}</div>
                  {e.source && <div className="mt-0.5 text-xs italic text-slate-500">— {e.source}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
