import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useCustomer } from '../../lib/CustomerContext.jsx'
import { usd } from '../../lib/format'
import { ArrowIcon } from '../marks'
import { WidgetShell, accent, RunTimeline } from './shared.jsx'

/* ------------------------------------------------------------ agent_runner */
export function AgentRunner({ section, agentId, agentName }) {
  const p = section.props || {}
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(null)
  const [err, setErr] = useState('')
  const t = accent(section.accent)
  const examples = p.examples || []

  async function go(text) {
    const value = (text ?? task).trim()
    if (!value) { setErr('Tell the agent what to do first.'); return }
    setBusy(true); setErr(''); setRun(null)
    try {
      const r = await api.agentTask({ task: value, agent: agentId })
      setRun(r.run || r)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'The agent could not run that — is the API up?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent} eyebrow="Run the agent" live>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div>
          {p.input_label && <div className="label mb-2">{p.input_label}</div>}
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={4}
            placeholder={p.placeholder || `Tell ${agentName || 'the agent'} what to do…`}
            className="inp resize-y text-sm"
          />
          {examples.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {examples.map((ex, i) => (
                <button key={i} onClick={() => { setTask(ex); go(ex) }} disabled={busy} className="chip transition hover:border-brand/50 hover:text-white">
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center">
            <button onClick={() => go()} disabled={busy} className="btn-primary ml-auto !py-2 text-sm">
              {busy ? 'Working…' : p.cta || `Run ${agentName || 'agent'}`} <ArrowIcon className="h-4 w-4" />
            </button>
          </div>
          {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
        </div>

        <div className="rounded-xl border border-line bg-ink-950/50 p-4">
          {!run && !busy && <div className="grid h-full min-h-[8rem] place-items-center text-center text-sm text-slate-600">The agent’s work appears here.</div>}
          {busy && !run && <div className="grid h-full min-h-[8rem] place-items-center"><span className={`h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand`} /></div>}
          {run && <RunTimeline run={run} agent={agentName} />}
        </div>
      </div>
    </WidgetShell>
  )
}

/* ------------------------------------------------------------- form_action */
export function FormAction({ section, agentId, agentName }) {
  const p = section.props || {}
  const fields = p.fields || []
  const submit = p.submit || {}
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(null)
  const [err, setErr] = useState('')

  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))

  function buildTask() {
    const tpl = submit.task_template || ''
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (values[k] != null && values[k] !== '' ? values[k] : `{${k}}`))
  }

  async function go() {
    const missing = fields.filter((f) => f.required !== false && (values[f.key] == null || values[f.key] === ''))
    if (missing.length && !submit.task_template) { setErr('Fill in the fields first.'); return }
    setBusy(true); setErr(''); setRun(null)
    try {
      const task = submit.task_template ? buildTask() : fields.map((f) => `${f.label || f.key}: ${values[f.key] ?? ''}`).join('; ')
      const r = await api.agentTask({ task, inputs: values, agent: agentId })
      setRun(r.run || r)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'The agent could not run that — is the API up?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WidgetShell title={section.title} subtitle={section.subtitle} acc={section.accent} eyebrow="Run the agent" live>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className={`block ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
            <span className="label">{f.label || f.key}</span>
            <div className="mt-2">
              {f.type === 'textarea' ? (
                <textarea value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={3} placeholder={f.placeholder} className="inp resize-y text-sm" />
              ) : f.type === 'select' ? (
                <select value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} className="inp text-sm">
                  <option value="">Choose…</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type === 'number' ? 'number' : 'text'} value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className="inp text-sm" />
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center">
        <button onClick={go} disabled={busy} className="btn-primary ml-auto !py-2 text-sm">
          {busy ? 'Working…' : submit.label || `Run ${agentName || 'agent'}`} <ArrowIcon className="h-4 w-4" />
        </button>
      </div>
      {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
      {run && <div className="mt-4 rounded-xl border border-line bg-ink-950/50 p-4"><RunTimeline run={run} agent={agentName} /></div>}
    </WidgetShell>
  )
}

/* ------------------------------------------------------------- claims_panel */
export function ClaimsPanel({ section, customer }) {
  const ctx = useCustomer()
  const c = ctx.customer || customer
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const payments = (c?.bank?.payments || []).filter((p) => p.memo !== 'prior')
  const claimedIds = new Set((c?.claims || []).map((cl) => cl.payment?.id))
  const claimable = payments.filter((p) => p.status === 'ok' || p.status === 'scheduled')

  async function flag(id) {
    setBusy(id); setErr('')
    try {
      await ctx.claim(id)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Claim failed — is the API up?')
    } finally {
      setBusy(null)
    }
  }

  return (
    <WidgetShell
      title={section.title || 'Claims'}
      subtitle={section.subtitle || 'Something wrong with a payment the agent made? File a claim — mistakes inside your mandate are covered.'}
      acc={section.accent}
      right={<Link to="/claims" className="text-xs text-brand/90 hover:text-brand-soft">Full litigation →</Link>}
    >
      {err && <div className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
      {claimable.length === 0 ? (
        <p className="text-sm text-slate-500">No payments to claim yet. Once your agent makes a payment, you can flag it here.</p>
      ) : (
        <div className="space-y-2">
          {claimable.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-900/40 px-4 py-3">
              <div>
                <div className="font-medium text-white">{p.payee} · {usd(p.amount)}</div>
                <div className="text-xs text-slate-500">{(p.ts || '').slice(0, 16).replace('T', ' ')}</div>
              </div>
              {claimedIds.has(p.id) ? (
                <span className="chip text-slate-500">filed</span>
              ) : (
                <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy === p.id} onClick={() => flag(p.id)}>
                  {busy === p.id ? 'reading log…' : 'File a claim'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {c?.claims?.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2">Filed claims</div>
          <div className="space-y-2">
            {c.claims.map((cl, i) => {
              const v = cl.verdict || {}
              return (
                <div key={i} className="rounded-xl border border-line bg-ink-900/40 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200">{cl.payment?.payee} · {usd(v.amount_usd)}</span>
                    <span className="text-xs text-slate-400">{(v.outcome || 'in review').replace(/_/g, ' ')}</span>
                  </div>
                  {v.reasons?.length > 0 && <div className="mt-1 text-xs text-slate-500">{v.who_pays ? `${v.who_pays} · ` : ''}{v.reasons.join(', ')}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </WidgetShell>
  )
}
