import { useEffect, useState } from 'react'
import api from '../api'
import { ShieldIcon, LockIcon, CheckIcon, XIcon, ArrowIcon } from '../components/marks'

// On-chain provenance explorer. Each marketplace agent's identity + grade is bound to a canonical
// fingerprint and sealed into a hash-linked, proof-of-work ledger (free — no wallet, no gas), with a
// best-effort Bitcoin anchor via OpenTimestamps. Verify re-computes the fingerprint live to prove the
// agent hasn't been silently re-graded, re-prompted or re-modelled since it was anchored.

const short = (h, n = 10) => (h ? `${String(h).slice(0, n)}…${String(h).slice(-6)}` : '—')
const fmt = (ms) => (ms ? new Date(ms).toLocaleString() : '')

const GRADE_CHIP = {
  A: 'border-safe/30 bg-safe/10 text-safe',
  B: 'border-info/30 bg-info/10 text-info-soft',
  C: 'border-warn/30 bg-warn/10 text-warn',
  D: 'border-bad/30 bg-bad/10 text-bad',
  F: 'border-bad/30 bg-bad/10 text-bad',
}

function Stat({ label, value, sub, mono }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold text-white ${mono ? 'font-mono text-base tracking-tight' : ''}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  )
}

export default function Chain() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [proofs, setProofs] = useState({}) // agent_id -> proof|'loading'
  const [anchoring, setAnchoring] = useState(false)
  const [onchaining, setOnchaining] = useState(false)
  const [notice, setNotice] = useState('')

  const load = () => {
    setLoading(true)
    api
      .get('/chain')
      .then((d) => { setData(d); setErr('') })
      .catch(() => setErr('Could not reach the ledger.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const verify = (id) => {
    setProofs((p) => ({ ...p, [id]: 'loading' }))
    api
      .get(`/chain/proof/${id}`)
      .then((r) => setProofs((p) => ({ ...p, [id]: r })))
      .catch(() => setProofs((p) => ({ ...p, [id]: { error: true } })))
  }

  const anchorAll = () => {
    setNotice('')
    setAnchoring(true)
    api
      .post('/chain/anchor-all')
      .then((r) => {
        const n = (r.anchored || []).length
        setNotice(n ? `Anchored ${n} agent${n === 1 ? '' : 's'} into the ledger.` : 'All agents were already anchored.')
        load()
      })
      .catch((e) => {
        if (e?.response?.status === 401) setNotice('Please log in to anchor agents — anchoring writes to the shared ledger.')
        else setNotice('Anchoring failed. Try again.')
      })
      .finally(() => setAnchoring(false))
  }

  const anchorOnchain = () => {
    setNotice('')
    setOnchaining(true)
    api
      .post('/chain/anchor-evm-all')
      .then((r) => {
        const n = (r.anchored_onchain || []).length
        const errs = (r.errors || []).length
        setNotice(n ? `Committed ${n} agent${n === 1 ? '' : 's'} on-chain${errs ? ` (${errs} failed)` : ''}.` : (errs ? 'On-chain anchoring failed — check the wallet.' : 'All agents already on-chain.'))
        load()
      })
      .catch((e) => {
        if (e?.response?.status === 401) setNotice('Please log in to anchor on-chain.')
        else setNotice(e?.response?.data?.detail || 'On-chain anchoring failed.')
      })
      .finally(() => setOnchaining(false))
  }

  const head = data?.head || {}
  const integrity = data?.integrity || {}
  const bitcoin = data?.bitcoin || {}
  const evm = data?.evm || {}
  const anchors = data?.anchors || []
  const FAUCET = 'https://www.alchemy.com/faucets/base-sepolia'

  const btcTone =
    bitcoin.status === 'pending'
      ? 'border-warn/30 bg-warn/10 text-warn'
      : bitcoin.status === 'confirmed'
        ? 'border-safe/30 bg-safe/10 text-safe'
        : 'border-slate-600/40 bg-slate-700/20 text-slate-400'
  const btcLabel =
    bitcoin.status === 'pending'
      ? 'Bitcoin: pending confirmation'
      : bitcoin.status === 'confirmed'
        ? 'Bitcoin: confirmed'
        : 'Bitcoin anchoring: unavailable'

  return (
    <div className="space-y-7">
      <header className="max-w-3xl">
        <div className="eyebrow mb-2"><span className="h-2 w-2 rounded-full bg-brand" /> Provenance · on-chain</div>
        <h1 className="font-display text-4xl font-semibold tracking-tightish text-white">Secured on-chain</h1>
        <p className="mt-3 text-slate-400">
          Every agent's identity and graded behaviour are bound into a single cryptographic fingerprint,
          then committed to a <span className="text-slate-200">real public blockchain</span> (Base Sepolia —
          clickable on the explorer below) and timestamped onto Bitcoin via OpenTimestamps. A local
          proof-of-work ledger makes it instantly self-verifiable. Once anchored, an agent's grade, system
          prompt or model <span className="text-slate-200">can't be silently changed</span> — any edit breaks
          its fingerprint and verification turns red.
        </p>
      </header>

      {err ? <div className="card border-bad/30 bg-bad/5 p-4 text-sm text-bad">{err}</div> : null}

      {/* headline stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Chain head" value={short(head.hash, 10)} sub={`block #${head.index ?? '—'}`} mono />
        <Stat label="Blocks" value={data?.block_count ?? '—'} sub={`${data?.anchor_count ?? 0} agents anchored`} />
        <Stat
          label="Chain integrity"
          value={integrity.valid ? 'Intact' : loading ? '…' : 'Broken'}
          sub={integrity.valid ? 'all hashes + links valid' : (integrity.issues || []).join('; ') || 'verifying'}
        />
        <Stat label="Difficulty" value={`${data?.difficulty ?? 3} zeros`} sub="proof-of-work target" />
      </div>

      {/* real public blockchain (EVM testnet) — the genuinely-decentralized, instantly-verifiable layer */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-1 text-safe"><span className="h-2 w-2 rounded-full bg-safe" /> Real public blockchain</div>
            <h3 className="font-display text-xl text-white">{evm.name || 'Base Sepolia'} · anyone can verify</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Each agent's fingerprint is committed inside a real transaction on a public EVM testnet. It's
              on a decentralized chain in seconds and clickable on the block explorer — no trust in our
              servers required. Free (testnet gas only).
            </p>
          </div>
          <div className="text-right text-xs">
            <div className="label text-[10px]">Anchoring wallet</div>
            {evm.address ? (
              <a href={`${evm.explorer}/address/${evm.address}`} target="_blank" rel="noreferrer" className="font-mono text-info-soft hover:underline">{short(evm.address, 10)} ↗</a>
            ) : <span className="text-slate-500">not configured</span>}
            <div className="mt-1 text-slate-500">balance {evm.balance_eth ?? '—'} ETH · {evm.connected ? 'connected' : 'offline'}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {evm.funded ? (
            <button onClick={anchorOnchain} disabled={onchaining} className="btn-primary inline-flex items-center gap-2">
              <ShieldIcon className="h-4 w-4" /> {onchaining ? 'Committing on-chain…' : 'Anchor all on-chain'}
            </button>
          ) : evm.configured ? (
            <>
              <span className="chip border-warn/30 bg-warn/10 text-warn">Wallet needs testnet funds</span>
              <a href={FAUCET} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5 text-sm">Open Base Sepolia faucet ↗</a>
              <span className="text-xs text-slate-500">fund {short(evm.address, 8)}, then press Refresh</span>
            </>
          ) : (
            <span className="chip border-slate-600/40 bg-slate-700/20 text-slate-400">On-chain anchoring not configured</span>
          )}
        </div>
      </div>

      {/* actions + bitcoin status */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className={`chip ${btcTone}`}><LockIcon className="h-3.5 w-3.5" /> {btcLabel}</span>
          {bitcoin.detail ? <span className="hidden max-w-md text-xs text-slate-500 md:inline">{bitcoin.detail}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          {notice ? <span className="text-xs text-slate-400">{notice}</span> : null}
          <button onClick={anchorAll} disabled={anchoring} className="btn-primary inline-flex items-center gap-2">
            <ShieldIcon className="h-4 w-4" />
            {anchoring ? 'Anchoring…' : 'Anchor all agents'}
          </button>
        </div>
      </div>

      {/* anchored agents */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="label">Anchored agents</div>
          <button onClick={load} className="btn-ghost !px-2.5 !py-1 text-xs">Refresh</button>
        </div>

        {loading && !data ? (
          <div className="grid h-40 place-items-center text-sm text-slate-600">Loading the ledger…</div>
        ) : anchors.length === 0 ? (
          <div className="grid h-40 place-items-center px-6 text-center text-sm text-slate-500">
            No agents anchored yet. Press “Anchor all agents” to seal the current marketplace into the ledger.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {anchors.map((a) => {
              const p = proofs[a.agent_id]
              const chip = GRADE_CHIP[a.grade] || 'border-slate-600/40 bg-slate-700/20 text-slate-300'
              return (
                <div key={a.agent_id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{a.name}</span>
                      {a.grade ? <span className={`chip !px-2 !py-0.5 text-[10px] ${chip}`}>Grade {a.grade}{a.score != null ? ` · ${a.score}` : ''}</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[a.developer, a.model, a.category].filter(Boolean).join(' · ') || a.agent_id}
                    </div>
                  </div>

                  <div className="min-w-[200px]">
                    <div className="label text-[10px]">Fingerprint</div>
                    <code className="font-mono text-xs text-brand">{short(a.fingerprint, 12)}</code>
                  </div>

                  <div className="min-w-[180px]">
                    <div className="label text-[10px]">On-chain</div>
                    {a.evm?.explorer_url ? (
                      <a href={a.evm.explorer_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-safe hover:underline">
                        ⛓ {short(a.evm.tx_hash, 10)} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-slate-600" title={`notarized in block #${a.block_index}`}>notarized · block #{a.block_index}</span>
                    )}
                  </div>

                  <div className="min-w-[200px] text-right">
                    {p && p !== 'loading' && !p.error ? (
                      p.untampered ? (
                        <span className="chip border-safe/30 bg-safe/10 text-safe"><CheckIcon className="h-3.5 w-3.5" /> Untampered</span>
                      ) : (
                        <span className="chip border-bad/30 bg-bad/10 text-bad"><XIcon className="h-3.5 w-3.5" /> Tampered</span>
                      )
                    ) : (
                      <button
                        onClick={() => verify(a.agent_id)}
                        disabled={p === 'loading'}
                        className="btn-ghost inline-flex items-center gap-1.5 !px-3 !py-1.5 text-xs"
                      >
                        {p === 'loading' ? 'Verifying…' : (<>Verify <ArrowIcon className="h-3.5 w-3.5" /></>)}
                      </button>
                    )}
                    {p && p !== 'loading' && !p.error ? (
                      <div className="mt-1 text-[11px] text-slate-500">
                        Bitcoin: {p.ots_status || 'unavailable'} · {fmt(a.anchored_at)}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* explainer */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <ShieldIcon className="h-5 w-5 text-brand" />
          <div className="mt-2 font-medium text-white">Identity is bound</div>
          <p className="mt-1 text-sm text-slate-400">The fingerprint hashes the agent's id, developer signature and code hash — anchoring proves exactly which agent this is.</p>
        </div>
        <div className="card p-4">
          <LockIcon className="h-5 w-5 text-brand" />
          <div className="mt-2 font-medium text-white">Grade can't be inflated</div>
          <p className="mt-1 text-sm text-slate-400">The grade, score, model and system-prompt hash are all part of the fingerprint. Re-grade or re-prompt an anchored agent and verification turns red.</p>
        </div>
        <div className="card p-4">
          <CheckIcon className="h-5 w-5 text-brand" />
          <div className="mt-2 font-medium text-white">Anyone can verify, free</div>
          <p className="mt-1 text-sm text-slate-400">Each fingerprint is committed in a real transaction on a public chain (Base Sepolia) you can open on the block explorer — plus a Bitcoin timestamp and a self-checking local ledger. No trust in our servers required.</p>
        </div>
      </div>
    </div>
  )
}
