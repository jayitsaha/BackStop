import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { Loading, ErrorNote } from '../components/states'
import { VerifiedMark, GradePill, ProtectedMark, GradeBadge, ArrowIcon, CheckIcon, XIcon, ShieldIcon } from '../components/marks'
import { AGENT_BLURB, TEST_TITLES, CATEGORY_OF, shortTestId, cents, usd, oneIn, gradeTheme } from '../lib/format'
import CrashTestLab from '../components/CrashTestLab.jsx'

export default function AgentDetail() {
  const { id } = useParams()
  const { data, loading, error } = useAsync(() => api.agent(id), [id])
  const [live, setLive] = useState({}) // testId -> passed (overrides recorded)

  const perTest = useMemo(() => recordedPerTest(data?.runs), [data])
  if (loading) return <Loading label="Loading agent…" />
  if (error) return <ErrorNote error={error} />

  const name = data.name
  const g = data.grade
  const q = data.quote
  const declined = q.status === 'declined'
  const t = gradeTheme(g.grade)
  const blurb = {
    tagline: data.tagline || AGENT_BLURB[name]?.tagline || data.blurb || data.system_prompt?.slice(0, 160),
    developer: AGENT_BLURB[name]?.developer || data.developer,
  }
  const isLive = data.kind === 'llm'

  return (
    <div className="space-y-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowIcon className="h-4 w-4 rotate-180" /> Marketplace
      </Link>

      {/* header */}
      <div className="card relative overflow-hidden p-7 md:p-9">
        <div className={`pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full blur-3xl`} style={{ background: `${t.hex}22` }} />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl font-semibold text-white">{name}</h1>
              <span className="text-slate-500">· {blurb.developer || data.developer}</span>
            </div>
            <p className="mt-2 max-w-xl text-slate-400">{blurb.tagline}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {data.identity?.agent_id && <VerifiedMark />}
              <GradePill grade={g.grade} score={g.score} />
              <ProtectedMark quote={q} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isLive ? (
                <span className="chip border-brand/30 bg-brand/10 text-brand-soft">live LLM · {data.model}</span>
              ) : (
                <span className="chip">deterministic reference engine</span>
              )}
              {data.use_case_type && <span className="chip">{data.use_case_type}</span>}
              {data.category && <span className="chip">{data.category}</span>}
            </div>
            {data.identity?.agent_id && (
              <div className="mt-2 font-mono text-xs text-slate-600">
                id {data.identity.agent_id} · v{data.identity.version} · code {data.identity.code_hash?.slice(0, 10)} · sig {data.identity.signature?.slice(0, 10)}…
              </div>
            )}
          </div>
          <div className="flex items-center gap-6">
            <GradeBadge grade={g.grade} size="lg" />
            <div className="hidden sm:block">
              <Metric label="Crash score" value={g.score} sub={`${g.passed_tests}/${g.total_tests} tests`} />
              <Metric label="Stability band" value={`${g.band[0]}–${g.band[1]}`} sub={g.unstable_tests?.length ? `${g.unstable_tests.length} unstable` : 'all stable'} className="mt-3" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-8">
          <AboutAgent data={data} name={name} />
          <CrashTestLab agentId={id} name={name} isLive={isLive} perTest={perTest} live={live} onLive={(tid, passed) => setLive((m) => ({ ...m, [tid]: passed }))} />
          <RedTeam id={id} name={name} />
          <ReplayGrid perTest={perTest} live={live} />
        </div>
        <div className="space-y-8">
          <PolicyCard name={name} q={q} declined={declined} book={data.book_400k_payments} />
          <Subscores subscores={data.subscores} />
          <Coverage />
        </div>
      </div>
    </div>
  )
}

// Rich marketplace info — what this agent IS, what it OFFERS, and HOW to use it.
function AboutAgent({ data, name }) {
  const caps = data.capabilities || []
  const usage = data.usage || []
  const inputs = data.inputs || []
  const outputs = data.outputs || []
  const examples = data.example_tasks || []
  const hasAnything = data.description || caps.length || usage.length || inputs.length || outputs.length
  if (!hasAnything) return null
  return (
    <div className="card p-6 md:p-7">
      <div className="eyebrow mb-1"><span className="h-2 w-2 rounded-full bg-brand" /> About this agent</div>
      <h3 className="font-display text-2xl text-white">What {name} does</h3>
      {data.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{data.description}</p>
      )}

      {caps.length > 0 && (
        <div className="mt-6">
          <div className="label mb-3">What it offers</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {caps.map((c, i) => {
              const nm = typeof c === 'string' ? c : c.name
              const desc = typeof c === 'string' ? '' : c.description
              return (
                <div key={i} className="rounded-xl border border-line bg-ink-950/50 p-3">
                  <div className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4 flex-none text-safe" />
                    <div>
                      <div className="text-sm font-medium text-white">{nm}</div>
                      {desc && <div className="mt-0.5 text-xs text-slate-400">{desc}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {usage.length > 0 && (
        <div className="mt-6">
          <div className="label mb-3">How to use it</div>
          <ol className="space-y-2">
            {usage.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-brand/15 font-mono text-[11px] text-brand-soft">{i + 1}</span>
                {typeof step === 'string' ? step : step.text || step.title}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {inputs.length > 0 && (
            <div>
              <div className="label mb-2">Inputs</div>
              <div className="flex flex-wrap gap-1.5">
                {inputs.map((x, i) => <span key={i} className="chip">{typeof x === 'string' ? x : x.name}</span>)}
              </div>
            </div>
          )}
          {outputs.length > 0 && (
            <div>
              <div className="label mb-2">Outputs</div>
              <div className="flex flex-wrap gap-1.5">
                {outputs.map((x, i) => <span key={i} className="chip">{typeof x === 'string' ? x : x.name}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {examples.length > 0 && (
        <div className="mt-6">
          <div className="label mb-2">Example tasks</div>
          <ul className="space-y-1.5">
            {examples.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <ArrowIcon className="mt-0.5 h-4 w-4 flex-none text-slate-500" />
                <span className="italic">“{typeof x === 'string' ? x : x.text}”</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function recordedPerTest(runs) {
  const map = {}
  ;(runs || []).forEach((r) => {
    const sid = (r.test_id || '').slice(0, 3) // normalise T01_foo -> T01 (tiles are keyed by short id)
    map[sid] = map[sid] || { passes: 0, total: 0, runs: [] }
    map[sid].passes += r.passed ? 1 : 0
    map[sid].total += 1
    map[sid].runs.push(r)
  })
  Object.values(map).forEach((v) => (v.passed = v.passes >= Math.ceil(v.total / 2)))
  return map
}

function Metric({ label, value, sub, className = '' }) {
  return (
    <div className={className}>
      <div className="stat-num text-2xl">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
      <div className="label mt-0.5">{label}</div>
    </div>
  )
}

function RedTeam({ id, name }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  async function go() {
    setBusy(true)
    setErr('')
    setRes(null)
    try {
      setRes(await api.redteam(id))
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Red-team failed — is the API up?')
    } finally {
      setBusy(false)
    }
  }
  const j = res?.judge
  const safe = j?.safe
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="mesh" style={{ top: '-70px', left: '6%', height: 180, width: 220, background: 'rgba(255,106,98,0.10)' }} />
      <div className="relative">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="eyebrow mb-1 !text-bad/90"><span className="h-2 w-2 rounded-full bg-bad" /> Adversarial red-team · AI vs AI</div>
            <h3 className="font-display text-xl text-white">Invent a brand-new attack</h3>
            <p className="mt-1 max-w-md text-sm text-slate-400">An attacker model writes a novel scam that isn’t in the 20 tests. {name} faces it live. A judge model rules.</p>
          </div>
          <button onClick={go} disabled={busy} className="btn-ghost whitespace-nowrap border-bad/30 hover:border-bad/60">
            {busy ? 'Generating & testing…' : 'Generate attack & test'}
          </button>
        </div>

        {busy && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-ink-950/50 p-4 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-bad" />
            Attacker is writing a novel attack → {name} is responding → judge is ruling…
          </div>
        )}
        {err && <div className="mt-4 rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{err}</div>}

        {res && (
          <div className="mt-5 grid animate-fade-up gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-bad/25 bg-bad/[0.04] p-4">
              <div className="label mb-1 text-bad/90">Generated attack · {res.attack.channel}</div>
              <div className="font-semibold text-white">{res.attack.title}</div>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{res.attack.body}</p>
              <div className="mt-2 text-[11px] text-slate-500">A safe agent should: <b className="text-slate-300">{res.attack.correct_action}</b></div>
            </div>
            <div className="flex flex-col">
              <div className="label mb-2">What {name} did</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {res.actions.map((a, i) => (
                  <span key={i} className="rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">{a.tool}</span>
                ))}
              </div>
              <div className={`mt-auto rounded-xl border p-4 ${safe ? 'border-safe/40 bg-safe/10' : 'border-bad/40 bg-bad/10'}`}>
                <div className={`flex items-center gap-2 font-display text-lg ${safe ? 'text-safe' : 'text-bad'}`}>
                  {safe ? <CheckIcon className="h-5 w-5" /> : <XIcon className="h-5 w-5" />}
                  Judge: {safe ? 'stayed safe' : 'got caught'}
                </div>
                <p className="mt-1 text-xs text-slate-300">{j.explanation}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReplayGrid({ perTest, live }) {
  const ids = Object.keys(TEST_TITLES)
  return (
    <div className="card p-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-xl text-white">The 20 crash tests</h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-safe" /> passed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-bad" /> failed</span>
        </div>
      </div>
      <p className="mb-5 text-sm text-slate-400">Three runs each. A test passes if at least two of three pass. What the agent actually did is its grade — not what it said.</p>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
        {ids.map((tid) => {
          const rec = perTest[tid]
          const isLive = live[tid] != null
          const passed = isLive ? live[tid] : rec?.passed
          const known = isLive || rec
          const base = !known ? 'border-line bg-ink-800 text-slate-500' : passed ? 'border-safe/40 bg-safe/10 text-safe' : 'border-bad/40 bg-bad/10 text-bad'
          return (
            <div
              key={tid}
              title={`${tid} — ${TEST_TITLES[tid]}`}
              className={`group relative aspect-square rounded-xl border p-2 text-left transition ${base} ${isLive ? 'ring-2 ring-offset-2 ring-offset-ink-850 ring-brand animate-pop' : ''}`}
            >
              <div className="font-mono text-xs opacity-80">{shortTestId(tid)}</div>
              <div className="absolute bottom-2 right-2">
                {known ? (passed ? <CheckIcon className="h-4 w-4" /> : <XIcon className="h-4 w-4" />) : <span className="text-[10px]">·</span>}
              </div>
              <div className="pointer-events-none absolute inset-x-1 bottom-full z-10 mb-2 hidden rounded-lg border border-line bg-ink-950 p-2 text-[11px] text-slate-300 shadow-card group-hover:block">
                {TEST_TITLES[tid]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Subscores({ subscores }) {
  if (!subscores?.length) return null
  return (
    <div className="card p-6">
      <h3 className="mb-4 font-display text-xl text-white">By category</h3>
      <div className="space-y-3.5">
        {subscores.map((s) => {
          const ratio = s.total ? s.passed / s.total : 0
          const full = ratio === 1
          return (
            <div key={s.category}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-slate-300">{s.category}</span>
                <span className={full ? 'text-safe' : 'text-warn'}>
                  {s.passed}/{s.total}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                <div className={`h-full rounded-full ${full ? 'bg-safe' : 'bg-warn'}`} style={{ width: `${ratio * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PolicyCard({ name, q, declined, book }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-ink-900/60 px-6 py-4">
        <div className="label">Policy card</div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-display text-xl text-white">{declined ? 'Declined' : 'Master policy'}</span>
          {!declined && <span className="font-display text-2xl text-safe">{cents(q.gross_premium_usd)}<span className="text-sm text-slate-500">/payment</span></span>}
        </div>
      </div>
      <div className="space-y-3 px-6 py-5 text-sm">
        <Row k="Grade → frequency" v={`${q.grade} · ${oneIn(q.frequency)} payments`} />
        <Row k="Severity (avg covered loss)" v={usd(q.severity_usd, 0)} />
        <Row k="Pure premium" v={`${cents(q.pure_premium_usd)} = ${oneIn(q.frequency).replace('1 in ', '1/')} × ${usd(q.severity_usd, 0)}`} />
        <Row k="Target loss ratio" v={`${Math.round(q.target_loss_ratio * 100)}%`} />
        <Row k="Gross premium" v={<span className={declined ? 'text-bad' : 'text-safe'}>{cents(q.gross_premium_usd)}</span>} strong />
        <div className="my-3 border-t border-line/70" />
        <Row k="Per-incident limit" v={usd(q.per_incident_limit_usd, 0)} />
        <Row k="Monthly aggregate" v={usd(q.monthly_aggregate_usd, 0)} />
        <Row k="Backstop commission" v={`${cents(q.commission_usd)} · ${Math.round(q.target_loss_ratio && (q.commission_usd / q.gross_premium_usd) * 100)}%`} />
        <Row k="Reinsurer margin" v={cents(q.reinsurer_margin_usd)} />
      </div>
      {book && !declined && (
        <div className="border-t border-line bg-ink-900/40 px-6 py-4 text-xs text-slate-400">
          On a book of <b className="text-slate-200">400k payments/mo</b>: {usd(book.gross_premium_usd, 0)} premium · {book.expected_claim_count} expected claims · {usd(book.expected_claims_usd, 0)} losses · loss ratio {Math.round(book.loss_ratio * 100)}%.
        </div>
      )}
      <div className="px-6 pb-6 pt-2">
        {declined ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
            One mistake in 200 payments — a dollar a payment. We don’t sell cover we’d lose money on. <b>Not listed.</b>
          </div>
        ) : (
          <Link to="/app" className="btn-primary w-full">
            Add {name} & connect my bank <ArrowIcon className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  )
}

function Row({ k, v, strong }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-400">{k}</span>
      <span className={`text-right font-mono ${strong ? 'font-semibold text-white' : 'text-slate-200'}`}>{v}</span>
    </div>
  )
}

function Coverage() {
  return (
    <div className="card p-6 text-sm">
      <h3 className="mb-3 font-display text-xl text-white">What’s covered</h3>
      <ul className="space-y-2">
        {[
          ['Duplicate bills inside the mandate', true],
          ['Wrong amounts under your cap', true],
          ['A cancellation that keeps charging', true],
        ].map(([t]) => (
          <li key={t} className="flex items-start gap-2 text-slate-300"><CheckIcon className="mt-0.5 h-4 w-4 text-safe" /> {t}</li>
        ))}
        {[
          ['Anything outside the mandate', false],
          ['Payments to an unverified payee', false],
        ].map(([t]) => (
          <li key={t} className="flex items-start gap-2 text-slate-500"><XIcon className="mt-0.5 h-4 w-4 text-bad" /> {t}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Had the agent paid a forged email, that’s the agent maker’s liability — they refund you and the grade drops.
      </p>
    </div>
  )
}
