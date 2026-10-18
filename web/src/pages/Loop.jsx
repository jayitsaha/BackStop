import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldIcon, CheckIcon, LockIcon, ArrowIcon } from '../components/marks'
import { Reveal, Stagger, stagItem, Tactile } from '../components/ui/motion.jsx'
import { GlowBackdrop, GoldRule } from '../components/ui/Backdrop.jsx'

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
    <div className="space-y-16">
      {/* editorial hero */}
      <section className="relative -mx-5 overflow-hidden px-5 pb-6 pt-4">
        <GlowBackdrop intensity={0.8} />
        <div className="relative mx-auto max-w-3xl pt-8">
          <Reveal as="div" className="eyebrow mb-4">The whole thing, once around</Reveal>
          <Reveal as="h1" delay={0.05} y={20} className="font-display text-6xl font-semibold leading-[0.92] tracking-tighter3 text-white md:text-7xl">
            One agent,<br /> one <span className="text-gold">loop.</span>
          </Reveal>
          <Reveal as="p" delay={0.12} className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            We run the marketplace where people buy AI finance agents, and we insure what those agents get wrong. Every
            agent is identity-verified, crash-tested twenty ways, and covered — and the test result sets the price.
          </Reveal>
          <Reveal delay={0.2} className="mt-8 max-w-md"><GoldRule /></Reveal>
        </div>
      </section>

      <Stagger className="grid gap-4 md:grid-cols-3" gap={0.06}>
        {STAGES.map((s) => (
          <motion.div
            key={s.n}
            variants={stagItem}
            className="card group relative p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-raised"
          >
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/30 transition group-hover:bg-brand/15">
                {typeof s.icon === 'string' ? <span className="text-lg">{s.icon}</span> : s.icon}
              </span>
              <span className="font-mono text-xs text-slate-600">{String(s.n).padStart(2, '0')}</span>
            </div>
            <div className="mt-4 font-display text-xl font-semibold tracking-tighter2 text-white">{s.t}</div>
            <div className="label mt-0.5">{s.who}</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.d}</p>
          </motion.div>
        ))}
      </Stagger>

      {/* the self-correcting cycle */}
      <Reveal as="section" className="relative overflow-hidden rounded-card border border-line bg-gradient-to-br from-ink-850 to-ink-900 p-8 md:p-12">
        <div className="mesh animate-drift" style={{ top: '-110px', right: '-30px', height: 300, width: 300, background: 'rgba(196,85,45,0.16)' }} />
        <div className="relative grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="eyebrow mb-4 text-brand-soft">Why it compounds</div>
            <h2 className="font-display text-4xl font-semibold leading-[0.95] tracking-tighter2 text-white md:text-5xl">Every incident makes<br className="hidden md:block" /> every agent safer.</h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              A covered claim doesn’t just get paid — it’s written back into the crash-test suite as a new attack. Tonight
              every insured agent faces it. Agents that would fail get re-priced or suspended before the scam spreads. The
              book’s frequency estimate stays current; after a year, real claims history replaces it entirely.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Tactile as={Link} to="/" className="btn-primary">Back to the marketplace <ArrowIcon className="h-4 w-4" /></Tactile>
              <Tactile as={Link} to="/claims" className="btn-ghost">Watch a claim pay out</Tactile>
            </div>
          </div>
          <Stagger className="space-y-3" gap={0.08}>
            {[
              ['Agent makers', 'pay the premium'],
              ['The reinsurer', 'carries the capital'],
              ['Maya', 'pays nothing'],
            ].map(([a, b]) => (
              <motion.div key={a} variants={stagItem} className="flex items-center justify-between rounded-xl border border-line bg-ink-900/60 px-5 py-4">
                <span className="font-medium text-white">{a}</span>
                <span className="text-slate-400">{b}</span>
              </motion.div>
            ))}
            <motion.div variants={stagItem} className="rounded-xl border border-safe/30 bg-safe/5 px-5 py-4 text-center text-sm text-safe">
              The ask: pilot with one agent maker and one Lloyd’s coverholder.
            </motion.div>
          </Stagger>
        </div>
      </Reveal>
    </div>
  )
}
