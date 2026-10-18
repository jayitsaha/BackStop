import { useEffect, useRef } from 'react'

// LedgerChain — an original Backstop "on-chain anchor" animation.
// A horizontal chain of hash-linked ledger blocks: each block is a rounded square with a
// dot-matrix fingerprint inside and a short hash below. A fingerprint hash stream flows down
// into the newest block, its characters scramble-resolve, a cream pulse travels the link back
// through the chain to confirm it, then the chain slides left and a fresh block begins forming.
// Pure Canvas 2D + rAF. DPR-aware, container-filling, honors prefers-reduced-motion (static
// frame of a settled chain). No dependencies.
//
// Props: { className, speed = 1, blocks = 4 }

const TAU = Math.PI * 2
const HEXC = '0123456789abcdef'
const MOCHA = [196, 85, 45]     // #c4552d
const MOCHA_LT = [232, 134, 95] // #e8865f
const CREAM = [255, 222, 210]   // #ffded2

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }
function hashStr(rng, n) {
  let s = ''
  for (let i = 0; i < n; i++) s += HEXC[Math.floor(rng() * 16)]
  return s
}
function cellHash(x, y, s) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453
  return v - Math.floor(v)
}
function rrect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r)
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r)
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r)
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r)
  c.closePath()
}

export default function LedgerChain({ className = '', speed = 1, blocks = 4 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let w = 0, h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    function resize() {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, r.width); h = Math.max(1, r.height)
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(canvas)
    else window.addEventListener('resize', resize)

    const rng = mulberry32(0x10edc)
    let blockSeq = 0
    const hashes = [] // rolling list of hashes, index aligned with chain position
    for (let i = 0; i < blocks + 1; i++) hashes.push(hashStr(rng, 6))

    // one full cycle: [0, .45) forming (stream + scramble) -> [.45, .7) confirm pulse -> [.7, .88) hold -> [.88, 1) slide
    const CYCLE = 5200

    function layout() {
      const n = blocks
      const bs = Math.min(h * 0.34, (w * 0.84) / (n + 0.6) * 0.72) // block size
      const gap = bs * 0.55
      const totalW = n * bs + (n - 1) * gap
      const x0 = (w - totalW) / 2
      const cyMid = h * 0.52
      return { bs, gap, x0, cyMid }
    }

    function drawBlock(x, y, bs, seed, alpha, formed, lit) {
      const r = bs * 0.18
      ctx.save()
      ctx.globalAlpha = alpha

      // body
      rrect(ctx, x - bs / 2, y - bs / 2, bs, bs, r)
      const g = ctx.createLinearGradient(x, y - bs / 2, x, y + bs / 2)
      g.addColorStop(0, '#241209')
      g.addColorStop(1, '#140a06')
      ctx.fillStyle = g
      ctx.fill()

      // dot-matrix fingerprint inside (reveals row by row as the block forms)
      const cells = 7
      const cs = (bs * 0.62) / cells
      const ox = x - (cells * cs) / 2, oy = y - (cells * cs) / 2 - bs * 0.04
      const rowsShown = Math.ceil(formed * cells)
      for (let gy = 0; gy < rowsShown; gy++) {
        for (let gx = 0; gx < cells; gx++) {
          const hv = cellHash(gx, gy, seed)
          if (hv > 0.52) continue
          const bright = 0.25 + hv * 1.4 + (lit ? 0.35 : 0)
          const [cr, cg, cb] = hv > 0.3 ? MOCHA_LT : MOCHA
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${clamp01(bright).toFixed(3)})`
          const sz = cs * 0.46
          ctx.fillRect(ox + gx * cs + (cs - sz) / 2, oy + gy * cs + (cs - sz) / 2, sz, sz)
        }
      }

      // rim
      rrect(ctx, x - bs / 2, y - bs / 2, bs, bs, r)
      ctx.strokeStyle = lit
        ? `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},0.9)`
        : `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},0.75)`
      ctx.lineWidth = Math.max(1, bs * 0.03)
      if (lit) {
        ctx.shadowColor = `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},0.9)`
        ctx.shadowBlur = bs * 0.3
      }
      ctx.stroke()
      ctx.shadowBlur = 0

      ctx.restore()
    }

    function drawHashLabel(x, y, bs, text, alpha, scrambleP, seed) {
      const fs = Math.max(8, Math.round(bs * 0.22))
      ctx.font = `500 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      let shown = ''
      for (let i = 0; i < text.length; i++) {
        const resolved = scrambleP >= (i + 1) / text.length
        shown += resolved ? text[i] : HEXC[Math.floor(cellHash(i, Math.floor(performance.now() / 90), seed) * 16)]
      }
      ctx.fillStyle = `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},${(0.7 * alpha).toFixed(3)})`
      ctx.fillText(`#${shown}`, x, y + bs * 0.62)
    }

    function drawLink(x1, x2, y, alpha, pulseT) {
      // dotted hash-link between blocks
      const n = 7
      for (let i = 1; i < n; i++) {
        const t = i / n
        const px = x1 + (x2 - x1) * t
        ctx.fillStyle = `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},${(0.55 * alpha).toFixed(3)})`
        const sz = 2.2
        ctx.fillRect(px - sz / 2, y - sz / 2, sz, sz)
      }
      // traveling confirmation pulse (right to left)
      if (pulseT >= 0 && pulseT <= 1) {
        const px = x2 + (x1 - x2) * pulseT
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(px, y, 0, px, y, 10)
        g.addColorStop(0, `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},0.95)`)
        g.addColorStop(1, 'rgba(232,134,95,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(px, y, 10, 0, TAU); ctx.fill()
        ctx.restore()
      }
    }

    function drawStream(x, yTop, yBlockTop, p, seed) {
      // fingerprint hash characters raining into the forming block
      const fs = Math.max(8, Math.round(Math.min(w, h) * 0.035))
      ctx.font = `500 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'center'
      const nCh = 6
      for (let i = 0; i < nCh; i++) {
        const off = (p * 2.2 + i / nCh) % 1
        const y = yTop + (yBlockTop - yTop) * off
        const a = Math.sin(off * Math.PI) * 0.75
        const ch = HEXC[Math.floor(cellHash(i, Math.floor((p * 14 + i) * 3), seed) * 16)]
        ctx.fillStyle = `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},${a.toFixed(3)})`
        ctx.fillText(ch, x + Math.sin(i * 2.7) * fs * 0.8, y)
      }
    }

    function drawFrame(now) {
      ctx.clearRect(0, 0, w, h)
      const { bs, gap, x0, cyMid } = layout()
      const cyc = reduce ? 0.8 : ((now * speed) % CYCLE) / CYCLE

      // when the cycle wraps, rotate hashes so the chain "advances"
      const cycleIdx = Math.floor((now * speed) / CYCLE)
      while (blockSeq < cycleIdx) {
        hashes.shift()
        hashes.push(hashStr(rng, 6))
        blockSeq++
      }

      // slide offset during the final phase
      const slideP = cyc > 0.88 ? (cyc - 0.88) / 0.12 : 0
      const ease = slideP * slideP * (3 - 2 * slideP)
      const slide = ease * (bs + gap)

      const formingP = clamp01(cyc / 0.45)             // newest block assembling
      const pulseP = cyc >= 0.45 && cyc < 0.7 ? (cyc - 0.45) / 0.25 : -1

      for (let i = 0; i < blocks; i++) {
        const isNew = i === blocks - 1
        const x = x0 + bs / 2 + i * (bs + gap) - slide
        const seed = (blockSeq + i) * 7.13
        // oldest block fades out as it slides off
        let alpha = 1
        if (i === 0 && slideP > 0) alpha = 1 - ease
        const formed = isNew ? formingP : 1
        const lit = isNew
          ? (pulseP >= 0 && pulseP < 0.2) || (cyc >= 0.7 && cyc < 0.88)
          : pulseP >= 0 && Math.abs((blocks - 1 - i) / Math.max(1, blocks - 1) - pulseP) < 0.12

        drawBlock(x, cyMid, bs, seed, alpha, formed, lit)
        drawHashLabel(x, cyMid, bs, hashes[i], alpha, isNew ? formingP : 1, seed)

        if (i > 0) {
          const xPrev = x0 + bs / 2 + (i - 1) * (bs + gap) - slide
          const linkAlpha = (i === 1 && slideP > 0 ? 1 - ease : 1) * (isNew ? clamp01((formingP - 0.6) / 0.4) : 1)
          // pulse travels right-to-left across each link in sequence
          const segN = blocks - 1
          const segIdx = segN - i // newest link is segment 0
          const segT = pulseP < 0 ? -1 : pulseP * segN - segIdx
          drawLink(xPrev + bs / 2, x - bs / 2, cyMid, linkAlpha, segT >= 0 && segT <= 1 ? segT : -1)
        }
      }

      // the fingerprint stream feeding the newest block
      if (!reduce && formingP < 1) {
        const xNew = x0 + bs / 2 + (blocks - 1) * (bs + gap) - slide
        drawStream(xNew, h * 0.04, cyMid - bs / 2 - 4, formingP, blockSeq * 3.3)
      }

      // caption dots under the chain — "anchored" tick per settled block
      const ty = cyMid + bs * 1.05
      if (ty < h - 4) {
        for (let i = 0; i < blocks; i++) {
          const x = x0 + bs / 2 + i * (bs + gap) - slide
          const settled = i < blocks - 1 || cyc > 0.7
          ctx.fillStyle = settled ? `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},0.8)` : 'rgba(255,222,210,0.18)'
          ctx.beginPath(); ctx.arc(x, ty, 1.8, 0, TAU); ctx.fill()
        }
      }
    }

    let last = 0
    const MIN_DT = 1000 / 45
    function loop(now) {
      raf = requestAnimationFrame(loop)
      if (now - last < MIN_DT) return
      drawFrame(now)
      last = now
    }

    if (reduce) drawFrame(CYCLE * 0.8)
    else raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', resize)
    }
  }, [speed, blocks])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    />
  )
}
