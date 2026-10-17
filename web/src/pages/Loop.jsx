import { Link } from 'react-router-dom'
import { ShieldIcon, CheckIcon, LockIcon, ArrowIcon } from '../components/marks'

const STAGES = [
  { n: 1, t: 'List', who: 'Agent maker', d: 'Submits an agent — name, version, developer email, document.', icon: '📤' },
  { n: 2, t: 'Verify (KYA)', who: 'Backstop', d: 'Checks the developer, signs an agent ID bound to the exact code hash.', icon: <ShieldIcon className="h-5 w-5" /> },
  { n: 3, t: 'Crash-test', who: 'The rig', d: '20 attacks × 3 runs in a fresh sandbox. Every tool call recorded.', icon: '🧪' },
  { n: 4, t: 'Grade', who: 'Scorer', d: 'Deterministic checks on the action log give a grade and a stability band.', icon: <CheckIcon className="h-5 w-5" /> },
  { n: 5, t: 'Price', who: 'Pricing engine', d: 'Grade → frequency → premium. A is 2¢/payment; F is declined.', icon: '💸' },
  { n: 6, t: 'Cover', who: 'Policy ledger', d: 'One master policy per agent; premium accrues per payment; reinsurer takes most.', icon: <LockIcon className="h-5 w-5" /> },
  { n: 7, t: 'Choose', who: 'Maya', d: 'Connects her bank, sets a mandate, adds the agent. Certificate issued.', icon: '🙋‍♀️' },
  { n: 8, t: 'Claim', who: 'Claims engine', d: 'A mistake inside the mandate is read from the log and paid — $140 in a day.', icon: '🧾' },
  { n: 9, t: 'Re-test', who: 'The rig', d: 'The incident becomes test 21. Every insured agent is re-run; prices update.', icon: '🔁' },
]

export default function Loop() {
  return (
    <div className="space-y-12">
      <header className="max-w-3xl">
        <div className="label mb-2">The whole thing, once around</div>
        <h1 className="font-display text-4xl font-semibold text-white">One agent, one loop.</h1>
        <p className="mt-3 text-lg text-slate-300">
          We run the marketplace where people buy AI finance agents, and we insure what those agents get wrong. Every
          agent is identity-verified, crash-tested twenty ways, and covered — and the test result sets the price.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {STAGES.map((s) => (
          <div key={s.n} className="card group relative p-6 transition hover:-translate-y-0.5 hover:border-brand/40">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/30">
                {typeof s.icon === 'string' ? <span className="text-lg">{s.icon}</span> : s.icon}
              </span>
              <span className="font-mono text-xs text-slate-600">{String(s.n).padStart(2, '0')}</span>
            </div>
            <div className="mt-4 font-display text-xl text-white">{s.t}</div>
            <div className="label mt-0.5">{s.who}</div>
            <p className="mt-2 text-sm text-slate-400">{s.d}</p>
          </div>
        ))}
      </div>

      {/* the self-correcting cycle */}
      <section className="rounded-3xl border border-line bg-gradient-to-br from-ink-850 to-ink-900 p-8 md:p-10">
        <div className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="label mb-2 text-brand-soft">Why it compounds</div>
            <h2 className="font-display text-3xl text-white">Every incident makes every agent safer.</h2>
            <p className="mt-3 text-slate-300">
              A covered claim doesn’t just get paid — it’s written back into the crash-test suite as a new attack. Tonight
              every insured agent faces it. Agents that would fail get re-priced or suspended before the scam spreads. The
              book’s frequency estimate stays current; after a year, real claims history replaces it entirely.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/" className="btn-primary">Back to the marketplace <ArrowIcon className="h-4 w-4" /></Link>
              <Link to="/claims" className="btn-ghost">Watch a claim pay out</Link>
            </div>
          </div>
          <div className="space-y-3">
            {[
              ['Agent makers', 'pay the premium'],
              ['The reinsurer', 'carries the capital'],
              ['Maya', 'pays nothing'],
            ].map(([a, b]) => (
              <div key={a} className="flex items-center justify-between rounded-xl border border-line bg-ink-900/60 px-5 py-4">
                <span className="font-medium text-white">{a}</span>
                <span className="text-slate-400">{b}</span>
              </div>
            ))}
            <div className="rounded-xl border border-safe/30 bg-safe/5 px-5 py-4 text-center text-sm text-safe">
              The ask: pilot with one agent maker and one Lloyd’s coverholder.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
