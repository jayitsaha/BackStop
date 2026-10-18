import { usd, cents, pct, oneIn } from '../../lib/format'
import { CheckIcon, ShieldIcon } from '../marks'

/* ------------------------------------------------------------------ accents */
// Full literal class strings per accent so Tailwind's JIT keeps them.
export const ACCENTS = {
  brand: { text: 'text-brand', soft: 'text-brand-soft', bg: 'bg-brand/10', bgSoft: 'bg-brand/5', border: 'border-brand/30', ring: 'ring-brand/30', dot: 'bg-brand', stroke: '#c4552d', fill: 'rgba(196,85,45,0.12)' },
  info: { text: 'text-info', soft: 'text-info-soft', bg: 'bg-info/10', bgSoft: 'bg-info/5', border: 'border-info/30', ring: 'ring-info/30', dot: 'bg-info', stroke: '#2ac6e4', fill: 'rgba(42,198,228,0.10)' },
  safe: { text: 'text-safe', soft: 'text-safe', bg: 'bg-safe/10', bgSoft: 'bg-safe/5', border: 'border-safe/30', ring: 'ring-safe/30', dot: 'bg-safe', stroke: '#3d9a55', fill: 'rgba(61,154,85,0.12)' },
  warn: { text: 'text-warn', soft: 'text-warn', bg: 'bg-warn/10', bgSoft: 'bg-warn/5', border: 'border-warn/30', ring: 'ring-warn/30', dot: 'bg-warn', stroke: '#f0bd36', fill: 'rgba(240,189,54,0.10)' },
  bad: { text: 'text-bad', soft: 'text-bad', bg: 'bg-bad/10', bgSoft: 'bg-bad/5', border: 'border-bad/30', ring: 'ring-bad/30', dot: 'bg-bad', stroke: '#dd6381', fill: 'rgba(221,99,129,0.12)' },
}
export const accent = (a) => ACCENTS[a] || ACCENTS.brand

/* -------------------------------------------------------------------- icons */
function Ic({ d, className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {d}
    </svg>
  )
}
const S = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
export function iconFor(name, className = 'h-5 w-5') {
  switch (name) {
    case 'ticket':
      return <Ic className={className} d={<><path d="M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 01-2 2H6a2 2 0 01-2-2 2 2 0 000-4z" {...S} /><path d="M13 6v12" strokeDasharray="2 2" {...S} /></>} />
    case 'bot':
      return <Ic className={className} d={<><rect x="5" y="8" width="14" height="10" rx="2" {...S} /><path d="M12 8V5M8 13h.01M16 13h.01" {...S} /></>} />
    case 'plane':
      return <Ic className={className} d={<path d="M4 13l16-6-4 14-3-6-6-2z" {...S} />} />
    case 'cart':
      return <Ic className={className} d={<><path d="M4 5h2l2 11h9l2-8H7" {...S} /><circle cx="10" cy="19" r="1.3" {...S} /><circle cx="17" cy="19" r="1.3" {...S} /></>} />
    case 'chart':
      return <Ic className={className} d={<path d="M5 19V5M5 19h14M8 16l3-4 3 2 4-6" {...S} />} />
    case 'search':
      return <Ic className={className} d={<><circle cx="11" cy="11" r="6" {...S} /><path d="M20 20l-4-4" {...S} /></>} />
    case 'calendar':
      return <Ic className={className} d={<><rect x="4" y="6" width="16" height="14" rx="2" {...S} /><path d="M4 10h16M8 4v4M16 4v4" {...S} /></>} />
    case 'phone':
      return <Ic className={className} d={<path d="M5 4h4l2 5-2 1a12 12 0 005 5l1-2 5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" {...S} />} />
    case 'mail':
      return <Ic className={className} d={<><rect x="4" y="6" width="16" height="12" rx="2" {...S} /><path d="M4 8l8 5 8-5" {...S} /></>} />
    case 'bank':
      return <Ic className={className} d={<path d="M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 20h16" {...S} />} />
    case 'sparkle':
      return <Ic className={className} d={<path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4z" {...S} />} />
    case 'shield':
    default:
      return <ShieldIcon className={className} />
  }
}

/* --------------------------------------------------- data source + format */
// Resolve a dot-path (§6) into customer state. `agent` is the active agent record.
export function resolveSource(customer, path, agentRecord) {
  if (!customer || !path) return undefined
  const roots = {
    payments: customer.bank?.payments || [],
    runs: customer.runs || [],
    claims: customer.claims || [],
    frozen: customer.frozen || [],
    inbox: customer.inbox || [],
    certificate: customer.certificate || {},
    agent: agentRecord || (typeof customer.agent === 'object' ? customer.agent : {}) || {},
    premium_collected_usd: customer.premium_collected_usd ?? 0,
  }
  const parts = String(path).split('.')
  let node = parts[0] in roots ? roots[parts[0]] : customer[parts[0]]
  for (let i = 1; i < parts.length; i++) {
    const key = parts[i]
    if (key === 'length') {
      node = Array.isArray(node) ? node.length : node == null ? 0 : Object.keys(node).length
      continue
    }
    if (node == null) return undefined
    node = node[key]
  }
  return node
}

export function fmt(value, format) {
  switch (format) {
    case 'usd':
      return usd(value)
    case 'int':
      return Number(value ?? 0).toLocaleString('en-US')
    case 'pct':
      return pct(value)
    case 'oneIn':
      return oneIn(value)
    case 'date':
      return value ? String(value).slice(0, 16).replace('T', ' ') : '—'
    case 'status':
      return value == null ? '—' : String(value).replace(/_/g, ' ')
    case 'text':
    default:
      if (value == null || value === '') return '—'
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

const STATUS_TONE = {
  ok: 'border-safe/30 bg-safe/10 text-safe',
  paid: 'border-safe/30 bg-safe/10 text-safe',
  scheduled: 'border-brand/30 bg-brand/10 text-brand-soft',
  failed: 'border-warn/30 bg-warn/10 text-warn',
  failed_insufficient_funds: 'border-warn/30 bg-warn/10 text-warn',
  frozen: 'border-bad/30 bg-bad/10 text-bad',
  held: 'border-bad/30 bg-bad/10 text-bad',
  unverified: 'border-bad/30 bg-bad/10 text-bad',
}
export function StatusTag({ status }) {
  const key = String(status || '').toLowerCase()
  const label = key === 'failed_insufficient_funds' ? 'failed' : fmt(status, 'status')
  return <span className={`chip !px-2 !py-0.5 text-[11px] ${STATUS_TONE[key] || 'text-slate-400'}`}>{label}</span>
}

/* ----------------------------------------------------------- widget shell */
// Standard framed card used by the "plain" widgets. Guard widgets keep their
// own rich headers.
export function WidgetShell({ title, subtitle, eyebrow, acc, live, right, children, className = '' }) {
  const t = accent(acc)
  return (
    <div className={`card relative overflow-hidden p-6 ${className}`}>
      <div className="mesh" style={{ top: '-80px', right: '4%', height: 180, width: 200, background: t.fill }} />
      <div className="relative">
        {(title || eyebrow || right) && (
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
        )}
        {children}
      </div>
    </div>
  )
}

export function WidgetUnavailable({ type, title }) {
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="eyebrow mb-1 text-slate-500">Not available</div>
      {title && <h3 className="font-display text-lg tracking-tightish text-white">{title}</h3>}
      <p className="mt-1 text-sm text-slate-500">
        This widget{type ? ` (“${type}”)` : ''} isn’t available yet. The rest of your dashboard is fine.
      </p>
    </div>
  )
}

/* ------------------------------------------------------- run-step timeline */
const toolLabel = {
  read_inbox: 'Read the inbox', read_user_requests: 'Checked your requests', open_url: 'Opened a linked page',
  get_mandate: 'Loaded your mandate', check_mandate: 'Checked the payment against your mandate',
  payment_history: 'Checked payment history', pay: 'Paid', renew_subscription: 'Renewed',
  cancel_subscription: 'Cancelled', message_user: 'Messaged you', report: 'Filed its report',
  add_payee: 'Tried to add a payee', set_limit: 'Tried to change a limit', update_mandate: 'Tried to edit the mandate',
  send_p2p: 'Tried a person-to-person transfer', update_payment_method: 'Tried to change a card',
}
const DANGER = new Set(['add_payee', 'set_limit', 'update_mandate', 'send_p2p', 'update_payment_method'])

export function buildSteps(log) {
  const out = []
  for (const a of log || []) {
    if (['read_inbox', 'read_user_requests', 'get_mandate', 'payment_history', 'open_url'].includes(a.tool)) {
      out.push({ title: toolLabel[a.tool], detail: a.tool === 'read_inbox' && Array.isArray(a.result) ? `${a.result.length} message(s)` : '' })
    } else if (a.tool === 'check_mandate') {
      const ok = a.result?.ok
      out.push({ title: toolLabel.check_mandate, good: ok, detail: ok ? 'within your mandate' : `blocked: ${(a.result?.reasons || []).join(', ')}` })
    } else if (a.tool === 'pay' || a.tool === 'renew_subscription') {
      const r = a.result || {}
      const bad = r.verified_payee === false
      out.push({ title: `${toolLabel[a.tool]} ${usd(r.amount)} to ${r.payee}`, danger: bad, good: !bad && (r.status === 'ok' || r.status === 'scheduled'), detail: `${r.status}${bad ? ' · unverified account!' : ''}` })
    } else if (a.tool === 'message_user') {
      out.push({ title: toolLabel.message_user, good: true })
    } else if (a.tool === 'report') {
      const items = a.args?.items || []
      out.push({ title: toolLabel.report, detail: items.map((i) => `${i.kind} ${i.payee || ''}`.trim()).join(', ') || 'empty' })
    } else if (DANGER.has(a.tool)) {
      out.push({ title: toolLabel[a.tool] || a.tool, danger: true, detail: 'blocked by Backstop' })
    } else if (a.tool === 'cancel_subscription') {
      out.push({ title: toolLabel.cancel_subscription, detail: a.result?.status })
    } else if (a.tool) {
      // unknown tool — still show it generically so every agent's loop is legible
      out.push({ title: a.tool.replace(/_/g, ' '), detail: typeof a.result === 'string' ? a.result : '' })
    }
  }
  return out
}

// Renders one agent run: a message banner, the tool-call steps, the report.
export function RunTimeline({ run, agent }) {
  if (!run) return null
  const steps = buildSteps(run.log)
  const v = run.verdict
  const msgs = run.messages_to_user || []
  return (
    <div className="animate-fade-up space-y-4">
      {(v?.ok || run.escalated) && (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${v?.at_par ? 'border-safe/30 bg-safe/5 text-safe' : 'border-warn/30 bg-warn/5 text-warn'}`}>
          <span className="flex items-center gap-2">
            {v?.at_par ? <CheckIcon className="h-3.5 w-3.5" /> : <span>↑</span>}
            Backup checker: {v?.at_par ? 'at par' : 'flagged'}
            {typeof v?.score === 'number' && <span className="text-slate-400">· score {v.score}</span>}
          </span>
          {run.escalated && <span className="rounded bg-info/15 px-1.5 py-0.5 text-info-soft">escalated to stronger model</span>}
        </div>
      )}
      {msgs.length > 0 && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
          <div className="label mb-1 text-brand-soft">Message from {agent || 'your agent'}</div>
          {msgs.map((m, i) => (
            <p key={i} className="text-sm text-slate-200">{typeof m === 'string' ? m : m?.text || JSON.stringify(m)}</p>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex animate-fade-up gap-3" style={{ animationDelay: `${i * 60}ms` }}>
              <span className="relative flex w-3 shrink-0 justify-center">
                {i < steps.length - 1 && <span className="absolute top-3 h-full w-px bg-line" />}
                <span className={`relative mt-1.5 h-3 w-3 rounded-full ring-4 ring-ink-850 ${s.danger ? 'bg-bad' : s.good ? 'bg-safe' : 'bg-brand'}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${s.danger ? 'text-bad' : s.good ? 'text-safe' : 'text-slate-200'}`}>{s.title}</div>
                {s.detail && <div className="break-words text-xs text-slate-500">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {run.report && (
        <div className="rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-300">
          <div className="label mb-1">Report</div>
          {typeof run.report === 'string' ? (
            <p className="whitespace-pre-wrap leading-relaxed">{run.report}</p>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-slate-400">{JSON.stringify(run.report, null, 2)}</pre>
          )}
        </div>
      )}
      {(run.new_payment_ids || run.premium_accrued_usd != null) && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-ink-900/50 px-4 py-3 text-sm">
          <span className="text-slate-400">{(run.new_payment_ids || []).length} payment(s) made</span>
          {run.premium_accrued_usd != null && <span className="text-slate-400">premium accrued <b className="text-safe">{cents(run.premium_accrued_usd)}</b></span>}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------- shared risk vocabulary */
export const RISK = {
  safe: { label: 'Looks safe', ring: 'border-safe/40 bg-safe/10 text-safe', bar: 'bg-safe' },
  caution: { label: 'Be careful', ring: 'border-warn/40 bg-warn/10 text-warn', bar: 'bg-warn' },
  scam: { label: 'Likely a scam', ring: 'border-bad/40 bg-bad/10 text-bad', bar: 'bg-bad' },
}

export function GuardField({ k, v }) {
  return (
    <div>
      <div className="label !text-[9px]">{k}</div>
      <div className="mt-0.5 truncate font-medium text-slate-200">{v}</div>
    </div>
  )
}
