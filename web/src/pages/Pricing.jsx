import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import api from '../api'
import { useAsync } from '../lib/useAsync'
import { Loading, ErrorNote } from '../components/states'
import { gradeTheme, usd } from '../lib/format'
import { ArrowIcon } from '../components/marks'

export default function Pricing() {
  const terms = useAsync(() => api.terms(), [])
  const demo = useAsync(() => api.agent('Sage').catch(() => null), [])

  if (terms.loading) return <Loading label="Loading the pricing model…" />
  if (terms.error) return <ErrorNote error={terms.error} />

  const rows = terms.data.pricing_table
  const t = terms.data.terms
  const book = demo.data?.book_400k_payments
  const a = rows.find((r) => r.grade === 'A')
  const lossPct = Math.round(t.target_loss_ratio * 100)

  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <div className="label mb-2">The actuarial model, on one screen</div>
        <h1 className="font-display text-4xl font-semibold text-white">The grade is the price.</h1>
        <p className="mt-3 text-lg text-slate-300">
          A grade is a <b className="text-white">frequency estimate</b> — how often an agent makes a covered mistake.
          Multiply by severity, divide by the loss ratio, split the rest. That’s the whole engine.
        </p>
      </header>

      {/* the derivation — computed live from /terms */}
      <section className="card p-7">
        <div className="label mb-4">How {a.gross_cents.toFixed(0)} cents happens (grade A)</div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Derive step="Frequency" value={`1 / ${a.one_in.toLocaleString()}`} note="covered mistakes per payment" />
          <Derive step="× Severity" value={usd(t.severity_usd, 0)} note={`avg covered loss, capped at ${usd(t.per_incident_limit_usd, 0)}`} />
          <Derive step="= Pure premium" value={`${a.pure_cents.toFixed(1)}¢`} note="expected claims per payment" />
          <Derive step={`÷ ${lossPct}% loss ratio`} value={`${a.gross_cents.toFixed(1)}¢`} note="gross premium charged" highlight />
        </div>
        <p className="mt-5 text-sm text-slate-400">
          The other {(a.gross_cents - a.pure_cents).toFixed(1)}¢ is Backstop’s {Math.round(t.commission_share * 100)}% commission and the
          reinsurer’s margin and cost of capital. The same formula gives{' '}
          C = {rows.find((r) => r.grade === 'C')?.gross_cents.toFixed(0)}¢ and F = {(rows.find((r) => r.grade === 'F')?.gross_cents / 100).toFixed(0)} dollar a
          payment — so <b className="text-bad">F is declined</b>, not sold.
        </p>
      </section>

      {/* the table */}
      <section>
        <h2 className="mb-4 font-display text-2xl text-white">Grade → frequency → premium</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-ink-900/60 text-slate-400">
                <tr>
                  {['Grade', 'Mistake rate', 'Pure premium', 'Gross premium', 'Status'].map((h) => (
                    <th key={h} className="px-6 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const th = gradeTheme(r.grade)
                  return (
                    <tr key={r.grade} className="border-b border-line/60 last:border-0 hover:bg-ink-800/40">
                      <td className="px-6 py-4">
                        <span className={`inline-grid h-9 w-9 place-items-center rounded-xl font-display text-lg ring-1 ${th.bg} ${th.text} ${th.ring}`}>
                          {r.grade}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-300">1 in {r.one_in.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-slate-400">{r.pure_cents.toFixed(2)}¢</td>
                      <td className="px-6 py-4 font-mono font-semibold text-white">{r.gross_cents.toFixed(2)}¢</td>
                      <td className="px-6 py-4">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* the book */}
      {book && (
        <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="card p-7">
            <div className="label mb-1">Penny’s book, one month</div>
            <h3 className="font-display text-2xl text-white">Where the premium goes</h3>
            <p className="mt-2 text-sm text-slate-400">
              A grade-A agent at 400k payments/month. Premium in, expected losses out, the rest split between Backstop
              and the reinsurer who carries the capital.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <BookStat label="Gross premium" value={usd(book.gross_premium_usd, 0)} tone="text-white" />
              <BookStat label="Expected claims" value={`${book.expected_claim_count}`} sub={usd(book.expected_claims_usd, 0)} tone="text-warn" />
              <BookStat label="Backstop commission" value={usd(book.commission_usd, 0)} tone="text-brand-soft" />
              <BookStat label="Reinsurer margin" value={usd(book.reinsurer_margin_usd, 0)} tone="text-safe" />
            </div>
            <div className="mt-5 rounded-xl border border-line bg-ink-900/50 p-4 text-sm text-slate-300">
              Loss ratio lands at <b className="text-white">{Math.round(book.loss_ratio * 100)}%</b> — exactly the target. The model
              is self-correcting: after a year, the agent’s own claims history replaces the crash-test estimate.
            </div>
          </div>
          <div className="card p-7">
            <div className="label mb-4">Monthly economics (USD)</div>
            <BookChart book={book} />
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-line bg-gradient-to-br from-ink-850 to-ink-900 p-8">
        <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div>
            <h3 className="font-display text-2xl text-white">The risk we actually fear</h3>
            <p className="mt-2 max-w-2xl text-slate-300">
              Mistakes aren’t independent — one new scam template can fool an agent across thousands of users in a day.
              So each policy carries a <b className="text-white">{usd(t.monthly_aggregate_usd, 0)} monthly aggregate</b>, the reinsurer
              takes most of it, and cover suspends if the aggregate is hit. Re-testing every version keeps the estimate current.
            </p>
          </div>
          <Link to="/loop" className="btn-ghost whitespace-nowrap">See the full loop <ArrowIcon className="h-4 w-4" /></Link>
        </div>
      </section>
    </div>
  )
}

function Derive({ step, value, note, highlight }) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? 'border-safe/40 bg-safe/10' : 'border-line bg-ink-900/50'}`}>
      <div className="label">{step}</div>
      <div className={`mt-1 font-display text-2xl ${highlight ? 'text-safe' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    bound: 'border-safe/30 bg-safe/10 text-safe',
    suspended: 'border-warn/30 bg-warn/10 text-warn',
    declined: 'border-bad/30 bg-bad/10 text-bad',
  }
  return <span className={`chip ${map[status] || ''}`}>{status}</span>
}

function BookStat({ label, value, sub, tone = 'text-white' }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900/50 p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-2xl ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function BookChart({ book }) {
  const data = [
    { name: 'Premium in', v: book.gross_premium_usd, fill: '#5B8CFF' },
    { name: 'Expected losses', v: book.expected_claims_usd, fill: '#F6C454' },
    { name: 'Backstop', v: book.commission_usd, fill: '#8DABFF' },
    { name: 'Reinsurer', v: book.reinsurer_margin_usd, fill: '#2FD39A' },
  ]
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fill: '#8595b4', fontSize: 12 }} axisLine={{ stroke: '#232c42' }} tickLine={false} />
        <YAxis tick={{ fill: '#60708f', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          contentStyle={{ background: '#0B0F17', border: '1px solid #232c42', borderRadius: 12, color: '#e2e8f0' }}
          formatter={(v) => [usd(v, 0), 'USD']}
        />
        <Bar dataKey="v" radius={[8, 8, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
          <LabelList dataKey="v" position="top" formatter={(v) => `$${(v / 1000).toFixed(1)}k`} style={{ fill: '#cbd5e1', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
