import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { useCustomer } from '../lib/CustomerContext.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useWallet } from '../lib/wallet.jsx'

// Buy an agent by paying the treasury from MetaMask (testnet), then record + add it server-side.
async function purchaseAgent(wallet, agentId, onStatus) {
  const cfg = wallet?.cfg
  if (!cfg?.treasury) throw new Error('On-chain payments are not configured')
  if (!wallet.account) {
    const a = await wallet.connect()
    if (!a) throw new Error('Connect your wallet to buy')
  }
  onStatus?.('confirm')
  const txHash = await wallet.sendTx({ to: cfg.treasury, value: cfg.agent_price_wei })
  onStatus?.('verify') // tx submitted; backend now waits for it to be mined (~15–30s)
  return api.buyAgent({ agent: agentId, tx_hash: txHash })
}
function buyError(e) {
  if (e?.code === 4001 || /user rejected/i.test(e?.message || '')) return 'Payment cancelled in MetaMask.'
  return e?.response?.data?.detail || e?.message || 'Purchase failed'
}
import { Loading } from '../components/states'
import { ArrowIcon, CheckIcon, LockIcon, XIcon, GradePill } from '../components/marks'
import { usd, cents } from '../lib/format'
import { iconFor, accent } from '../components/widgets/shared.jsx'
import AgentDashboard from '../components/AgentDashboard.jsx'
import ConciergeChat from '../components/Chat/ConciergeChat.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { Reveal, Stagger, stagItem, Tactile } from '../components/ui/motion.jsx'
import { GlowBackdrop, GoldRule } from '../components/ui/Backdrop.jsx'

// Turn an email into a friendly display name: "jay.saha@x.com" -> "Jay Saha"
function nameFromEmail(email) {
  if (!email) return ''
  return (
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\d+/g, '')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || email.split('@')[0]
  )
}

// Normalise the owned-agents list (now an array; fall back to the single agent).
function ownedAgents(c) {
  const out = []
  if (Array.isArray(c?.agents) && c.agents.length) {
    for (const a of c.agents) {
      if (typeof a === 'string') out.push({ id: a, name: a })
      else {
        const id = a.agent_id || a.agent || a.id
        if (id) out.push({ id, name: a.name || a.agent_name || id, icon: a.icon, accent: a.accent })
      }
    }
  } else if (c?.agent) {
    const id = typeof c.agent === 'object' ? c.agent.agent_id || c.agent.id : c.agent
    if (id) out.push({ id, name: c.agent_name || (typeof c.agent === 'object' ? c.agent.name : c.agent) || id })
  }
  return out
}

export default function CustomerApp() {
  const ctx = useCustomer()
  if (ctx.loading) return <Loading label="Loading your account…" />
  if (!ctx.customer) return <Onboard />
  const agents = ownedAgents(ctx.customer)
  if (!agents.length) return <AddAgent />
  return <ChatDashboard agents={agents} />
}

/* =========================================================== chat dashboard */
function ChatDashboard({ agents }) {
  const ctx = useCustomer()
  const { user } = useAuth()
  const c = ctx.customer
  const [activeAgentId, setActiveAgentId] = useState(
    () => c.active_agent || (typeof c.agent === 'string' ? c.agent : c.agent?.agent_id) || agents[0]?.id,
  )
  const [schema, setSchema] = useState(null)
  const [agentRecord, setAgentRecord] = useState(null)
  const [loadingSchema, setLoadingSchema] = useState(true)
  const [adding, setAdding] = useState(false)

  // load the active agent's UI-schema + record whenever the active agent changes
  useEffect(() => {
    if (!activeAgentId) return
    let alive = true
    setLoadingSchema(true)
    setSchema(null)
    Promise.all([
      api.agentUI(activeAgentId).then((r) => r.ui_schema || r).catch(() => null),
      api.agent(activeAgentId).catch(() => null),
    ]).then(([ui, rec]) => {
      if (!alive) return
      setSchema(ui)
      setAgentRecord(rec)
      setLoadingSchema(false)
    })
    return () => {
      alive = false
    }
  }, [activeAgentId])

  function pickAgent(id) {
    if (!id || id === activeAgentId) return
    setActiveAgentId(id)
    api.setActive(id).catch(() => {})
  }

  const activeMeta = agents.find((a) => a.id === activeAgentId) || agents[0]
  const agentName = agentRecord?.name || activeMeta?.name || schema?.title || 'your agent'

  return (
    <>
      <div className="space-y-6">
        <Reveal y={10}>
          <SlimHeader c={c} agentName={agentName} schema={schema} onReset={ctx.reset} />
        </Reveal>

        <AgentRail
          agents={agents}
          activeId={activeAgentId}
          onPick={pickAgent}
          onAdd={() => setAdding(true)}
        />

        {loadingSchema ? (
          <DashboardSkeleton />
        ) : schema ? (
          <AgentDashboard
            schema={schema}
            customer={c}
            agentId={activeAgentId}
            agentName={activeMeta?.name || agentName}
            agentRecord={agentRecord}
          />
        ) : (
          <Reveal className="card relative overflow-hidden p-7">
            <GlowBackdrop dots={false} className="opacity-70" />
            <div className="relative">
              <div className="eyebrow mb-2">No dashboard yet</div>
              <p className="max-w-lg font-display text-xl leading-snug tracking-tightish text-white">
                This agent doesn’t have a live dashboard.
              </p>
              <p className="mt-2 text-sm text-slate-400">Open the concierge to operate it, or switch agents from the rail above.</p>
            </div>
          </Reveal>
        )}
      </div>

      {/* Asha-style floating concierge launcher (fixed bottom-right) */}
      <ConciergeChat
        schema={schema}
        agents={agents}
        activeAgentId={activeAgentId}
        agentName={activeMeta?.name || agentName}
        onPickAgent={pickAgent}
        userEmail={user?.email}
      />

      <AnimatePresence>
        {adding && (
          <AddAgentModal
            owned={agents}
            onClose={() => setAdding(false)}
            onAdded={async (id) => {
              setAdding(false)
              // re-fetch the customer so the new agent shows up in the rail immediately…
              await ctx.refresh()
              // …then switch to it
              if (id) {
                setActiveAgentId(id)
                api.setActive(id).catch(() => {})
              }
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/* ------------------------------------------------- owned-agent rail + add */
function AgentRail({ agents, activeId, onPick, onAdd }) {
  return (
    <Stagger className="flex items-center gap-2 overflow-x-auto pb-1" gap={0.05}>
      <motion.span variants={stagItem} className="eyebrow shrink-0 pr-1">Your agents</motion.span>
      {agents.map((a) => {
        const on = a.id === activeId
        return (
          <Tactile
            key={a.id}
            variants={stagItem}
            onClick={() => onPick(a.id)}
            className={`group relative flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
              on ? 'border-brand/50 bg-brand/10 text-white shadow-glow' : 'border-line bg-ink-900/50 text-slate-400 hover:border-brand/30 hover:text-white'
            }`}
          >
            <span className={`grid h-6 w-6 place-items-center rounded-lg transition-colors ${on ? 'bg-brand/20 text-brand-soft' : 'bg-ink-800 text-slate-500 group-hover:text-brand-soft'}`}>
              {iconFor(a.icon, 'h-3.5 w-3.5')}
            </span>
            <span className="font-medium tracking-tightish">{a.name}</span>
            {on && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
            )}
          </Tactile>
        )
      })}
      <Tactile
        variants={stagItem}
        onClick={onAdd}
        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-slate-400 transition-colors hover:border-brand/50 hover:text-brand-soft"
      >
        <span className="text-base leading-none">+</span> Add agent
      </Tactile>
    </Stagger>
  )
}

/* ------------------------------------------------- add-agent marketplace modal */
function AddAgentModal({ owned, onClose, onAdded }) {
  const wallet = useWallet()
  const listings = useAsync(() => api.listings(), [])
  const [busy, setBusy] = useState(null)
  const [phase, setPhase] = useState(null)
  const [err, setErr] = useState('')
  const ownedIds = new Set((owned || []).map((a) => a.id))
  const price = wallet?.cfg?.agent_price_eth
  const chain = wallet?.cfg?.chain_name || 'testnet'

  // ESC to close
  useEffect(() => {
    const onEsc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  async function buy(id) {
    setBusy(id)
    setErr('')
    setPhase('confirm')
    try {
      await purchaseAgent(wallet, id, setPhase)
      onAdded(id)
    } catch (e) {
      setErr(buyError(e))
      setBusy(null)
      setPhase(null)
    }
  }

  const rows = (listings.data || []).filter((l) => l.quote.status === 'bound' || ownedIds.has(l.agent))

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-md sm:p-8"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        className="card-raised relative my-auto w-full max-w-4xl overflow-hidden p-6"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <GlowBackdrop dots={false} className="opacity-70" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-brand" /></span>
              Marketplace · pay with MetaMask
            </div>
            <h2 className="font-display text-3xl tracking-tighter2 text-white">Hire another agent</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              Pay {price ? `${price} ETH` : 'a small fee'} on {chain} from your wallet. Each agent is insured,
              gets its own live dashboard, and you can switch between them anytime.
            </p>
          </div>
          <Tactile onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-slate-400 transition-colors hover:border-brand/50 hover:text-white">
            <XIcon className="h-4 w-4" />
          </Tactile>
        </div>

        <GoldRule className="relative mt-5" />

        {err && <div className="relative mt-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>}

        {listings.loading ? (
          <div className="relative grid h-40 place-items-center text-sm text-slate-500">
            <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" /> Loading the marketplace…</span>
          </div>
        ) : (
          <Stagger className="relative mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" gap={0.05}>
            {rows.map((l) => {
              const isOwned = ownedIds.has(l.agent)
              const declined = l.quote.status !== 'bound'
              return (
                <motion.div
                  key={l.agent}
                  variants={stagItem}
                  className={`card glass-sweep flex flex-col p-4 transition-colors hover:border-brand/40 ${declined ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-ink-800 text-brand-soft">{iconFor(l.icon, 'h-4 w-4')}</span>
                      <div className="min-w-0">
                        <div className="truncate font-display text-lg tracking-tightish text-white">{l.name}</div>
                        <div className="truncate text-[11px] uppercase tracking-[0.14em] text-slate-500">{l.category || l.developer}</div>
                      </div>
                    </div>
                    <GradePill grade={l.grade.grade} score={l.grade.score} />
                  </div>
                  {l.tagline && <p className="mt-2 line-clamp-2 text-xs text-slate-400">{l.tagline}</p>}
                  <div className="mt-2 text-xs text-safe">{declined ? '' : `Protected · ${cents(l.quote.gross_premium_usd)}/action`}</div>
                  <Tactile
                    className={`mt-3 ${isOwned ? 'btn-ghost' : 'btn-primary'} !py-2 text-sm`}
                    disabled={isOwned || declined || busy === l.agent}
                    onClick={() => buy(l.agent)}
                  >
                    {isOwned
                      ? 'Owned ✓'
                      : busy === l.agent
                        ? phase === 'verify'
                          ? 'Verifying payment…'
                          : 'Confirm in MetaMask…'
                        : declined
                          ? 'Unavailable'
                          : wallet?.available
                            ? `Buy · ${price ?? '…'} ETH`
                            : 'Connect wallet to buy'}
                  </Tactile>
                </motion.div>
              )
            })}
          </Stagger>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function SlimHeader({ c, agentName, schema, onReset }) {
  const cert = c.certificate
  const t = accent(schema?.accent)
  return (
    <div className="card relative flex flex-col gap-4 overflow-hidden p-5 md:flex-row md:items-center md:justify-between">
      <div className="mesh" style={{ top: '-120px', left: '-4%', height: 220, width: 260, background: t.fill }} />
      <div className="relative flex items-center gap-3">
        <div className={`grid h-12 w-12 place-items-center rounded-xl border ${t.border} ${t.bg} ${t.text} shadow-glow`}>
          {iconFor(schema?.icon, 'h-5 w-5')}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl tracking-tighter2 text-white">{schema?.title || c.name}</h1>
            <span className="chip border-safe/30 bg-safe/10 text-safe">
              <LockIcon className="h-3.5 w-3.5" /> Covered · {agentName}
            </span>
            {c.frozen?.length > 0 && (
              <span className="chip border-bad/30 bg-bad/10 text-bad" title={c.frozen.map((f) => f.payee).join(', ')}>
                <LockIcon className="h-3.5 w-3.5" /> {c.frozen.length} frozen
              </span>
            )}
          </div>
          {(schema?.subtitle || cert) && (
            <div className="mt-1 text-xs text-slate-500">
              {schema?.subtitle || `cert ${cert?.certificate_id} · limit ${usd(cert?.per_incident_limit_usd, 0)} · your premium $0`}
            </div>
          )}
        </div>
      </div>
      <div className="relative flex items-center gap-6">
        <div className="hidden sm:block">
          <div className="stat-num font-mono text-lg text-white">{usd(c.bank?.balances?.checking ?? 0, 2)}</div>
          <div className="label">Checking</div>
        </div>
        <div className="hidden h-8 w-px bg-line/70 sm:block" />
        <div className="hidden sm:block">
          <div className="stat-num font-mono text-lg text-white">{cents(c.premium_collected_usd)}</div>
          <div className="label">Premium accrued</div>
        </div>
        <button onClick={onReset} className="text-xs text-slate-500 transition-colors hover:text-brand-soft">
          switch account
        </button>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`card relative overflow-hidden p-6 ${i === 0 ? 'lg:col-span-2' : ''}`}>
          <div
            className="pointer-events-none absolute inset-0 bg-shine bg-[length:220%_100%] opacity-[0.07] animate-shimmer"
            aria-hidden
          />
          <div className="relative h-3.5 w-1/3 rounded-full bg-ink-700/70" />
          <div className="relative mt-4 h-24 rounded-xl bg-ink-800/50" />
        </div>
      ))}
    </div>
  )
}

/* ================================================================= onboard */
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
    <div className="relative mx-auto max-w-2xl">
      <GlowBackdrop className="-z-10 h-[520px]" intensity={0.9} />
      <Stagger className="space-y-6">
        <motion.header variants={stagItem}>
          <div className="eyebrow mb-3">Your account · step 1 of 2</div>
          <h1 className="font-display text-5xl font-semibold leading-[0.9] tracking-tighter3 text-white">
            Open a Backstop
            <br />
            <span className="text-gold">account.</span>
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-300">
            Connect your bank and set the rules. Then add an agent — it can only act inside your mandate,
            and everything inside it is <span className="handwriting text-brand-soft">insured.</span>
          </p>
        </motion.header>

        <motion.div variants={stagItem} className="card relative overflow-hidden p-7">
          <GoldRule className="absolute inset-x-0 top-0" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name">
              <input value={name} onChange={(e) => setName(e.target.value)} className="inp" />
            </Field>
            <Field label="Rent cap (Oak Properties)">
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-400">$</span>
                <input type="number" value={rentCap} onChange={(e) => setRentCap(e.target.value)} className="inp font-mono" />
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

          <Tactile className="btn-primary mt-6 w-full" onClick={open} disabled={busy}>
            {busy ? 'Opening account…' : 'Open account & connect bank'} <ArrowIcon className="h-4 w-4" />
          </Tactile>
        </motion.div>
      </Stagger>
    </div>
  )
}

/* =============================================================== add agent */
function AddAgent() {
  const ctx = useCustomer()
  const wallet = useWallet()
  const listings = useAsync(() => api.listings(), [])
  const [busy, setBusy] = useState(null)
  const [phase, setPhase] = useState(null)
  const [err, setErr] = useState('')
  const price = wallet?.cfg?.agent_price_eth
  const chain = wallet?.cfg?.chain_name || 'testnet'

  async function buy(name) {
    setBusy(name)
    setErr('')
    setPhase('confirm')
    try {
      await purchaseAgent(wallet, name, setPhase)
      ctx.refresh()
    } catch (e) {
      setErr(buyError(e))
    } finally {
      setBusy(null)
      setPhase(null)
    }
  }

  if (listings.loading) return <Loading />
  return (
    <div className="relative mx-auto max-w-3xl space-y-7">
      <GlowBackdrop className="-z-10 h-[520px]" intensity={0.9} />
      <Reveal as="header" y={12}>
        <div className="eyebrow mb-3">Your account · step 2 of 2</div>
        <h1 className="font-display text-5xl font-semibold leading-[0.9] tracking-tighter3 text-white">
          Hire an agent for <span className="text-gold">{ctx.customer.name.split(' ')[0]}.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300">
          Pay {price ? `${price} ETH` : 'a small fee'} on {chain} from MetaMask. Only verified, insured agents can be
          hired — each gets its own live dashboard.
        </p>
        {err && <div className="mt-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>}
        <button onClick={ctx.reset} className="mt-3 text-xs text-slate-500 transition-colors hover:text-brand-soft">← start over</button>
      </Reveal>

      <Stagger className="grid gap-5 sm:grid-cols-3" gap={0.07}>
        {(listings.data || []).map((l) => {
          const declined = l.quote.status !== 'bound'
          return (
            <motion.div
              key={l.agent}
              variants={stagItem}
              className={`card glass-sweep flex flex-col p-5 transition-colors hover:border-brand/40 ${declined ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-display text-xl tracking-tightish text-white">{l.name}</div>
                  <div className="mt-0.5 text-xs uppercase tracking-[0.14em] text-slate-500">{l.developer}</div>
                </div>
                <GradePill grade={l.grade.grade} score={l.grade.score} />
              </div>
              {l.kind === 'llm' && <div className="mt-2 inline-flex w-fit items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-soft"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> live · {l.model?.split('/').pop()}</div>}
              <div className="mt-3 text-sm">
                {declined ? (
                  <span className="text-bad">Declined — not insurable</span>
                ) : (
                  <span className="text-safe">Protected · {cents(l.quote.gross_premium_usd)}/payment</span>
                )}
              </div>
              <Tactile className="btn-primary mt-4" disabled={declined || busy === l.agent} onClick={() => buy(l.agent)}>
                {busy === l.agent
                  ? phase === 'verify'
                    ? 'Verifying payment…'
                    : 'Confirm in MetaMask…'
                  : declined
                    ? 'Unavailable'
                    : wallet?.available
                      ? `Buy · ${price ?? '…'} ETH`
                      : 'Connect wallet to buy'}
              </Tactile>
            </motion.div>
          )
        })}
      </Stagger>
    </div>
  )
}

/* ---------------------------------------------------------------- helpers */
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
    <div className={`rounded-xl border p-4 transition-colors ${selected ? 'border-brand/50 bg-brand/5 shadow-glow' : 'border-line bg-ink-900/50'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{name}</span>
        {selected && <CheckIcon className="h-4 w-4 text-brand" />}
      </div>
      <div className="mt-1 stat-num font-mono text-xl text-white">{bal}</div>
    </div>
  )
}
