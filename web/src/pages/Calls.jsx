import { useEffect, useRef, useState } from 'react'
import api from '../api'
import { CheckIcon, XIcon } from '../components/marks'

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
      <header className="max-w-3xl">
        <div className="eyebrow mb-2"><span className="h-2 w-2 rounded-full bg-bad" /> Call monitor · live</div>
        <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">Live call screening</h1>
        <p className="mt-3 text-slate-400">
          Every session the guardian screens shows up here in real time — the live transcript (by speaker) and the moment
          it flags a scam. Start one in <span className="text-slate-200">My account → Live call guardian</span>, or route a
          phone call in via SIP.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        {/* session list */}
        <div className="card p-4">
          <div className="label mb-3 px-2">Sessions</div>
          {list.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500">No call sessions yet. Start a live screening and this fills in.</p>
          ) : (
            <div className="space-y-1.5">
              {list.map((c) => {
                const r = RISK[c.risk] || RISK.safe
                const active = c.status === 'active'
                return (
                  <button
                    key={c.room}
                    onClick={() => setSel(c.room)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${sel === c.room ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-brand/30'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                        <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse ' + r.dot : 'bg-slate-600'}`} />
                        {active ? 'Live call' : 'Ended'}
                      </span>
                      <span className={`chip !px-2 !py-0.5 text-[10px] ${r.chip}`}>{r.label}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{fmt(c.started_at)} · {c.line_count} lines · {c.alert_count} alerts</div>
                    {c.last_text && <div className="mt-0.5 truncate text-xs text-slate-600">“{c.last_text}”</div>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* detail */}
        <div className="card p-6">
          {!detail ? (
            <div className="grid h-72 place-items-center text-sm text-slate-600">Select a session to watch it live.</div>
          ) : (
            <CallDetail d={detail} />
          )}
        </div>
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
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-xl text-white">{d.status === 'active' ? 'Live call' : 'Call ended'}</h3>
            <span className={`chip ${r.chip}`}>{d.risk === 'scam' ? <XIcon className="h-3.5 w-3.5" /> : d.risk === 'safe' ? <CheckIcon className="h-3.5 w-3.5" /> : null} {r.label}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">{d.room} · started {fmt(d.started_at)}{d.ended_at ? ` · ended ${fmt(d.ended_at)}` : ''}</div>
        </div>
      </div>

      {d.alerts?.length > 0 && (
        <div className="mt-4 space-y-2">
          {d.alerts.map((a, i) => (
            <div key={i} className={`rounded-xl border p-3 ${a.severity === 'scam' ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10'}`}>
              <div className={`flex items-center gap-2 text-sm font-semibold ${a.severity === 'scam' ? 'text-bad' : 'text-warn'}`}>
                ⚠ {a.severity === 'scam' ? 'Scam detected' : 'Caution'} <span className="font-normal text-slate-500">· {fmt(a.t)}</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-200">{a.reason}</p>
              {a.advice && <p className="mt-0.5 text-xs italic text-slate-400">→ {a.advice}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="label mb-2 mt-5">Transcript</div>
      <div className="h-80 overflow-y-auto rounded-xl border border-line bg-ink-950/60 p-3 text-sm leading-relaxed text-slate-300">
        {(!d.transcript || d.transcript.length === 0) && <span className="text-slate-600">Waiting for speech…</span>}
        {(d.transcript || []).map((t, i) => (
          <p key={i} className="flex gap-1.5">
            {t.speaker != null && <span className={`mt-0.5 h-fit shrink-0 rounded px-1 font-mono text-[10px] ${SPK[t.speaker % SPK.length]}`}>S{t.speaker}</span>}
            <span>{t.text}</span>
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
