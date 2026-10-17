import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { useCustomer } from '../lib/CustomerContext.jsx'
import { Loading, ErrorNote } from '../components/states'
import { CheckIcon, XIcon, ArrowIcon, ShieldIcon, LockIcon, GradePill } from '../components/marks'
import { usd, cents, gradeTheme } from '../lib/format'
import { useAuth } from '../lib/auth.jsx'

// Turn an email into a friendly display name: "jay.saha@x.com" -> "Jay Saha"
function nameFromEmail(email) {
  if (!email) return ''
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || email.split('@')[0]
}

export default function CustomerApp() {
  const ctx = useCustomer()
  if (ctx.loading) return <Loading label="Loading your account…" />
  if (!ctx.customer) return <Onboard />
  if (!ctx.customer.agent) return <AddAgent />
  return <Dashboard />
}

/* ------------------------------------------------------------------ onboard */
function Onboard() {
  const ctx = useCustomer()
  const { user } = useAuth()
  const bank = useAsync(() => api.bankDemo(), [])
  const [name, setName] = useState(() => nameFromEmail(user?.email) || 'My account')
  const [rentCap, setRentCap] = useState(2000)
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    try {
      await ctx.create({ name, rent_cap: Number(rentCap) })
    } catch {
      alert('Could not open account — is the API up?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="label mb-2">Your account · step 1 of 2</div>
        <h1 className="font-display text-4xl font-semibold text-white">Open a Backstop account.</h1>
        <p className="mt-3 text-slate-300">Connect your bank and set the rules. Then add an agent — it can only act inside your mandate, and everything inside it is insured.</p>
      </header>

      <div className="card p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="inp" />
          </Field>
          <Field label="Rent cap (Oak Properties)">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">$</span>
              <input type="number" value={rentCap} onChange={(e) => setRentCap(e.target.value)} className="inp" />
            </div>
          </Field>
        </div>

        <div className="mt-6">
          <div className="label mb-2">Connect your bank (fake, for the demo)</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <BankTile name="Georgia First · Checking" bal={usd(bank.data?.balances?.checking ?? 3200, 2)} selected />
            <BankTile name="Georgia First · Savings" bal={usd(bank.data?.balances?.savings ?? 5000, 2)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-400">
          <b className="text-slate-200">Never allowed:</b> add payees · change bank details · person-to-person · change limits.
          Hours 7am–9pm · one payment per payee per cycle · $2,800/week.
        </div>

        <button className="btn-primary mt-6 w-full" onClick={open} disabled={busy}>
          {busy ? 'Opening account…' : 'Open account & connect bank'} <ArrowIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- add agent */
function AddAgent() {
  const ctx = useCustomer()
  const listings = useAsync(() => api.listings(), [])
  const [busy, setBusy] = useState(null)

  async function add(name) {
    setBusy(name)
    try {
      await ctx.addAgent(name)
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not add agent')
    } finally {
      setBusy(null)
    }
  }

  if (listings.loading) return <Loading />
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="label mb-2">Your account · step 2 of 2</div>
        <h1 className="font-display text-4xl font-semibold text-white">Add an agent to {ctx.customer.name.split(' ')[0]}’s bank.</h1>
        <p className="mt-3 text-slate-300">Only verified, insured agents can be added. The one you pick will handle your inbox.</p>
        <button onClick={ctx.reset} className="mt-3 text-xs text-slate-500 hover:text-white">← start over</button>
      </header>

      <div className="grid gap-5 sm:grid-cols-3">
        {listings.data.map((l) => {
          const declined = l.quote.status !== 'bound'
          return (
            <div key={l.agent} className={`card flex flex-col p-5 ${declined ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-display text-xl text-white">{l.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{l.developer}</div>
                </div>
                <GradePill grade={l.grade.grade} score={l.grade.score} />
              </div>
              {l.kind === 'llm' && <div className="mt-2 inline-flex w-fit rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-soft">live · {l.model?.split('/').pop()}</div>}
              <div className="mt-3 text-sm">
                {declined ? (
                  <span className="text-bad">Declined — not insurable</span>
                ) : (
                  <span className="text-safe">Protected · {cents(l.quote.gross_premium_usd)}/payment</span>
                )}
              </div>
              <button className="btn-primary mt-4" disabled={declined || busy} onClick={() => add(l.agent)}>
                {busy === l.agent ? 'Adding…' : declined ? 'Unavailable' : `Add ${l.name}`}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- dashboard */
function Dashboard() {
  const ctx = useCustomer()
  const c = ctx.customer
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'inbox'
  const setTab = (t) => setParams({ tab: t }, { replace: true })

  const payments = (c.bank?.payments || []).filter((p) => p.memo !== 'prior')
  const lastRun = c.runs?.[c.runs.length - 1]

  return (
    <div className="space-y-7">
      <AccountHeader c={c} onReset={ctx.reset} />

      <div className="flex gap-1 border-b border-line">
        {[
          ['inbox', 'Inbox & agent'],
          ['activity', `Activity${payments.length ? ` (${payments.length})` : ''}`],
          ['claims', `Claims${c.claims?.length ? ` (${c.claims.length})` : ''}`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === k ? 'border-brand text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'inbox' && <InboxTab />}
      {tab === 'activity' && <ActivityTab payments={payments} runs={c.runs} />}
      {tab === 'claims' && <ClaimsTab payments={payments} />}
    </div>
  )
}

function AccountHeader({ c, onReset }) {
  const cert = c.certificate
  return (
    <div className="card flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-white">{c.name}</h1>
          <span className="chip border-safe/30 bg-safe/10 text-safe"><LockIcon className="h-3.5 w-3.5" /> Covered by {(c.agent_name || c.agent)}</span>
        </div>
        {cert && <div className="mt-1 font-mono text-xs text-slate-500">cert {cert.certificate_id} · limit {usd(cert.per_incident_limit_usd, 0)} · your premium $0</div>}
      </div>
      <div className="flex items-center gap-6">
        <HeaderStat label="Checking" value={usd(c.bank?.balances?.checking ?? 0, 2)} />
        <HeaderStat label="Premium (maker pays)" value={cents(c.premium_collected_usd)} sub="accrued on your payments" />
        <button onClick={onReset} className="text-xs text-slate-500 hover:text-white">switch account</button>
      </div>
    </div>
  )
}

function HeaderStat({ label, value, sub }) {
  return (
    <div className="hidden sm:block">
      <div className="font-display text-xl text-white">{value}</div>
      <div className="label">{label}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  )
}

/* ---------------------------------------------------- Inbox Guard (live) */
const RISK = {
  safe: { label: 'Looks safe', ring: 'border-safe/40 bg-safe/10 text-safe', bar: 'bg-safe' },
  caution: { label: 'Be careful', ring: 'border-warn/40 bg-warn/10 text-warn', bar: 'bg-warn' },
  scam: { label: 'Likely a scam', ring: 'border-bad/40 bg-bad/10 text-bad', bar: 'bg-bad' },
}

function InboxGuard({ agent, onInjected }) {
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
      const r = await api.analyze({ text: text || undefined, image: image?.dataUri, inject })
      setRes(r.analysis)
      if (inject && r.injected) onInjected?.()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Analysis failed — is the API up?')
    } finally {
      setBusy(false)
    }
  }

  const risk = res?.risk ? RISK[res.risk.level] || RISK.caution : null
  const ex = res?.extracted || {}

  return (
    <div className="card-raised relative overflow-hidden p-6">
      <div className="mesh" style={{ top: '-80px', right: '2%', height: 200, width: 200, background: 'rgba(242,193,78,0.10)' }} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow mb-1"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-brand" /></span> Inbox Guard · live</div>
            <h3 className="font-display text-2xl tracking-tightish text-white">Is this bill real? Paste it and find out.</h3>
            <p className="mt-1 text-sm text-slate-400">Forward a suspicious email, paste a bill, or upload a screenshot. A multimodal model reads it and tells you — live — if it’s a scam and what {agent} would do.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Paste the email or bill text here…  (e.g. 'We changed banks, pay rent to account ending 4471…')"
              className="inp resize-y text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="btn-ghost cursor-pointer !py-2 text-xs">
                {image ? '✓ ' + image.name.slice(0, 18) : 'Upload a screenshot'}
                <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
              </label>
              {image && <button onClick={() => setImage(null)} className="text-xs text-slate-500 hover:text-white">remove</button>}
              <button onClick={() => analyze(false)} disabled={busy} className="btn-primary ml-auto !py-2 text-sm">
                {busy ? 'Analyzing live…' : 'Analyze with Inbox Guard'} <ArrowIcon className="h-4 w-4" />
              </button>
            </div>
            {err && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
          </div>

          <div className="rounded-xl border border-line bg-ink-950/50 p-4">
            {!res && !busy && <div className="grid h-full place-items-center text-center text-sm text-slate-600">Your live verdict appears here.</div>}
            {busy && !res && <div className="grid h-full place-items-center text-sm text-slate-500"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" /></div>}
            {res && (
              <div className="animate-fade-up space-y-3">
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${risk.ring}`}>
                  <span className="font-display text-lg">{risk.label}</span>
                  <span className="font-mono text-sm">risk {res.risk.score}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-700"><div className={`h-full ${risk.bar}`} style={{ width: `${res.risk.score}%` }} /></div>
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
      </div>
    </div>
  )
}

function GuardField({ k, v }) {
  return (
    <div>
      <div className="label !text-[9px]">{k}</div>
      <div className="mt-0.5 truncate font-medium text-slate-200">{v}</div>
    </div>
  )
}

/* -------------------------------------------------------------- inbox tab */
function InboxTab() {
  const ctx = useCustomer()
  const c = ctx.customer
  const tests = useAsync(() => api.tests(), [])
  const [injecting, setInjecting] = useState(null)
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState(null)

  const grouped = useMemo(() => {
    const clean = {}
    ;(tests.data || []).forEach((t) => {
      clean[t.category] = clean[t.category] || []
      clean[t.category].push(t)
    })
    return clean
  }, [tests.data])

  async function inject(id) {
    setInjecting(id)
    try {
      await ctx.inject(id)
    } finally {
      setInjecting(null)
    }
  }
  async function runAgent() {
    setRunning(true)
    setRun(null)
    try {
      const rec = await ctx.run()
      setRun(rec)
    } catch {
      alert('Run failed — is the API up?')
    } finally {
      setRunning(false)
    }
  }

  const inbox = c.inbox || []

  return (
    <div className="space-y-7">
    <InboxGuard agent={c.agent_name || c.agent} onInjected={() => ctx.refresh()} />
    <div className="grid gap-7 lg:grid-cols-[1fr_1fr]">
      {/* left: inbox + add scenarios */}
      <div className="space-y-5">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl text-white">{c.name.split(' ')[0]}’s inbox</h3>
            <span className="text-xs text-slate-500">{inbox.length} waiting</span>
          </div>
          {inbox.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Inbox is empty. Add an incoming message below — a normal bill, or one of the real attacks — then let {(c.agent_name || c.agent)} handle it.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {inbox.map((m) => (
                <div key={m.id} className="rounded-xl border border-line bg-ink-950/50 p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono uppercase">{m.channel}</span>
                    <span className="truncate">{m.sender}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">{m.subject || '(no subject)'}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{m.body}</p>
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary mt-5 w-full" disabled={!inbox.length || running} onClick={runAgent}>
            {running ? `${(c.agent_name || c.agent)} is working…` : `Let ${(c.agent_name || c.agent)} handle my inbox`} <ArrowIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="card p-6">
          <div className="label mb-1">Simulate an incoming message</div>
          <p className="mb-4 text-sm text-slate-400">These are the real crash-test scenarios. Drop one into your inbox and watch how {(c.agent_name || c.agent)} handles it on your actual account.</p>
          {tests.loading ? (
            <Loading label="Loading scenarios…" />
          ) : (
            <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="label mb-2">{cat.replace('_', ' ')}</div>
                  <div className="space-y-2">
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => inject(t.id)}
                        disabled={injecting === t.id}
                        className="flex w-full items-center justify-between rounded-lg border border-line bg-ink-900/50 px-3 py-2 text-left text-sm transition hover:border-brand/40"
                      >
                        <span className="pr-3 text-slate-300">{t.title}</span>
                        <span className="shrink-0 text-xs text-brand-soft">{injecting === t.id ? '…' : '+ add'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* right: what the agent did */}
      <div className="card p-6">
        <div className="label mb-3">What {(c.agent_name || c.agent)} did</div>
        {!run && <p className="py-10 text-center text-sm text-slate-600">Add a message and press “Let {(c.agent_name || c.agent)} handle my inbox.”</p>}
        {run && <RunResult run={run} agent={(c.agent_name || c.agent)} />}
      </div>
    </div>
    </div>
  )
}

function RunResult({ run, agent }) {
  const steps = buildSteps(run.log)
  const v = run.verdict
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
      {run.messages_to_user?.length > 0 && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
          <div className="label mb-1 text-brand-soft">Message from {agent}</div>
          {run.messages_to_user.map((m, i) => (
            <p key={i} className="text-sm text-slate-200">{m}</p>
          ))}
        </div>
      )}
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
      <div className="flex items-center justify-between rounded-xl border border-line bg-ink-900/50 px-4 py-3 text-sm">
        <span className="text-slate-400">{(run.new_payment_ids || []).length} payment(s) made</span>
        <span className="text-slate-400">premium accrued <b className="text-safe">{cents(run.premium_accrued_usd)}</b></span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- activity tab */
function ActivityTab({ payments, runs }) {
  return (
    <div className="grid gap-7 lg:grid-cols-[1.3fr_1fr]">
      <div className="card p-6">
        <h3 className="mb-4 font-display text-xl text-white">Payments</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments yet. Head to the Inbox tab and let your agent handle a bill.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <PaymentRow key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
      <div className="card p-6">
        <h3 className="mb-4 font-display text-xl text-white">Run history</h3>
        {runs?.length ? (
          <div className="space-y-2 text-sm">
            {runs.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-ink-900/40 px-3 py-2">
                <span className="text-slate-300">{r.agent_name || r.agent} · {(r.new_payment_ids || []).length} paid{r.escalated ? ' · escalated' : ''}</span>
                <span className="font-mono text-xs text-slate-500">{(r.ts || '').slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No runs yet.</p>
        )}
      </div>
    </div>
  )
}

function PaymentRow({ p }) {
  const bad = p.verified_payee === false
  const scheduled = p.status === 'scheduled'
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${bad ? 'border-bad/30 bg-bad/5' : 'border-line bg-ink-900/40'}`}>
      <div>
        <div className="font-medium text-white">
          {p.payee} <span className="text-slate-400">· {usd(p.amount)}</span>
        </div>
        <div className="text-xs text-slate-500">
          {p.account_last4 ? `acct ••${p.account_last4} · ` : ''}
          {scheduled ? `scheduled ${(p.scheduled_for || '').slice(0, 16).replace('T', ' ')}` : (p.ts || '').slice(0, 16).replace('T', ' ')}
          {bad ? ' · unverified payee' : ''}
        </div>
      </div>
      <StatusTag status={p.status} bad={bad} />
    </div>
  )
}

function StatusTag({ status, bad }) {
  if (bad) return <span className="chip border-bad/30 bg-bad/10 text-bad">unverified</span>
  const map = {
    ok: 'border-safe/30 bg-safe/10 text-safe',
    scheduled: 'border-brand/30 bg-brand/10 text-brand-soft',
    failed_insufficient_funds: 'border-warn/30 bg-warn/10 text-warn',
  }
  const label = status === 'failed_insufficient_funds' ? 'failed' : status
  return <span className={`chip ${map[status] || 'text-slate-400'}`}>{label}</span>
}

/* ------------------------------------------------------------- claims tab */
function ClaimsTab({ payments }) {
  const ctx = useCustomer()
  const c = ctx.customer
  const [busy, setBusy] = useState(null)
  const claimedIds = new Set((c.claims || []).map((cl) => cl.payment.id))

  async function flag(id) {
    setBusy(id)
    try {
      await ctx.claim(id)
    } catch {
      alert('Claim failed — is the API up?')
    } finally {
      setBusy(null)
    }
  }

  const claimable = payments.filter((p) => p.status === 'ok' || p.status === 'scheduled')

  return (
    <div className="grid gap-7 lg:grid-cols-[1fr_1fr]">
      <div className="card p-6">
        <h3 className="mb-1 font-display text-xl text-white">Something wrong? Flag a payment.</h3>
        <p className="mb-4 text-sm text-slate-400">We read {(c.agent_name || c.agent)}’s action log, compare it to your mandate, and allocate the loss. Mistakes inside the mandate are covered.</p>
        {claimable.length === 0 ? (
          <p className="text-sm text-slate-500">
            No payments to flag yet. To see a <b className="text-slate-300">covered</b> mistake: add <b className="text-slate-300">Quill</b>, inject
            “Spotify payment-failed, same cycle” (Inside the rules), and run it — Quill pays a verified payee twice. That duplicate is in your
            mandate, so it’s covered. A scam to a new account is <i>out</i> of mandate — the maker’s liability.
          </p>
        ) : (
          <div className="space-y-2">
            {claimable.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-900/40 px-4 py-3">
                <div>
                  <div className="font-medium text-white">{p.payee} · {usd(p.amount)}</div>
                  <div className="text-xs text-slate-500">{(p.ts || '').slice(0, 16).replace('T', ' ')}</div>
                </div>
                {claimedIds.has(p.id) ? (
                  <span className="chip text-slate-500">flagged</span>
                ) : (
                  <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy === p.id} onClick={() => flag(p.id)}>
                    {busy === p.id ? 'reading log…' : 'Something’s wrong'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h3 className="mb-4 font-display text-xl text-white">Claims</h3>
        {c.claims?.length ? (
          <div className="space-y-3">
            {c.claims.map((cl, i) => (
              <ClaimCard key={i} cl={cl} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No claims filed. Flag a payment on the left to see it adjudicated live.</p>
        )}
      </div>
    </div>
  )
}

const OUTCOME = {
  covered_auto_paid: { label: 'Covered — auto-paid', tone: 'border-safe/40 bg-safe/10 text-safe', icon: 'check' },
  covered_queued: { label: 'Covered — in review', tone: 'border-warn/40 bg-warn/10 text-warn', icon: 'queue' },
  out_of_mandate: { label: 'Out of mandate — not covered', tone: 'border-bad/40 bg-bad/10 text-bad', icon: 'x' },
  user_authorized_denied: { label: 'You approved it — denied', tone: 'border-line bg-ink-800 text-slate-300', icon: 'x' },
}

function ClaimCard({ cl }) {
  const v = cl.verdict
  const meta = OUTCOME[v.outcome] || OUTCOME.out_of_mandate
  const settled = v.settled_in_seconds ? `00:${String(v.settled_in_seconds).padStart(2, '0')}` : null
  return (
    <div className={`animate-pop rounded-xl border p-4 ${meta.tone}`}>
      <div className="flex items-center gap-2 font-display text-lg">
        {meta.icon === 'check' ? <CheckIcon className="h-5 w-5" /> : meta.icon === 'x' ? <XIcon className="h-5 w-5" /> : <span>⏳</span>}
        {meta.label}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
        <span>{cl.payment.payee} · {usd(v.amount_usd)}</span>
        <span className="text-right">{settled ? `settled ${settled}` : 'in review queue'}</span>
        <span className="col-span-2 text-xs text-slate-400">{v.who_pays} · {(v.reasons || []).join(', ')}</span>
      </div>
      {cl.test_21 && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-brand/5 p-2 text-xs text-slate-300">
          The incident is now <span className="font-mono text-brand-soft">{cl.test_21.id}</span> — every insured agent is re-run against it.
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- helpers */
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  )
}
function BankTile({ name, bal, selected }) {
  return (
    <div className={`rounded-xl border p-4 ${selected ? 'border-brand/50 bg-brand/5' : 'border-line bg-ink-900/50'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{name}</span>
        {selected && <CheckIcon className="h-4 w-4 text-brand" />}
      </div>
      <div className="mt-1 font-display text-xl text-white">{bal}</div>
    </div>
  )
}

const toolLabel = {
  read_inbox: 'Read the inbox', read_user_requests: 'Checked your requests', open_url: 'Opened a linked page',
  get_mandate: 'Loaded your mandate', check_mandate: 'Checked the payment against your mandate',
  payment_history: 'Checked payment history', pay: 'Paid', renew_subscription: 'Renewed',
  cancel_subscription: 'Cancelled', message_user: 'Messaged you', report: 'Filed its report',
  add_payee: 'Tried to add a payee', set_limit: 'Tried to change a limit', update_mandate: 'Tried to edit the mandate',
  send_p2p: 'Tried a person-to-person transfer', update_payment_method: 'Tried to change a card',
}
const DANGER = new Set(['add_payee', 'set_limit', 'update_mandate', 'send_p2p', 'update_payment_method'])

function buildSteps(log) {
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
    }
  }
  return out
}
