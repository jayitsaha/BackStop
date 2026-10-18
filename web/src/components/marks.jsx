import { gradeTheme, cents } from '../lib/format'

// The three marks every listed agent carries: Verified · Grade · Protected.

export function VerifiedMark({ compact = false }) {
  return (
    <span className={`chip border-info/30 bg-info/10 text-info-soft ${compact ? 'px-2' : ''}`}>
      <ShieldIcon className="h-3.5 w-3.5" />
      Verified
    </span>
  )
}

export function GradeBadge({ grade, score, size = 'md' }) {
  const t = gradeTheme(grade)
  const dims = {
    sm: 'h-9 w-9 text-lg',
    md: 'h-14 w-14 text-3xl',
    lg: 'h-24 w-24 text-6xl',
  }[size]
  return (
    <div className="flex items-center gap-3">
      <div className={`grid place-items-center rounded-2xl font-display font-semibold ring-1 ${dims} ${t.bg} ${t.text} ${t.ring}`}>
        {grade}
      </div>
      {score != null && (
        <div className="leading-tight">
          <div className="stat-num text-xl">{score}</div>
          <div className="label">crash score</div>
        </div>
      )}
    </div>
  )
}

export function ProtectedMark({ quote }) {
  if (!quote) return null
  if (quote.status === 'declined') {
    return (
      <span className="chip border-bad/30 bg-bad/10 text-bad">
        <XIcon className="h-3.5 w-3.5" /> Not listed
      </span>
    )
  }
  return (
    <span className="chip border-safe/30 bg-safe/10 text-safe">
      <LockIcon className="h-3.5 w-3.5" />
      Protected · {cents(quote.gross_premium_usd)}/payment
    </span>
  )
}

export function ThreeMarks({ verified = true, grade, score, quote }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {verified && <VerifiedMark />}
      <GradePill grade={grade} score={score} />
      <ProtectedMark quote={quote} />
    </div>
  )
}

export function GradePill({ grade, score }) {
  const t = gradeTheme(grade)
  return (
    <span className={`chip ${t.ring} ring-1 ${t.bg} ${t.text}`}>
      <span className={`h-2 w-2 rounded-full ${t.dot}`} />
      Grade {grade}
      {score != null && <span className="text-slate-400">· {score}</span>}
    </span>
  )
}

// --- Backstop's own mark ----------------------------------------------------
// BackstopMark — the wordmark glyph: a crest shield with an inner "keep" chevron,
// drawn as original art (shield motif, never a cup/bowl). Gradient-fillable.
export function BackstopMark({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {/* crest shield */}
      <path
        d="M12 2.4l7.6 2.9v5.9c0 5.2-3.3 9.1-7.6 10.9C7.7 20.3 4.4 16.4 4.4 11.2V5.3L12 2.4z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* inner guard — a backstop wall that catches the fall */}
      <path d="M8 12.4l4 3.4 4-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.2v8.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

// --- tiny inline icons (no icon dependency) --------------------------------
export function ShieldIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 2.6l7.4 2.8v5.8c0 5-3.2 8.8-7.4 10.6C7.8 20 4.6 16.2 4.6 11.2V5.4L12 2.6z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path d="M8.7 12.1l2.3 2.3 4.4-4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function LockIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="10" width="14" height="10" rx="2.4" stroke="currentColor" strokeWidth="1.55" />
      <path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" />
    </svg>
  )
}
export function XIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
export function CheckIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function ArrowIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
