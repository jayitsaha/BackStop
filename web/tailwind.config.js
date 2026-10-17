/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // deep institutional ink
        ink: {
          950: '#07090E',
          900: '#0A0D14',
          850: '#0E121B',
          800: '#131824',
          700: '#1B2130',
          600: '#283040',
        },
        line: '#242b3b',
        // molten gold — the brand / premium / seal accent (keeps the `brand-*` class names)
        brand: {
          DEFAULT: '#F2C14E',
          soft: '#F8D98A',
          dim: '#9c7d33',
          deep: '#4b3b14',
        },
        // cool trust blue for the Verified mark
        info: {
          DEFAULT: '#6E8BFF',
          soft: '#A8BBFF',
        },
        safe: '#3FD99A',
        warn: '#F2B441',
        bad: '#FF6A62',
        paper: '#EDEBE2',
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightish: '-0.02em',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.045) inset, 0 24px 60px -28px rgba(0,0,0,0.85)',
        raised: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 40px 90px -40px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(242,193,78,0.35), 0 10px 40px -10px rgba(242,193,78,0.35)',
        'glow-safe': '0 0 0 1px rgba(63,217,154,0.3), 0 10px 40px -12px rgba(63,217,154,0.3)',
      },
      backgroundImage: {
        'gold-sheen': 'linear-gradient(135deg, #F8D98A 0%, #F2C14E 45%, #C79A2E 100%)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        pop: { '0%': { transform: 'scale(0.82)', opacity: '0' }, '60%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(242,193,78,0.5)' }, '100%': { boxShadow: '0 0 0 14px rgba(242,193,78,0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        drift: { '0%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(3%,-4%) scale(1.08)' }, '100%': { transform: 'translate(0,0) scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '-120% 0' }, '100%': { backgroundPosition: '220% 0' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.6s ease-out both',
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
