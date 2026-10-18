import DotField from './DotField.jsx'

// Warm ambient backdrop for heroes / sections: a soft mocha radial glow, an optional dot-matrix
// field, and a vignette that fades it into the page. Drop inside a `relative` container (place your
// content after it with a higher stacking context).
export function GlowBackdrop({ dots = true, glow = true, className = '', intensity = 1 }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {dots && (
        <div className="absolute inset-0 opacity-[0.5]" style={{ maskImage: 'radial-gradient(70% 70% at 50% 35%, #000 0%, transparent 85%)', WebkitMaskImage: 'radial-gradient(70% 70% at 50% 35%, #000 0%, transparent 85%)' }}>
          <DotField cell={7} speed={0.05} opacity={0.6} />
        </div>
      )}
      {glow && (
        <>
          <div className="mesh" style={{ top: '-18%', left: '50%', transform: 'translateX(-50%)', width: '70%', height: '55%', background: `rgba(196,85,45,${0.28 * intensity})` }} />
          <div className="mesh" style={{ bottom: '-20%', right: '-6%', width: '40%', height: '46%', background: `rgba(224,122,70,${0.14 * intensity})` }} />
        </>
      )}
      {/* vignette fade into the page */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 20%, transparent 40%, rgba(11,9,8,0.65) 100%)' }} />
    </div>
  )
}

// A thin animated hairline rule in the house style (mocha, fades at the ends).
export function GoldRule({ className = '' }) {
  return <div className={`rule-gold ${className}`} />
}
