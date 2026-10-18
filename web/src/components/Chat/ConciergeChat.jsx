import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { ShieldIcon, ArrowIcon, XIcon } from '../marks'
import { accent, iconFor } from '../widgets/shared.jsx'

/* -------------------------------------------------------------- avatars */
function Avatar({ role, initial, t }) {
  if (role === 'user') {
    return (
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-brand/40 bg-brand/15 font-display text-sm font-semibold text-brand-soft">
        {initial}
      </div>
    )
  }
  return (
    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${t.border} ${t.bg} ${t.text}`}>
      <ShieldIcon className="h-4 w-4" />
    </div>
  )
}

function Bubble({ msg, initial, t }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar role={msg.role} initial={initial} t={t} />
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-tr-sm bg-brand/15 text-slate-100 ring-1 ring-brand/25'
            : 'rounded-tl-sm border border-line bg-ink-900/70 text-slate-200'
        }`}
      >
        {msg.content}
      </div>
    </div>
  )
}

function Thinking({ t }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${t.border} ${t.bg} ${t.text}`}>
        <ShieldIcon className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-ink-900/70 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 w-1.5 animate-pulse rounded-full ${t.dot}`} style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- the chat */
export default function ConciergeChat({ schema, agents = [], activeAgentId, agentName, onPickAgent, userEmail }) {
  const t = accent(schema?.accent)
  const initial = (userEmail || 'Y').trim().charAt(0).toUpperCase()
  const greeting = schema?.greeting || `Hi! I’m ${agentName || 'your agent'}. Ask me anything, or tell me what you’d like to do.`

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([{ role: 'assistant', content: greeting }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const taRef = useRef(null)
  const panelRef = useRef(null)

  // re-seed the greeting whenever the active agent (and its loaded greeting) changes
  useEffect(() => {
    setMessages([{ role: 'assistant', content: greeting }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, greeting])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, open])

  // when the panel opens, focus the composer; ESC closes
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => taRef.current?.focus(), 120)
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => {
      clearTimeout(id)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // auto-grow the composer
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [draft])

  function maybeSwitchAgent(reply) {
    const candidate =
      reply?.active_agent || reply?.active_agent_id || reply?.set_active || reply?.switch_to || reply?.agent
    if (!candidate) return
    const match = agents.find((a) => a.id === candidate || a.name === candidate)
    if (match && match.id !== activeAgentId) onPickAgent?.(match.id)
  }

  // Natural-language switch: "switch to Quant", "open my travel agent", or just "Scholar".
  const SWITCH_RE = /\b(switch|change|open|show|go to|take me to|talk to|use|load|bring up|move to|jump to)\b/i
  function detectSwitch(text) {
    const low = text.toLowerCase()
    const cand = agents.find((a) => a.id !== activeAgentId && (a.name || '').toLowerCase() && low.includes((a.name || '').toLowerCase()))
    if (!cand) return null
    const bare = low.replace(/[^a-z0-9 ]/g, '').trim()
    if (SWITCH_RE.test(low) || bare === (cand.name || '').toLowerCase()) return cand
    return null
  }

  function extractText(reply) {
    if (typeof reply === 'string') return reply
    if (!reply) return ''
    if (reply.reply) return reply.reply
    if (reply.message) return typeof reply.message === 'string' ? reply.message : reply.message.content || ''
    if (reply.content) return reply.content
    if (Array.isArray(reply.messages) && reply.messages.length) {
      const last = reply.messages[reply.messages.length - 1]
      return typeof last === 'string' ? last : last.content || ''
    }
    return "I'm here — try asking about what this agent can do, or pick an agent above."
  }

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    // natural-language agent switch — switch and let the new agent's greeting take over
    const hit = detectSwitch(text)
    if (hit) {
      setDraft('')
      onPickAgent?.(hit.id)
      return
    }
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setDraft('')
    setBusy(true)
    try {
      const payload = next.map((m) => ({ role: m.role, content: m.content }))
      const reply = await api.chat({ messages: payload, agent: activeAgentId })
      maybeSwitchAgent(reply)
      setMessages((m) => [...m, { role: 'assistant', content: extractText(reply) }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'I could not reach the service just now — is the API up? Try again in a moment.' }])
    } finally {
      setBusy(false)
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const launcherIcon = iconFor(schema?.icon, 'h-7 w-7')

  // Portal to <body> so the fixed launcher/panel escapes the <main> ancestor, which has a persistent
  // `fade-up` transform (fill-mode both) that would otherwise become the containing block for `fixed`
  // and pin this to the bottom of the page content instead of the viewport corner.
  return createPortal(
    <>
      {/* ---------------------------------------------------- floating launcher */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
          {/* tiny "Ask {agentName}" label, hidden on very small screens */}
          <span className="hidden select-none rounded-full border border-line bg-ink-900/85 px-3 py-1.5 text-xs font-medium text-slate-300 shadow-lg backdrop-blur sm:inline-flex">
            Ask {agentName || 'your concierge'}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Open ${agentName || 'concierge'} chat`}
            className="group relative grid h-14 w-14 place-items-center rounded-full text-ink-950 shadow-glow outline-none transition-transform duration-300 hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            {/* pulse ring */}
            <span className="absolute inset-0 rounded-full bg-gold-sheen animate-pulse-ring" aria-hidden />
            {/* gold gradient face */}
            <span className="absolute inset-0 rounded-full bg-gold-sheen" aria-hidden />
            <span className="relative drop-shadow-sm">{launcherIcon}</span>
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ popup panel */}
      {open && (
        <>
          {/* click-outside catcher — a soft backdrop on mobile, transparent on desktop */}
          <div
            className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label={`${agentName || 'Concierge'} chat`}
            className="card fixed inset-0 z-50 flex origin-bottom-right animate-pop flex-col overflow-hidden rounded-none border-0 bg-ink-950 sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[560px] sm:max-h-[calc(100vh-3rem)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-line sm:shadow-glow"
          >
            <div className="mesh" style={{ top: '-90px', right: '6%', height: 220, width: 240, background: t.fill }} />

            {/* header + agent switcher */}
            <div className="relative flex flex-col gap-3 border-b border-line/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl border ${t.border} ${t.bg} ${t.text}`}>
                    <ShieldIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-display text-lg leading-tight text-white">Concierge</div>
                    <div className="label">{agentName ? `operating ${agentName}` : 'your account assistant'}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-slate-400 transition hover:border-brand/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              {agents.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => a.id !== activeAgentId && onPickAgent?.(a.id)}
                      className={`chip transition ${a.id === activeAgentId ? `${t.border} ${t.bg} ${t.text}` : 'hover:border-brand/50 hover:text-white'}`}
                    >
                      {a.id === activeAgentId && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* messages */}
            <div className="relative flex-1 space-y-4 overflow-y-auto p-4">
              {messages.map((m, i) => (
                <Bubble key={i} msg={m} initial={initial} t={t} />
              ))}
              {busy && <Thinking t={t} />}
              <div ref={endRef} />
            </div>

            {/* composer */}
            <div className="relative border-t border-line/80 p-3">
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-ink-900/70 px-3 py-2 focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/15">
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                  placeholder={`Message ${agentName || 'your concierge'}…`}
                  className="max-h-[140px] flex-1 resize-none bg-transparent py-1.5 text-sm text-white outline-none placeholder:text-slate-600"
                />
                <button
                  onClick={send}
                  disabled={busy || !draft.trim()}
                  className="btn-primary !rounded-xl !px-3 !py-2 text-sm disabled:opacity-40"
                  aria-label="Send"
                >
                  <ArrowIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>,
    document.body,
  )
}
