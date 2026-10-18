import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api'
import { CheckIcon, XIcon } from '../components/marks'
import { Reveal, Stagger, stagItem } from '../components/ui/motion.jsx'
import { GlowBackdrop, GoldRule } from '../components/ui/Backdrop.jsx'

const RISK = {
  safe: { label: 'Safe', chip: 'border-safe/30 bg-safe/10 text-safe', dot: 'bg-safe' },
  caution: { label: 'Caution', chip: 'border-warn/30 bg-warn/10 text-warn', dot: 'bg-warn' },
  scam: { label: 'Scam', chip: 'border-bad/30 bg-bad/10 text-bad', dot: 'bg-bad' },
}
const SPK = ['bg-info/20 text-info-soft', 'bg-brand/20 text-brand-soft', 'bg-safe/20 text-safe', 'bg-warn/20 text-warn']
const fmt = (ms) => (ms ? new Date(ms).toLocaleTimeString() : '')

export default function Calls() {
  const [list, setList] = useState([])
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const selRef = useRef(null)
  selRef.current = sel

  // poll the list every 3s
  useEffect(() => {
    let alive = true
    const tick = () => api.calls().then((d) => alive && setList(d)).catch(() => {})
    tick()
    const iv = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [])

  // poll the selected call every 2s
  useEffect(() => {
    if (!sel) {
      setDetail(null)
      return
    }
    let alive = true
    const tick = () => api.call(sel).then((d) => alive && selRef.current === sel && setDetail(d)).catch(() => {})
    tick()
    const iv = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [sel])

  // auto-select the most recent active call
  useEffect(() => {
    if (!sel && list.length) setSel(list[0].room)
  }, [list, sel])

  return (
    <div className="space-y-7">
      {/* hero */}
      <div className="card relative overflow-hidden p-7 md:p-9">
        <GlowBackdrop intensity={0.8} />
        <Reveal className="relative max-w-3xl">
          <div className="eyebrow mb-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
            </span>
            Call monitor · live
          </div>
          <h1 className="font-display text-5xl font-semibold leading-[0.92] tracking-tighter2 text-white md:text-6xl">
            Live call<br />screening
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
            Every session the guardian screens shows up here in real time — the live transcript (by speaker) and the moment
            it flags a scam. Start one in <span className="text-slate-200">My account → Live call guardian</span>, or route a
            phone call in via SIP.
          </p>
          <GoldRule className="mt-6 max-w-xs" />
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        {/* session list */}
        <Reveal delay={0.05} className="card p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="label">Sessions</div>
            {list.length > 0 && (
              <span className="chip !px-2 !py-0.5 text-[10px] text-slate-400">{list.length} total</span>
            )}
          </div>
          {list.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-slate-500">No call sessions yet. Start a live screening and this fills in.</p>
          ) : (
            <Stagger className="space-y-1.5" gap={0.04}>
              {list.map((c) => {
                const r = RISK[c.risk] || RISK.safe
                const active = c.status === 'active'
                const isSel = sel === c.room
                return (
                  <motion.button
                    key={c.room}
                    variants={stagItem}
                    onClick={() => setSel(c.room)}
                    whileTap={{ scale: 0.985 }}
                    className={`group w-full rounded-card-sm border px-3 py-2.5 text-left transition ${isSel ? 'border-brand/60 bg-brand/10 shadow-glow' : 'border-line bg-ink-900/40 hover:border-brand/40 hover:bg-ink-800/40'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        <span className="relative flex h-2 w-2">
                          {active && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${r.dot} opacity-70`} />}
                          <span className={`relative inline-flex h-2 w-2 rounded-full ${active ? r.dot : 'bg-slate-600'}`} />
                        </span>
                        {active ? 'Live call' : 'Ended'}
                      </span>
                      <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}>{r.label}</span>
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[11px] text-slate-500">{fmt(c.started_at)} · {c.line_count} lines · {c.alert_count} alerts</div>
                    {c.last_text && <div className="mt-0.5 truncate text-xs italic text-slate-600">“{c.last_text}”</div>}
                  </motion.button>
                )
              })}
            </Stagger>
          )}
        </Reveal>

        {/* detail */}
        <Reveal delay={0.1} className="card p-6">
          {!detail ? (
            <div className="grid h-72 place-items-center text-sm text-slate-600">Select a session to watch it live.</div>
          ) : (
            <CallDetail d={detail} />
          )}
        </Reveal>
      </div>
    </div>
  )
}

function CallDetail({ d }) {
  const r = RISK[d.risk] || RISK.safe
  const endRef = useRef(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [d.transcript?.length])
  const active = d.status === 'active'
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="font-display text-2xl tracking-tightish text-white">{active ? 'Live call' : 'Call ended'}</h3>
            <span className={`chip ${r.chip}`}>{d.risk === 'scam' ? <XIcon className="h-3.5 w-3.5" /> : d.risk === 'safe' ? <CheckIcon className="h-3.5 w-3.5" /> : null} {r.label}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">{d.room} · started {fmt(d.started_at)}{d.ended_at ? ` · ended ${fmt(d.ended_at)}` : ''}</div>
        </div>
        {active && (
          <span className="chip border-bad/30 bg-bad/10 text-bad !px-2.5 !py-1 text-[10px] uppercase tracking-[0.18em]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bad" />
            </span>
            Rec
          </span>
        )}
      </div>

      {d.alerts?.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2">Alert timeline</div>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {d.alerts.map((a, i) => {
                const scam = a.severity === 'scam'
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className={`relative overflow-hidden rounded-card-sm border p-3 pl-4 ${scam ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10'}`}
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${scam ? 'bg-bad' : 'bg-warn'}`} />
                    <div className={`flex items-center gap-1.5 text-sm font-semibold ${scam ? 'text-bad' : 'text-warn'}`}>
                      <span aria-hidden>⚠</span> {scam ? 'Scam detected' : 'Caution'} <span className="font-mono text-[11px] font-normal text-slate-500">· {fmt(a.t)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-200">{a.reason}</p>
                    {a.advice && <p className="mt-0.5 text-xs italic text-slate-400">→ {a.advice}</p>}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="label mb-2 mt-6">Transcript</div>
      <div className="h-80 overflow-y-auto rounded-card-sm border border-line bg-ink-950/60 p-4 text-sm leading-relaxed text-slate-300">
        {(!d.transcript || d.transcript.length === 0) && (
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Waiting for speech…
          </span>
        )}
        {(d.transcript || []).map((t, i) => (
          <p key={i} className="flex gap-2 py-0.5">
            {t.speaker != null && <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 font-mono text-[10px] font-medium ${SPK[t.speaker % SPK.length]}`}>S{t.speaker}</span>}
            <span>{t.text}</span>
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
