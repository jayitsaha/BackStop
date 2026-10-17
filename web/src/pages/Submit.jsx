import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { Loading, ErrorNote } from '../components/states'
import { GradeBadge, ShieldIcon, CheckIcon, XIcon, ArrowIcon } from '../components/marks'
import { AGENT_BLURB, cents, usd, oneIn, gradeTheme } from '../lib/format'

const STAGES = [
  ['KYA', 'Verify developer, sign agent ID'],
  ['Crash-test', '20 attacks × 3 runs in fresh sandboxes'],
  ['Grade', 'Deterministic checks → grade + band'],
  ['Price', 'Grade → frequency → premium'],
  ['List', 'Bind policy, place on the shelf'],
]

export default function Submit() {
  const avail = useAsync(() => api.available(), [])
  const [selected, setSelected] = useState(null)
  const [stage, setStage] = useState(-1)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  if (avail.loading) return <Loading label="Loading the maker console…" />
  if (avail.error) return <ErrorNote error={avail.error} />

  async function submit(name) {
    setSelected(name)
    setResult(null)
    setBusy(true)
    setStage(0)
    // stage the UI while the real pipeline runs; then show the real result
    const tick = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 420)
    try {
      const res = await api.listAgent(name)
      await wait(400)
      clearInterval(tick)
      setStage(STAGES.length)
      setResult(res)
    } catch (e) {
      clearInterval(tick)
      alert('Submission failed — is the API up?')
      setStage(-1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <div className="label mb-2">Agent-maker console</div>
        <h1 className="font-display text-4xl font-semibold text-white">List an agent. Earn its grade, live.</h1>
        <p className="mt-3 text-lg text-slate-300">
          Submit an agent and watch the real loop run: we verify the developer, sign an ID bound to the exact code,
          run all 20 crash tests three times in fresh sandboxes, grade it, price it, and bind a policy. No cover, no shelf.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        {/* pick an agent */}
        <div className="space-y-3">
          <div className="label">Available agents (our reference builds)</div>
          {avail.data.map((a) => {
            const blurb = AGENT_BLURB[a.name] || {}
            return (
              <div key={a.name} className={`card p-5 ${selected === a.name ? 'border-brand/60 ring-1 ring-brand/30' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-xl text-white">{a.name}</div>
                    <div className="text-xs text-slate-500">{blurb.developer}</div>
                  </div>
                  {a.listed ? (
                    <span className="chip border-safe/30 bg-safe/10 text-safe">on shelf</span>
                  ) : (
                    <span className="chip text-slate-400">unlisted</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-400">{blurb.tagline}</p>
                <button className="btn-ghost mt-4 w-full" disabled={busy} onClick={() => submit(a.name)}>
                  {busy && selected === a.name ? 'Running the loop…' : a.listed ? 'Re-test & re-price' : 'Submit for verification'}
                  <ArrowIcon className="h-4 w-4" />
                </button>
              </div>
            )
          })}
          <p className="text-xs text-slate-600">
            In production an agent maker uploads their own code here; the signed ID is bound to its hash, so any change
            forces a re-test. For the demo these are the three reference agents.
          </p>
        </div>

        {/* the pipeline + result */}
        <div className="card p-7">
          {stage < 0 && (
            <div className="flex h-full min-h-[20rem] flex-col items-center justify-center text-center text-slate-500">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 text-brand ring-1 ring-line">
                <ShieldIcon className="h-7 w-7" />
              </div>
              <p className="mt-4 max-w-sm">Pick an agent to run the real verification + crash-test pipeline.</p>
            </div>
          )}

          {stage >= 0 && (
            <div>
              <div className="label mb-4">Underwriting {selected}</div>
              <ol className="space-y-3">
                {STAGES.map(([t, d], i) => {
                  const done = stage > i
                  const active = stage === i
                  return (
                    <li key={t} className={`flex items-start gap-3 rounded-xl border p-3 transition ${done ? 'border-safe/30 bg-safe/5' : active ? 'border-brand/40 bg-brand/5' : 'border-line bg-ink-900/40'}`}>
                      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${done ? 'bg-safe text-ink-950' : active ? 'bg-brand text-white animate-pulse-ring' : 'bg-ink-700 text-slate-500'}`}>
                        {done ? <CheckIcon className="h-4 w-4" /> : i + 1}
                      </span>
                      <div>
                        <div className={`text-sm font-medium ${done ? 'text-safe' : active ? 'text-white' : 'text-slate-400'}`}>{t}</div>
                        <div className="text-xs text-slate-500">{d}</div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {result && <Result name={selected} res={result} />}
        </div>
      </div>
    </div>
  )
}

function Result({ name, res }) {
  const g = res.grade
  const q = res.quote
  const t = gradeTheme(g.grade)
  const declined = q.status === 'declined'
  const id = res.identity
  return (
    <div className="mt-6 animate-fade-up border-t border-line pt-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="label mb-1">Result</div>
          <div className="flex items-center gap-3">
            <GradeBadge grade={g.grade} size="md" />
            <div>
              <div className="font-display text-xl text-white">{g.score} / 100</div>
              <div className="text-xs text-slate-500">{g.passed_tests}/{g.total_tests} tests · band {g.band[0]}–{g.band[1]}</div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`font-display text-2xl ${declined ? 'text-bad' : 'text-safe'}`}>{declined ? 'Declined' : cents(q.gross_premium_usd)}</div>
          <div className="text-xs text-slate-500">{declined ? 'no cover, no shelf' : 'per payment'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-ink-900/50 p-4 font-mono text-xs text-slate-400">
        <div><span className="text-slate-600">agent_id</span> {id?.agent_id}</div>
        <div><span className="text-slate-600">code_hash</span> {id?.code_hash}</div>
        <div><span className="text-slate-600">signature</span> {id?.signature}</div>
        <div><span className="text-slate-600">status</span> <span className="text-safe">{id?.status}</span></div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Mini k="Mistake rate" v={oneIn(q.frequency)} />
        <Mini k="Per-incident" v={usd(q.per_incident_limit_usd, 0)} />
        <Mini k="Monthly agg." v={usd(q.monthly_aggregate_usd / 1000, 0) + 'k'} />
      </div>

      <Link to={`/agent/${name}`} className="btn-primary mt-5 w-full">
        {declined ? 'See why it was declined' : `View ${name} on the shelf`} <ArrowIcon className="h-4 w-4" />
      </Link>
    </div>
  )
}

function Mini({ k, v }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900/40 p-3">
      <div className="label">{k}</div>
      <div className="mt-0.5 font-mono text-white">{v}</div>
    </div>
  )
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
