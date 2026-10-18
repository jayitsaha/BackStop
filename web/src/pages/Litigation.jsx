import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api'
import { useWallet } from '../lib/wallet.jsx'
import { CheckIcon, XIcon, ShieldIcon, ArrowIcon } from '../components/marks'
import { Reveal, Stagger, stagItem, Tactile } from '../components/ui/motion.jsx'
import { GlowBackdrop, GoldRule } from '../components/ui/Backdrop.jsx'

// Litigation / claims desk: file a claim with evidence, then an autonomous support agent
// cross-questions you to establish the scam genuinely happened via the agent you bought — and decides.

const STATUS = {
  investigating: { label: 'Investigating', chip: 'border-info/30 bg-info/10 text-info-soft', dot: 'bg-info' },
  decided: { label: 'Decided', chip: 'border-slate-600/40 bg-slate-700/20 text-slate-300', dot: 'bg-slate-500' },
}
const OUTCOME = {
  approved: { label: 'Approved', chip: 'border-safe/30 bg-safe/10 text-safe', dot: 'bg-safe', Icon: CheckIcon },
  denied: { label: 'Denied', chip: 'border-bad/30 bg-bad/10 text-bad', dot: 'bg-bad', Icon: XIcon },
  needs_human: { label: 'Needs human review', chip: 'border-warn/30 bg-warn/10 text-warn', dot: 'bg-warn', Icon: ShieldIcon },
}
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '')

const fileToDataUri = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })

export default function Litigation() {
  const [cases, setCases] = useState([])
  const [agents, setAgents] = useState([])
  const [sel, setSel] = useState(null) // case_id
  const [active, setActive] = useState(null) // full case
  const [mode, setMode] = useState('new') // 'new' | 'case'

  const refresh = () =>
    api
      .litigationList()
      .then((d) => setCases(Array.isArray(d) ? d : []))
      .catch(() => {})

  useEffect(() => {
    refresh()
    api
      .getCustomer()
      .then((c) => setAgents((c && c.agents) || []))
      .catch(() => {})
  }, [])

  const openCase = (id) => {
    setSel(id)
    setMode('case')
    api.litigationCase(id).then(setActive).catch(() => {})
  }

  const startNew = () => {
    setSel(null)
    setActive(null)
    setMode('new')
  }

  const onOpened = (c) => {
    setActive(c)
    setSel(c.case_id)
    setMode('case')
    refresh()
  }

  const onUpdated = (c) => {
    setActive(c)
    refresh()
  }

  return (
    <div className="space-y-7">
      {/* hero */}
      <div className="card relative overflow-hidden p-7 md:p-9">
        <GlowBackdrop intensity={0.9} />
        <Reveal className="relative max-w-3xl">
          <div className="eyebrow mb-3"><span className="h-2 w-2 rounded-full bg-brand" /> Claims · litigation</div>
          <h1 className="font-display text-5xl font-semibold leading-[0.9] tracking-tighter2 text-white md:text-6xl">
            File a claim
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
            Lost money through an agent you bought? File a claim with your evidence. Our autonomous claims
            investigator will cross-question you to establish exactly what happened — then decide.
          </p>
          <GoldRule className="mt-6 max-w-xs" />
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.9fr]">
        {/* cases list */}
        <Reveal delay={0.05} className="card p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="label">Your cases</div>
            <Tactile onClick={startNew} className="btn-ghost !px-2.5 !py-1 text-xs">+ New claim</Tactile>
          </div>
          {cases.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-slate-500">No claims yet. File your first on the right.</p>
          ) : (
            <Stagger className="space-y-1.5" gap={0.04}>
              {cases.map((c) => {
                const st = STATUS[c.status] || STATUS.investigating
                const out = c.outcome ? OUTCOME[c.outcome] : null
                const badge = out || st
                const isSel = sel === c.case_id
                return (
                  <motion.button
                    key={c.case_id}
                    variants={stagItem}
                    onClick={() => openCase(c.case_id)}
                    whileTap={{ scale: 0.985 }}
                    className={`w-full rounded-card-sm border px-3 py-2.5 text-left transition ${isSel ? 'border-brand/60 bg-brand/10 shadow-glow' : 'border-line bg-ink-900/40 hover:border-brand/40 hover:bg-ink-800/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
                        {c.agent_name || 'Claim'}
                      </span>
                      <span className={`chip !px-2 !py-0.5 text-[10px] ${badge.chip}`}>{badge.label}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-500">{c.summary || c.suspected_scam_type}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-600">{fmt(c.created_at)}</div>
                  </motion.button>
                )
              })}
            </Stagger>
          )}
        </Reveal>

        {/* right pane */}
        <Reveal delay={0.1} className="card p-6 md:p-7">
          {mode === 'new' || !active ? (
            <ClaimForm agents={agents} onOpened={onOpened} />
          ) : (
            <CaseChat caseData={active} onUpdated={onUpdated} />
          )}
        </Reveal>
      </div>
    </div>
  )
}

// ----------------------------- intake form -----------------------------
function ClaimForm({ agents, onOpened }) {
  const [agentId, setAgentId] = useState(agents[0]?.agent_id || '')
  const [paymentId, setPaymentId] = useState('')
  const [text, setText] = useState('')
  const [shot, setShot] = useState(null) // { name, dataUri }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!agentId && agents.length) setAgentId(agents[0].agent_id)
  }, [agents]) // eslint-disable-line

  const pickFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const dataUri = await fileToDataUri(f)
      setShot({ name: f.name, dataUri })
    } catch {
      setErr('Could not read that file.')
    }
  }

  const submit = async () => {
    setErr('')
    if (!text.trim() && !shot) {
      setErr('Describe what happened or attach a screenshot.')
      return
    }
    setBusy(true)
    try {
      const c = await api.litigationOpen({
        agent_id: agentId || undefined,
        payment_id: paymentId.trim() || undefined,
        evidence_text: text.trim(),
        screenshot: shot?.dataUri,
      })
      onOpened(c)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not open the claim.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-2xl tracking-tightish text-white">New claim</h3>
        <span className="chip border-info/30 bg-info/10 text-info-soft"><ShieldIcon className="h-3.5 w-3.5" /> Evidence-backed</span>
      </div>
      <p className="mt-1.5 text-sm text-slate-400">Tell us what happened. The investigator opens with its first question right after you submit.</p>

      {agents.length === 0 && (
        <div className="mt-4 rounded-card-sm border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          You don't own any agents yet. Add one from the marketplace before filing a claim about it.
        </div>
      )}

      <Stagger className="mt-6 space-y-4" gap={0.05}>
        <motion.div variants={stagItem}>
          <label className="label mb-1.5 block">Which agent is this claim about?</label>
          <select
            className="inp w-full"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={agents.length === 0}
          >
            {agents.length === 0 && <option value="">No agents owned</option>}
            {agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.agent_name}{a.use_case_type ? ` · ${a.use_case_type}` : ''}
              </option>
            ))}
          </select>
        </motion.div>

        <motion.div variants={stagItem}>
          <label className="label mb-1.5 block">Linked payment ID <span className="text-slate-600">(optional)</span></label>
          <input className="inp w-full" placeholder="e.g. pay-1234" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} />
        </motion.div>

        <motion.div variants={stagItem}>
          <label className="label mb-1.5 block">What happened?</label>
          <textarea
            className="inp min-h-[120px] w-full resize-y"
            placeholder="Describe the scam: who you paid, how much, what the agent did, and how you realised something was wrong…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </motion.div>

        <motion.div variants={stagItem}>
          <label className="label mb-1.5 block">Screenshot evidence <span className="text-slate-600">(optional)</span></label>
          <div className="flex items-center gap-3">
            <label className="btn-ghost cursor-pointer text-sm">
              {shot ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
            </label>
            {shot && (
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <CheckIcon className="h-4 w-4 text-safe" /> {shot.name}
                <button onClick={() => setShot(null)} className="text-slate-600 transition-colors hover:text-bad">remove</button>
              </span>
            )}
          </div>
          <AnimatePresence>
            {shot && (
              <motion.img
                key={shot.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                src={shot.dataUri}
                alt="evidence"
                className="mt-3 max-h-48 rounded-card-sm border border-line object-contain"
              />
            )}
          </AnimatePresence>
        </motion.div>

        {err && <div className="rounded-card-sm border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}

        <motion.div variants={stagItem}>
          <Tactile onClick={submit} disabled={busy || agents.length === 0} className="btn-primary w-full disabled:opacity-50">
            {busy ? 'Opening case…' : 'File claim & start investigation'}
          </Tactile>
        </motion.div>
      </Stagger>
    </div>
  )
}

// ----------------------------- case chat -----------------------------
function CaseChat({ caseData, onUpdated }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)
  const transcript = caseData.transcript || []
  const decided = caseData.status === 'decided'

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.length])

  const send = async () => {
    const a = answer.trim()
    if (!a || busy) return
    setErr('')
    setBusy(true)
    setAnswer('')
    try {
      const updated = await api.litigationChat(caseData.case_id, { answer: a })
      onUpdated(updated)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not send your answer.')
      setAnswer(a)
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const st = STATUS[caseData.status] || STATUS.investigating
  const dec = caseData.decision

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-2xl tracking-tightish text-white">{caseData.agent_name || 'Claim'}</h3>
            <span className={`chip ${st.chip}`}>
              {caseData.status === 'investigating' && <span className={`h-2 w-2 animate-pulse rounded-full ${st.dot}`} />}
              {caseData.status !== 'investigating' && <span className={`h-2 w-2 rounded-full ${st.dot}`} />}
              {st.label}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-slate-400">{caseData.summary}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-600">
            <span>{caseData.case_id}</span>
            {caseData.suspected_scam_type && <span>· suspected: {caseData.suspected_scam_type}</span>}
            {caseData.payment_id && <span>· payment {caseData.payment_id}</span>}
          </div>
        </div>
      </div>

      {/* transcript */}
      <div className="mt-4 max-h-[48vh] min-h-[220px] flex-1 space-y-3 overflow-y-auto pr-1">
        {caseData.screenshot_text && (
          <details className="rounded-card-sm border border-line bg-ink-950/60 p-3 text-xs text-slate-400">
            <summary className="cursor-pointer text-slate-300">Transcribed screenshot evidence</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-500">{caseData.screenshot_text}</pre>
          </details>
        )}
        {transcript.map((t, i) => {
          const isAgent = t.role === 'agent'
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  isAgent
                    ? 'border border-line bg-ink-950/60 text-slate-200'
                    : 'border border-brand/30 bg-brand/15 text-brand-lite'
                }`}
              >
                {isAgent && <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-brand/90"><ShieldIcon className="h-3 w-3" /> Investigator</div>}
                {t.content}
              </div>
            </motion.div>
          )
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-ink-950/60 px-3.5 py-2.5 text-sm text-slate-500">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" />
              </span>
              Investigator is thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* verdict */}
      {decided && dec && <VerdictCard dec={dec} adjudication={caseData.adjudication} />}

      {/* payout — approved claims can be settled on-chain to the user's wallet */}
      {decided && dec && dec.outcome === 'approved' && (
        <PayoutPanel caseData={caseData} onUpdated={onUpdated} />
      )}

      {/* composer */}
      {!decided && (
        <div className="mt-4 border-t border-line pt-4">
          {err && <div className="mb-2 rounded-card-sm border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}
          <div className="flex items-end gap-2">
            <textarea
              className="inp max-h-32 min-h-[46px] flex-1 resize-y"
              placeholder="Answer the investigator… (Enter to send, Shift+Enter for a new line)"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onKey}
            />
            <Tactile onClick={send} disabled={busy || !answer.trim()} className="btn-primary disabled:opacity-50">Send</Tactile>
          </div>
        </div>
      )}
    </div>
  )
}

function VerdictCard({ dec, adjudication }) {
  const o = OUTCOME[dec.outcome] || OUTCOME.needs_human
  const { Icon } = o
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`mt-4 rounded-card-sm border p-4 ${o.chip}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h4 className="font-display text-lg tracking-tightish">Verdict · {o.label}</h4>
        {dec.amount_usd > 0 && <span className="ml-auto font-mono text-sm">${Number(dec.amount_usd).toLocaleString()}</span>}
      </div>
      {dec.rationale && <p className="mt-2 text-sm text-slate-200">{dec.rationale}</p>}
      {Array.isArray(dec.evidence_cited) && dec.evidence_cited.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Evidence cited</div>
          <ul className="space-y-1">
            {dec.evidence_cited.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-safe" /> {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {adjudication && (
        <div className="mt-3 rounded-card-sm border border-safe/30 bg-safe/5 px-3 py-2 text-xs text-safe">
          Logged against payment {adjudication.payment_id} — eligible for settlement.
        </div>
      )}
    </motion.div>
  )
}

// ----------------------------- payout to MetaMask -----------------------------
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

// Scoped CSS for the "final whizz" celebration. Injected once; pure CSS, no deps.
// Mocha Noir palette — burnt terracotta + gold + settlement green burst.
const WHIZZ_CSS = `
@keyframes whizz-pop {
  0% { transform: scale(0.3); opacity: 0; }
  55% { transform: scale(1.18); opacity: 1; }
  75% { transform: scale(0.94); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes whizz-glow {
  0% { box-shadow: 0 0 0 0 rgba(61,154,85,0.0), 0 0 0 0 rgba(196,85,45,0.0); }
  40% { box-shadow: 0 0 30px 6px rgba(61,154,85,0.55), 0 0 64px 20px rgba(196,85,45,0.32); }
  100% { box-shadow: 0 0 16px 2px rgba(61,154,85,0.3), 0 0 0 0 rgba(196,85,45,0.0); }
}
@keyframes whizz-ring {
  0% { transform: scale(0.5); opacity: 0.7; }
  100% { transform: scale(2.4); opacity: 0; }
}
@keyframes whizz-ring2 {
  0% { transform: scale(0.5); opacity: 0.5; }
  100% { transform: scale(3.1); opacity: 0; }
}
@keyframes whizz-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes whizz-ray {
  0% { transform: rotate(var(--a)) translateY(0) scale(0.6); opacity: 0; }
  25% { opacity: 1; }
  100% { transform: rotate(var(--a)) translateY(calc(-1 * var(--d))) scale(1); opacity: 0; }
}
@keyframes whizz-rise {
  0% { transform: translateY(8px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes whizz-sheen {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(220%); }
}
.whizz-pop { animation: whizz-pop 0.6s cubic-bezier(0.22,1.4,0.42,1) both; }
.whizz-glow { animation: whizz-glow 1.4s ease-out both; }
.whizz-ring { animation: whizz-ring 0.9s ease-out both; }
.whizz-ring2 { animation: whizz-ring2 1.15s 0.08s ease-out both; }
.whizz-check path { stroke-dasharray: 26; stroke-dashoffset: 26; animation: whizz-draw 0.5s 0.28s ease-out forwards; }
.whizz-ray { animation: whizz-ray 0.85s ease-out both; }
.whizz-rise { animation: whizz-rise 0.5s 0.35s ease-out both; }
.whizz-sheen { animation: whizz-sheen 1.5s 0.3s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .whizz-pop, .whizz-glow, .whizz-ring, .whizz-ring2, .whizz-ray, .whizz-rise, .whizz-sheen { animation: none !important; opacity: 1 !important; transform: none !important; }
  .whizz-check path { stroke-dashoffset: 0 !important; animation: none !important; }
}
`

// 12 radiating confetti rays around the check badge — mocha + gold + green, classy burst.
const RAY_COLORS = ['#3d9a55', '#c4552d', '#f0bd36', '#e8865f']
const RAYS = Array.from({ length: 12 }, (_, i) => ({
  a: `${i * 30}deg`,
  d: `${46 + (i % 3) * 12}px`,
  color: RAY_COLORS[i % RAY_COLORS.length],
  delay: `${(i % 5) * 0.03}s`,
  size: i % 3 === 0 ? 8 : 6,
}))

function SettledCard({ payout, celebrate }) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-card-sm border border-safe/40 bg-gradient-to-br from-safe/12 via-safe/5 to-brand/12 p-5">
      <style>{WHIZZ_CSS}</style>
      {celebrate && <span className="whizz-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-shine opacity-60" aria-hidden />}

      <div className="relative flex items-start gap-4">
        {/* animated check badge + burst */}
        <div className="relative grid h-14 w-14 shrink-0 place-items-center">
          {celebrate && (
            <>
              <span className="whizz-ring absolute inset-0 rounded-full border-2 border-safe/60" />
              <span className="whizz-ring2 absolute inset-0 rounded-full border border-brand/50" />
              {RAYS.map((r, i) => (
                <span
                  key={i}
                  className="whizz-ray absolute left-1/2 top-1/2 block rounded-full"
                  style={{
                    '--a': r.a,
                    '--d': r.d,
                    width: r.size,
                    height: r.size,
                    marginLeft: -r.size / 2,
                    marginTop: -r.size / 2,
                    background: r.color,
                    animationDelay: r.delay,
                  }}
                />
              ))}
            </>
          )}
          <div className={`grid h-14 w-14 place-items-center rounded-full bg-safe/15 text-safe ring-1 ring-safe/40 ${celebrate ? 'whizz-pop whizz-glow' : ''}`}>
            <CheckIcon className={`h-7 w-7 ${celebrate ? 'whizz-check' : ''}`} />
          </div>
        </div>

        <div className={`min-w-0 flex-1 ${celebrate ? 'whizz-rise' : ''}`}>
          <div className="flex items-center gap-2">
            <h4 className="font-display text-lg tracking-tightish text-white">Settlement paid</h4>
            <span className="chip border-safe/30 bg-safe/10 text-safe !px-2 !py-0.5 text-[10px]">On-chain</span>
          </div>
          <p className="mt-1 text-sm text-slate-300">
            Settled on-chain ·{' '}
            <span className="font-mono text-safe">{payout.amount_eth} ETH</span>{' '}
            → <span className="font-mono text-slate-200">{shortAddr(payout.to_address)}</span>
          </p>
          {payout.explorer_url && (
            <a
              href={payout.explorer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost mt-3 inline-flex items-center gap-1.5 text-sm"
            >
              View transaction <ArrowIcon className="h-4 w-4 -rotate-45" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function PayoutPanel({ caseData, onUpdated }) {
  const { account, connect, connecting, available } = useWallet()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [celebrate, setCelebrate] = useState(false)

  // Already settled (persists across reloads via the fetched case).
  if (caseData.payout) {
    return <SettledCard payout={caseData.payout} celebrate={celebrate} />
  }

  const claim = async () => {
    setErr('')
    setBusy(true)
    try {
      let to = account
      if (!to) {
        to = await connect() // prompts MetaMask
        if (!to) {
          setBusy(false)
          return // user dismissed / no wallet
        }
      }
      const res = await api.claimPayout({ case_id: caseData.case_id, to_address: to })
      // Refresh the case so the payout persists on reload.
      const fresh = await api.litigationCase(caseData.case_id).catch(() => null)
      if (fresh && fresh.payout) {
        setCelebrate(true)
        onUpdated(fresh)
      } else if (res?.payout) {
        // Fallback: merge the payout into the current case if the refetch lagged.
        setCelebrate(true)
        onUpdated({ ...caseData, payout: res.payout })
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not send the settlement. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative mt-4 overflow-hidden rounded-card-sm border border-safe/30 bg-gradient-to-br from-safe/8 to-brand/8 p-5"
    >
      <span className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-safe/10 blur-3xl" aria-hidden />
      <div className="relative flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-card-sm bg-safe/15 text-safe ring-1 ring-safe/30">
          <CheckIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h4 className="font-display text-lg tracking-tightish text-white">Your claim was approved</h4>
          <p className="mt-0.5 text-sm text-slate-400">
            Receive your settlement directly to your MetaMask wallet on Ethereum Sepolia.
          </p>
        </div>
      </div>

      {busy ? (
        <div className="relative mt-4 flex items-center gap-3 rounded-card-sm border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-soft">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-info-soft/40 border-t-info-soft" />
          <span>
            {connecting ? 'Waiting for MetaMask…' : 'Sending your settlement on-chain…'}
            <span className="block text-xs text-slate-500">This can take around 15 seconds — please keep this tab open.</span>
          </span>
        </div>
      ) : (
        <Tactile onClick={claim} className="btn-primary relative mt-4 w-full">
          Receive payout to MetaMask
        </Tactile>
      )}

      {available === false && (
        <p className="relative mt-2 text-center text-xs text-slate-500">
          No wallet detected.{' '}
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2 hover:text-brand-soft"
          >
            Install MetaMask
          </a>{' '}
          to receive your payout.
        </p>
      )}

      {err && (
        <div className="relative mt-3 rounded-card-sm border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>
      )}
    </motion.div>
  )
}
