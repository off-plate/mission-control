/* JARVIS's core, the centre of the assistant page (his ask, 2026-10-04).

   At rest it is DRAWN: spinning HUD rings as real lines. He rejected the dot
   cloud at rest twice ("molecule", then "static dots"). When work starts the
   lines hand over to ~12k particles that leave from exactly where the lines
   were, swirl through a turbine while the model thinks, then fly into a shape
   for each thing the assistant actually did. Each shape holds five seconds
   (his number), the next one plays, and the dots condense back into lines.

   Loaded only by the assistant page, and only through a dynamic import, so
   three.js never reaches the bundle every other page pays for.

   Approved prototype: claude.ai/artifact/CGQ2hNaPABoYhCkS3LhxAj. The helmet is
   traced from his own artwork (helmet.tsx), never drawn by hand: he called
   the hand-drawn one "very bad". */
import * as THREE from 'three'
import { HELMET_D } from './helmet'

export type Shape =
  | 'core' | 'turbine' | 'tasks' | 'calendar' | 'bills' | 'gym' | 'idea'
  | 'person' | 'building' | 'note' | 'habit' | 'focus' | 'helmet' | 'prospect'

export interface Callout { label: string; value?: string }
export interface Job { shape: Shape; callouts: Callout[] }
/** Live signals the core breathes with: the real voice level while JARVIS
 *  speaks, the real microphone level while he talks to it. */
export interface Signals { speak: () => number; listen: () => number }

const HOLD = 5000

/* ---------- typing preview: words, until real actions replace them ---------- */
/* First match wins, so the order is the judgement: a date names the calendar
   before "add" names the list, "paid" names Bills before "mark" names a task,
   and "today at noon" is the day's list. Only for the preview while he types;
   once he sends, the shapes come from what the assistant really did. */
const RULES: [Shape, RegExp][] = [
  ['calendar', /\b(tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|calendar|meeting|schedule)\b/i],
  ['bills', /\b(bill|pay|paid|money|spotify|income|expense|kč|czk|invoice)\b/i],
  ['focus', /\b(focus|timer|pomodoro|zone|block)\b/i],
  ['tasks', /\b(task|to-?do|list|add|remind|today|noon|morning|afternoon|evening|tonight|done|finished|tick)\b/i],
  ['calendar', /\bplan\b/i],
  ['gym', /\b(gym|workout|bench|squat|hevy|train|lift)\b/i],
  ['idea', /\bidea/i],
  ['prospect', /\b(prospect|lead|client|outreach|cold email|pipeline|reach out)/i],
  ['person', /\b(person|people|brother|sister|friend|contact|called|mum|mom|dad|father|girlfriend)\b/i],
  ['building', /\b(project|house|kitchen|build|renovat)/i],
  ['note', /\b(note|write (it|this|that) down|jot)/i],
  ['habit', /\b(habit|routine|streak|stretch|meditat|goal)/i],
]
export function previewShape(text: string): Shape {
  const bits = text.split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b)\s*/i).filter(Boolean)
  for (let i = bits.length - 1; i >= 0; i--) {
    const hit = RULES.find(([, r]) => r.test(bits[i]))
    if (hit) return hit[0]
  }
  return 'core'
}
export const isEasterEgg = (t: string) => /love\s*you\s*3\s*0\s*0\s*0/i.test(t)

/* Where each shape's callouts attach, in its own coordinates. */
const ANCHORS: Partial<Record<Shape, [number, number, number][]>> = {
  tasks: [[-0.2, 1.3, 0], [1.6, 1.3, 0], [0.34, -1.28, -1.2]],
  calendar: [[0, 0.57, -0.43], [-2.0, 1.15, -0.8], [2.0, -1.2, -0.8]],
  bills: [[-0.4, 0.14, 1.0], [1.5, 0.7, 0.2], [-2.2, -1.45, 0]],
  gym: [[1.55, 1.0, 0], [-1.55, -1.0, 0], [0, -1.4, 2.3]],
  idea: [[0, 1.7, 0], [1.6, 0.4, 0], [-1.6, 0.4, 0]],
  person: [[0, 1.7, 0], [2.0, -1.55, 0], [-1.3, -0.8, 0]],
  building: [[1.3, 1.15, 0.85], [-1.3, -1.35, 0.85], [2.35, -1.43, 0]],
  note: [[-0.95, 1.15, 0], [1.2, -1.5, 0], [-1.2, -1.2, 0]],
  habit: [[0, 1.6, 1.35], [1.35, -0.6, 0], [-1.35, 0.4, 0]],
  focus: [[0, 1.75, 0], [1.5, 0.3, 0], [-1.6, -0.6, 0]],
  prospect: [[-1.68, 0.75, 0], [0.4, 2.0, 0], [0.55, -1.55, 0]],
}
const VIEWS: Record<Shape, [number, number, number]> = {
  core: [0, 0, 9], turbine: [0.9, 0.25, 9.4], tasks: [-0.35, 0.12, 9], calendar: [0, 0.08, 8.6], bills: [0.5, 0.42, 9],
  gym: [0.55, 0.3, 9], idea: [0.2, 0.05, 8.8], person: [0.3, 0.1, 8.8], building: [0.7, 0.45, 9.6], note: [-0.25, 0.1, 8.8],
  habit: [0.4, 0.2, 9], focus: [0, 0, 8.8], helmet: [0, 0.04, 8.4], prospect: [0.3, 0.42, 9.2],
}
const WIRE_AMBER: Shape[] = ['building', 'bills', 'turbine', 'helmet', 'prospect']

/* Seeded, so every load draws the same shapes. */
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const easeJS = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Prim { w: number; tone: number; spin?: number; sample: () => THREE.Vector3; lines: () => THREE.Vector3[] }
interface Built { pos: Float32Array; tone: Float32Array; spin: Float32Array; lines: Float32Array }

export class JarvisCore {
  private readonly reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly N = this.reduce ? 6000 : 12000
  private readonly rng = mulberry32(20261004)
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private readonly group = new THREE.Group()
  private readonly cache: Partial<Record<Shape, Built>> = {}
  private readonly wires: Partial<Record<Shape, THREE.LineSegments>> = {}
  private readonly geo = new THREE.BufferGeometry()
  private readonly aFrom: Float32Array
  private readonly aTo: Float32Array
  private readonly tFrom: Float32Array
  private readonly tTo: Float32Array
  private readonly spinTo: Float32Array
  private readonly seed: Float32Array
  private readonly U = {
    uTime: { value: 0 }, uMorph: { value: 1 }, uThink: { value: 0 }, uListen: { value: 0 }, uKick: { value: -10 },
    uSpeak: { value: 0 }, uDots: { value: 0 }, uPixel: { value: 1 },
    uCyan: { value: new THREE.Color('#4FD8E8') }, uAmber: { value: new THREE.Color('#E8913A') }, uRed: { value: new THREE.Color('#D8322E') },
  }
  private readonly coreLines = new THREE.Group()
  private readonly lineMats: THREE.LineBasicMaterial[] = []
  private readonly glowMat: THREE.ShaderMaterial
  private readonly eyes = new THREE.Group()
  private readonly eyeMat: THREE.ShaderMaterial
  private readonly leaders: SVGSVGElement
  private readonly flyBox: HTMLDivElement
  private flys: { p: THREE.Vector3; el: HTMLDivElement; line: SVGPolylineElement; dot: SVGCircleElement; born: number }[] = []

  private shape: Shape = 'core'
  private morph = 1
  private morphDur: number
  private settledAt = 0
  private pending: Callout[] | null = null
  private queue: Job[] = []
  private thinking = false
  private think = 0
  private speak = 0
  private listen = 0
  private lastKey = 0
  private words = 0
  private coreVis = 1
  private dots = 0
  private egg = 0
  private eggLit = 0
  private yaw = 0; private pitch = 0; private dist = 9; private drift = 0
  private dragYaw = 0; private dragPitch = 0; private dragging = false; private lastDrag = 0; private lx = 0; private ly = 0
  private prev = performance.now()
  private raf = 0
  private traced: { edges: { len: number; tone: number; pts: [number, number][] }[]; shellFill: [number, number][]; plateFill: [number, number][] } | null = null
  private readonly ro: ResizeObserver
  private readonly off: (() => void)[] = []

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly signals: Signals,
  ) {
    this.morphDur = this.reduce ? 0.35 : 1.8
    /* Colours as written, the way the approved prototype drew them. */
    THREE.ColorManagement.enabled = false
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.U.uPixel.value = this.renderer.getPixelRatio()
    this.camera.position.set(0, 0, 9)
    this.scene.add(this.group)

    const start = this.get('core')
    this.aFrom = new Float32Array(start.pos); this.aTo = new Float32Array(start.pos)
    this.tFrom = new Float32Array(start.tone); this.tTo = new Float32Array(start.tone)
    this.spinTo = new Float32Array(start.spin)
    this.seed = new Float32Array(this.N); for (let i = 0; i < this.N; i++) this.seed[i] = this.rng()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.aFrom, 3))
    this.geo.setAttribute('aTo', new THREE.BufferAttribute(this.aTo, 3))
    this.geo.setAttribute('aToneFrom', new THREE.BufferAttribute(this.tFrom, 1))
    this.geo.setAttribute('aToneTo', new THREE.BufferAttribute(this.tTo, 1))
    this.geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spinTo, 1))
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1))
    const points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime, uMorph, uThink, uListen, uKick, uSpeak, uDots, uPixel;
        uniform vec3 uCyan, uAmber, uRed;
        attribute vec3 aTo; attribute float aSeed, aToneFrom, aToneTo, aSpin;
        varying vec3 vCol; varying float vA;
        float ease(float t){ return t < .5 ? 4.*t*t*t : 1. - pow(-2.*t + 2., 3.) / 2.; }
        void main(){
          float p = clamp(uMorph * 1.6 - aSeed * .6, 0., 1.);
          float e = ease(p);
          float sp = aSpin * uTime, cs = cos(sp), sn = sin(sp);
          vec3 to = vec3(cs * aTo.x - sn * aTo.y, sn * aTo.x + cs * aTo.y, aTo.z);
          vec3 d = to - position;
          vec3 side = normalize(cross(d + vec3(1e-4, 0., 0.), vec3(0., 1., 0.)) + vec3(1e-4));
          float arc = sin(e * 3.14159);
          vec3 pos = mix(position, to, e) + side * length(d) * .38 * arc * (aSeed - .5) * 2. + vec3(0., arc * .35 * (fract(aSeed * 7.) - .5), 0.);
          pos += normalize(pos + 1e-4) * sin(uTime * 1.3 + aSeed * 6.283) * .018;
          float ang = uThink * (uTime * 1.8 + length(pos.xz) * 1.4 + aSeed * .8);
          float c = cos(ang), s = sin(ang);
          pos.xz = mat2(c, -s, s, c) * pos.xz;
          pos.y += uThink * sin(uTime * 3. + aSeed * 20.) * .09;
          float k = uTime - uKick; float r = length(pos);
          pos += normalize(pos + 1e-4) * uListen * .16 * sin(r * 5.5 - k * 14.) * exp(-k * 2.2);
          pos *= 1. + uSpeak * .05 * (.5 + .5 * sin(aSeed * 40. + uTime * 13.));
          vec4 mv = modelViewMatrix * vec4(pos, 1.);
          gl_PointSize = (1.3 + aSeed * 1.6) * uPixel * (9. / -mv.z) * (1. + arc * .8);
          gl_Position = projectionMatrix * mv;
          float tn = mix(aToneFrom, aToneTo, e);
          vCol = tn <= 1. ? mix(uCyan, uAmber, tn) : mix(uAmber, uRed, tn - 1.);
          vA = ((.42 + .38 * sin(uTime * 2. + aSeed * 50.)) * (1. + arc * .7) + uSpeak * .2) * uDots;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vCol * (.7 + a), a * vA); }`,
    }))
    this.group.add(points)

    this.glowMat = this.buildLineCore()
    this.eyeMat = this.buildEyes()

    const NS = 'http://www.w3.org/2000/svg'
    this.leaders = document.createElementNS(NS, 'svg')
    this.leaders.setAttribute('class', 'jv-leaders')
    this.leaders.setAttribute('aria-hidden', 'true')
    this.flyBox = document.createElement('div')
    this.flyBox.setAttribute('aria-hidden', 'true')
    overlay.append(this.leaders, this.flyBox)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas); this.ro.observe(stage)
    this.resize()
    this.bindDrag()
    this.raf = requestAnimationFrame(this.frame)
  }

  /* ---------- the public surface the page drives ---------- */
  /** A keystroke: a ripple through the core, and a word that names a part of
   *  the app starts shaping it. */
  type(text: string): void {
    this.lastKey = performance.now()
    /* Once per finished WORD, not per key (his ask, 2026-10-04: it felt
       stuttery). A word is finished when a space or punctuation follows it;
       deleting never ripples. */
    const words = (text.match(/\S+(?=[\s.,!?;:])/g) ?? []).length
    const grew = words > this.words
    this.words = words
    if (!grew) return
    this.U.uKick.value = this.U.uTime.value
    this.listen = 0.8
    if (this.thinking || this.egg) return
    const s = previewShape(text)
    if (s !== 'core' || this.shape !== 'core') this.morphTo(s)
  }
  /** The model is working. */
  setThinking(on: boolean): void {
    if (on === this.thinking) return
    this.thinking = on
    if (on) { this.queue = []; this.morphTo('turbine') }
    else if (this.shape === 'turbine' && !this.queue.length) this.morphTo('core')
  }
  /** What the turn actually did, in order: one shape each, five seconds each. */
  play(jobs: Job[]): void {
    this.thinking = false
    this.queue = jobs.slice(1)
    if (jobs.length) this.start(jobs[0])
    else if (this.shape !== 'core') this.morphTo('core')
  }
  /** LOVE YOU 3000. */
  easterEgg(): void {
    this.queue = []; this.thinking = false
    this.egg = performance.now(); this.eggLit = 0
    const was = this.morphDur
    this.morphDur = this.reduce ? 0.35 : 2.6
    this.morphTo('helmet')
    setTimeout(() => { this.morphDur = was }, 2700)
  }
  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.off.forEach((f) => f())
    this.leaders.remove(); this.flyBox.remove()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose()
    })
    this.renderer.dispose()
  }

  /* ---------- primitives ---------- */
  private basis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    n = n.clone().normalize()
    const a = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const u = new THREE.Vector3().crossVectors(n, a).normalize()
    return [u, new THREE.Vector3().crossVectors(n, u).normalize()]
  }
  private circle(c: THREE.Vector3, r: number, n: THREE.Vector3, tone = 0, w = 1, a0 = 0, a1 = Math.PI * 2): Prim {
    const [u, v] = this.basis(n)
    const at = (a: number) => c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r)
    return {
      w: (w * r * (a1 - a0)) / (Math.PI * 2), tone, sample: () => at(a0 + this.rng() * (a1 - a0)),
      lines: () => { const out: THREE.Vector3[] = []; const k = Math.max(8, Math.round((64 * (a1 - a0)) / (Math.PI * 2))); for (let i = 0; i < k; i++) out.push(at(a0 + ((a1 - a0) * i) / k), at(a0 + ((a1 - a0) * (i + 1)) / k)); return out },
    }
  }
  private seg(a: THREE.Vector3, b: THREE.Vector3, tone = 0, w = 1): Prim {
    return { w: w * a.distanceTo(b) * 0.16, tone, sample: () => a.clone().lerp(b, this.rng()), lines: () => [a, b] }
  }
  private shell(c: THREE.Vector3, r: number, tone = 0, w = 1, yMin = -1): Prim {
    return {
      w: w * r * r * 1.2, tone,
      sample: () => { let p: THREE.Vector3; do { const z = 2 * this.rng() - 1, t = this.rng() * Math.PI * 2, s = Math.sqrt(1 - z * z); p = new THREE.Vector3(s * Math.cos(t), z, s * Math.sin(t)) } while (p.y < yMin); return p.multiplyScalar(r).add(c) },
      lines: () => [...this.circle(c, r, new THREE.Vector3(0, 1, 0)).lines(), ...this.circle(c, r, new THREE.Vector3(1, 0, 0)).lines()],
    }
  }
  private disk(c: THREE.Vector3, r: number, n: THREE.Vector3, tone = 0, w = 1): Prim {
    const [u, v] = this.basis(n)
    return { w: w * r * r * 0.8, tone, sample: () => { const rr = r * Math.sqrt(this.rng()), a = this.rng() * Math.PI * 2; return c.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr) }, lines: () => [] }
  }
  private rect(c: THREE.Vector3, w: number, h: number, n: THREE.Vector3, tone = 0, wt = 1): Prim[] {
    const [u, v] = this.basis(n)
    const p = (x: number, y: number) => c.clone().addScaledVector(u, x).addScaledVector(v, y)
    const A = p(-w / 2, -h / 2), B = p(w / 2, -h / 2), C = p(w / 2, h / 2), D = p(-w / 2, h / 2)
    return [this.seg(A, B, tone, wt), this.seg(B, C, tone, wt), this.seg(C, D, tone, wt), this.seg(D, A, tone, wt)]
  }
  private ticks(c: THREE.Vector3, r0: number, r1: number, n: THREE.Vector3, k: number, tone = 0, w = 1): Prim[] {
    const [u, v] = this.basis(n); const out: Prim[] = []
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2
      const d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a))
      const rr = i % 5 === 0 ? r1 - (r0 - r1) : r1
      out.push(this.seg(c.clone().addScaledVector(d, r0), c.clone().addScaledVector(d, rr), tone, w))
    }
    return out
  }
  /** A ring that turns at its own speed. Its points spin on the GPU, and it
   *  draws no wireframe of its own (the line core has its own turning lines). */
  private spun(p: Prim, spin: number): Prim { return { ...p, spin, lines: () => [] } }

  /* ---------- his helmet, traced ---------- */
  private hz(x: number, y: number): number { return 0.82 * Math.cos((Math.min(1, Math.abs(x) / 1.3) * Math.PI) / 2) + 0.08 - 0.12 * Math.max(0, -y - 1.0) }
  private hp(x: number, y: number, j = 0): THREE.Vector3 {
    const X = x + (this.rng() - 0.5) * j, Y = y + (this.rng() - 0.5) * j
    return new THREE.Vector3(X, Y, this.hz(X, Y) + (this.rng() - 0.5) * j)
  }
  private trace() {
    if (this.traced) return this.traced
    const NS = 'http://www.w3.org/2000/svg'
    const HS = 3.6 / 122.88
    const hx = (px: number) => (px - 39.45) * HS, hy = (py: number) => -(py - 61.44) * HS
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute'
    document.body.appendChild(svg)
    /* The artwork's sub-paths, in its own order: eye band, outer shell,
       faceplate, chin plates, right eye, left eye. */
    const subs = HELMET_D.split(/(?=M)/).map((d) => d.trim()).filter(Boolean)
    const TONES = [1, 2, 1, 1, 1, 1]
    const edges = subs.map((d, i) => {
      const el = document.createElementNS(NS, 'path'); el.setAttribute('d', d); svg.appendChild(el)
      const len = el.getTotalLength(), n = Math.max(40, Math.round(len * 6)), pts: [number, number][] = []
      for (let k = 0; k <= n; k++) { const q = el.getPointAtLength((len * k) / n); pts.push([hx(q.x), hy(q.y)]) }
      return { len, tone: TONES[i] ?? 1, pts }
    })
    const cv = document.createElement('canvas').getContext('2d')!
    const all = new Path2D(HELMET_D), plate = new Path2D(subs[2])
    const shellFill: [number, number][] = [], plateFill: [number, number][] = []
    for (let k = 0; k < 9000 && (shellFill.length < 1500 || plateFill.length < 1500); k++) {
      const px = this.rng() * 78.89, py = this.rng() * 122.88
      if (!cv.isPointInPath(all, px, py, 'evenodd')) continue
      ;(cv.isPointInPath(plate, px, py) ? plateFill : shellFill).push([hx(px), hy(py)])
    }
    svg.remove()
    this.traced = { edges, shellFill, plateFill }
    return this.traced
  }

  /* ---------- the shapes ---------- */
  private prims(name: Shape): Prim[] {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const O = V(0, 0, 0), Z = V(0, 0, 1), Y = V(0, 1, 0), X = V(1, 0, 0)
    const tilt = (x: number, y: number) => V(0, 0, 1).applyEuler(new THREE.Euler(x, y, 0))
    const arcs = (c: THREE.Vector3, r: number, k: number, frac: number, tone: number, w: number, spin: number) => {
      const out: Prim[] = []
      for (let i = 0; i < k; i++) { const a0 = (i / k) * Math.PI * 2; out.push(this.spun(this.circle(c, r, Z, tone, w, a0, a0 + (frac * Math.PI * 2) / k), spin)) }
      return out
    }
    switch (name) {
      case 'core': {
        /* The resting face. Its points are only seen in flight: at rest the
           line core below draws the same rings as real lines. */
        const out: Prim[] = [
          this.circle(O, 2.35, Z, 0, 2.2),
          ...this.ticks(O, 2.35, 2.22, Z, 90, 0, 0.5).map((p) => this.spun(p, 0.05)),
          ...arcs(V(0, 0, 0.18), 2.04, 3, 0.72, 1, 1.6, -0.14),
          ...arcs(V(0, 0, -0.14), 1.76, 40, 0.45, 0, 0.9, 0.24),
          this.circle(O, 1.46, Z, 0, 1.1),
          this.circle(V(0, 0, 0.06), 0.66, Z, 1, 1.4),
          this.disk(V(0, 0, 0.04), 0.44, Z, 1, 4.5),
        ]
        for (let i = 0; i < 10; i++) {
          const a0 = (i / 10) * Math.PI * 2 + 0.06, a1 = ((i + 1) / 10) * Math.PI * 2 - 0.06, c = V(0, 0, 0.08)
          out.push(this.spun(this.circle(c, 1.18, Z, 1, 1.2, a0, a1), -0.3), this.spun(this.circle(c, 0.9, Z, 1, 0.9, a0, a1), -0.3))
          for (const a of [a0, a1]) out.push(this.spun(this.seg(V(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.08), V(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0.08), 1, 0.8), -0.3))
        }
        return out
      }
      case 'turbine': {
        const out: Prim[] = []; const xs = [-1.7, -1.1, -0.5, 0.1, 0.7, 1.3, 1.8], rs = [1.1, 1.55, 1.9, 2.0, 1.75, 1.35, 0.9]
        xs.forEach((x, i) => { out.push(this.circle(V(x, 0, 0), rs[i], X, i % 2 ? 1 : 0.8, 1.4), this.circle(V(x, 0, 0), rs[i] * 0.55, X, 0, 0.8)) })
        for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; out.push(this.seg(V(0.1, Math.cos(a) * 0.45, Math.sin(a) * 0.45), V(0.4, Math.cos(a + 0.3) * 1.85, Math.sin(a + 0.3) * 1.85), 1, 0.8)) }
        out.push(this.seg(V(-2.3, 0, 0), V(2.3, 0, 0), 0, 2), this.shell(V(-1.9, 0, 0), 0.35, 1, 2))
        return out
      }
      case 'tasks': {
        const out: Prim[] = []
        for (let k = 0; k < 4; k++) {
          const c = V(-0.2 + k * 0.18, 1.3 - k * 0.86, -k * 0.4), t = k === 0 ? 1 : 0
          out.push(...this.rect(c, 3.8, 0.66, Z, t, 1.3), ...this.rect(V(c.x - 1.55, c.y, c.z), 0.34, 0.34, Z, t, 1))
          out.push(this.seg(V(c.x - 1.1, c.y + 0.08, c.z), V(c.x + 0.4 + (k % 2) * 0.6, c.y + 0.08, c.z), t, 0.8), this.seg(V(c.x - 1.1, c.y - 0.12, c.z), V(c.x - 0.1, c.y - 0.12, c.z), 0, 0.5))
        }
        out.push(this.seg(V(-1.88, 1.3, 0), V(-1.77, 1.18, 0), 1, 3), this.seg(V(-1.77, 1.18, 0), V(-1.56, 1.45, 0), 1, 3))
        return out
      }
      case 'calendar': {
        const out: Prim[] = []; const R = 2.7
        for (let col = 0; col < 7; col++) for (let row = 0; row < 5; row++) {
          const a = -0.55 + (col / 6) * 1.1; const c = V(Math.sin(a) * R, 1.15 - row * 0.58, Math.cos(a) * R - R)
          const hot = col === 3 && row === 1
          out.push(...this.rect(c, 0.44, 0.44, V(Math.sin(a), 0, Math.cos(a)), hot ? 1 : 0, hot ? 2 : 0.6))
          if (hot) out.push(this.disk(c, 0.16, V(Math.sin(a), 0, Math.cos(a)), 1, 3))
        }
        out.push(this.circle(V(0, 1.75, -R), R, Y, 1, 1.2, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62))
        return out
      }
      case 'bills': {
        const out: Prim[] = []
        for (let i = 0; i < 6; i++) { const y = -1.3 + i * 0.24; out.push(this.circle(V(-0.4, y, 0), 1.0, Y, 1, 1.2), this.circle(V(-0.4, y + 0.12, 0), 1.0, Y, 1, 0.6)) }
        out.push(this.disk(V(-0.4, 0.14, 0), 1.0, Y, 1, 1.4))
        out.push(this.circle(V(1.5, 0.7, 0.2), 0.85, tilt(0.3, 1.1), 1, 1.4), this.disk(V(1.5, 0.7, 0.2), 0.85, tilt(0.3, 1.1), 1, 1), this.circle(V(1.5, 0.7, 0.2), 0.6, tilt(0.3, 1.1), 0, 0.8))
        out.push(this.circle(V(0, -1.45, 0), 2.2, Y, 0, 1.4), this.circle(V(0, -1.45, 0), 2.45, Y, 0, 0.8))
        return out
      }
      case 'gym': {
        const out: Prim[] = []
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; out.push(this.seg(V(-2.1, Math.cos(a) * 0.08, Math.sin(a) * 0.08), V(2.1, Math.cos(a) * 0.08, Math.sin(a) * 0.08), 0, 0.8)) }
        ;[-1.55, -1.25, 1.25, 1.55].forEach((x, i) => { const r = i === 1 || i === 2 ? 1.0 : 0.78; out.push(this.circle(V(x, 0, 0), r, X, 1, 1.6), this.disk(V(x, 0, 0), r, X, 1, 0.9), this.circle(V(x, 0, 0), 0.2, X, 0, 0.5)) })
        out.push(this.circle(V(0, -1.4, 0), 2.3, Y, 0, 1))
        return out
      }
      case 'idea': {
        const out: Prim[] = [this.shell(V(0, 0.45, 0), 1.25, 0, 2.2, -0.55)]
        for (let i = 0; i < 5; i++) out.push(this.circle(V(0, -0.75 - i * 0.16, 0), 0.55 - i * 0.03, Y, 0, 1))
        const f = [V(-0.4, -0.3, 0), V(-0.25, 0.5, 0), V(-0.1, 0.2, 0), V(0.05, 0.6, 0), V(0.2, 0.2, 0), V(0.3, 0.5, 0), V(0.4, -0.3, 0)]
        for (let i = 0; i < f.length - 1; i++) out.push(this.seg(f[i], f[i + 1], 1, 3))
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; out.push(this.seg(V(Math.cos(a) * 1.65, 0.45 + Math.sin(a) * 1.65, 0), V(Math.cos(a) * 2.0, 0.45 + Math.sin(a) * 2.0, 0), 1, 0.8)) }
        return out
      }
      case 'person': {
        const out: Prim[] = [this.shell(V(0, 1.15, 0), 0.55, 1, 3)]
        ;[[0.4, 0.3], [0.1, 1.0], [-0.3, 1.25], [-0.8, 1.32], [-1.35, 1.32]].forEach(([y, r]) => out.push(this.circle(V(0, y, 0), r, Y, 0, 1.2)))
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; out.push(this.seg(V(Math.cos(a) * 0.35, 0.4, Math.sin(a) * 0.35), V(Math.cos(a) * 1.32, -1.35, Math.sin(a) * 1.32), 0, 0.6)) }
        out.push(this.circle(V(0, -1.55, 0), 2.0, Y, 1, 1.2), this.circle(V(0, -1.55, 0), 2.25, Y, 0, 0.6, 0, 4.5))
        return out
      }
      case 'building': {
        const out: Prim[] = []; const w = 2.6, d = 1.7, h = 2.5, y0 = -1.35
        const P = (x: number, y: number, z: number) => V((x * w) / 2, y0 + y * h, (z * d) / 2)
        ;[[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, z]) => out.push(this.seg(P(x, 0, z), P(x, 1, z), 1, 1.4)))
        for (let f = 0; f <= 6; f++) { const y = f / 6; out.push(this.seg(P(-1, y, -1), P(1, y, -1), 1, 0.7), this.seg(P(1, y, -1), P(1, y, 1), 1, 0.7), this.seg(P(1, y, 1), P(-1, y, 1), 1, 0.7), this.seg(P(-1, y, 1), P(-1, y, -1), 1, 0.7)) }
        for (let i = 1; i < 8; i++) out.push(this.seg(P(-1 + i / 4, 0, 1), P(-1 + i / 4, 1, 1), 1, 0.3))
        out.push(this.circle(V(0, y0 - 0.08, 0), 2.35, Y, 0, 1.4), this.circle(V(0, y0 - 0.08, 0), 2.0, Y, 0, 0.8), this.disk(V(0, y0 - 0.1, 0), 1.9, Y, 0, 0.8))
        return out
      }
      case 'note': {
        const out: Prim[] = []
        for (let k = 2; k >= 0; k--) out.push(...this.rect(V(k * 0.22, -k * 0.18, -k * 0.35), 2.4, 3.0, Z, k ? 0 : 0.2, k ? 0.6 : 1.2))
        out.push(this.seg(V(-0.95, 1.15, 0), V(0.6, 1.15, 0), 1, 2))
        for (let i = 0; i < 6; i++) out.push(this.seg(V(-0.95, 0.7 - i * 0.32, 0), V(0.95 - (i % 3) * 0.35, 0.7 - i * 0.32, 0), 0, 0.9))
        return out
      }
      case 'habit': {
        const out: Prim[] = []; const pts: THREE.Vector3[] = []
        for (let i = 0; i <= 120; i++) { const t = i / 120; const a = t * Math.PI * 6; pts.push(V(Math.cos(a) * 1.35, -1.6 + t * 3.2, Math.sin(a) * 1.35)) }
        for (let i = 0; i < pts.length - 1; i++) out.push(this.seg(pts[i], pts[i + 1], 0, 1.2))
        for (let i = 0; i <= 20; i++) out.push(this.shell(pts[i * 6], 0.12, i > 13 ? 1 : 0, 3))
        out.push(this.seg(V(0, -1.8, 0), V(0, 1.8, 0), 0, 1))
        return out
      }
      case 'focus':
        return [
          this.circle(O, 2.15, Z, 0, 2), ...this.ticks(O, 2.15, 1.98, Z, 60, 0, 0.5),
          this.circle(O, 1.75, Z, 1, 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.2),
          this.circle(O, 1.75, Z, 0, 0.4, -Math.PI / 2 + Math.PI * 1.2, Math.PI * 1.5),
          this.shell(O, 0.3, 1, 3), this.seg(O, V(Math.cos(0.2) * 1.5, Math.sin(0.2) * 1.5, 0), 1, 2),
        ]
      case 'prospect': {
        /* People > Business: his pipeline as a funnel. Five stage rings
           narrow from reach (top) to won (bottom), struts tie them, and the
           new business is the bright node dropping in at the top. */
        const out: Prim[] = []
        const rings: [number, number][] = [[1.45, 2.1], [0.75, 1.65], [0.05, 1.2], [-0.65, 0.8], [-1.35, 0.5]]
        rings.forEach(([y, r], i) => out.push(this.circle(V(0, y, 0), r, Y, i === 0 ? 1 : 0, i === 0 ? 1.8 : 1.2)))
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          for (let k = 0; k < rings.length - 1; k++) {
            const [y0, r0] = rings[k], [y1, r1] = rings[k + 1]
            out.push(this.seg(V(Math.cos(a) * r0, y0, Math.sin(a) * r0), V(Math.cos(a) * r1, y1, Math.sin(a) * r1), 0, 0.35))
          }
        }
        out.push(this.disk(V(0, -1.35, 0), 0.5, Y, 1, 1.4))
        out.push(this.shell(V(0, 2.0, 0), 0.22, 1, 4), this.circle(V(0, 2.0, 0), 0.38, Z, 1, 1))
        out.push(this.seg(V(0, 2.0, 0), V(0, 1.45, 0), 1, 1.2))
        return out
      }
      case 'helmet': {
        const h = this.trace()
        const out: Prim[] = h.edges.map((e) => ({
          w: e.len * (e.tone === 2 ? 0.9 : 1.4), tone: e.tone,
          sample: () => { const pt = e.pts[Math.floor(this.rng() * e.pts.length)]; return this.hp(pt[0], pt[1], 0.004) },
          lines: () => { const o: THREE.Vector3[] = []; for (let i = 0; i < e.pts.length - 1; i += 3) o.push(this.hp(...e.pts[i]), this.hp(...e.pts[Math.min(e.pts.length - 1, i + 3)])); return o },
        }))
        out.push({ w: 150, tone: 2, sample: () => this.hp(...h.shellFill[Math.floor(this.rng() * h.shellFill.length)], 0.03), lines: () => [] })
        out.push({ w: 70, tone: 1, sample: () => this.hp(...h.plateFill[Math.floor(this.rng() * h.plateFill.length)], 0.03), lines: () => [] })
        const back = this.shell(O, 1, 2, 5)
        out.push({ ...back, w: 30, sample: () => { let q: THREE.Vector3; do { q = back.sample() } while (q.z > 0.1); return V(q.x * 1.12, q.y * 1.72, q.z * 1.05) }, lines: () => [] })
        return out
      }
    }
  }

  /** N points spread across a shape's primitives by weight, stratified so a
   *  thin primitive still gets its share, then shuffled so a morph reads as a
   *  swarm rather than a wipe. */
  private get(name: Shape): Built {
    const hit = this.cache[name]
    if (hit) return hit
    const prims = this.prims(name), N = this.N, rng = this.rng
    const total = prims.reduce((a, p) => a + p.w, 0)
    const pos = new Float32Array(N * 3), tone = new Float32Array(N), spin = new Float32Array(N)
    let pi = 0, edge = prims[0].w / total
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N
      while (u > edge && pi < prims.length - 1) { pi++; edge += prims[pi].w / total }
      const p = prims[pi].sample(), j = 0.018
      pos[i * 3] = p.x + (rng() - 0.5) * j; pos[i * 3 + 1] = p.y + (rng() - 0.5) * j; pos[i * 3 + 2] = p.z + (rng() - 0.5) * j
      tone[i] = prims[pi].tone; spin[i] = prims[pi].spin ?? 0
    }
    for (let i = N - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1))
      for (let c = 0; c < 3; c++) { const t = pos[i * 3 + c]; pos[i * 3 + c] = pos[k * 3 + c]; pos[k * 3 + c] = t }
      let t = tone[i]; tone[i] = tone[k]; tone[k] = t
      t = spin[i]; spin[i] = spin[k]; spin[k] = t
    }
    const segs: number[] = []
    prims.forEach((p) => { for (const q of p.lines()) segs.push(q.x, q.y, q.z) })
    const built = { pos, tone, spin, lines: new Float32Array(segs) }
    this.cache[name] = built
    return built
  }

  private wire(name: Shape): THREE.LineSegments {
    const have = this.wires[name]
    if (have) return have
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.get(name).lines, 3))
    const m = new THREE.LineBasicMaterial({ color: WIRE_AMBER.includes(name) ? 0xE8913A : 0x4FD8E8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const l = new THREE.LineSegments(g, m); this.group.add(l); this.wires[name] = l
    return l
  }

  /* The resting core is drawn: real lines, each ring turning at the speed
     its particles turn, so the handover to dots is seamless both ways. */
  private buildLineCore(): THREE.ShaderMaterial {
    this.group.add(this.coreLines)
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const CY = 0x4FD8E8, AM = 0xE8913A, TAU = Math.PI * 2
    const add = (pts: THREE.Vector3[], color: number, opacity: number, spin: number) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      m.userData.base = opacity; this.lineMats.push(m)
      const holder = new THREE.Group(); holder.add(new THREE.LineSegments(g, m)); holder.userData.spin = spin
      this.coreLines.add(holder)
    }
    const arc = (r: number, a0: number, a1: number, z = 0, k = 96) => { const o: THREE.Vector3[] = []; for (let i = 0; i <= k; i++) { const a = a0 + ((a1 - a0) * i) / k; o.push(V(Math.cos(a) * r, Math.sin(a) * r, z)) } return o }
    const pairs = (p: THREE.Vector3[]) => { const o: THREE.Vector3[] = []; for (let i = 0; i < p.length - 1; i++) o.push(p[i], p[i + 1]); return o }
    /* A bright line hugged by two faint ones: the glow one 1px line lacks. */
    const ring = (r: number, z: number, color: number, op: number, k = 160) => {
      add(pairs(arc(r, 0, TAU, z, k)), color, op, 0)
      add(pairs(arc(r + 0.014, 0, TAU, z, k)), color, op * 0.35, 0)
      add(pairs(arc(r - 0.014, 0, TAU, z, k)), color, op * 0.35, 0)
    }
    ring(2.35, 0, CY, 0.9, 220)
    { const t: THREE.Vector3[] = []; for (let i = 0; i < 90; i++) { const a = (i / 90) * TAU, r1 = i % 5 === 0 ? 2.09 : 2.22; t.push(V(Math.cos(a) * 2.35, Math.sin(a) * 2.35, 0), V(Math.cos(a) * r1, Math.sin(a) * r1, 0)) } add(t, CY, 0.7, 0.05) }
    for (let i = 0; i < 3; i++) { const a0 = (i / 3) * TAU, a1 = a0 + (0.72 * TAU) / 3; for (const r of [2.0, 2.04, 2.08]) add(pairs(arc(r, a0, a1, 0.18, 80)), AM, 0.85, -0.14) }
    { const d: THREE.Vector3[] = []; for (let i = 0; i < 40; i++) { const a0 = (i / 40) * TAU; d.push(...pairs(arc(1.76, a0, a0 + (0.45 * TAU) / 40, -0.14, 4))) } add(d, CY, 0.8, 0.24) }
    ring(1.46, 0, CY, 0.55)
    { const c: THREE.Vector3[] = []; for (let i = 0; i < 10; i++) { const a0 = (i / 10) * TAU + 0.06, a1 = ((i + 1) / 10) * TAU - 0.06; c.push(...pairs(arc(1.18, a0, a1, 0.08, 12)), ...pairs(arc(0.9, a0, a1, 0.08, 10))); for (const a of [a0, a1]) c.push(V(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.08), V(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0.08)) } add(c, AM, 0.9, -0.3) }
    ring(0.66, 0.06, AM, 0.9, 120)
    /* The centre burns: amber with a white-hot middle. */
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uO: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uO; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = smoothstep(1., .0, d); vec3 c = mix(vec3(.91,.57,.23), vec3(1.,.93,.82), smoothstep(.55, .0, d)); gl_FragColor = vec4(c, a * a * uO); }',
    })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), glowMat); glow.position.z = 0.04
    const holder = new THREE.Group(); holder.add(glow); holder.userData.spin = 0
    this.coreLines.add(holder)
    return glowMat
  }

  /* The helmet's eyes: the artwork's own eye slots filled with light, laid on
     the curved face vertex by vertex, each with a soft glow behind. */
  private buildEyes(): THREE.ShaderMaterial {
    this.group.add(this.eyes)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uO: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uO; varying vec2 vUv; void main(){ vec2 d = (vUv - .5) * vec2(1., 2.4); float a = smoothstep(.5, .0, length(d)); gl_FragColor = vec4(vec3(.6,.92,1.), a * a * uO); }',
    })
    const t = this.trace()
    for (const pts of [t.edges[4].pts, t.edges[5].pts]) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - cx, y - cy))))
      const pa = g.attributes.position
      for (let k = 0; k < pa.count; k++) pa.setZ(k, this.hz(pa.getX(k) + cx, pa.getY(k) + cy) + 0.03)
      const slit = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xF2FBFF, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.6), mat); halo.position.z = this.hz(cx, cy) + 0.02
      const holder = new THREE.Group(); holder.position.set(cx, cy, 0); holder.add(slit, halo)
      this.eyes.add(holder)
    }
    return mat
  }

  /* ---------- morph ---------- */
  private morphTo(name: Shape): void {
    if (name === this.shape && this.morph >= 1) return
    const nx = this.get(name), t = this.U.uTime.value
    /* Start from where every point IS right now, mid-flight and mid-turn
       included, so an interrupted morph bends instead of jumping. */
    for (let i = 0; i < this.N; i++) {
      const e = easeJS(Math.min(1, Math.max(0, this.morph * 1.6 - this.seed[i] * 0.6)))
      const sp = this.spinTo[i] * t, cs = Math.cos(sp), sn = Math.sin(sp)
      const x = this.aTo[i * 3], y = this.aTo[i * 3 + 1]
      const to = [cs * x - sn * y, sn * x + cs * y, this.aTo[i * 3 + 2]]
      for (let c = 0; c < 3; c++) this.aFrom[i * 3 + c] += (to[c] - this.aFrom[i * 3 + c]) * e
      this.tFrom[i] += (this.tTo[i] - this.tFrom[i]) * e
    }
    this.aTo.set(nx.pos); this.tTo.set(nx.tone); this.spinTo.set(nx.spin)
    for (const k of ['position', 'aTo', 'aToneFrom', 'aToneTo', 'aSpin']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true
    this.shape = name; this.morph = 0; this.settledAt = 0
    this.hideFlys()
  }
  private start(job: Job): void { this.morphTo(job.shape); this.pending = job.callouts }

  /* ---------- callouts ---------- */
  private hideFlys(): void {
    const old = this.flys
    old.forEach((f) => f.el.classList.remove('is-on'))
    setTimeout(() => old.forEach((f) => { f.el.remove(); f.line.remove(); f.dot.remove() }), 300)
    this.flys = []
  }
  private showFlys(items: Callout[]): void {
    this.hideFlys()
    const anchors = ANCHORS[this.shape] ?? []
    const NS = 'http://www.w3.org/2000/svg'
    this.flys = items.slice(0, anchors.length).map((c, i) => {
      const el = document.createElement('div'); el.className = 'jv-fly'
      el.textContent = c.label.toUpperCase()
      if (c.value) { const b = document.createElement('b'); b.textContent = c.value; el.appendChild(b) }
      this.flyBox.appendChild(el)
      const line = document.createElementNS(NS, 'polyline'); line.setAttribute('class', 'jv-leader')
      const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', '2.5'); dot.setAttribute('class', 'jv-leader-dot')
      this.leaders.append(line, dot)
      setTimeout(() => el.classList.add('is-on'), 120 + i * 110)
      return { p: new THREE.Vector3(...anchors[i]), el, line, dot, born: performance.now() + i * 110 }
    })
  }
  private placeFlys(now: number): void {
    if (!this.flys.length) return
    const box = this.canvas.getBoundingClientRect(), st = this.stage.getBoundingClientRect()
    const w = box.width, h = box.height
    const lo = st.left - box.left, hi = st.right - box.left
    const tmp = new THREE.Vector3()
    this.flys.forEach((f) => {
      tmp.copy(f.p).applyMatrix4(this.group.matrixWorld).project(this.camera)
      const x = ((tmp.x + 1) / 2) * w, y = ((1 - tmp.y) / 2) * h
      const dir = x >= (lo + hi) / 2 ? 1 : -1
      /* The callout flies out along its leader, growing from the anchor. */
      const g = 1 - Math.pow(1 - Math.min(1, Math.max(0, (now - f.born) / 420)), 3)
      const ex = x + dir * 60 * g, ey = y - 46 * g, lx = ex + dir * 70 * g
      f.line.setAttribute('points', `${x},${y} ${ex},${ey} ${lx},${ey}`)
      f.dot.setAttribute('cx', String(x)); f.dot.setAttribute('cy', String(y))
      const bw = f.el.offsetWidth
      /* Inside the stage: never over the panels either side of it. */
      const left = Math.max(lo + 8, Math.min(hi - bw - 8, dir > 0 ? lx + 6 : lx - bw - 6))
      /* And never up into the JARVIS title on the stage's top edge. */
      f.el.style.transform = `translate(${left}px, ${Math.max(st.top - box.top + 30, ey - 12)}px)`
    })
  }

  /* ---------- size: the scene centres on the stage and fits it ---------- */
  private resize(): void {
    const box = this.canvas.getBoundingClientRect(), st = this.stage.getBoundingClientRect()
    const w = Math.max(1, box.width), h = Math.max(1, box.height)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    /* A little below the stage's middle: the JARVIS title sits on its top edge. */
    const sx = st.left - box.left + st.width / 2, sy = st.top - box.top + st.height / 2 + 12
    this.camera.setViewOffset(w, h, w / 2 - sx, h / 2 - sy, w, h)
    this.camera.updateProjectionMatrix()
    /* The rings fill about 90% of the stage's smaller side: at distance 9 and
       a 38 degree field the view is 6.2 units tall across the canvas. */
    const side = Math.min(st.width, st.height)
    this.group.scale.setScalar(Math.max(0.2, ((0.82 * side) / h) * 6.2 / (2 * 2.4)))
  }

  /* ---------- look around ---------- */
  private bindDrag(): void {
    const el = this.stage
    const down = (e: PointerEvent) => { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; el.setPointerCapture(e.pointerId); el.classList.add('is-drag') }
    const move = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragYaw += (e.clientX - this.lx) * 0.006
      this.dragPitch = Math.max(-0.9, Math.min(0.9, this.dragPitch + (e.clientY - this.ly) * 0.004))
      this.lx = e.clientX; this.ly = e.clientY; this.lastDrag = performance.now()
    }
    const up = () => { this.dragging = false; el.classList.remove('is-drag') }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    this.off.push(() => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) })
  }

  /* ---------- the loop ---------- */
  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min((now - this.prev) / 1000, 1 / 30); this.prev = now
    if (document.hidden) return
    const U = this.U
    U.uTime.value += dt
    if (this.morph < 1) { this.morph = Math.min(1, this.morph + dt / this.morphDur); if (this.morph >= 1) this.settledAt = now }
    U.uMorph.value = this.morph
    this.think += ((this.thinking ? 1 : 0) - this.think) * Math.min(1, dt * 3)
    U.uThink.value = this.reduce ? 0 : this.think
    /* The microphone, when he is talking to it, counts as a keystroke. */
    const mic = this.signals.listen()
    if (mic > 0.08) { this.listen = Math.max(this.listen, mic); U.uKick.value = U.uTime.value - 0.05 }
    this.listen *= Math.pow(0.25, dt)
    U.uListen.value = this.reduce ? 0 : this.listen
    this.speak += (Math.min(1, this.signals.speak()) - this.speak) * Math.min(1, dt * 12)
    U.uSpeak.value = this.speak

    for (const [name, l] of Object.entries(this.wires) as [Shape, THREE.LineSegments][]) {
      const m = l.material as THREE.LineBasicMaterial
      m.opacity += ((name === this.shape && this.morph >= 1 && this.think < 0.1 ? 0.32 : 0) - m.opacity) * Math.min(1, dt * 4)
    }
    if (this.shape !== 'core') this.wire(this.shape)
    if (this.pending && this.morph >= 1 && now - this.settledAt > 150) { this.showFlys(this.pending); this.pending = null }

    /* Lines at home, dots away: fast out, slow back. */
    const home = this.shape === 'core' && this.morph >= 1
    this.coreVis += ((home ? 1 : 0) - this.coreVis) * Math.min(1, dt * (home ? 2.6 : 16))
    this.dots += ((home ? 0 : 1) - this.dots) * Math.min(1, dt * (home ? 1.8 : 18))
    U.uDots.value = this.dots
    const tt = U.uTime.value
    this.coreLines.children.forEach((hd, i) => {
      hd.rotation.z = (hd.userData.spin || 0) * tt
      hd.scale.setScalar(1 + (this.reduce ? 0 : this.listen * 0.035 * Math.sin(tt * 14 - i * 0.35)) + this.speak * 0.045 * (0.5 + 0.5 * Math.sin(tt * 13 + i)))
    })
    this.lineMats.forEach((m) => { m.opacity = m.userData.base * this.coreVis })
    this.glowMat.uniforms.uO.value = this.coreVis * (0.75 + this.speak * 0.5 + 0.08 * Math.sin(tt * 2.2))

    /* The helmet keeps its own clock: settle, ignite with a double flicker,
       glow, close like eyelids, home. */
    let eyeO = 0, eyeY = 1
    if (this.egg && this.shape === 'helmet' && this.morph >= 1) {
      if (!this.eggLit) this.eggLit = now
      const e = now - this.eggLit
      eyeO = e < 250 ? 0 : e < 330 ? 1 : e < 430 ? 0.15 : e < 520 ? 1 : e < 600 ? 0.35 : 1
      if (e > 3300) eyeY = Math.max(0.02, 1 - Math.pow(Math.min(1, (e - 3300) / 380), 2))
      if (e > 3680) eyeO *= Math.max(0, 1 - (e - 3680) / 200)
      if (e > 4200) { this.egg = 0; this.eggLit = 0; this.morphTo('core') }
    }
    this.eyes.visible = this.shape === 'helmet'
    this.eyes.children.forEach((hd) => { hd.children.forEach((c) => { c.scale.y = eyeY }); ((hd.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = eyeO })
    this.eyeMat.uniforms.uO.value = eyeO * 0.95

    /* Each finished shape holds five seconds, then the next job, then home.
       Typing holds it too, so a preview never vanishes mid-sentence. */
    if (!this.thinking && !this.egg && this.morph >= 1 && this.settledAt && this.shape !== 'core' && this.shape !== 'turbine' && now - Math.max(this.settledAt, this.lastKey) > HOLD) {
      const next = this.queue.shift()
      if (next) this.start(next); else this.morphTo('core')
    }

    const [vy, vp, vd] = VIEWS[this.shape]
    if (!this.reduce) this.drift += dt * 0.12
    if (!this.dragging && now - this.lastDrag > 1600) { this.dragYaw *= Math.pow(0.35, dt); this.dragPitch *= Math.pow(0.35, dt) }
    const k = Math.min(1, dt * 2.2)
    this.yaw += (vy + Math.sin(this.drift) * 0.35 + this.dragYaw - this.yaw) * k
    this.pitch += (vp + this.dragPitch - this.pitch) * k
    this.dist += (vd - this.dist) * k
    this.group.rotation.set(this.pitch, this.yaw, 0)
    this.camera.position.z = this.dist
    this.group.updateMatrixWorld()
    this.renderer.render(this.scene, this.camera)
    this.placeFlys(now)
  }
}
