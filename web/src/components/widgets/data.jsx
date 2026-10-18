import { useState } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../../api'
import { useAsync } from '../../lib/useAsync'
import { useCustomer } from '../../lib/CustomerContext.jsx'
import { LockIcon } from '../marks'
import { WidgetShell, accent, resolveSource, fmt, StatusTag, RunTimeline } from './shared.jsx'

/* -------------------------------------------------------------- stat_cards */
export function StatCards({ section, customer, agentRecord }) {
  const items = section.props?.items || []
  const t = accent(section.accent)
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => {
          const raw = it.source != null ? resolveSource(customer, it.source, agentRecord) : it.value
          return (
            <div key={i} className="group relative overflow-hidden rounded-xl border border-line bg-ink-900/40 p-4 transition-colors hover:border-brand/30">
              <div className={`stat-num text-2xl ${t.text}`}>{fmt(raw, it.format)}</div>
              <div className="label mt-1">{it.label}</div>
              {it.sub && <div className="mt-0.5 text-[10px] text-slate-600">{it.sub}</div>}
            </div>
          )
        })}
      </div>
    </WidgetShell>
  )
}

/* --------------------------------------------------------------- item_list */
export function ItemList({ section, customer, agentRecord }) {
  const p = section.props || {}
  let rows = resolveSource(customer, p.source, agentRecord)
  if (!Array.isArray(rows)) rows = []
  if (p.limit) rows = rows.slice(0, p.limit)
  const cols = p.columns || []
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{p.empty || 'Nothing here yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                {cols.map((c) => (
                  <th key={c.key} className="label pb-2 pr-4 font-semibold">{c.label || c.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || i} className="border-b border-line/60 last:border-0">
                  {cols.map((c) => {
                    const val = c.key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row)
                    return (
                      <td key={c.key} className="py-2.5 pr-4 text-slate-300">
                        {c.format === 'status' ? <StatusTag status={val} /> : fmt(val, c.format)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetShell>
  )
}

/* ---------------------------------------------------------------- timeline */
export function Timeline({ section, customer, agentRecord, agentName }) {
  const p = section.props || {}
  let runs = resolveSource(customer, p.source || 'runs', agentRecord)
  if (!Array.isArray(runs)) runs = []
  const ordered = [...runs].reverse()
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent} eyebrow="Activity">
      {ordered.length === 0 ? (
        <p className="text-sm text-slate-500">{p.empty || 'Nothing yet — run the agent.'}</p>
      ) : (
        <div className="space-y-6">
          {ordered.map((run, i) => (
            <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>{run.agent_name || run.agent || agentName || 'run'}</span>
                <span className="font-mono">{(run.ts || '').slice(0, 16).replace('T', ' ')}</span>
              </div>
              <RunTimeline run={run} agent={run.agent_name || run.agent || agentName} />
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

/* ------------------------------------------------------------------ chart */
export function Chart({ section, customer, agentRecord }) {
  const p = section.props || {}
  let rows = resolveSource(customer, p.source, agentRecord)
  if (!Array.isArray(rows)) rows = []
  const t = accent(section.accent)
  const x = p.x || 'ts'
  const y = p.y || 'value'
  const data = rows.map((r, i) => {
    const xv = r[x]
    return { ...r, _x: typeof xv === 'string' ? xv.slice(5, 16).replace('T', ' ') : xv ?? i + 1, _y: Number(r[y] ?? 0) }
  })
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle || p.label} acc={section.accent}>
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">{p.empty || 'No data to chart yet.'}</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {p.kind === 'bar' ? (
              <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#3a342f" vertical={false} />
                <XAxis dataKey="_x" tick={{ fill: '#8b8a87', fontSize: 11 }} stroke="#3a342f" />
                <YAxis tick={{ fill: '#8b8a87', fontSize: 11 }} stroke="#3a342f" />
                <Tooltip contentStyle={{ background: '#171310', border: '1px solid #3a342f', borderRadius: 12, color: '#f1f0ef' }} labelStyle={{ color: '#8b8a87' }} cursor={{ fill: 'rgba(196,85,45,0.06)' }} />
                <Bar dataKey="_y" name={p.label || y} fill={t.stroke} radius={[6, 6, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#3a342f" vertical={false} />
                <XAxis dataKey="_x" tick={{ fill: '#8b8a87', fontSize: 11 }} stroke="#3a342f" />
                <YAxis tick={{ fill: '#8b8a87', fontSize: 11 }} stroke="#3a342f" />
                <Tooltip contentStyle={{ background: '#171310', border: '1px solid #3a342f', borderRadius: 12, color: '#f1f0ef' }} labelStyle={{ color: '#8b8a87' }} cursor={{ fill: 'rgba(196,85,45,0.06)' }} />
                <Line type="monotone" dataKey="_y" name={p.label || y} stroke={t.stroke} strokeWidth={2.4} dot={{ r: 3, fill: t.stroke }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </WidgetShell>
  )
}

/* ------------------------------------------------------------- capabilities */
export function Capabilities({ section, customer, agentRecord }) {
  const p = section.props || {}
  let caps = p.source ? resolveSource(customer, p.source, agentRecord) : null
  if (!Array.isArray(caps) || caps.length === 0) {
    caps = agentRecord?.capabilities || customer?.agent?.capabilities || p.items || []
  }
  const t = accent(section.accent)
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent}>
      {caps.length === 0 ? (
        <p className="text-sm text-slate-500">No capabilities listed.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {caps.map((cap, i) => {
            const name = typeof cap === 'string' ? cap : cap.name
            const desc = typeof cap === 'string' ? '' : cap.description
            return (
              <div key={i} className="rounded-xl border border-line bg-ink-900/40 p-4">
                <div className={`flex items-center gap-2 font-medium text-white`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} /> {name}
                </div>
                {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}

/* ---------------------------------------------------------------- markdown */
// Tiny self-contained markdown formatter: headings, bold, lists, line breaks.
export function Markdown({ section }) {
  const content = section.props?.content || ''
  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent}>
      <div className="space-y-2 text-sm leading-relaxed text-slate-300">{renderMarkdown(content)}</div>
    </WidgetShell>
  )
}

function inline(text) {
  // bold **x** and inline `code`
  const parts = []
  let rest = String(text)
  let key = 0
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/
  let m
  while ((m = re.exec(rest))) {
    if (m.index > 0) parts.push(rest.slice(0, m.index))
    if (m[2] != null) parts.push(<b key={key++} className="font-semibold text-white">{m[2]}</b>)
    else parts.push(<code key={key++} className="rounded bg-ink-800 px-1 py-0.5 font-mono text-xs text-brand-soft">{m[3]}</code>)
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest) parts.push(rest)
  return parts
}

function renderMarkdown(md) {
  const lines = String(md).replace(/\\n/g, '\n').split('\n')
  const out = []
  let list = null
  let ordered = false
  const flush = () => {
    if (list) {
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={out.length} className={`ml-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'} text-slate-300`}>
          {list.map((li, i) => <li key={i}>{inline(li)}</li>)}
        </Tag>,
      )
      list = null
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^###\s+/.test(line)) { flush(); out.push(<h4 key={out.length} className="mt-3 font-display text-base text-white">{inline(line.replace(/^###\s+/, ''))}</h4>); continue }
    if (/^##\s+/.test(line)) { flush(); out.push(<h3 key={out.length} className="mt-3 font-display text-lg text-white">{inline(line.replace(/^##\s+/, ''))}</h3>); continue }
    if (/^#\s+/.test(line)) { flush(); out.push(<h2 key={out.length} className="mt-3 font-display text-xl text-white">{inline(line.replace(/^#\s+/, ''))}</h2>); continue }
    const ol = line.match(/^\s*\d+\.\s+(.*)/)
    const ul = line.match(/^\s*[-*]\s+(.*)/)
    if (ol) { if (!list || !ordered) { flush(); list = []; ordered = true } list.push(ol[1]); continue }
    if (ul) { if (!list || ordered) { flush(); list = []; ordered = false } list.push(ul[1]); continue }
    if (!line.trim()) { flush(); continue }
    flush()
    out.push(<p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return out
}

/* ----------------------------------------------------------- mandate_editor */
export function MandateEditor({ section }) {
  const ctx = useCustomer()
  const c = ctx.customer
  const mandate = useAsync(() => api.mandate().catch(() => null), [])
  const [payee, setPayee] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const frozen = c?.frozen || []

  async function hold() {
    if (!payee.trim()) return
    setBusy(true); setErr('')
    try {
      await api.hold({ payee: payee.trim(), reason: 'held from mandate editor', source: 'dashboard' })
      await ctx.refresh()
      setPayee('')
    } catch (e) { setErr(e?.response?.data?.detail || 'Could not hold payee.') } finally { setBusy(false) }
  }
  async function unhold(name) {
    setBusy(true); setErr('')
    try {
      await api.unhold(name)
      await ctx.refresh()
    } catch (e) { setErr(e?.response?.data?.detail || 'Could not unhold payee.') } finally { setBusy(false) }
  }

  const rules = mandate.data?.rules || mandate.data?.never_allowed || null
  return (
    <WidgetShell title={section.title || 'Spend mandate'} subtitle={section.subtitle} acc={section.accent}>
      <div className="rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-400">
        {mandate.loading ? (
          'Loading mandate…'
        ) : Array.isArray(rules) ? (
          <ul className="ml-5 list-disc space-y-1">{rules.map((r, i) => <li key={i}>{typeof r === 'string' ? r : JSON.stringify(r)}</li>)}</ul>
        ) : (
          <div>
            <b className="text-slate-200">Never allowed:</b> add payees · change bank details · person-to-person · change limits. Hours 7am–9pm · one payment per payee per cycle · $2,800/week.
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="label mb-2">Frozen payees — your agent will never pay these</div>
        {frozen.length === 0 ? (
          <p className="text-sm text-slate-500">No payees frozen.</p>
        ) : (
          <div className="space-y-2">
            {frozen.map((f, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5 text-slate-200"><LockIcon className="h-3.5 w-3.5 shrink-0 text-bad" /> {f.payee}{f.reason ? <span className="text-xs text-slate-500"> · {f.reason}</span> : null}</span>
                <button onClick={() => unhold(f.payee)} disabled={busy} className="text-xs text-slate-400 hover:text-white">unfreeze</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Freeze a payee by name…" className="inp text-sm" />
        <button onClick={hold} disabled={busy || !payee.trim()} className="btn-ghost whitespace-nowrap !py-2 text-sm">Freeze</button>
      </div>
      {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
    </WidgetShell>
  )
}
