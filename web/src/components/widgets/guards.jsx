import { useEffect, useRef, useState } from 'react'
import api from '../../api'
import { useAsync } from '../../lib/useAsync'
import { useCustomer } from '../../lib/CustomerContext.jsx'
import { usd } from '../../lib/format'
import { ArrowIcon } from '../marks'
import { WidgetShell, RISK, GuardField } from './shared.jsx'

/* ============================================================ message_analyzer
 * Lifted verbatim from the original InboxGuard. props.mode ('fraud'|'generic'),
 * props.accept (['text','image']), props.verdict_labels override RISK labels. */
export function MessageAnalyzer({ section, agentName }) {
  const p = section.props || {}
  const agent = agentName || 'your agent'
  const mode = p.mode || 'fraud'
  const accept = p.accept || ['text', 'image']
  const allowImage = accept.includes('image')
  const ctx = useCustomer()

  const [text, setText] = useState('')
  const [image, setImage] = useState(null) // {name, dataUri}
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  function pickImage(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setImage({ name: f.name, dataUri: reader.result })
    reader.readAsDataURL(f)
  }

  async function analyze(inject = false) {
    if (!text.trim() && !image) {
      setErr('Paste a message or upload a screenshot first.')
      return
    }
    setBusy(true)
    setErr('')
    if (!inject) setRes(null)
    try {
      const r = await api.analyze({ text: text || undefined, image: image?.dataUri, inject, agent: section.agent_id })
      setRes(r.analysis)
      if (inject && r.injected) ctx.refresh?.()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Analysis failed — is the API up?')
    } finally {
      setBusy(false)
    }
  }

  const labels = p.verdict_labels || {}
  const riskMeta = res?.risk ? RISK[res.risk.level] || RISK.caution : null
  const riskLabel = res?.risk ? labels[res.risk.level] || riskMeta.label : null
  const ex = res?.extracted || {}
  const showVerdict = res?.risk && mode !== 'generic'

  return (
    <WidgetShell
      title={section.title || 'Is this real? Paste it and find out.'}
      subtitle={section.subtitle || `Forward a suspicious message, paste a document, or upload a screenshot. ${agent} reads it — live.`}
      acc={section.accent}
      eyebrow={section.props?.eyebrow || 'Analyzer · live'}
      live
    >
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={p.placeholder || 'Paste the email, bill, listing or message here…'}
            className="inp resize-y text-sm"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {allowImage && (
              <label className="btn-ghost cursor-pointer !py-2 text-xs">
                {image ? '✓ ' + image.name.slice(0, 18) : 'Upload a screenshot'}
                <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
              </label>
            )}
            {image && <button onClick={() => setImage(null)} className="text-xs text-slate-500 hover:text-white">remove</button>}
            <button onClick={() => analyze(false)} disabled={busy} className="btn-primary ml-auto !py-2 text-sm">
              {busy ? 'Analyzing live…' : p.cta || 'Analyze'} <ArrowIcon className="h-4 w-4" />
            </button>
          </div>
          {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
        </div>

        <div className="rounded-xl border border-line bg-ink-950/50 p-4">
          {!res && !busy && <div className="grid h-full place-items-center text-center text-sm text-slate-600">Your live verdict appears here.</div>}
          {busy && !res && <div className="grid h-full place-items-center text-sm text-slate-500"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" /></div>}
          {res && (
            <div className="animate-fade-up space-y-3">
              {showVerdict ? (
                <>
                  <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${riskMeta.ring}`}>
                    <span className="font-display text-lg">{riskLabel}</span>
                    <span className="font-mono text-sm">risk {res.risk.score}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-700"><div className={`h-full ${riskMeta.bar}`} style={{ width: `${res.risk.score}%` }} /></div>
                  {res.risk.signals?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {res.risk.signals.slice(0, 5).map((s, i) => (
                        <span key={i} className="rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">{String(s).replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  )}
                  {res.risk.explanation && <p className="text-xs leading-relaxed text-slate-400">{res.risk.explanation}</p>}
                  <div className="grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-xs">
                    <GuardField k="Payee" v={ex.payee || '—'} />
                    <GuardField k="Amount" v={ex.amount ? usd(ex.amount) : '—'} />
                    <GuardField k="Account" v={ex.account_last4 ? `••${ex.account_last4}` : '—'} />
                  </div>
                </>
              ) : (
                <>
                  {(res.summary || res.classification) && (
                    <div className="rounded-lg border border-line bg-ink-900/60 p-3">
                      {res.classification && <div className="label mb-1 text-brand-soft">{String(res.classification).replace(/_/g, ' ')}</div>}
                      {res.summary && <p className="text-sm text-slate-200">{res.summary}</p>}
                    </div>
                  )}
                  {Object.keys(ex).length > 0 && (
                    <div className="grid grid-cols-2 gap-2 border-t border-line/70 pt-3 text-xs">
                      {Object.entries(ex).slice(0, 6).map(([k, v]) => (
                        <GuardField key={k} k={k.replace(/_/g, ' ')} v={v == null ? '—' : String(v)} />
                      ))}
                    </div>
                  )}
                  {!res.summary && !res.classification && Object.keys(ex).length === 0 && (
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">{JSON.stringify(res, null, 2)}</pre>
                  )}
                </>
              )}

              {res.agent_decision && (
                <div className="rounded-lg border border-brand/25 bg-brand/5 p-3">
                  <div className="label text-brand-soft">{agent} would: <b className="text-white">{res.agent_decision.action}</b></div>
                  {res.agent_decision.message_to_user && <p className="mt-1 text-xs text-slate-300">“{res.agent_decision.message_to_user}”</p>}
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className={res.covered ? 'text-safe' : 'text-slate-500'}>{res.covered ? '✓ Covered if the agent errs here' : 'Not covered — outside the mandate'}</span>
                <button onClick={() => analyze(true)} disabled={busy} className="text-brand/90 hover:text-brand-soft">add to my inbox →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  )
}

/* ============================================================== voice_guard */
export function VoiceGuard({ section = {} }) {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const recRef = useRef(null)
  const supported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  function toggleMic() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let finalText = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t + ' '
        else interim += t
      }
      setTranscript((finalText + interim).trim())
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setTranscript('')
    setRes(null)
    rec.start()
    setListening(true)
  }

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy(true)
      setErr('')
      setRes(null)
      try {
        const r = await api.voiceAnalyze({ audio: reader.result, content_type: f.type || 'audio/wav' })
        setTranscript(r.transcript || '')
        setRes(r.analysis)
      } catch (ex) {
        setErr(ex?.response?.data?.detail || 'Could not analyze audio.')
      } finally {
        setBusy(false)
      }
    }
    reader.readAsDataURL(f)
  }

  async function analyze() {
    if (!transcript.trim()) {
      setErr('Record, upload, or paste a call first.')
      return
    }
    setBusy(true)
    setErr('')
    setRes(null)
    try {
      const r = await api.voiceAnalyze({ transcript })
      setRes(r.analysis)
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Analysis failed.')
    } finally {
      setBusy(false)
    }
  }

  const risk = res?.risk ? RISK[res.risk.level] || RISK.caution : null

  return (
    <WidgetShell
      title={section.title || 'Is this call a scam? Let it listen.'}
      subtitle={section.subtitle || 'Put a suspicious call or voicemail on speaker and screen it live, or upload the recording. It transcribes and tells you instantly if it’s vishing and what to say.'}
      acc={section.accent || 'info'}
      eyebrow="Voice Guard · live"
      live
    >
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {supported ? (
              <button onClick={toggleMic} className={`btn ${listening ? 'bg-bad text-white' : 'btn-ghost'} !py-2 text-sm`}>
                <span className={`h-2.5 w-2.5 rounded-full ${listening ? 'animate-pulse bg-white' : 'bg-bad'}`} />
                {listening ? 'Stop listening' : 'Screen a call (mic)'}
              </button>
            ) : (
              <span className="text-xs text-slate-500">Live mic needs Chrome/Safari — upload or paste instead.</span>
            )}
            <label className="btn-ghost cursor-pointer !py-2 text-xs">
              Upload voicemail
              <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
            </label>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={5}
            placeholder={listening ? 'Listening… play the call on speaker.' : 'Live transcript appears here — or paste what the caller said.'}
            className="inp mt-3 resize-y text-sm"
          />
          <div className="mt-3 flex items-center gap-3">
            <button onClick={analyze} disabled={busy || listening} className="btn-primary ml-auto !py-2 text-sm">
              {busy ? 'Analyzing…' : 'Analyze the call'} <ArrowIcon className="h-4 w-4" />
            </button>
          </div>
          {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
        </div>

        <div className="rounded-xl border border-line bg-ink-950/50 p-4">
          {!res && !busy && <div className="grid h-full place-items-center text-center text-sm text-slate-600">Your live verdict appears here.</div>}
          {busy && !res && <div className="grid h-full place-items-center"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-info" /></div>}
          {res && (
            <div className="animate-fade-up space-y-3">
              <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${risk.ring}`}>
                <span className="font-display text-lg">{risk.label}</span>
                <span className="font-mono text-sm">risk {res.risk.score}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700"><div className={`h-full ${risk.bar}`} style={{ width: `${res.risk.score}%` }} /></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <GuardField k="Scam type" v={(res.risk.scam_type || '—').replace(/_/g, ' ')} />
                <GuardField k="Claims to be" v={res.impersonating || '—'} />
              </div>
              {res.risk.signals?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {res.risk.signals.slice(0, 5).map((s, i) => (
                    <span key={i} className="rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">{String(s).replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}
              {res.recommended_action && (
                <div className="rounded-lg border border-bad/25 bg-bad/5 p-3">
                  <div className="label text-bad/90">Do this now</div>
                  <p className="mt-1 text-xs text-slate-200">{res.recommended_action}</p>
                </div>
              )}
              {res.safe_response && <p className="text-xs italic text-slate-400">Say: “{res.safe_response}”</p>}
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  )
}

/* =========================================================== live_call_guard */
const SPEAKER_COLORS = ['bg-info/20 text-info-soft', 'bg-brand/20 text-brand-soft', 'bg-safe/20 text-safe', 'bg-warn/20 text-warn']

export function LiveCallGuard({ section = {} }) {
  const cfg = useAsync(() => api.livekitConfig().catch(() => ({ configured: false })), [])
  const [active, setActive] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [finals, setFinals] = useState([])
  const [interim, setInterim] = useState('')
  const [alerts, setAlerts] = useState([])
  const [err, setErr] = useState('')
  const roomRef = useRef(null)
  const trackRef = useRef(null)

  useEffect(() => () => stop(), []) // cleanup on unmount

  function handleData(payload) {
    try {
      const m = JSON.parse(new TextDecoder().decode(payload))
      if (m.type === 'transcript') {
        if (m.final && m.text) {
          setFinals((f) => [...f.slice(-30), { text: m.text, speaker: m.speaker }])
          setInterim('')
        } else setInterim(m.text || '')
      } else if (m.type === 'alert') {
        setAlerts((a) => [{ ...m, at: Date.now() }, ...a].slice(0, 6))
      }
    } catch {
      /* ignore */
    }
  }

  async function start() {
    setConnecting(true)
    setErr('')
    setFinals([])
    setInterim('')
    setAlerts([])
    try {
      const { url, token } = await api.livekitToken()
      const { Room, RoomEvent, createLocalAudioTrack } = await import('livekit-client')
      const room = new Room()
      roomRef.current = room
      room.on(RoomEvent.DataReceived, (payload) => handleData(payload))
      room.on(RoomEvent.Disconnected, () => setActive(false))
      await room.connect(url, token)
      const track = await createLocalAudioTrack()
      trackRef.current = track
      await room.localParticipant.publishTrack(track)
      setActive(true)
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Could not start the live call.')
    } finally {
      setConnecting(false)
    }
  }

  function stop() {
    try {
      trackRef.current?.stop()
    } catch {}
    try {
      roomRef.current?.disconnect()
    } catch {}
    trackRef.current = null
    roomRef.current = null
    setActive(false)
  }

  const topAlert = alerts[0]
  const notConfigured = cfg.data && !cfg.data.configured

  return (
    <WidgetShell
      title={section.title || 'An AI sits on the call with you'}
      subtitle={section.subtitle || 'Start a live session, put a suspicious call on speaker, and an AI guardian joins — transcribing and interrupting the moment it hears a scam.'}
      acc={section.accent || 'bad'}
      eyebrow="Live call guardian · LiveKit"
      live
      right={
        !notConfigured ? (
          <button onClick={active ? stop : start} disabled={connecting} className={`btn whitespace-nowrap !py-2 ${active ? 'bg-bad text-white' : 'btn-ghost border-bad/30 hover:border-bad/60'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${active ? 'animate-pulse bg-white' : 'bg-bad'}`} />
            {connecting ? 'Connecting…' : active ? 'End session' : 'Start live screening'}
          </button>
        ) : null
      }
    >
      {notConfigured && (
        <div className="rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-400">
          <b className="text-slate-200">Setup:</b> set <span className="font-mono text-xs">LIVEKIT_URL/API_KEY/API_SECRET</span> + <span className="font-mono text-xs">DEEPGRAM_API_KEY</span> in <span className="font-mono text-xs">.env</span>, then run the guardian worker:
          <span className="mt-1 block font-mono text-xs text-brand-soft">python -m scripts.call_guardian dev</span>
        </div>
      )}
      {err && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}

      {active && (
        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="label mb-2">Live transcript</div>
            <div className="h-44 overflow-y-auto rounded-xl border border-line bg-ink-950/60 p-3 text-sm leading-relaxed text-slate-300">
              {finals.length === 0 && !interim && <span className="text-slate-600">Listening… speak or play the call.</span>}
              {finals.map((t, i) => (
                <p key={i} className="flex gap-1.5">
                  {t.speaker != null && <span className={`mt-0.5 h-fit shrink-0 rounded px-1 font-mono text-[10px] ${SPEAKER_COLORS[t.speaker % SPEAKER_COLORS.length]}`}>S{t.speaker}</span>}
                  <span>{t.text}</span>
                </p>
              ))}
              {interim && <p className="text-slate-500">{interim}</p>}
            </div>
          </div>
          <div>
            <div className="label mb-2">Guardian alerts</div>
            {topAlert ? (
              <div className={`animate-pop rounded-xl border p-4 ${topAlert.severity === 'scam' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-warn/40 bg-warn/10 text-warn'}`}>
                <div className="font-display text-lg">⚠ {topAlert.severity === 'scam' ? 'Scam detected' : 'Be careful'}</div>
                <p className="mt-1 text-sm text-slate-200">{topAlert.reason}</p>
                {topAlert.advice && <p className="mt-1 text-xs italic text-slate-300">→ {topAlert.advice}</p>}
              </div>
            ) : (
              <div className="grid h-44 place-items-center rounded-xl border border-line bg-ink-950/60 text-center text-sm text-slate-600">No scam signals yet — the guardian is listening.</div>
            )}
            {alerts.length > 1 && <div className="mt-2 text-xs text-slate-500">{alerts.length} alerts this call</div>}
          </div>
        </div>
      )}
    </WidgetShell>
  )
}

/* ============================================================= gmail_connect */
function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.getElementById('gis-script')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      return
    }
    const s = document.createElement('script')
    s.id = 'gis-script'
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('could not load Google script'))
    document.head.appendChild(s)
  })
}

function ActBtn({ label, onClick, busy, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
        danger ? 'border-bad/30 text-bad hover:bg-bad/10' : 'border-line text-slate-300 hover:border-brand/50 hover:text-white'
      }`}
    >
      {busy ? '…' : label}
    </button>
  )
}

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export function GmailConnect({ section = {} }) {
  const ctx = useCustomer()
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const GMAIL_Q = section.props?.query || 'in:inbox newer_than:1y'
  const [connected, setConnected] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const [auto, setAuto] = useState(false)
  const [lastScan, setLastScan] = useState(null)
  const [acted, setActed] = useState({})
  const [actBusy, setActBusy] = useState({})
  const [reply, setReply] = useState(null)

  const tcRef = useRef(null)
  const tokenRef = useRef(null)
  const resolverRef = useRef(null)
  const modTcRef = useRef(null)
  const modTokenRef = useRef(null)
  const modResolverRef = useRef(null)
  const seenRef = useRef(new Map())

  function getTokenClient() {
    if (tcRef.current) return tcRef.current
    tcRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (resp) => {
        if (resp.access_token) {
          tokenRef.current = { token: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 }
          resolverRef.current?.resolve(resp.access_token)
        } else {
          resolverRef.current?.reject(new Error(resp.error || 'authorization failed'))
        }
        resolverRef.current = null
      },
    })
    return tcRef.current
  }

  async function ensureToken(interactive) {
    const t = tokenRef.current
    if (t && Date.now() < t.exp - 60000) return t.token
    await loadGis()
    const tc = getTokenClient()
    return new Promise((resolve, reject) => {
      resolverRef.current = { resolve, reject }
      tc.requestAccessToken(interactive ? {} : { prompt: '' })
    })
  }

  async function scan(token) {
    setScanning(true)
    setErr('')
    try {
      const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=12&q=${encodeURIComponent(GMAIL_Q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())
      if (list.error) throw new Error(list.error.message || 'Gmail API error')
      const ids = (list.messages || []).map((m) => m.id)
      const newIds = ids.filter((id) => !seenRef.current.has(id))
      const fresh = await Promise.all(
        newIds.map(async (id) => {
          const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
          const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name, x.value]))
          const text = `From: ${h.From || ''}\nSubject: ${h.Subject || ''}\n${m.snippet || ''}`
          let analysis = null
          try {
            analysis = (await api.analyze({ text })).analysis
          } catch {
            /* leave null */
          }
          return { id, isNew: true, from: h.From || 'unknown', subject: h.Subject || '(no subject)', snippet: m.snippet || '', analysis }
        }),
      )
      seenRef.current.forEach((v) => (v.isNew = false))
      fresh.forEach((f) => seenRef.current.set(f.id, f))
      const all = [...seenRef.current.values()].sort((a, b) => (b.analysis?.risk?.score || 0) - (a.analysis?.risk?.score || 0))
      setItems(all)
      setLastScan(Date.now())
      setConnected(true)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setScanning(false)
    }
  }

  async function connect() {
    setErr('')
    try {
      const tok = await ensureToken(true)
      await scan(tok)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  async function ensureModifyToken() {
    const t = modTokenRef.current
    if (t && Date.now() < t.exp - 60000) return t.token
    await loadGis()
    if (!modTcRef.current) {
      modTcRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/gmail.modify',
        callback: (resp) => {
          if (resp.access_token) {
            modTokenRef.current = { token: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 }
            modResolverRef.current?.resolve(resp.access_token)
          } else modResolverRef.current?.reject(new Error(resp.error || 'authorization failed'))
          modResolverRef.current = null
        },
      })
    }
    return new Promise((resolve, reject) => {
      modResolverRef.current = { resolve, reject }
      modTcRef.current.requestAccessToken({})
    })
  }

  const mark = (id, label, kind = 'ok') => setActed((m) => ({ ...m, [id]: { label, kind } }))
  const setBusy = (id, name) => setActBusy((m) => ({ ...m, [id]: name }))
  const clearBusy = (id) => setActBusy((m) => { const n = { ...m }; delete n[id]; return n })

  async function doReply(it) {
    setBusy(it.id, 'reply')
    try {
      const { reply: text } = await api.replySuggest({ sender: it.from, subject: it.subject, snippet: it.snippet })
      setReply({ id: it.id, text })
    } catch {
      setErr('Could not draft a reply.')
    } finally {
      clearBusy(it.id)
    }
  }

  async function doHandToAgent(it) {
    setBusy(it.id, 'agent')
    try {
      await api.analyze({ text: `From: ${it.from}\nSubject: ${it.subject}\n${it.snippet || ''}`, inject: true })
      await ctx.refresh()
      mark(it.id, 'sent to your agent', 'brand')
    } catch {
      setErr('Could not hand to your agent.')
    } finally {
      clearBusy(it.id)
    }
  }

  async function doReportSpam(it) {
    setBusy(it.id, 'spam')
    try {
      const tok = await ensureModifyToken()
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error?.message || 'modify failed')
      }
      mark(it.id, 'reported as spam', 'bad')
    } catch (e) {
      setErr(`Report failed: ${e.message || e}. (Needs the gmail.modify scope — grant it in the popup.)`)
    } finally {
      clearBusy(it.id)
    }
  }

  async function doHoldPayment(it) {
    setBusy(it.id, 'hold')
    const payee = it.analysis?.extracted?.payee || (it.from || '').replace(/<.*/, '').replace(/"/g, '').trim() || 'this sender'
    let reported = false
    try {
      await api.hold({
        payee,
        account_last4: it.analysis?.extracted?.account_last4,
        reason: `flagged ${it.analysis?.risk?.level || 'risky'} email in Gmail`,
        source: 'gmail',
      })
      try {
        const tok = await ensureModifyToken()
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}/modify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }),
        })
        reported = r.ok
      } catch {
        /* spam is best-effort; the freeze is the important part */
      }
      await ctx.refresh()
      mark(it.id, reported ? `“${payee}” frozen · reported as spam` : `“${payee}” frozen — your agent won’t pay it`, 'bad')
    } catch (e) {
      setErr('Could not hold payment: ' + (e.message || e))
    } finally {
      clearBusy(it.id)
    }
  }

  function openGmail(it) {
    window.open(`https://mail.google.com/mail/u/0/#all/${it.id}`, '_blank', 'noopener')
  }

  useEffect(() => {
    if (!auto || !connected) return
    const iv = setInterval(async () => {
      try {
        const tok = await ensureToken(false)
        await scan(tok)
      } catch {
        setAuto(false)
        setErr('Session expired — click Connect Gmail to resume.')
      }
    }, 30000)
    return () => clearInterval(iv)
  }, [auto, connected])

  const scamCount = items.filter((it) => it.analysis?.risk?.level === 'scam').length

  return (
    <WidgetShell
      title={section.title || 'Triage your real Gmail'}
      subtitle={section.subtitle || 'Connect Gmail (read-only) and Backstop watches your inbox, ranking every email by scam risk — live.'}
      acc={section.accent || 'safe'}
      eyebrow="Connect your inbox · live"
      live
      right={
        clientId ? (
          <div className="flex items-center gap-2">
            {connected && (
              <button onClick={() => setAuto((a) => !a)} className={`btn !py-2 text-xs ${auto ? 'bg-safe/15 text-safe ring-1 ring-safe/30' : 'btn-ghost'}`}>
                <span className={`h-2 w-2 rounded-full ${auto ? 'animate-pulse bg-safe' : 'bg-slate-600'}`} /> Auto {auto ? 'on' : 'off'}
              </button>
            )}
            <button onClick={connect} disabled={scanning} className="btn-ghost whitespace-nowrap border-safe/30 hover:border-safe/60">
              {scanning ? 'Scanning…' : connected ? 'Rescan' : 'Connect Gmail'}
            </button>
          </div>
        ) : null
      }
    >
      {!clientId && (
        <div className="rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-400">
          <b className="text-slate-200">Setup (one-time):</b> create an OAuth client at console.cloud.google.com (enable the Gmail API, add <span className="font-mono text-xs">gmail.readonly</span> + yourself as a test user), then set <span className="font-mono text-xs text-brand-soft">VITE_GOOGLE_CLIENT_ID</span> in <span className="font-mono text-xs">web/.env</span>. Read-only — Backstop never sends email or moves money.
        </div>
      )}
      {err && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}

      {connected && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {scanning && <span className="flex items-center gap-1.5 text-slate-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-safe" /> scanning…</span>}
          <span>{items.length} emails triaged</span>
          {scamCount > 0 && <span className="text-bad">⚠ {scamCount} flagged as scam</span>}
          {auto && <span className="text-safe">auto-rescan every 30s</span>}
          {lastScan && <span>last scan {new Date(lastScan).toLocaleTimeString()}</span>}
        </div>
      )}

      {connected && (
        <div className="mt-4 space-y-2">
          {items.length === 0 && !scanning && <p className="text-sm text-slate-500">No emails in your inbox matched. Try “Rescan”.</p>}
          {items.map((it) => {
            const r = it.analysis?.risk
            const meta = r ? RISK[r.level] || RISK.caution : null
            const flagged = r && r.level !== 'safe'
            const status = acted[it.id]
            return (
              <div key={it.id} className={`rounded-xl border px-4 py-3 transition ${meta ? meta.ring : 'border-line bg-ink-900/40 text-slate-300'} ${it.isNew ? 'animate-pop ring-1 ring-brand/30' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{it.subject}</span>
                      {it.isNew && <span className="shrink-0 rounded bg-brand/15 px-1.5 text-[10px] text-brand-soft">new</span>}
                    </div>
                    <div className="truncate text-xs opacity-70">{it.from}</div>
                  </div>
                  {r ? <span className={`chip shrink-0 ${meta.ring}`}>{meta.label} · {r.score}</span> : <span className="chip shrink-0 text-slate-500">—</span>}
                </div>
                {(flagged || status) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2.5">
                    {status ? (
                      <span className={`text-xs font-medium ${status.kind === 'bad' ? 'text-bad' : status.kind === 'brand' ? 'text-brand-soft' : 'text-safe'}`}>✓ {status.label}</span>
                    ) : (
                      <>
                        <ActBtn label="🔒 Hold the payment" danger busy={actBusy[it.id] === 'hold'} onClick={() => doHoldPayment(it)} />
                        <ActBtn label="Draft safe reply" busy={actBusy[it.id] === 'reply'} onClick={() => doReply(it)} />
                        <ActBtn label="Hand to my agent" busy={actBusy[it.id] === 'agent'} onClick={() => doHandToAgent(it)} />
                        <ActBtn label="Report spam" danger busy={actBusy[it.id] === 'spam'} onClick={() => doReportSpam(it)} />
                      </>
                    )}
                    <button onClick={() => openGmail(it)} className="ml-auto text-xs text-slate-500 hover:text-white">Open in Gmail →</button>
                  </div>
                )}
                {reply?.id === it.id && (
                  <div className="mt-2.5 rounded-lg border border-brand/25 bg-brand/5 p-3">
                    <div className="label mb-1 text-brand-soft">Suggested reply</div>
                    <p className="whitespace-pre-wrap text-xs text-slate-200">{reply.text}</p>
                    <div className="mt-2 flex gap-3">
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(reply.text)
                          mark(it.id, 'reply copied', 'ok')
                          setReply(null)
                        }}
                        className="text-xs text-brand/90 hover:text-brand-soft"
                      >
                        Copy reply
                      </button>
                      <button onClick={() => setReply(null)} className="text-xs text-slate-500 hover:text-white">dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}
