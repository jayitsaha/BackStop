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
// Refined 24px line set — 1.5 stroke, rounded, with a low-opacity secondary pass
// for depth. Original Backstop marks; deliberately crisp over cutesy.
const S = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
const S2 = { ...S, strokeWidth: 1.3, opacity: 0.55 }
const DOT = { fill: 'currentColor', stroke: 'none' }
export function iconFor(name, className = 'h-5 w-5') {
  switch (name) {
    // admission ticket — pinched waist + perforated stub
    case 'ticket':
      return <Ic className={className} d={<><path d="M4 9.1V7.8A1.3 1.3 0 015.3 6.5h13.4A1.3 1.3 0 0120 7.8v1.3a1.9 1.9 0 000 3.8v1.3a1.3 1.3 0 01-1.3 1.3H5.3A1.3 1.3 0 014 14.2v-1.3a1.9 1.9 0 000-3.8z" {...S} /><path d="M14.6 6.8v10.4" strokeDasharray="1.4 2" {...S} /></>} />
    // robot head — antenna, rounded crown, filled eyes, side ears
    case 'bot':
      return <Ic className={className} d={<><rect x="4.6" y="8" width="14.8" height="10" rx="3.2" {...S} /><path d="M12 8V5.4" {...S} /><circle cx="12" cy="4.4" r="1.1" {...S} /><circle cx="9.6" cy="13" r="1.05" {...DOT} /><circle cx="14.4" cy="13" r="1.05" {...DOT} /><path d="M3 12v1.8M21 12v1.8" {...S} /></>} />
    // top-down jet — elegant swept silhouette
    case 'plane':
      return <Ic className={className} d={<path d="M12 3c.86 0 1.5 1.3 1.5 2.9v2.3l6.4 3.8v1.8l-6.4-1.9v3.8l1.8 1.3v1.5L12 20.5l-3.3-1.1v-1.5l1.8-1.3v-3.8L4 14.8V13l6.5-3.8V5.9C10.5 4.3 11.14 3 12 3z" {...S} />} />
    case 'cart':
      return <Ic className={className} d={<><path d="M3 4.5h2.1l1.8 10.1a1.5 1.5 0 001.48 1.24h7.5a1.5 1.5 0 001.47-1.2L19 7.2H6.1" {...S} /><circle cx="9.5" cy="19.2" r="1.35" {...S} /><circle cx="16.3" cy="19.2" r="1.35" {...S} /></>} />
    // trading candlesticks on an axis
    case 'chart':
      return <Ic className={className} d={<><path d="M4 4v15.5h15.5" {...S} /><path d="M8 8.3v6.8M13 6.4v9.2M18 9v5.4" {...S} /><rect x="6.7" y="9.9" width="2.6" height="3.4" rx="0.5" {...S} /><rect x="11.7" y="8.2" width="2.6" height="4.6" rx="0.5" {...S} /><rect x="16.7" y="10.3" width="2.6" height="2.7" rx="0.5" {...S} /></>} />
    // research — magnifier scanning document lines
    case 'search':
      return <Ic className={className} d={<><circle cx="10.5" cy="10.5" r="6" {...S} /><path d="M19.6 19.6l-4.4-4.4" {...S} /><path d="M8.3 9.4h4.4M8.3 12h2.9" {...S2} /></>} />
    case 'calendar':
      return <Ic className={className} d={<><rect x="3.6" y="5.6" width="16.8" height="14.8" rx="2.6" {...S} /><path d="M3.6 10h16.8" {...S} /><path d="M8 3.6v4M16 3.6v4" {...S} /><path d="M7.4 14h2.4M11.8 14h2.4M7.4 16.9h2.4" {...S2} /></>} />
    case 'phone':
      return <Ic className={className} d={<path d="M6.4 3.6h2.9l1.5 4.1-2 1.3a11 11 0 005 5l1.3-2 4.1 1.5v2.9a1.6 1.6 0 01-1.72 1.6A16.5 16.5 0 014.8 5.3 1.6 1.6 0 016.4 3.6z" {...S} />} />
    case 'mail':
      return <Ic className={className} d={<><rect x="3.5" y="5.6" width="17" height="12.8" rx="2.6" {...S} /><path d="M4.4 8.2l6.5 4.3a2 2 0 002.2 0l6.5-4.3" {...S} /></>} />
    case 'bank':
      return <Ic className={className} d={<><path d="M12 3.6 3.6 8h16.8L12 3.6z" {...S} /><path d="M5.6 11v5.6M9.5 11v5.6M14.5 11v5.6M18.4 11v5.6" {...S} /><path d="M3.6 20.2h16.8" {...S} /><circle cx="12" cy="6.1" r="0.9" {...DOT} /></>} />
    // four-point sparkle with a secondary glint
    case 'sparkle':
      return <Ic className={className} d={<><path d="M12 3.4c.42 3.7 1.9 5.18 5.6 5.6-3.7.42-5.18 1.9-5.6 5.6-.42-3.7-1.9-5.18-5.6-5.6 3.7-.42 5.18-1.9 5.6-5.6z" {...S} /><path d="M18.2 14.4c.2 1.65.92 2.37 2.57 2.57-1.65.2-2.37.92-2.57 2.57-.2-1.65-.92-2.37-2.57-2.57 1.65-.2 2.37-.92 2.57-2.57z" {...S2} /></>} />
    // document with a folded corner + lines (submit / list)
    case 'doc':
      return <Ic className={className} d={<><path d="M6.5 3.6h6.9L18.5 8.7V19a1.5 1.5 0 01-1.5 1.5H6.5A1.5 1.5 0 015 19V5.1A1.5 1.5 0 016.5 3.6z" {...S} /><path d="M13 3.8v5h5" {...S} /><path d="M8 12.5h6M8 15.5h4" {...S2} /></>} />
    // laboratory flask (crash-test rig)
    case 'beaker':
      return <Ic className={className} d={<><path d="M9.6 3.8h4.8M10.6 3.8v5.1L5.9 16.9A1.6 1.6 0 007.3 19.4h9.4a1.6 1.6 0 001.4-2.5l-4.7-8V3.8" {...S} /><path d="M8.1 13.6h7.8" {...S2} /></>} />
    // coin with a currency stroke (price)
    case 'coin':
      return <Ic className={className} d={<><circle cx="12" cy="12" r="8.1" {...S} /><path d="M12 7v10M14.4 9.1c-.45-.9-1.35-1.4-2.4-1.4-1.3 0-2.35.82-2.35 1.95 0 2.5 4.85 1.45 4.85 3.95 0 1.13-1.05 1.95-2.35 1.95-1.1 0-2.05-.5-2.45-1.45" {...S} /></>} />
    // single person (chooses / connects)
    case 'user':
      return <Ic className={className} d={<><circle cx="12" cy="8.1" r="3.4" {...S} /><path d="M5.6 19.4a6.4 6.4 0 0112.8 0" {...S} /></>} />
    // receipt with a torn edge (claim)
    case 'receipt':
      return <Ic className={className} d={<><path d="M6.2 3.8h11.6v16.4l-1.95-1.25-1.95 1.25-1.9-1.25-1.95 1.25-1.95-1.25L6.2 20.2V3.8z" {...S} /><path d="M9 8h6M9 11h6M9 14h3.5" {...S2} /></>} />
    // circular retry arrows (re-test)
    case 'refresh':
      return <Ic className={className} d={<><path d="M4.8 12a7.2 7.2 0 0112.3-5.1M19.2 12a7.2 7.2 0 01-12.3 5.1" {...S} /><path d="M17.3 3.6v3.3H14M6.7 20.4v-3.3H10" {...S} /></>} />
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
