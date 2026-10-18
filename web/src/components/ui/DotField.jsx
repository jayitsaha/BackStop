import { useEffect, useRef } from 'react'

// DotField — an original animated dot-matrix texture: a grid of small squares whose palette index
// and size are driven by scrolling 2-octave value-noise and softened with an 8x8 Bayer ordered
// dither. Mocha-brown -> cream palette over the warm-black canvas. Pure 2D canvas, no deps.
// Props: cell (px), speed, opacity, palette, className. Honors prefers-reduced-motion.

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
]

const DEFAULT_PALETTE = ['#140d0a', '#3a1c11', '#6e3017', '#a8471f', '#c4552d', '#e07a46', '#ffb98c', '#ffded2']

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export default function DotField({ cell = 6, speed = 0.04, opacity = 0.9, palette = DEFAULT_PALETTE, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf, w = 0, h = 0, cols = 0, rows = 0, dpr = Math.min(2, window.devicePixelRatio || 1)

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, r.width); h = Math.max(1, r.height)
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(w / cell) + 1; rows = Math.ceil(h / cell) + 1
    }
    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    const N = palette.length
    const draw = (t) => {
      ctx.clearRect(0, 0, w, h)
      const z = t * 0.001 * speed * 60
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const n = 0.65 * vnoise(gx * 0.045 + z, gy * 0.045 - 0.6 * z) +
                    0.35 * vnoise(gx * 0.11 - z, gy * 0.11 + 0.4 * z)
          const level = n * (N - 1)
          const base = Math.floor(level)
          // ordered dither to next palette index
          const idx = Math.min(N - 1, (level - base) > (BAYER8[gy & 7][gx & 7] + 0.5) / 64 ? base + 1 : base)
          if (idx <= 0) continue
          const size = cell * (0.42 + 0.5 * (idx / (N - 1)))
          const off = (cell - size) / 2
          ctx.fillStyle = palette[idx]
          ctx.fillRect(gx * cell + off, gy * cell + off, size, size)
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    if (reduce) draw(0)
    else raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [cell, speed, palette])

  return <canvas ref={ref} className={className} style={{ width: '100%', height: '100%', opacity, display: 'block' }} aria-hidden />
}
