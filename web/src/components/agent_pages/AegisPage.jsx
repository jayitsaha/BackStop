/* ============================================================================
 * AEGIS — Autonomous Security Operations Console  (bespoke fraud-defense page)
 * ============================================================================
 *
 * PHASE 1 — IDEATE
 *   A fraud-defense agent shouldn't wait for you to paste something — it should
 *   already be watching. The whole page is reframed so Aegis is the active party:
 *   it SWEEPS your incoming bills/emails/texts/calls the moment the page opens,
 *   triages them, and proposes one-tap actions on your behalf. The user mostly
 *   confirms. A proactive headline ("Aegis flagged 2 scams and is holding 1
 *   payment") makes the autonomy legible. Manual tools stay, but demoted to a
 *   "check something specific" strip — pre-seeded from the latest flagged item so
 *   it's one click, never a blank box.
 *
 * PHASE 2 — PLAN
 *   (0) TrustStrip     — identity, GradePill, premium, cover, verified·tested·insured
 *   (1) PostureBanner  — headline computed from the auto-sweep
 *   (2) ThreatFeed     — AUTO-RUNS POST /apps/aegis/sweep on mount; live card feed
 *                        with per-item one-tap actions (Freeze → api.hold, Dismiss,
 *                        Draft reply → api.replySuggest). Skeleton while sweeping,
 *                        retry on error, manual Re-sweep button. Runs once (guarded).
 *   (3) DeepScan       — SECONDARY "check something specific" (POST /apps/aegis/screen),
 *                        pre-seeded from the latest flagged sweep item; keeps examples.
 *   (4) InboxTriage    — api.agentTask → live tool-use loop
 *   (5) FreezeVault    — customer.frozen + api.hold / api.unhold
 *   (6) ActivityFeed + InsuranceStrip (links to /claims)
 *   New backend endpoints (api/app_aegis.py): POST /apps/aegis/sweep,
 *   POST /apps/aegis/screen, GET /apps/aegis/examples.
 *
 * PHASE 3 — BUILD below — every panel wired to a real backend call.
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { cents, usd } from '../../lib/format'
import { GradePill, ShieldIcon, LockIcon, CheckIcon, ArrowIcon } from '../marks'
import { WidgetShell, RunTimeline, GuardField, iconFor } from '../widgets/shared.jsx'

/* ----- shared verdict vocabulary (fraud semantics, not the gold accent) ----- */
const VERDICT = {
  safe: { label: 'Looks legit', chip: 'border-safe/40 bg-safe/10 text-safe', bar: 'bg-safe', ring: 'border-safe/25 bg-safe/[0.04]', stroke: '#3FD99A', dot: 'bg-safe' },
  caution: { label: 'Double-check this', chip: 'border-warn/40 bg-warn/10 text-warn', bar: 'bg-warn', ring: 'border-warn/30 bg-warn/[0.05]', stroke: '#F2B441', dot: 'bg-warn' },
  scam: { label: 'Likely a scam', chip: 'border-bad/40 bg-bad/10 text-bad', bar: 'bg-bad', ring: 'border-bad/35 bg-bad/[0.06]', stroke: '#FF6A62', dot: 'bg-bad' },
}
const vmeta = (v) => VERDICT[v] || VERDICT.caution
const CHANNEL = { email: '✉️', text: '💬', call: '📞', bill: '🧾' }

/* ============================================================== 0. HERO/TRUST */
function TrustStrip({ agent, customer, kpis }) {
  const q = agent?.quote || {}
  const grade = agent?.grade || {}
  return (
    <div className="card-raised relative overflow-hidden p-6 sm:p-8">
      <div className="mesh" style={{ top: -120, right: '-4%', height: 320, width: 360, background: 'rgba(242,180,65,0.14)' }} />
      <div className="mesh" style={{ bottom: -140, left: '-6%', height: 300, width: 320, background: 'rgba(63,217,154,0.08)' }} />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-warn/10 text-warn ring-1 ring-warn/30">
              {iconFor(agent?.icon || 'shield', 'h-7 w-7')}
            </div>
            <div>
              <div className="eyebrow mb-1 text-warn">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-warn" />
                </span>
                Autonomous security · live
              </div>
              <h1 className="font-display text-3xl font-semibold tracking-tightish text-white sm:text-4xl">{agent?.name || 'Aegis'}</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-400">{agent?.tagline || 'Detect and block scams before they hit your wallet.'}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <GradePill grade={grade.grade} score={grade.score} />
            <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
              <span className="chip border-info/30 bg-info/10 text-info-soft"><ShieldIcon className="h-3.5 w-3.5" /> Verified</span>
              <span className="chip border-warn/30 bg-warn/10 text-warn"><CheckIcon className="h-3.5 w-3.5" /> Crash-tested</span>
              <span className="chip border-safe/30 bg-safe/10 text-safe"><LockIcon className="h-3.5 w-3.5" /> Insured</span>
            </div>
          </div>
        </div>

        <div className="rule-gold my-6" />

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line/60 sm:grid-cols-4">
          <Kpi label="Premium / payment" value={q.gross_premium_usd != null ? cents(q.gross_premium_usd) : '—'} sub="you pay" tone="text-brand-soft" />
          <Kpi label="Covered per incident" value={usd(q.per_incident_limit_usd || customer?.certificate?.per_incident_limit_usd || 0, 0)} sub="insured mistakes" tone="text-safe" />
          <Kpi label="Threats flagged" value={kpis.flagged} sub="this sweep" tone={kpis.flagged > 0 ? 'text-bad' : 'text-slate-300'} />
          <Kpi label="Payees frozen" value={kpis.frozen} sub="agent won't pay" tone={kpis.frozen > 0 ? 'text-warn' : 'text-slate-300'} />
        </div>
      </div>
    </div>
  )
}
function Kpi({ label, value, sub, tone }) {
  return (
    <div className="bg-ink-850/80 px-4 py-3.5">
      <div className="label !text-[10px]">{label}</div>
      <div className={`stat-num mt-1 text-2xl ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

/* ============================================= 1. PROACTIVE POSTURE BANNER */
function PostureBanner({ status, counts, onResweep, sweeping }) {
  let headline, tone, Icon
  if (status === 'loading') {
    headline = 'Aegis is sweeping your inbox, texts and calls…'
    tone = 'border-warn/30 bg-warn/[0.05] text-warn'
    Icon = <span className="h-4 w-4 animate-spin rounded-full border-2 border-warn/40 border-t-warn" />
  } else if (status === 'error') {
    headline = "Aegis couldn't finish the sweep — retrying."
    tone = 'border-bad/30 bg-bad/10 text-bad'
    Icon = <span className="text-lg leading-none">⚠</span>
  } else {
    const c = counts || {}
    const scams = c.scam || 0
    const holds = c.holds || 0
    const cautions = c.caution || 0
    const parts = []
    if (scams) parts.push(`flagged ${scams} scam${scams > 1 ? 's' : ''}`)
    if (cautions) parts.push(`${cautions} to double-check`)
    if (holds) parts.push(`is proposing to hold ${holds} payment${holds > 1 ? 's' : ''}`)
    headline = parts.length ? `Aegis ${parts.join(', ')}.` : 'Aegis swept your inbox — nothing suspicious right now.'
    tone = scams ? 'border-bad/35 bg-bad/[0.07] text-bad' : cautions ? 'border-warn/30 bg-warn/[0.05] text-warn' : 'border-safe/30 bg-safe/[0.05] text-safe'
    Icon = scams ? <span className="text-lg leading-none">🛡️</span> : <CheckIcon className="h-5 w-5" />
  }
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${tone}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5">{Icon}</span>
        <div>
          <div className="font-display text-lg leading-tight text-white">{headline}</div>
          <div className="text-[11px] uppercase tracking-wider opacity-80">Working on your behalf · no action needed unless you want to override</div>
        </div>
      </div>
      <button onClick={onResweep} disabled={sweeping} className="btn-ghost shrink-0 !py-2 text-xs">
        {sweeping ? 'Sweeping…' : 'Re-sweep now'}
      </button>
    </div>
  )
}

/* ============================================= 2. AUTONOMOUS THREAT FEED */
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-line bg-ink-900/40 p-4">
      <div className="flex items-center justify-between">
        <div className="h-3 w-40 rounded bg-ink-700" />
        <div className="h-5 w-20 rounded-full bg-ink-700" />
      </div>
      <div className="mt-3 h-3 w-3/4 rounded bg-ink-700" />
      <div className="mt-2 h-2.5 w-1/2 rounded bg-ink-800" />
    </div>
  )
}

function ThreatCard({ item, onFreeze, onDismiss, onDraft, frozenNames }) {
  const meta = vmeta(item.verdict)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState(null) // {label}
  const [reply, setReply] = useState(null)
  const frozen = item.payee && frozenNames.includes(String(item.payee).toLowerCase())

  async function freeze() {
    setBusy('freeze')
    const ok = await onFreeze(item.payee, `Aegis sweep: ${item.reason || item.verdict}`, item.account_last4)
    setBusy('')
    if (ok) setDone({ label: `“${item.payee}” frozen — Aegis won't pay it` })
  }
  async function draft() {
    setBusy('draft')
    try {
      const { reply: text } = await api.replySuggest({ sender: item.sender, subject: item.subject, snippet: item.reason })
      setReply(text)
    } catch { setReply('Could not draft a reply right now.') } finally { setBusy('') }
  }

  if (done) {
    return (
      <div className={`rounded-xl border px-4 py-3 ${meta.ring}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-safe"><CheckIcon className="h-4 w-4" /> {done.label}</div>
      </div>
    )
  }

  return (
    <div className={`animate-fade-up rounded-xl border p-4 ${meta.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{CHANNEL[item.channel] || '✉️'}</span>
            <span className="truncate text-sm font-semibold text-white">{item.subject}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{item.sender}
            {item.amount ? <span className="text-slate-400"> · {usd(item.amount)}</span> : null}
            {item.account_last4 ? <span className="font-mono text-slate-500"> · ••{item.account_last4}</span> : null}
          </div>
        </div>
        <span className={`chip shrink-0 !px-2 !py-0.5 text-[11px] ${meta.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {item.verdict} · {item.risk_score}
        </span>
      </div>
      {item.reason && <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.reason}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        <span className="text-[11px] uppercase tracking-wider text-slate-600">Aegis proposes</span>
        {item.action === 'freeze_payee' && item.payee && (
          <button onClick={freeze} disabled={busy || frozen}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${frozen ? 'border-bad/30 text-bad' : 'border-bad/40 text-bad hover:bg-bad/10'}`}>
            <LockIcon className="mr-1 inline h-3.5 w-3.5" />{busy === 'freeze' ? 'Freezing…' : frozen ? 'Already frozen' : `Freeze ${item.payee}`}
          </button>
        )}
        {item.action === 'draft_reply' && (
          <button onClick={draft} disabled={busy} className="rounded-lg border border-info/40 px-2.5 py-1 text-xs font-medium text-info-soft transition hover:bg-info/10">
            {busy === 'draft' ? 'Drafting…' : 'Draft a safe reply'}
          </button>
        )}
        <button onClick={() => onDismiss(item.id)} className="ml-auto text-xs text-slate-500 hover:text-white">Dismiss</button>
      </div>

      {reply && (
        <div className="mt-3 rounded-lg border border-info/25 bg-info/5 p-3">
          <div className="label mb-1 text-info-soft">Suggested reply</div>
          <p className="whitespace-pre-wrap text-xs text-slate-200">{reply}</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => { navigator.clipboard?.writeText(reply); setReply(null) }} className="text-xs text-info-soft hover:text-white">Copy</button>
            <button onClick={() => setReply(null)} className="text-xs text-slate-500 hover:text-white">dismiss</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ThreatFeed({ sweepRef, onSweepResult, onStatus, onFreeze, frozenNames }) {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [items, setItems] = useState([])
  const [, setCounts] = useState(null)
  const [agent, setAgent] = useState('Aegis')
  const triedRetry = useRef(false)
  const started = useRef(false) // guard double-invoke (StrictMode / re-render)

  function report(s) { setStatus(s); onStatus?.(s) }

  async function sweep(isRetry = false) {
    report('loading')
    try {
      const d = await api.post('/apps/aegis/sweep', {})
      const s = d.sweep || {}
      setItems(s.items || [])
      setCounts(s.counts || null)
      setAgent(s.agent || 'Aegis')
      report('ready')
      triedRetry.current = false
      onSweepResult?.(s)
    } catch (e) {
      if (!isRetry && !triedRetry.current) {
        triedRetry.current = true
        setTimeout(() => sweep(true), 1500) // one automatic retry
      } else {
        report('error')
      }
    }
  }

  // run ONCE on mount (guarded against StrictMode's double effect)
  useEffect(() => {
    if (started.current) return
    started.current = true
    sweep()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // expose a manual re-sweep to the posture banner
  if (sweepRef) sweepRef.current = () => sweep()

  function dismiss(id) { setItems((xs) => xs.filter((x) => x.id !== id)) }

  // recompute counts after dismissals so the posture stays honest
  useEffect(() => {
    if (status !== 'ready') return
    const scam = items.filter((i) => i.verdict === 'scam').length
    const caution = items.filter((i) => i.verdict === 'caution').length
    const holds = items.filter((i) => i.action === 'freeze_payee').length
    const next = { scam, caution, safe: items.length - scam - caution, holds, total: items.length }
    setCounts(next)
    onSweepResult?.({ counts: next, items, agent })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  return (
    <WidgetShell
      title="Live threat feed"
      subtitle={`${agent} triaged your incoming bills, emails, texts and calls automatically. Confirm or override its proposed actions below.`}
      acc="warn"
      eyebrow="Autonomous sweep · live"
      live
    >
      {status === 'loading' && (
        <div className="space-y-2.5">
          <div className="mb-1 flex items-center gap-2 text-sm text-warn"><span className="h-4 w-4 animate-spin rounded-full border-2 border-warn/40 border-t-warn" /> {agent} is sweeping your inbox…</div>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
          The sweep failed. <button onClick={() => sweep()} className="underline hover:text-white">Try again</button>
        </div>
      )}
      {status === 'ready' && (
        items.length === 0 ? (
          <p className="rounded-xl border border-safe/25 bg-safe/[0.04] px-4 py-8 text-center text-sm text-safe">All clear — Aegis found nothing suspicious in this sweep.</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((it) => (
              <ThreatCard key={it.id} item={it} frozenNames={frozenNames} onFreeze={onFreeze} onDismiss={dismiss} />
            ))}
          </div>
        )
      )}
    </WidgetShell>
  )
}

/* ================================================= 3. DEEP SCAN (secondary) */
function RiskMeter({ score, meta }) {
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="label">Risk score</div>
        <div className="font-display text-3xl font-semibold leading-none" style={{ color: meta.stroke }}>
          {pct}<span className="ml-0.5 text-base text-slate-500">/100</span>
        </div>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-ink-700">
        <div className="absolute inset-0 opacity-40" style={{ background: 'linear-gradient(90deg,#3FD99A 0%,#F2B441 55%,#FF6A62 100%)' }} />
        <div className={`relative h-full ${meta.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-600">
        <span>safe</span><span>caution</span><span>scam</span>
      </div>
    </div>
  )
}

function DeepScan({ onFreeze, frozenNames, seed }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [examples, setExamples] = useState([])
  const [froze, setFroze] = useState(false)
  const seededRef = useRef('')

  useEffect(() => {
    api.get('/apps/aegis/examples').then((d) => setExamples(d.examples || [])).catch(() => {})
  }, [])

  // pre-seed the box (one click, not blank) from the latest flagged sweep item
  useEffect(() => {
    if (seed && seed !== seededRef.current && !text) {
      seededRef.current = seed
      setText(seed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  async function scan(t) {
    const body = (t ?? text).trim()
    if (!body) { setErr('Paste a message, bill, or call transcript to scan.'); return }
    setBusy(true); setErr(''); setRes(null); setFroze(false)
    try {
      const d = await api.post('/apps/aegis/screen', { text: body })
      setRes(d.screen)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Scan failed — is the API up?')
    } finally { setBusy(false) }
  }
  function useExample(ex) { setText(ex.text); setRes(null); setErr(''); scan(ex.text) }

  const meta = res ? vmeta(res.verdict) : null
  const payee = res?.extracted?.payee
  const alreadyFrozen = payee && frozenNames.includes(String(payee).toLowerCase())

  async function freezePayee() {
    if (!payee) return
    const ok = await onFreeze(payee, `Aegis threat scan: ${res.scam_type?.replace(/_/g, ' ') || 'flagged'}`, res.extracted?.account_last4)
    if (ok) setFroze(true)
  }

  return (
    <WidgetShell
      title="Check something specific"
      subtitle="Got a message Aegis hasn't seen? Paste it for a full forensic scan. (Pre-filled from your latest flagged item — just hit scan.)"
      acc="warn"
      eyebrow="Manual deep scan"
    >
      {examples.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">Or try a specimen:</span>
          {examples.map((ex) => (
            <button key={ex.id} onClick={() => useExample(ex)} disabled={busy}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition hover:text-white disabled:opacity-50 ${ex.tone === 'scam' ? 'border-bad/30 text-bad hover:bg-bad/10' : 'border-safe/30 text-safe hover:bg-safe/10'}`}>
              {ex.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
            placeholder="Paste the email, bill, message or call transcript here…"
            className="inp resize-y text-sm" />
          <div className="mt-3 flex items-center gap-3">
            {text && <button onClick={() => { setText(''); setRes(null); setErr('') }} className="text-xs text-slate-500 hover:text-white">clear</button>}
            <button onClick={() => scan()} disabled={busy} className="btn-primary ml-auto !py-2 text-sm">
              {busy ? 'Scanning…' : 'Run threat scan'} <ArrowIcon className="h-4 w-4" />
            </button>
          </div>
          {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
        </div>

        <div className="rounded-xl border border-line bg-ink-950/50 p-4">
          {!res && !busy && <div className="grid h-full min-h-[14rem] place-items-center text-center text-sm text-slate-600">Your forensic verdict appears here.</div>}
          {busy && <div className="grid h-full min-h-[14rem] place-items-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-warn" /></div>}
          {res && !busy && (
            <div className="animate-fade-up space-y-4">
              <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${meta.chip}`}>
                <span className="font-display text-lg">{vmeta(res.verdict).label}</span>
                <span className="font-mono text-xs uppercase tracking-wider">{res.verdict}</span>
              </div>
              <RiskMeter score={res.risk_score} meta={meta} />
              <div className="grid grid-cols-2 gap-3 border-t border-line/70 pt-3 text-xs">
                <GuardField k="Scam type" v={(res.scam_type || 'none').replace(/_/g, ' ')} />
                <GuardField k="Impersonating" v={res.impersonating || '—'} />
              </div>
              {res.red_flags?.length > 0 && (
                <div>
                  <div className="label mb-1.5">Red flags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {res.red_flags.map((f, i) => (
                      <span key={i} className="rounded-md border border-bad/25 bg-bad/5 px-2 py-0.5 text-[11px] text-bad">⚑ {f}</span>
                    ))}
                  </div>
                </div>
              )}
              {(res.extracted?.payee || res.extracted?.amount || res.extracted?.account_last4) && (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-ink-900/60 p-3 text-xs">
                  <GuardField k="Payee" v={res.extracted.payee || '—'} />
                  <GuardField k="Amount" v={res.extracted.amount ? usd(res.extracted.amount) : '—'} />
                  <GuardField k="Account" v={res.extracted.account_last4 ? `••${res.extracted.account_last4}` : '—'} />
                </div>
              )}
              <div className="rounded-lg border border-warn/25 bg-warn/5 p-3">
                <div className="label text-warn">Do this now</div>
                <p className="mt-1 text-sm text-slate-200">{res.recommended_action}</p>
                {res.safe_next_step && <p className="mt-2 text-xs italic text-slate-400">Safe next step: {res.safe_next_step}</p>}
              </div>
              {payee && res.verdict !== 'safe' && (
                <button onClick={freezePayee} disabled={alreadyFrozen || froze}
                  className={`btn w-full !py-2 text-sm ${alreadyFrozen || froze ? 'border border-bad/30 text-bad' : 'btn-ghost border-bad/40 text-bad hover:bg-bad/10'}`}>
                  <LockIcon className="h-4 w-4" />
                  {alreadyFrozen || froze ? `“${payee}” is frozen — Aegis won't pay it` : `Freeze “${payee}” so Aegis never pays it`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  )
}

/* ================================================= 4. INBOX TRIAGE (live agent) */
function InboxTriage({ agentName }) {
  const [task, setTask] = useState('Triage my inbox: flag anything that looks like a scam, hold suspicious payments, and tell me what you did and why.')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(null)
  const [err, setErr] = useState('')

  async function go() {
    if (!task.trim()) return
    setBusy(true); setErr(''); setRun(null)
    try {
      const d = await api.agentTask({ task })
      setRun(d.run)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not run the agent — check the API / LLM keys.')
    } finally { setBusy(false) }
  }

  return (
    <WidgetShell
      title={`Send ${agentName} on a deeper run`}
      subtitle="Runs the live, insured agent against a safe copy of your account — no money moves — and shows its real tool-by-tool reasoning."
      acc="info"
      eyebrow="Live agent run"
      live
      right={<button onClick={go} disabled={busy} className="btn-ghost whitespace-nowrap border-info/30 hover:border-info/60">{busy ? 'Running…' : run ? 'Run again' : `Run ${agentName}`}</button>}
    >
      <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2}
        placeholder="Tell Aegis what to do…" className="inp resize-y text-sm" />
      {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
      <div className="mt-4">
        {!run && !busy && <p className="rounded-xl border border-line bg-ink-950/50 p-6 text-center text-sm text-slate-600">The agent's tool-call log, messages and report will stream in here.</p>}
        {busy && <div className="grid place-items-center py-10"><span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-info" /></div>}
        {run && !busy && <RunTimeline run={run} agent={agentName} />}
      </div>
    </WidgetShell>
  )
}

/* ================================================== 5. FREEZE VAULT (hold/unhold) */
function FreezeVault({ frozen, onFreeze, onUnfreeze }) {
  const [payee, setPayee] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!payee.trim()) { setErr('Enter a payee to freeze.'); return }
    setBusy(true); setErr('')
    const ok = await onFreeze(payee.trim(), reason.trim() || 'Frozen from the Aegis console')
    setBusy(false)
    if (ok) { setPayee(''); setReason('') } else setErr('Could not freeze that payee.')
  }

  return (
    <WidgetShell
      title="Freeze vault"
      subtitle="Any payee you freeze here is one Aegis will never pay — no matter how convincing the message."
      acc="bad"
      eyebrow={`Payment blocklist · ${frozen.length} frozen`}
    >
      <div className="grid gap-2 sm:grid-cols-[1.3fr_1.3fr_auto]">
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Payee name (e.g. Greenoak Rentals)" className="inp text-sm" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="inp text-sm" />
        <button onClick={add} disabled={busy} className="btn-ghost whitespace-nowrap border-bad/40 text-bad hover:bg-bad/10"><LockIcon className="h-4 w-4" /> Freeze</button>
      </div>
      {err && <div className="mt-2 text-xs text-bad">{err}</div>}

      <div className="mt-4 space-y-2">
        {frozen.length === 0 ? (
          <p className="rounded-xl border border-line bg-ink-950/50 px-4 py-6 text-center text-sm text-slate-600">Nothing frozen yet. Confirm a freeze from the threat feed — or add one here.</p>
        ) : frozen.map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-bad/25 bg-bad/5 px-4 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <LockIcon className="h-3.5 w-3.5 text-bad" /> {f.payee}
                {f.account_last4 && <span className="font-mono text-xs text-slate-500">••{f.account_last4}</span>}
              </div>
              {(f.reason || f.source) && <div className="truncate text-xs text-slate-500">{f.reason}{f.source ? ` · via ${f.source}` : ''}</div>}
            </div>
            <button onClick={() => onUnfreeze(f.payee)} className="shrink-0 text-xs text-slate-500 hover:text-white">unfreeze</button>
          </div>
        ))}
      </div>
    </WidgetShell>
  )
}

/* ================================================= 6. ACTIVITY + INSURANCE */
function ActivityFeed({ runs, agentName }) {
  const list = (runs || []).slice().reverse()
  return (
    <WidgetShell title="What Aegis did" subtitle="Every live run, newest first." acc="info" eyebrow={`Activity · ${list.length}`}>
      {list.length === 0 ? (
        <p className="rounded-xl border border-line bg-ink-950/50 px-4 py-8 text-center text-sm text-slate-600">No deeper runs yet — send Aegis on a run above and its work shows up here.</p>
      ) : (
        <div className="max-h-[32rem] space-y-5 overflow-y-auto pr-1">
          {list.map((r, i) => (
            <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>{r.agent || agentName}</span>
                <span className="font-mono">{r.ts ? new Date(r.ts).toLocaleString() : ''}</span>
              </div>
              <RunTimeline run={r} agent={r.agent || agentName} />
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

function InsuranceStrip({ agent, customer }) {
  const cert = customer?.certificate || {}
  const claims = customer?.claims || []
  const limit = agent?.quote?.per_incident_limit_usd || cert.per_incident_limit_usd || 0
  return (
    <WidgetShell title="Insurance & claims" subtitle="Mistakes Aegis makes inside your mandate are covered. File and track claims here." acc="safe" eyebrow="Backstop policy">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-safe/25 bg-safe/5 p-4">
          <div className="label text-safe">Per-incident cover</div>
          <div className="stat-num mt-1 text-2xl text-white">{usd(limit, 0)}</div>
        </div>
        <div className="rounded-xl border border-line bg-ink-900/50 p-4">
          <div className="label">Certificate</div>
          <div className="mt-1 truncate font-mono text-sm text-slate-300">{cert.certificate_id || '—'}</div>
        </div>
        <div className="rounded-xl border border-line bg-ink-900/50 p-4">
          <div className="label">Claims filed</div>
          <div className="stat-num mt-1 text-2xl text-white">{claims.length}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-ink-950/50 px-4 py-3">
        <span className="text-sm text-slate-400">Something slipped through? Open a claim with the evidence.</span>
        <Link to="/claims" className="btn-ghost !py-2 text-sm">Go to claims <ArrowIcon className="h-4 w-4" /></Link>
      </div>
    </WidgetShell>
  )
}

/* ================================================================= PAGE ROOT */
export default function AegisPage({ agentId, agent, customer: customerProp, agentName }) {
  const name = agentName || agent?.name || 'Aegis'
  const [customer, setCustomer] = useState(customerProp || null)
  useEffect(() => { if (customerProp) setCustomer(customerProp) }, [customerProp])

  // live sweep posture lifted up so the banner + hero + deep-scan seed can share it
  const [sweepStatus, setSweepStatus] = useState('loading')
  const [sweepCounts, setSweepCounts] = useState(null)
  const [sweepSeed, setSweepSeed] = useState('') // latest flagged item → pre-seeds the manual box
  const resweepRef = useRef(null)

  function handleSweep(s) {
    if (s.counts) setSweepCounts(s.counts)
    // pre-seed the manual deep scan from the top flagged item
    const flagged = (s.items || []).find((i) => i.verdict !== 'safe')
    if (flagged) {
      const seedText = [
        flagged.channel === 'call' ? `Call from ${flagged.sender}` : `From: ${flagged.sender}`,
        flagged.subject ? `Subject: ${flagged.subject}` : '',
        flagged.reason || '',
        flagged.payee ? `Payee: ${flagged.payee}` : '',
        flagged.amount ? `Amount: $${flagged.amount}` : '',
      ].filter(Boolean).join('\n')
      setSweepSeed(seedText)
    }
  }

  const frozen = customer?.frozen || []
  const frozenNames = frozen.map((f) => String(f.payee || '').toLowerCase())
  const runs = customer?.runs || []

  async function freeze(payee, reason, account_last4) {
    try {
      const state = await api.hold({ payee, reason, account_last4, source: 'aegis' })
      if (state) setCustomer(state)
      return true
    } catch { return false }
  }
  async function unfreeze(payee) {
    try {
      const state = await api.unhold(payee)
      if (state) setCustomer(state)
    } catch { /* ignore */ }
  }

  const kpis = { flagged: (sweepCounts?.scam || 0) + (sweepCounts?.caution || 0), frozen: frozen.length }

  return (
    <div className="space-y-6">
      <TrustStrip agent={agent} customer={customer} kpis={kpis} />

      <PostureBanner
        status={sweepStatus}
        counts={sweepCounts}
        sweeping={sweepStatus === 'loading'}
        onResweep={() => resweepRef.current?.()}
      />

      <ThreatFeed
        sweepRef={resweepRef}
        onSweepResult={handleSweep}
        onStatus={setSweepStatus}
        onFreeze={freeze}
        frozenNames={frozenNames}
      />

      <DeepScan onFreeze={freeze} frozenNames={frozenNames} seed={sweepSeed} />

      <div className="grid gap-6 lg:grid-cols-2">
        <InboxTriage agentName={name} />
        <FreezeVault frozen={frozen} onFreeze={freeze} onUnfreeze={unfreeze} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <ActivityFeed runs={runs} agentName={name} />
        <InsuranceStrip agent={agent} customer={customer} />
      </div>
    </div>
  )
}
