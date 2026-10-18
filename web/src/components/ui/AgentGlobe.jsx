import { useEffect, useRef } from 'react'

// AgentGlobe — an original Backstop "agent network globe".
// A dotted-stipple sphere (lat/lon point grid, hash-gated so it reads as a dot matrix) slowly
// auto-rotates while glowing mocha great-circle arcs draw themselves between verified agent
// nodes; a bright cream pulse travels each arc and the nodes breathe with soft ripples.
// Pure Canvas 2D + rAF. DPR-aware, container-filling, drag-to-rotate, honors
// prefers-reduced-motion (renders one rich static frame). No dependencies.
//
// Props: { className, speed = 1, density = 1 }

const TAU = Math.PI * 2

// ----- small deterministic helpers -------------------------------------------------------------
function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function lerp(a, b, t) { return a + (b - a) * t }
function rampBetween(c1, c2, steps) {
  const A = hexToRgb(c1), B = hexToRgb(c2), out = []
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    // slight gamma lift so the cream end blooms
    const g = Math.pow(t, 0.82)
    out.push(`rgb(${Math.round(lerp(A[0], B[0], g))},${Math.round(lerp(A[1], B[1], g))},${Math.round(lerp(A[2], B[2], g))})`)
  }
  return out
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }

// Palette (Mocha Noir)
const DOT_DARK = '#5a2818'
const DOT_CREAM = '#ffded2'
const ARC_A = hexToRgb('#c4552d')
const ARC_B = hexToRgb('#e8865f')
const CREAM = hexToRgb('#ffded2')
const BACK_DOT = 'rgba(58, 24, 14, 0.55)'

export default function AgentGlobe({ className = '', speed = 1, density = 1 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let w = 0, h = 0, cx = 0, cy = 0, R = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    // ----- sphere dot lattice (unit vectors on lat/lon rings) -----
    const dots = [] // { x, y, z, h }  (model space)
    function buildSphere() {
      dots.length = 0
      const d = Math.max(0.25, Math.min(2.5, density))
      let rings = Math.round(40 * Math.sqrt(d))
      // cap total dot count (~2900) for performance
      for (;;) {
        let est = 0
        for (let i = 1; i < rings; i++) {
          const lat = -Math.PI / 2 + (i / rings) * Math.PI
          est += Math.max(4, Math.round(Math.cos(lat) * rings * 2.25))
        }
        if (est <= 2900 || rings <= 12) break
        rings -= 2
      }
      for (let i = 1; i < rings; i++) {
        const lat = -Math.PI / 2 + (i / rings) * Math.PI
        const r = Math.cos(lat), y = Math.sin(lat)
        const lonN = Math.max(4, Math.round(r * rings * 2.25))
        for (let j = 0; j < lonN; j++) {
          const lon = (j / lonN) * TAU + (i % 2) * (Math.PI / lonN) // offset alternate rings
          dots.push({ x: r * Math.cos(lon), y, z: r * Math.sin(lon), h: hash2(i, j) })
        }
      }
    }
    buildSphere()

    // ----- verified-agent nodes (seeded, spread apart) -----
    const rng = mulberry32(0xb4c57)
    const nodes = []
    while (nodes.length < 14) {
      const u = rng() * 2 - 1, phi = rng() * TAU
      const r = Math.sqrt(1 - u * u)
      const p = { x: r * Math.cos(phi), y: u * 0.86, z: r * Math.sin(phi), phase: rng() * TAU }
      const L = Math.hypot(p.x, p.y, p.z); p.x /= L; p.y /= L; p.z /= L
      let ok = true
      for (const q of nodes) if (p.x * q.x + p.y * q.y + p.z * q.z > 0.82) { ok = false; break }
      if (ok) nodes.push(p)
    }

    // ----- arcs (great circles between node pairs, with lifecycle) -----
    const arcs = []       // { a, b, omega, born, dur, tint }
    let nextSpawn = 0
    const MAX_ARCS = 5
    function pairDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
    function spawnArc(now) {
      for (let tries = 0; tries < 24; tries++) {
        const ai = Math.floor(rng() * nodes.length)
        let bi = Math.floor(rng() * nodes.length)
        if (bi === ai) bi = (bi + 1) % nodes.length
        const d = pairDot(nodes[ai], nodes[bi])
        const omega = Math.acos(Math.max(-1, Math.min(1, d)))
        if (omega < 0.55 || omega > 2.45) continue
        let dup = false
        for (const arc of arcs) if ((arc.ai === ai && arc.bi === bi) || (arc.ai === bi && arc.bi === ai)) { dup = true; break }
        if (dup) continue
        arcs.push({ ai, bi, omega, born: now, dur: (3200 + rng() * 1800) / Math.max(0.2, speed), tint: rng() })
        return
      }
    }

    // ----- rotation state (auto + drag with inertia) -----
    let yaw = 0.6, yawVel = 0
    let dragging = false, lastPX = 0
    const TILT = 0.42
    const sinT = Math.sin(TILT), cosT = Math.cos(TILT)

    function onPointerDown(e) {
      dragging = true; lastPX = e.clientX; yawVel = 0
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId)
    }
    function onPointerMove(e) {
      if (!dragging) return
      const dx = e.clientX - lastPX
      lastPX = e.clientX
      yaw += dx * 0.006
      yawVel = dx * 0.006
    }
    function onPointerUp() { dragging = false }
    if (!reduce) {
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }

    // ----- sizing -----
    function resize() {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, r.width); h = Math.max(1, r.height)
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx = w / 2; cy = h / 2
      R = Math.min(w, h) * 0.405
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(canvas)
    else window.addEventListener('resize', resize)

    // ----- rotation + projection -----
    // rotate around Y by yaw, then tilt around X; returns [sx, sy, depth, normalBrightness]
    const LX = -0.42, LY = -0.5, LZ = 0.76 // light from upper-left-front
    function project(p, sy_, cy_) {
      const x1 = p.x * cy_ + p.z * sy_
      const z1 = -p.x * sy_ + p.z * cy_
      const y2 = p.y * cosT - z1 * sinT
      const z2 = p.y * sinT + z1 * cosT
      return [cx + x1 * R, cy + y2 * R, z2, x1 * LX + y2 * LY + z2 * LZ]
    }

    // ----- dot ramp buckets -----
    const NB = 16
    const RAMP = rampBetween(DOT_DARK, DOT_CREAM, NB)
    const buckets = Array.from({ length: NB }, () => [])

    // ----- per-frame draw -----
    const SAMPLES = 44
    let last = 0
    const MIN_DT = 1000 / 46 // ~45fps cap

    function drawFrame(now) {
      // arc lifecycle management
      if (!reduce) {
        for (let i = arcs.length - 1; i >= 0; i--) {
          if ((now - arcs[i].born) / arcs[i].dur >= 1) arcs.splice(i, 1)
        }
        if (arcs.length < MAX_ARCS && now >= nextSpawn) {
          spawnArc(now)
          nextSpawn = now + 350 + rng() * 950
        }
      }

      if (!dragging) {
        const dt = Math.min(64, last ? now - last : 22) // ms, clamped
        yaw += 0.00011 * speed * dt + yawVel
        yawVel *= 0.94
      }
      const sy = Math.sin(yaw), cyw = Math.cos(yaw)

      ctx.clearRect(0, 0, w, h)

      // soft atmospheric halo behind the sphere
      const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.28)
      halo.addColorStop(0, 'rgba(196, 85, 45, 0.10)')
      halo.addColorStop(0.72, 'rgba(196, 85, 45, 0.035)')
      halo.addColorStop(1, 'rgba(196, 85, 45, 0)')
      ctx.fillStyle = halo
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6)

      // ---- back hemisphere dots (faint, gives volume) ----
      ctx.fillStyle = BACK_DOT
      const sBack = Math.max(1, R / 260)
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]
        const pr = project(d, sy, cyw)
        if (pr[2] > -0.08 || d.h > 0.3) continue
        ctx.fillRect(pr[0], pr[1], sBack, sBack)
      }

      // ---- back halves of arcs (dim, under the sphere dots) then fronts later ----
      drawArcs(now, sy, cyw, false)

      // ---- front hemisphere dots, stipple-gated + lit, bucketed by ramp index ----
      for (let b = 0; b < NB; b++) buckets[b].length = 0
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]
        const pr = project(d, sy, cyw)
        if (pr[2] <= -0.05) continue
        const bright = clamp01(pr[3]) * 0.78 + clamp01(pr[2]) * 0.34
        // hash gate: brighter regions keep more dots — this is what makes it read as stipple
        if (d.h > 0.3 + bright * 0.62) continue
        const bi = Math.min(NB - 1, Math.floor(clamp01(bright) * NB))
        const size = (0.9 + bright * 1.7) * Math.max(0.8, R / 230)
        buckets[bi].push(pr[0] - size / 2, pr[1] - size / 2, size)
      }
      for (let b = 0; b < NB; b++) {
        const arr = buckets[b]
        if (!arr.length) continue
        ctx.fillStyle = RAMP[b]
        for (let k = 0; k < arr.length; k += 3) ctx.fillRect(arr[k], arr[k + 1], arr[k + 2], arr[k + 2])
      }

      // ---- front halves of arcs + pulse heads (additive glow) ----
      drawArcs(now, sy, cyw, true)

      // ---- node glows ----
      const tSec = now * 0.001 * speed
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i]
        const pr = project(nd, sy, cyw)
        if (pr[2] < 0.04) continue
        const depthA = clamp01((pr[2] - 0.04) / 0.5)
        const pulse = 0.55 + 0.45 * Math.sin(tSec * 2.1 + nd.phase)
        const nr = Math.max(1.6, R * 0.014)
        // soft mocha aura
        const g = ctx.createRadialGradient(pr[0], pr[1], 0, pr[0], pr[1], nr * 5)
        g.addColorStop(0, `rgba(${ARC_B[0]},${ARC_B[1]},${ARC_B[2]},${(0.30 * pulse * depthA).toFixed(3)})`)
        g.addColorStop(1, 'rgba(232,134,95,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(pr[0], pr[1], nr * 5, 0, TAU); ctx.fill()
        // cream core
        ctx.fillStyle = `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},${(0.92 * depthA).toFixed(3)})`
        ctx.beginPath(); ctx.arc(pr[0], pr[1], nr * (0.8 + 0.25 * pulse), 0, TAU); ctx.fill()
        // expanding ripple ring
        const rp = (tSec * 0.5 + nd.phase) % 1
        ctx.strokeStyle = `rgba(${ARC_B[0]},${ARC_B[1]},${ARC_B[2]},${((1 - rp) * 0.4 * depthA).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(pr[0], pr[1], nr * (1.4 + rp * 3.4), 0, TAU); ctx.stroke()
      }
      ctx.restore()
    }

    // slerp a sample along a node pair's great circle, with a gentle lift off the surface
    const _sp = { x: 0, y: 0, z: 0 }
    function arcPoint(A, B, omega, t, lift) {
      const so = Math.sin(omega)
      const k1 = Math.sin((1 - t) * omega) / so
      const k2 = Math.sin(t * omega) / so
      const rad = 1 + lift * Math.sin(Math.PI * t)
      _sp.x = (A.x * k1 + B.x * k2) * rad
      _sp.y = (A.y * k1 + B.y * k2) * rad
      _sp.z = (A.z * k1 + B.z * k2) * rad
      return _sp
    }

    function drawArcs(now, sy, cyw, frontPass) {
      ctx.save()
      ctx.lineCap = 'round'
      if (frontPass) ctx.globalCompositeOperation = 'lighter'
      for (const arc of arcs) {
        const life = reduce ? 0.55 : clamp01((now - arc.born) / arc.dur)
        const drawP = clamp01(life / 0.3)                       // arc draws itself in
        const fade = life > 0.8 ? (life - 0.8) / 0.2 : 0        // then dissolves
        const alive = (1 - fade)
        if (alive <= 0.01 || drawP <= 0.02) continue
        const A = nodes[arc.ai], B = nodes[arc.bi]
        const lift = 0.07 + arc.omega * 0.085
        const lw = Math.max(1, R * 0.008)

        let px = 0, py = 0, pz = -1
        const nSeg = Math.max(8, Math.round(SAMPLES * drawP))
        for (let s = 0; s <= nSeg; s++) {
          const t = (s / nSeg) * drawP
          const pt = arcPoint(A, B, arc.omega, t, lift)
          const pr = project(pt, sy, cyw)
          if (s > 0) {
            const zMid = (pz + pr[2]) / 2
            const isFront = zMid > 0.02
            if (isFront === frontPass) {
              const depthA = frontPass ? clamp01((zMid - 0.02) / 0.4) : clamp01((zMid + 0.5) / 0.5) * 0.3
              const mix = clamp01(t + arc.tint * 0.3)
              const cr = Math.round(lerp(ARC_A[0], ARC_B[0], mix))
              const cg = Math.round(lerp(ARC_A[1], ARC_B[1], mix))
              const cb = Math.round(lerp(ARC_A[2], ARC_B[2], mix))
              if (frontPass) {
                // wide soft glow under-stroke, then the hot core
                ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(depthA * alive * 0.3).toFixed(3)})`
                ctx.lineWidth = lw * 3.4
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(pr[0], pr[1]); ctx.stroke()
                ctx.strokeStyle = `rgba(${Math.min(255, cr + 40)},${Math.min(255, cg + 32)},${Math.min(255, cb + 26)},${(depthA * alive).toFixed(3)})`
                ctx.lineWidth = lw * 1.25
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(pr[0], pr[1]); ctx.stroke()
              } else {
                ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(depthA * alive).toFixed(3)})`
                ctx.lineWidth = lw * 0.7
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(pr[0], pr[1]); ctx.stroke()
              }
            }
          }
          px = pr[0]; py = pr[1]; pz = pr[2]
        }

        // bright cream pulse traveling the arc (front pass only)
        if (frontPass && life > 0.28 && life < 0.8) {
          const ht = clamp01((life - 0.28) / 0.48)
          const pt = arcPoint(A, B, arc.omega, ht, lift)
          const pr = project(pt, sy, cyw)
          if (pr[2] > 0.02) {
            const hr = Math.max(2, R * 0.02)
            const g = ctx.createRadialGradient(pr[0], pr[1], 0, pr[0], pr[1], hr * 4)
            g.addColorStop(0, `rgba(${CREAM[0]},${CREAM[1]},${CREAM[2]},0.95)`)
            g.addColorStop(0.35, 'rgba(232,134,95,0.5)')
            g.addColorStop(1, 'rgba(232,134,95,0)')
            ctx.fillStyle = g
            ctx.beginPath(); ctx.arc(pr[0], pr[1], hr * 4, 0, TAU); ctx.fill()
            ctx.fillStyle = '#fff6f1'
            ctx.beginPath(); ctx.arc(pr[0], pr[1], hr * 0.55, 0, TAU); ctx.fill()
          }
        }
      }
      ctx.restore()
    }

    // ----- loop -----
    function loop(now) {
      raf = requestAnimationFrame(loop)
      if (now - last < MIN_DT) return
      drawFrame(now)
      last = now
    }

    if (reduce) {
      // static frame: pre-seed a few fully drawn arcs
      spawnArc(0); spawnArc(0); spawnArc(0)
      drawFrame(1200)
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [speed, density])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'pan-y', cursor: 'grab' }}
      aria-hidden
    />
  )
}
