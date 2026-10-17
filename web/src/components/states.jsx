export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  )
}

export function ErrorNote({ error }) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <div className="font-display text-lg text-white">Can’t reach the Backstop API</div>
      <p className="mt-2 text-sm text-slate-400">
        Start it with <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-brand-soft">uvicorn api.main:app --port 8000</code> from the <span className="font-mono">backstop/</span> folder.
      </p>
      {error?.message && <p className="mt-3 font-mono text-xs text-slate-600">{String(error.message)}</p>}
    </div>
  )
}

export function Section({ eyebrow, title, children, right }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <div className="label mb-1">{eyebrow}</div>}
          <h2 className="font-display text-2xl font-semibold text-white">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
