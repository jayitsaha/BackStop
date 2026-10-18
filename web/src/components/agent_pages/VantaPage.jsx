/* ============================================================================
   VANTA — bot-detection / abuse-defense console  (bespoke "My account" page)

   PHASE 1 · IDEATE — the killer bot-defense utilities
     Vanta's real job (per its system_prompt): read traffic logs / signup bursts /
     request patterns, identify bots, scrapers, credential-stuffing and fake
     accounts, explain the EVIDENCE, score confidence, and recommend precise
     mitigations (rate-limit / CAPTCHA / block) — never blocking real users
     without proof. The experience is AUTOMATED-FIRST: Vanta is already watching.
       • Live Monitor     — on mount, zero input, Vanta synthesizes + analyzes the
                            CURRENT traffic window and keeps re-checking (~15s).
       • Blocklist        — auto-proposes flagged bots; one tap to confirm / undo.
       • Traffic Mix      — human vs suspect vs bot from the live window (chart).
       • Log Triage       — SECONDARY: analyze your own pasted logs.
       • Live Fingerprint — one user-agent/IP/behaviour → instant verdict.
       • Ask Vanta        — freeform tool-use loop for anything else.
     Plus the trust strip and an activity + insurance strip.

   PHASE 2 · PLAN — widgets + endpoints
     Trust strip      ← agent record (name, tagline, grade, quote, marks)
     Live Monitor     ← POST /apps/vanta/live {window}   (on mount + every ~15s)
                        → headline · gauge · signals · entities · mitigations
     Traffic Mix      ← breakdown[] from the live result (Recharts bar)
     Blocklist        ← client-side, auto-proposed from live bots (confirm/undo)
     Log Triage       ← POST /apps/vanta/analyze {logs}          (secondary)
     Live Fingerprint ← POST /apps/vanta/fingerprint {...}
     Ask Vanta        ← api.agentTask({task}) → live tool-call log + report
     Activity feed    ← customer.runs           Insurance strip → /claims

   PHASE 3 · BUILD — wired below to the real structured backend results.
   ========================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../../api'
import { cents } from '../../lib/format'
import { GradePill, VerifiedMark, ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../marks'
import { WidgetShell, accent as accentOf, RunTimeline } from '../widgets/shared.jsx'

const REFRESH_MS = 15000

/* --------------------------------------------------------------- vocabulary */
const CLASS = {
  human: { label: 'Human', text: 'text-safe', chip: 'border-safe/30 bg-safe/10 text-safe', dot: 'bg-safe', hex: '#3FD99A' },
  suspect: { label: 'Suspect', text: 'text-warn', chip: 'border-warn/30 bg-warn/10 text-warn', dot: 'bg-warn', hex: '#F2B441' },
  bot: { label: 'Bot', text: 'text-bad', chip: 'border-bad/30 bg-bad/10 text-bad', dot: 'bg-bad', hex: '#FF6A62' },
}
const SEV = {
  low: 'border-info/30 bg-info/10 text-info-soft',
  medium: 'border-warn/30 bg-warn/10 text-warn',
  high: 'border-bad/30 bg-bad/10 text-bad',
}
const SAMPLE_LOGS = `185.220.101.5 - - GET /login 200 UA="python-requests/2.28" (412 reqs / 60s)
45.9.148.3 - - POST /signup 200 UA="curl/7.88" email=a9f3@mailinator.com
45.9.148.3 - - POST /signup 200 UA="curl/7.88" email=b2k1@mailinator.com
45.9.148.3 - - POST /signup 200 UA="curl/7.88" email=z7p0@mailinator.com
73.11.44.2 - - GET /products 200 UA="Mozilla/5.0 (Macintosh) Chrome/120" (3 reqs / 5m)
66.249.66.1 - - GET /sitemap.xml 200 UA="Googlebot/2.1"
104.28.5.9 - - GET /api/pricing 429 UA="Go-http-client/2.0" (scraping, 60 rpm)`

/* ------------------------------------------------------------- bot-score gauge */
function BotGauge({ score = 0, confidence = 0 }) {
  const cls = score >= 66 ? CLASS.bot : score >= 33 ? CLASS.suspect : CLASS.human
  const r = 52
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div className="relative grid place-items-center">
      <svg viewBox="0 0 140 140" className="h-40 w-40 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#242b3b" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke={cls.hex} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} className="transition-all duration-700"
          style={{ filter: `drop-shadow(0 0 8px ${cls.hex}66)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`stat-num text-4xl ${cls.text}`}>{score}</span>
        <span className="label mt-0.5">bot score</span>
        <span className={`chip mt-2 !px-2 !py-0.5 text-[10px] ${cls.chip}`}>{cls.label}-leaning</span>
      </div>
      {confidence ? (
        <div className="mt-3 text-center text-[11px] text-slate-500">
          confidence <b className="text-slate-300">{Math.round(confidence * 100)}%</b>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------- reusable analysis body (gauge + lists) */
function AnalysisBody({ a, onBlock, blockedIds }) {
  if (!a) return null
  return (
    <div className="space-y-5">
      <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
        <BotGauge score={a.bot_score} confidence={a.confidence} />
        <div>
          <div className="label mb-1">Verdict</div>
          <p className="text-sm leading-relaxed text-slate-200">{a.verdict || '—'}</p>
          <div className="mt-3 flex gap-4 text-sm">
            <span className="text-slate-400">Human <b className="text-safe">{a.human_pct}%</b></span>
            <span className="text-slate-400">Bot <b className="text-bad">{a.bot_score}%</b></span>
          </div>
        </div>
      </div>

      {a.signals?.length > 0 && (
        <div>
          <div className="label mb-2">Signals</div>
          <div className="space-y-2">
            {a.signals.map((s, i) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-ink-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-200">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.detail}</div>
                </div>
                <span className={`chip shrink-0 !px-2 !py-0.5 text-[10px] ${SEV[s.severity] || SEV.medium}`}>{s.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {a.entities?.length > 0 && (
        <div>
          <div className="label mb-2">Classified clients</div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-ink-900/40">
                  <th className="label px-3 py-2">Client</th>
                  <th className="label px-3 py-2">Class</th>
                  <th className="label px-3 py-2">Score</th>
                  <th className="label px-3 py-2">Evidence</th>
                  <th className="label px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {a.entities.map((e, i) => {
                  const c = CLASS[e.classification] || CLASS.suspect
                  const blocked = blockedIds?.has(e.id)
                  return (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{e.id}</td>
                      <td className="px-3 py-2"><span className={`chip !px-2 !py-0.5 text-[10px] ${c.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />{c.label}</span></td>
                      <td className={`px-3 py-2 font-mono ${c.text}`}>{e.score}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{e.reason}</td>
                      <td className="px-3 py-2 text-right">
                        {e.classification !== 'human' && (
                          <button onClick={() => onBlock?.(e.id, e.reason)} disabled={blocked} className="text-xs text-slate-400 hover:text-bad disabled:text-slate-600">
                            {blocked ? 'blocked' : 'block'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {a.recommended_mitigations?.length > 0 && (
        <div>
          <div className="label mb-2">Recommended mitigations</div>
          <div className="flex flex-wrap gap-2">
            {a.recommended_mitigations.map((m, i) => (
              <span key={i} className="chip border-warn/30 bg-warn/10 text-warn">{m}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ====================================================================== PAGE */
export default function VantaPage({ agentId, agent = {}, customer = {}, agentName }) {
  const acc = accentOf(agent.accent || 'warn')
  const name = agent.name || agentName || 'Vanta'
  const quote = agent.quote || {}
  const grade = agent.grade || {}
  const runs = Array.isArray(customer.runs) ? customer.runs : []

  // ---- Live monitor state
  const [live, setLive] = useState(null)
  const [liveLoading, setLiveLoading] = useState(true)   // true until the first tick lands
  const [liveErr, setLiveErr] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastTick, setLastTick] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const busyRef = useRef(false)

  // ---- Blocklist (client-side, demo). entries: {id, status:'proposed'|'confirmed', reason, auto}
  const [blocklist, setBlocklist] = useState([])
  const [dismissed, setDismissed] = useState(() => new Set())   // ids the user undid — don't re-propose
  const [blockInput, setBlockInput] = useState('')

  // ---- Manual log triage
  const [logs, setLogs] = useState('')
  const [manual, setManual] = useState(null)
  const [mBusy, setMBusy] = useState(false)
  const [mErr, setMErr] = useState('')

  // ---- Fingerprint state
  const [fp, setFp] = useState({ user_agent: '', ip: '', behavior: '' })
  const [fpRes, setFpRes] = useState(null)
  const [fpBusy, setFpBusy] = useState(false)
  const [fpErr, setFpErr] = useState('')

  // ---- Ask Vanta state
  const [task, setTask] = useState('')
  const [askRun, setAskRun] = useState(null)
  const [askBusy, setAskBusy] = useState(false)
  const [askErr, setAskErr] = useState('')

  const blockedIds = useMemo(() => new Set(blocklist.map((b) => b.id)), [blocklist])

  // --- blocklist mutators
  function proposeBots(entities) {
    const bots = (entities || []).filter((e) => e.classification === 'bot')
    setBlocklist((prev) => {
      const have = new Set(prev.map((b) => b.id))
      const add = bots
        .filter((b) => !have.has(b.id) && !dismissed.has(b.id))
        .map((b) => ({ id: b.id, status: 'proposed', reason: b.reason, auto: true }))
      return add.length ? [...prev, ...add] : prev
    })
  }
  function addConfirmed(id, reason) {
    const v = String(id || '').trim()
    if (!v) return
    setDismissed((prev) => { const n = new Set(prev); n.delete(v); return n })
    setBlocklist((prev) => {
      const i = prev.findIndex((b) => b.id === v)
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], status: 'confirmed' }; return next }
      return [...prev, { id: v, status: 'confirmed', reason, auto: false }]
    })
  }
  function confirmEntry(id) {
    setBlocklist((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'confirmed' } : b)))
  }
  function removeEntry(id, remember = true) {
    setBlocklist((prev) => prev.filter((b) => b.id !== id))
    if (remember) setDismissed((prev) => new Set(prev).add(id))
  }

  // --- live monitoring tick
  async function fetchLive() {
    if (busyRef.current) return
    busyRef.current = true
    setRefreshing(true); setLiveErr('')
    try {
      const r = await api.post('/apps/vanta/live', { window: 'last 60s', agent_id: agentId })
      setLive(r)
      setLastTick(Date.now())
      proposeBots(r.entities)
    } catch (e) {
      setLiveErr(e?.response?.data?.detail || 'Live monitor could not reach Vanta.')
    } finally {
      setLiveLoading(false)
      setRefreshing(false)
      busyRef.current = false
    }
  }

  // run once on mount + auto-refresh loop (cleans up on unmount / toggle off)
  useEffect(() => {
    fetchLive()
    if (!autoRefresh) return
    const iv = setInterval(fetchLive, REFRESH_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, agentId])

  async function runAnalyze() {
    if (!logs.trim() || mBusy) return
    setMBusy(true); setMErr(''); setManual(null)
    try {
      const r = await api.post('/apps/vanta/analyze', { logs, agent_id: agentId })
      setManual(r)
      proposeBots(r.entities)
    } catch (e) {
      setMErr(e?.response?.data?.detail || 'Analysis failed. Try again.')
    } finally {
      setMBusy(false)
    }
  }

  async function runFingerprint() {
    if (!fp.user_agent.trim() || fpBusy) return
    setFpBusy(true); setFpErr(''); setFpRes(null)
    try {
      const r = await api.post('/apps/vanta/fingerprint', { ...fp, agent_id: agentId })
      setFpRes(r)
    } catch (e) {
      setFpErr(e?.response?.data?.detail || 'Fingerprint failed.')
    } finally {
      setFpBusy(false)
    }
  }

  async function runAsk() {
    if (!task.trim() || askBusy) return
    setAskBusy(true); setAskErr(''); setAskRun(null)
    try {
      const r = await api.agentTask({ task, agent: agentId })
      setAskRun(r?.run || r)
    } catch (e) {
      setAskErr(e?.response?.data?.detail || 'Vanta could not run that task.')
    } finally {
      setAskBusy(false)
    }
  }

  const chartData = useMemo(() => (live?.breakdown || []).map((b) => ({ ...b })), [live])
  const liveBots = useMemo(() => (live?.entities || []).filter((e) => e.classification === 'bot').length, [live])
  const liveSources = (live?.entities || []).length
  const proposedCount = blocklist.filter((b) => b.status === 'proposed').length

  return (
    <div className="space-y-6">
      {/* =============================================== TRUST / IDENTITY STRIP */}
      <div className="card-raised relative overflow-hidden p-6 sm:p-7">
        <div className="mesh" style={{ top: '-120px', right: '-4%', height: 260, width: 320, background: acc.fill }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className={`eyebrow mb-2 ${acc.text}`}>
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${acc.dot} opacity-60`} />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${acc.dot}`} />
              </span>
              Bot defense · monitoring live
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">{name}</h1>
            {/* proactive, agent-is-defending headline */}
            <p className="mt-2 max-w-xl text-lg text-slate-300">
              {liveLoading ? (
                <span className="text-slate-500">Vanta is reading your live traffic…</span>
              ) : liveBots > 0 ? (
                <>Vanta is auto-blocking <b className="text-bad">{liveBots}</b> {liveBots === 1 ? 'bot' : 'bots'} across <b className="text-white">{liveSources}</b> monitored sources right now.</>
              ) : (
                <>Vanta is watching <b className="text-white">{liveSources || '—'}</b> sources — traffic looks clean right now.</>
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <VerifiedMark />
              <GradePill grade={grade.grade} score={grade.score} />
              <span className="chip border-safe/30 bg-safe/10 text-safe">
                <LockIcon className="h-3.5 w-3.5" /> Insured · {cents(quote.gross_premium_usd)}/call
              </span>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <Stat acc={acc} label="Premium" value={cents(quote.gross_premium_usd)} sub="per analyzed call" />
            <Stat acc={acc} label="Covered limit" value={quote.per_incident_limit_usd ? `$${Number(quote.per_incident_limit_usd).toLocaleString('en-US')}` : '—'} sub="per incident" />
          </div>
        </div>
      </div>

      {/* =============================================== LIVE MONITOR + TRAFFIC MIX */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <WidgetShell
          title="Live traffic monitor"
          subtitle="Vanta continuously samples and classifies your current traffic window — no input needed."
          acc={agent.accent || 'warn'}
          eyebrow={refreshing ? 'Scanning…' : 'Live'}
          live
          right={
            <div className="flex items-center gap-3">
              {lastTick && !refreshing && <span className="text-[11px] text-slate-600">updated {timeAgo(lastTick)}</span>}
              <button
                type="button"
                onClick={() => setAutoRefresh((v) => !v)}
                className={`chip !px-2.5 !py-1 text-[11px] ${autoRefresh ? 'border-safe/30 bg-safe/10 text-safe' : 'text-slate-400'}`}
                title="Toggle continuous monitoring"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? 'bg-safe animate-pulse' : 'bg-slate-600'}`} />
                {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
              </button>
              <button type="button" onClick={fetchLive} disabled={refreshing} className="text-xs text-slate-500 hover:text-white disabled:opacity-50">
                refresh now
              </button>
            </div>
          }
        >
          {liveErr && <div className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{liveErr}</div>}
          {liveLoading && !live ? (
            <WatchingSkeleton />
          ) : (
            <div className={`animate-fade-up ${refreshing ? 'opacity-70 transition-opacity' : ''}`}>
              <AnalysisBody a={live} onBlock={addConfirmed} blockedIds={blockedIds} />
            </div>
          )}
        </WidgetShell>

        {/* TRAFFIC MIX chart */}
        <WidgetShell title="Traffic mix" subtitle="Human vs suspect vs bot in the current window." acc={agent.accent || 'warn'} eyebrow="Live composition" live={autoRefresh}>
          {chartData.length === 0 ? (
            <div className="grid h-56 place-items-center text-center text-sm text-slate-600">Reading the live window…</div>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="#242b3b" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} stroke="#242b3b" />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} stroke="#242b3b" />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      contentStyle={{ background: '#0E121B', border: '1px solid #242b3b', borderRadius: 12, color: '#fff' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(v, _n, p) => [`${v}%`, p?.payload?.label]}
                    />
                    <Bar dataKey="pct" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={(CLASS[d.key] || CLASS.suspect).hex} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex justify-around text-center">
                {chartData.map((d, i) => {
                  const c = CLASS[d.key] || CLASS.suspect
                  return (
                    <div key={i}>
                      <div className={`stat-num text-xl ${c.text}`}>{d.pct}%</div>
                      <div className="label mt-0.5">{d.label}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </WidgetShell>
      </div>

      {/* =============================================== BLOCKLIST + FINGERPRINT */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* BLOCKLIST */}
        <WidgetShell
          title="Auto-blocklist"
          subtitle="Vanta proposes every client it flags as a bot. Confirm to block, or undo to let it through."
          acc={agent.accent || 'warn'}
          eyebrow="Mitigation"
          right={<span className="chip !px-2 !py-0.5 text-[10px] text-slate-400">{proposedCount} proposed · {blocklist.length - proposedCount} confirmed</span>}
        >
          <div className="flex gap-2">
            <input
              className="inp text-sm"
              placeholder="Add an IP, user-agent or email…"
              value={blockInput}
              onChange={(e) => setBlockInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { addConfirmed(blockInput); setBlockInput('') } }}
            />
            <button onClick={() => { addConfirmed(blockInput); setBlockInput('') }} disabled={!blockInput.trim()} className="btn-ghost whitespace-nowrap !py-2 text-sm">Block</button>
          </div>
          <div className="mt-4">
            {blocklist.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing flagged yet. As Vanta spots bots they'll queue here for one-tap confirmation.</p>
            ) : (
              <div className="space-y-2">
                {blocklist.map((b) => {
                  const proposed = b.status === 'proposed'
                  return (
                    <div key={b.id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${proposed ? 'border-warn/30 bg-warn/5' : 'border-bad/30 bg-bad/5'}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <LockIcon className={`h-3.5 w-3.5 shrink-0 ${proposed ? 'text-warn' : 'text-bad'}`} />
                        <span className="truncate font-mono text-xs text-slate-200">{b.id}</span>
                        <span className={`chip !px-1.5 !py-0 text-[9px] ${proposed ? 'border-warn/30 text-warn' : 'text-slate-500'}`}>{proposed ? 'proposed' : 'blocked'}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {proposed && <button onClick={() => confirmEntry(b.id)} className="text-xs text-safe hover:underline">confirm</button>}
                        <button onClick={() => removeEntry(b.id)} className="text-xs text-slate-400 hover:text-white">{proposed ? 'undo' : 'remove'}</button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </WidgetShell>

        {/* LIVE FINGERPRINT */}
        <WidgetShell title="Live fingerprint" subtitle="One request in, one verdict out — paste a user-agent (plus IP / behaviour) for an instant call." acc={agent.accent || 'warn'} eyebrow="Single request">
          <div className="space-y-2.5">
            <input className="inp text-sm" placeholder='User-Agent  e.g. "python-requests/2.28" or a real browser UA' value={fp.user_agent} onChange={(e) => setFp({ ...fp, user_agent: e.target.value })} />
            <div className="grid grid-cols-2 gap-2.5">
              <input className="inp text-sm" placeholder="IP (optional)" value={fp.ip} onChange={(e) => setFp({ ...fp, ip: e.target.value })} />
              <input className="inp text-sm" placeholder="Behaviour (optional)" value={fp.behavior} onChange={(e) => setFp({ ...fp, behavior: e.target.value })} />
            </div>
            <button onClick={runFingerprint} disabled={fpBusy || !fp.user_agent.trim()} className="btn-ghost !py-2 text-sm">
              {fpBusy ? 'Fingerprinting…' : 'Fingerprint request'}
            </button>
          </div>
          {fpErr && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{fpErr}</div>}
          {fpRes && (() => {
            const c = CLASS[fpRes.classification] || CLASS.suspect
            return (
              <div className={`mt-4 animate-fade-up rounded-xl border p-4 ${c.chip}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-lg font-semibold">
                    {fpRes.classification === 'bot' ? <XIcon className="h-4 w-4" /> : fpRes.classification === 'human' ? <CheckIcon className="h-4 w-4" /> : null}
                    {c.label}
                  </span>
                  <span className="font-mono text-sm">score {fpRes.score} · conf {Math.round((fpRes.confidence || 0) * 100)}%</span>
                </div>
                {fpRes.reasons?.length > 0 && (
                  <ul className="mt-2 ml-4 list-disc space-y-0.5 text-xs text-slate-300">
                    {fpRes.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {fpRes.classification !== 'human' && (
                  <button onClick={() => addConfirmed(fpRes.echo?.ip || fpRes.echo?.user_agent, (fpRes.reasons || [])[0])} className="mt-3 text-xs underline hover:text-white">
                    add to blocklist
                  </button>
                )}
              </div>
            )
          })()}
        </WidgetShell>
      </div>

      {/* =============================================== SECONDARY: ANALYZE YOUR OWN LOGS */}
      <WidgetShell
        title="Analyze your own logs"
        subtitle="Already have access logs or a signup dump? Paste them and Vanta runs the same analysis on demand."
        acc={agent.accent || 'warn'}
        eyebrow="On demand"
        right={<button type="button" onClick={() => setLogs(SAMPLE_LOGS)} className="text-xs text-slate-500 hover:text-white">load sample</button>}
      >
        <textarea
          value={logs}
          onChange={(e) => setLogs(e.target.value)}
          placeholder={'185.220.101.5 GET /login UA="python-requests/2.28"\n45.9.148.3 POST /signup email=a9f3@mailinator.com ...'}
          className="inp h-32 resize-y font-mono text-xs leading-relaxed"
        />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={runAnalyze} disabled={mBusy || !logs.trim()} className="btn-ghost !py-2 text-sm">
            {mBusy ? 'Scanning…' : 'Analyze these logs'}
          </button>
          {manual && <span className="text-xs text-slate-500">{(manual.entities || []).length} clients classified</span>}
        </div>
        {mErr && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{mErr}</div>}
        {manual && <div className="mt-5 animate-fade-up"><AnalysisBody a={manual} onBlock={addConfirmed} blockedIds={blockedIds} /></div>}
      </WidgetShell>

      {/* =============================================== ASK VANTA (freeform) */}
      <WidgetShell title={`Ask ${name}`} subtitle="Anything the tools above don't cover — Vanta runs its live tool-use loop and shows every step and its report." acc={agent.accent || 'warn'} eyebrow="Agent task">
        <div className="flex gap-2">
          <input
            className="inp text-sm"
            placeholder="e.g. Which paths are being scraped and what rate limits should I set?"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runAsk() }}
          />
          <button onClick={runAsk} disabled={askBusy || !task.trim()} className="btn-primary whitespace-nowrap !py-2 text-sm">
            {askBusy ? 'Working…' : 'Run'}
          </button>
        </div>
        {askErr && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{askErr}</div>}
        {askBusy && !askRun && <div className="mt-4 text-sm text-slate-500">Vanta is working through the request…</div>}
        {askRun && (
          <div className="mt-4 rounded-xl border border-line bg-ink-900/40 p-4">
            <RunTimeline run={askRun} agent={name} />
          </div>
        )}
      </WidgetShell>

      {/* =============================================== ACTIVITY + INSURANCE */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <WidgetShell title="Activity" subtitle="Everything Vanta has run on your account." acc={agent.accent || 'warn'} eyebrow="History">
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet. Vanta is monitoring in the background — ask it a question to log a run.</p>
          ) : (
            <div className="space-y-5">
              {[...runs].reverse().map((run, i) => (
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
        </WidgetShell>

        {/* INSURANCE STRIP */}
        <WidgetShell title="Coverage" subtitle="Every verdict Vanta ships is insured by Backstop." acc="safe" eyebrow="Protected">
          <div className="space-y-3">
            <div className="rounded-xl border border-safe/30 bg-safe/5 p-4">
              <div className="flex items-center gap-2 text-safe">
                <ShieldIcon className="h-4 w-4" />
                <span className="font-display text-lg">Grade {grade.grade || '—'}{grade.score != null ? ` · ${grade.score}` : ''}</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">Crash-tested and bound. A covered misclassification that slips through is claimable up to the per-incident limit.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-ink-900/40 p-4">
                <div className="stat-num text-xl text-safe">{quote.per_incident_limit_usd ? `$${Number(quote.per_incident_limit_usd).toLocaleString('en-US')}` : '—'}</div>
                <div className="label mt-1">Per-incident limit</div>
              </div>
              <div className="rounded-xl border border-line bg-ink-900/40 p-4">
                <div className="stat-num text-xl text-white">{cents(quote.gross_premium_usd)}</div>
                <div className="label mt-1">Premium / call</div>
              </div>
            </div>
            <a href="/claims" className="btn-ghost w-full justify-between !py-2.5 text-sm">
              File or track a claim <ArrowIcon className="h-4 w-4" />
            </a>
          </div>
        </WidgetShell>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ bits */
function Stat({ acc, label, value, sub }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900/40 px-4 py-3">
      <div className={`stat-num text-2xl ${acc.text}`}>{value}</div>
      <div className="label mt-1">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-600">{sub}</div>}
    </div>
  )
}

function WatchingSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warn" />
        </span>
        Vanta is watching your traffic…
      </div>
      <div className="mt-5 grid items-center gap-5 sm:grid-cols-[auto_1fr]">
        <div className="h-40 w-40 animate-pulse rounded-full border-[12px] border-line/60" />
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-line" />
          <div className="h-3 w-full animate-pulse rounded bg-line/70" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-line/50" />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-line/40" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  )
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return `${m}m ago`
}
