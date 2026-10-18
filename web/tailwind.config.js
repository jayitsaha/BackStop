/** @type {import('tailwindcss').Config} */
// "Mocha Noir" — warm near-black espresso canvas lit by burnt-terracotta mocha, editorial serif
// display over Geist sans, soft 24px glass cards. The legacy token NAMES (ink/brand/slate/line…)
// are kept and remapped so the whole app adopts the palette without rewriting every class.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // warm espresso surfaces (legacy name `ink`)
        ink: {
          950: '#0b0908', // page background
          900: '#0d0b0a',
          850: '#171310', // elevated / card
          800: '#1a1613', // pressed
          700: '#241f1a', // hover
          600: '#3a342f', // borders / faint
        },
        line: '#3a342f',
        input: '#120f0c',
        overlay: '#080606',
        // brand = mocha (keeps `brand-*` class names; was gold, now burnt terracotta)
        brand: {
          DEFAULT: '#c4552d',
          soft: '#e8865f',
          dim: '#8a3d20',
          deep: '#2a241f',
          lite: '#ffded2',
        },
        mocha: { DEFAULT: '#c4552d', hover: '#d2643c', muted: '#2a241f', lite: '#ffded2' },
        // trust accent (legacy `info`) → warm sky
        info: { DEFAULT: '#2ac6e4', soft: '#7fdcee' },
        // semantic (warm)
        safe: '#3d9a55',
        warn: '#f0bd36',
        bad: '#dd6381',
        paper: '#f1f0ef',
        // extended data-viz palette
        success: '#3d9a55',
        sky: '#2ac6e4',
        tan: '#b8a07a',
        gold: '#f0bd36',
        sage: '#61b166',
        lime: '#c4dc78',
        clay: '#e8612e',
        rose: '#dd6381',
        // warm-neutral slate (overrides Tailwind's cool slate used across the app for muted text)
        slate: {
          100: '#e6e6e4',
          200: '#d6d5d2',
          300: '#c6c5c2',
          400: '#8b8a87',
          500: '#6c6b68',
          600: '#4a453f',
          700: '#3a342f',
          800: '#241f1a',
          900: '#120f0c',
          950: '#0b0908',
        },
      },
      fontFamily: {
        sans: ['Geist', '-apple-system', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Source Serif 4"', 'Georgia', 'ui-serif', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        accent: ['Kalam', '"Bradley Hand"', '"Segoe Print"', 'cursive'],
      },
      letterSpacing: {
        tightish: '-0.02em',
        tighter2: '-0.03em',
        tighter3: '-0.04em',
      },
      borderRadius: {
        card: '24px',
        'card-sm': '12px',
      },
      boxShadow: {
        // warm glass panels — hairline inset ring over the warm off-white + deep soft drop
        card: '0 0 0 1px color-mix(in srgb, #f1f0ef 10%, transparent) inset, 0 18px 40px -18px rgba(0,0,0,0.7)',
        raised: '0 0 0 1px color-mix(in srgb, #f1f0ef 12%, transparent) inset, 0 1px 0 color-mix(in srgb, #f1f0ef 7%, transparent) inset, 0 40px 80px -40px rgba(0,0,0,0.9)',
        panel: '0 0 0 1px color-mix(in srgb, #f1f0ef 12%, transparent) inset, 0 18px 40px -18px rgba(0,0,0,0.7)',
        float: '0 0 0 1px #ffffff17, 0 40px 90px rgba(0,0,0,0.55)',
        glow: '0 0 0 1px rgba(196,85,45,0.45), 0 10px 44px -10px rgba(196,85,45,0.5)',
        'glow-safe': '0 0 0 1px rgba(61,154,85,0.35), 0 10px 40px -12px rgba(61,154,85,0.35)',
        'focus-mocha': '0 0 0 1px color-mix(in srgb, #f1f0ef 40%, transparent) inset, 0 0 0 4px #c4552d inset, 0 4px 8px -2px rgba(0,0,0,0.55)',
      },
      backgroundImage: {
        // mocha radial glows + warm panel sheen + fine grid + specular shine
        'gold-sheen': 'linear-gradient(135deg, #e8865f 0%, #c4552d 52%, #8a3d20 100%)',
        'mocha-sheen': 'linear-gradient(135deg, #e8865f 0%, #c4552d 52%, #8a3d20 100%)',
        'mocha-glow': 'radial-gradient(70% 55% at 50% 32%, #c4552d, transparent 72%)',
        'hero-warm': 'radial-gradient(70% 58% at 12% 0, #c4552d 0%, transparent 62%), linear-gradient(168deg, #3a1a10 0%, #150e0c 78%)',
        'panel-sheen': 'linear-gradient(#100e0c 0%, #161310 58%, #1c1814 100%)',
        'grid-warm': 'linear-gradient(rgba(241,240,239,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(241,240,239,0.045) 1px, transparent 1px)',
        shine: 'linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.38) 50%, transparent 100%)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(.16,1,.3,1)',
        'out-quint': 'cubic-bezier(.22,1,.36,1)',
        'out-back': 'cubic-bezier(.34,1.56,.64,1)',
        spring: 'cubic-bezier(.175,.885,.32,1.275)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(12%)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        reveal: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pop: { '0%': { transform: 'scale(0.82)', opacity: '0' }, '60%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(196,85,45,0.5)' }, '100%': { boxShadow: '0 0 0 14px rgba(196,85,45,0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        drift: { '0%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(3%,-4%) scale(1.08)' }, '100%': { transform: 'translate(0,0) scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '-120% 0' }, '100%': { backgroundPosition: '220% 0' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(.16,1,.3,1) both',
        'fade-in': 'fade-in 0.6s ease-out both',
        reveal: 'reveal 0.7s cubic-bezier(.16,1,.3,1) both',
        pop: 'pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
        float: 'float 7s ease-in-out infinite',
        drift: 'drift 22s ease-in-out infinite',
        shimmer: 'shimmer 2.8s linear infinite',
        marquee: 'marquee 40s linear infinite',
        sweep: 'sweep 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
