import { useEffect, useRef } from 'react'

// ShieldDeflect — an original Backstop "crash-test" animation.
// A central Backstop crest (original geometric shield with an inner check-chevron) sits inside a
// slowly rotating dotted test-rig ring. ~20 adversarial attack streaks fly in from the edges; each
// one deflects off the shield with a cream spark burst and an expanding ripple, and a counter
// reads "N / 20 deflected". When all attacks are down the shield flares, holds, and the cycle
// restarts. Pure Canvas 2D + rAF. DPR-aware, container-filling, honors prefers-reduced-motion
// (renders a static mid-battle frame). No dependencies.
//
// Props: { className, count = 20, speed = 1 }

const TAU = Math.PI * 2

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

const ATTACK_COLORS = [
  [221, 99, 129],  // #dd6381 rose
  [232, 97, 46],   // #e8612e hot terracotta
]
const CREAM = [255, 222, 210]  // #ffded2
const MOCHA = [196, 85, 45]    // #c4552d
const MOCHA_LT = [232, 134, 95] // #e8865f

export default function ShieldDeflect({ className = '', count = 20, speed = 1 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let w = 0, h = 0, cx = 0, cy = 0, S = 0, shieldR = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    function resize() {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, r.width); h = Math.max(1, r.height)
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx = w / 2; cy = h / 2
      S = Math.min(w, h)
      shieldR = S * 0.165
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(canvas)
    else window.addEventListener('resize', resize)

    // ----- simulation state -----
    const rng = mulberry32(0x5afe)
    let attacks = []     // { ang, delay, speed, col, launched, dead, deflected, x, y, vx, vy, deflT }
    let sparks = []      // { x, y, vx, vy, life, max, cream }
    let ripples = []     // { r0, life, max, ix, iy }
    let deflectedN = 0
    let cycleStart = 0
    let holdUntil = 0
    let glowBoost = 0    // spikes on impact, decays
    let shakeAmt = 0

    function buildWave(now) {
      attacks = []
      deflectedN = 0
      cycleStart = now
      const n = Math.max(1, count)
      for (let i = 0; i < n; i++) {
        const ang = rng() * TAU
        attacks.push({
          ang,
          delay: 500 + i * (5200 / n) + rng() * 420, // staggered volleys over ~5-6s
          spd: (0.16 + rng() * 0.1) * S / 520,       // px per ms, scale with canvas
          col: ATTACK_COLORS[i % 2],
          launched: false, dead: false, deflected: false,
          x: 0, y: 0, vx: 0, vy: 0, deflT: 0,
          wob: (rng() - 0.5) * 0.9,                  // slight curve on approach
          len: 22 + rng() * 22,
        })
      }
    }

    function launch(a) {
      const spawnDist = Math.hypot(w, h) * 0.56
      a.x = cx + Math.cos(a.ang) * spawnDist
      a.y = cy + Math.sin(a.ang) * spawnDist
      // aim at center with a small offset so impacts land across the face of the shield
      const tx = cx + Math.cos(a.ang + Math.PI / 2) * a.wob * shieldR * 0.7
      const ty = cy + Math.sin(a.ang + Math.PI / 2) * a.wob * shieldR * 0.7
      const d = Math.hypot(tx - a.x, ty - a.y)
      a.vx = (tx - a.x) / d
      a.vy = (ty - a.y) / d
      a.launched = true
    }

    function impact(a) {
      a.deflected = true
      a.deflT = 0
      deflectedN++
      glowBoost = Math.min(1.6, glowBoost + 0.55)
      shakeAmt = Math.min(1, shakeAmt + 0.5)
      // reflect velocity about the outward normal at the impact point
      const nx = (a.x - cx) / shieldR, ny = (a.y - cy) / shieldR
      const dot = a.vx * nx + a.vy * ny
      a.vx = (a.vx - 2 * dot * nx) * 1.25
      a.vy = (a.vy - 2 * dot * ny) * 1.25
      // sparks
      const nSp = 7 + Math.floor(rng() * 5)
      for (let i = 0; i < nSp; i++) {
        const sa = Math.atan2(ny, nx) + (rng() - 0.5) * 1.9
        const sv = (0.05 + rng() * 0.16) * S / 520
        sparks.push({
          x: a.x, y: a.y,
          vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv,
          life: 0, max: 320 + rng() * 300,
          cream: rng() > 0.35,
        })
      }
      ripples.push({ ix: a.x, iy: a.y, life: 0, max: 620 })
    }

    // ----- Backstop crest (original geometric shield + inner check-chevron) -----
    function shieldPath(c, r) {
      // drawn in local coords (0,0 center), r ≈ half-height
      c.beginPath()
      c.moveTo(0, -r)
      c.bezierCurveTo(0.36 * r, -0.97 * r, 0.68 * r, -0.84 * r, 0.88 * r, -0.72 * r)
      c.bezierCurveTo(0.93 * r, -0.12 * r, 0.78 * r, 0.5 * r, 0, r)
      c.bezierCurveTo(-0.78 * r, 0.5 * r, -0.93 * r, -0.12 * r, -0.88 * r, -0.72 * r)
      c.bezierCurveTo(-0.68 * r, -0.84 * r, -0.36 * r, -0.97 * r, 0, -r)
      c.closePath()
    }

    function drawShield(now, flare) {
      const r = shieldR
      const breathe = reduce ? 0 : Math.sin(now * 0.0016 * speed) * 0.02
      const glow = 0.35 + glowBoost * 0.8 + flare * 0.9

      ctx.save()
      ctx.translate(cx, cy)
      if (!reduce && shakeAmt > 0.02) {
        ctx.translate((rng() - 0.5) * shakeAmt * 3, (rng() - 0.5) * shakeAmt * 3)
      }
      ctx.scale(1 + breathe, 1 + breathe)

      // soft outer aura
      const aura = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.6)
      aura.addColorStop(0, `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},${(0.14 * glow).toFixed(3)})`)
      aura.addColorStop(1, 'rgba(196,85,45,0)')
      ctx.fillStyle = aura
      ctx.fillRect(-r * 2.7, -r * 2.7, r * 5.4, r * 5.4)

      // body
      shieldPath(ctx, r)
      const body = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.35)
      body.addColorStop(0, '#30160c')
      body.addColorStop(0.6, '#1c0e08')
      body.addColorStop(1, '#120905')
      ctx.fillStyle = body
      ctx.fill()

      // dotted-matrix texture inside the crest
      ctx.save()
      shieldPath(ctx, r)
      ctx.clip()
      const cell = Math.max(4, r * 0.13)
      for (let gy = -r; gy < r; gy += cell) {
        for (let gx = -r; gx < r; gx += cell) {
          const hsh = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453
          const hv = hsh - Math.floor(hsh)
          if (hv > 0.42) continue
          const depth = 1 - Math.hypot(gx + r * 0.25, gy + r * 0.3) / (r * 1.6)
          ctx.fillStyle = `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},${(0.08 + clamp01(depth) * 0.16).toFixed(3)})`
          const sz = cell * 0.26
          ctx.fillRect(gx, gy, sz, sz)
        }
      }
      ctx.restore()

      // rim stroke with glow
      ctx.save()
      ctx.shadowColor = `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},0.9)`
      ctx.shadowBlur = r * (0.22 + glow * 0.3)
      shieldPath(ctx, r)
      ctx.strokeStyle = `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},${(0.85 + flare * 0.15).toFixed(3)})`
      ctx.lineWidth = Math.max(1.4, r * 0.055)
      ctx.lineJoin = 'round'
      ctx.stroke()
      // inner rim echo
      shieldPath(ctx, r * 0.82)
      ctx.strokeStyle = `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},0.38)`
      ctx.lineWidth = Math.max(1, r * 0.02)
      ctx.stroke()
      ctx.restore()

      // inner check-chevron (the Backstop mark)
      ctx.save()
      ctx.shadowColor = `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},0.8)`
      ctx.shadowBlur = r * (0.12 + flare * 0.3)
      ctx.strokeStyle = `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},${(0.95).toFixed(2)})`
      ctx.lineWidth = Math.max(2, r * 0.11)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(-r * 0.36, -r * 0.02)
      ctx.lineTo(-r * 0.07, r * 0.3)
      ctx.lineTo(r * 0.42, -r * 0.34)
      ctx.stroke()
      ctx.restore()

      ctx.restore()
    }

    // rotating dotted test-rig ring around the shield
    function drawRig(now) {
      const rr = shieldR * 2.0
      const rot = reduce ? 0.4 : now * 0.00012 * speed
      const N = 64
      for (let i = 0; i < N; i++) {
        const a = rot + (i / N) * TAU
        const tw = 0.5 + 0.5 * Math.sin(i * 2.4 + now * 0.002 * speed)
        ctx.fillStyle = `rgba(${MOCHA[0]},${MOCHA[1]},${MOCHA[2]},${(0.1 + tw * 0.22).toFixed(3)})`
        const sz = 1.4 + tw * 1.3
        ctx.fillRect(cx + Math.cos(a) * rr - sz / 2, cy + Math.sin(a) * rr - sz / 2, sz, sz)
      }
    }

    function drawAttack(a) {
      const alpha = a.deflected ? clamp01(1 - a.deflT / 620) : 1
      if (alpha <= 0) return
      const [r, g, b] = a.deflected ? CREAM : a.col
      const mag = Math.hypot(a.vx, a.vy) || 1
      const tx = a.x - (a.vx / mag) * a.len
      const ty = a.y - (a.vy / mag) * a.len
      const grad = ctx.createLinearGradient(a.x, a.y, tx, ty)
      grad.addColorStop(0, `rgba(${r},${g},${b},${(0.95 * alpha).toFixed(3)})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.strokeStyle = grad
      ctx.lineWidth = a.deflected ? 1.2 : 1.7
      ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(a.x, a.y); ctx.stroke()
      // hot head
      ctx.fillStyle = `rgba(255,246,241,${(0.9 * alpha).toFixed(3)})`
      ctx.beginPath(); ctx.arc(a.x, a.y, a.deflected ? 1.2 : 1.8, 0, TAU); ctx.fill()
    }

    function drawCounter(n) {
      const fs = Math.max(10, Math.round(S * 0.026))
      ctx.font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      const y = cy + shieldR * 2.55
      const label = `${n} / ${count} deflected`
      ctx.fillStyle = 'rgba(255,222,210,0.92)'
      ctx.fillText(label, cx, Math.min(h - fs * 0.8, y))
      // tiny tick row under the counter
      const tickW = Math.min(S * 0.42, count * 9)
      const step = tickW / count
      const ty = Math.min(h - fs * 0.2, y + fs * 0.75)
      for (let i = 0; i < count; i++) {
        const on = i < n
        ctx.fillStyle = on ? `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},0.95)` : 'rgba(255,222,210,0.16)'
        ctx.fillRect(cx - tickW / 2 + i * step, ty, Math.max(2, step * 0.5), 2.5)
      }
    }

    // ----- frame -----
    let last = 0
    const MIN_DT = 1000 / 48

    function drawFrame(now, dt) {
      // wave lifecycle
      const allDone = deflectedN >= count && attacks.every((a) => a.dead || (a.deflected && a.deflT > 500))
      let flare = 0
      if (allDone) {
        if (!holdUntil) holdUntil = now + 2200 / Math.max(0.2, speed)
        flare = clamp01(Math.sin(clamp01(1 - (holdUntil - now) / 2200) * Math.PI)) // bell curve
        if (now >= holdUntil) { holdUntil = 0; buildWave(now) }
      }

      // physics
      if (!reduce) {
        const t = (now - cycleStart) * speed
        for (const a of attacks) {
          if (a.dead) continue
          if (!a.launched) {
            if (t >= a.delay) launch(a)
            else continue
          }
          const step = a.spd * dt * speed
          a.x += a.vx * step
          a.y += a.vy * step
          if (!a.deflected) {
            const d = Math.hypot(a.x - cx, a.y - cy)
            if (d <= shieldR * 1.02) {
              // snap to the rim and deflect
              a.x = cx + ((a.x - cx) / d) * shieldR
              a.y = cy + ((a.y - cy) / d) * shieldR
              impact(a)
            }
          } else {
            a.deflT += dt
            if (a.deflT > 680) a.dead = true
          }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]
          s.life += dt
          if (s.life >= s.max) { sparks.splice(i, 1); continue }
          s.x += s.vx * dt; s.y += s.vy * dt
          s.vx *= 0.985; s.vy *= 0.985
        }
        for (let i = ripples.length - 1; i >= 0; i--) {
          ripples[i].life += dt * speed
          if (ripples[i].life >= ripples[i].max) ripples.splice(i, 1)
        }
        glowBoost = Math.max(0, glowBoost - dt * 0.0016)
        shakeAmt = Math.max(0, shakeAmt - dt * 0.004)
      }

      // ---- render ----
      ctx.clearRect(0, 0, w, h)
      drawRig(now)
      drawShield(now, flare)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      // ripples (expanding rings from impact points + a rim echo on the shield)
      for (const rp of ripples) {
        const p = rp.life / rp.max
        const a1 = (1 - p) * 0.55
        ctx.strokeStyle = `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},${a1.toFixed(3)})`
        ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.arc(rp.ix, rp.iy, 2 + p * shieldR * 0.9, 0, TAU); ctx.stroke()
        ctx.strokeStyle = `rgba(${MOCHA_LT[0]},${MOCHA_LT[1]},${MOCHA_LT[2]},${((1 - p) * 0.3).toFixed(3)})`
        ctx.beginPath(); ctx.arc(cx, cy, shieldR * (1.08 + p * 0.7), 0, TAU); ctx.stroke()
      }

      // attacks
      for (const a of attacks) {
        if (a.dead || !a.launched) continue
        drawAttack(a)
      }

      // sparks
      for (const s of sparks) {
        const p = s.life / s.max
        const a1 = (1 - p) * 0.9
        const [r, g, b] = s.cream ? CREAM : MOCHA_LT
        ctx.fillStyle = `rgba(${r},${g},${b},${a1.toFixed(3)})`
        const sz = 1 + (1 - p) * 1.6
        ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz)
      }
      ctx.restore()

      drawCounter(Math.min(deflectedN, count))
    }

    function loop(now) {
      raf = requestAnimationFrame(loop)
      if (now - last < MIN_DT) return
      const dt = Math.min(64, last ? now - last : 20)
      drawFrame(now, dt)
      last = now
    }

    buildWave(0)

    if (reduce) {
      // static mid-battle frame: pose several frozen attacks + a done-state counter
      deflectedN = count
      const n = Math.min(6, count)
      for (let i = 0; i < n; i++) {
        const a = attacks[i]
        launch(a)
        const d0 = Math.hypot(a.x - cx, a.y - cy)
        const travel = d0 - shieldR * (1.6 + (i % 3) * 0.9)
        a.x += a.vx * travel; a.y += a.vy * travel
        if (i % 2 === 0) {
          // pose as already-deflected, bouncing away
          const dd = Math.hypot(a.x - cx, a.y - cy) || 1
          const nx = (a.x - cx) / dd, ny = (a.y - cy) / dd
          const dot = a.vx * nx + a.vy * ny
          a.vx -= 2 * dot * nx; a.vy -= 2 * dot * ny
          a.deflected = true; a.deflT = 120
        }
      }
      ripples.push({ ix: cx + shieldR * 0.7, iy: cy - shieldR * 0.5, life: 180, max: 620 })
      drawFrame(900, 0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', resize)
    }
  }, [count, speed])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    />
  )
}
