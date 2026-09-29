/**
 * Drawing and the laser pointer (M4): ink over the slide, in canvas
 * coordinates, so it scales with the canvas and sits where it was drawn.
 *
 * The deck holds the ink, like everything else (the presenter protocol's
 * rule): input anywhere, in the deck or on the presenter's preview, becomes
 * an `InkEvent` the deck applies and then broadcasts. Strokes are kept per
 * slide for as long as the page is open; they're never printed or saved.
 */

export type Tool = 'none' | 'laser' | 'pen' | 'highlighter'

/** The pen's three colours (`1`, `2`, `3`): the theme's ink, then two chart colours. */
export const INK_COLORS = ['--blitz-ink', '--blitz-chart-2', '--blitz-chart-3'] as const
/** How wide each tool draws, in canvas pixels. */
export const WIDTH = { pen: 6, highlighter: 28 } as const

export interface Stroke {
  /** Unique per window that drew it; a repeat replaces. */
  id: string
  color: string
  width: number
  /** A highlighter stroke: broad, and see-through. */
  kind?: 'highlight'
  /** Flat `x, y` pairs in canvas pixels. */
  points: number[]
}

export type InkEvent =
  /** A stroke begins (or, in a sync, is whole). */
  | { op: 'stroke'; slide: number; stroke: Stroke }
  /** More points for a stroke under way: only the new ones (PLAN §15, M12.3). */
  | { op: 'extend'; slide: number; id: string; points: number[] }
  /** `Z`: an intent; the deck turns it into a `remove` of the slide's last stroke. */
  | { op: 'undo'; slide: number }
  | { op: 'remove'; slide: number; id: string }
  | { op: 'clear'; slide: number }
  /** Where the laser points, in canvas pixels; `null` when it's off the canvas. */
  | { op: 'laser'; at: [number, number] | null }
  /** Every stroke, by slide index: what a window that (re)connects gets first. */
  | { op: 'sync'; strokes: Record<string, Stroke[]> }

/** Strokes by slide. Pure, so both the deck and the presenter keep one. */
export class InkBook {
  readonly strokes = new Map<number, Stroke[]>()

  apply(e: InkEvent): void {
    if (e.op === 'stroke') {
      const list = this.strokes.get(e.slide) ?? []
      const k = list.findIndex((s) => s.id === e.stroke.id)
      // A copy: the points grow in place as `extend`s arrive.
      const stroke = { ...e.stroke, points: [...e.stroke.points] }
      if (k >= 0) list[k] = stroke
      else list.push(stroke)
      this.strokes.set(e.slide, list)
    } else if (e.op === 'extend') {
      this.find(e.slide, e.id)?.points.push(...e.points)
    } else if (e.op === 'remove') {
      const list = this.strokes.get(e.slide)?.filter((s) => s.id !== e.id)
      if (list?.length) this.strokes.set(e.slide, list)
      else this.strokes.delete(e.slide)
    } else if (e.op === 'clear') {
      this.strokes.delete(e.slide)
    } else if (e.op === 'sync') {
      this.strokes.clear()
      for (const [k, v] of Object.entries(e.strokes)) this.strokes.set(Number(k), v)
    }
  }

  snapshot(): InkEvent {
    return { op: 'sync', strokes: Object.fromEntries(this.strokes) }
  }

  find(slide: number, id: string): Stroke | undefined {
    return this.strokes.get(slide)?.find((s) => s.id === id)
  }

  /** The slide's last stroke, which `undo` takes back. */
  last(slide: number): Stroke | undefined {
    return this.strokes.get(slide)?.at(-1)
  }
}

/** A smooth SVG path through the points: quadratic curves via the midpoints. */
export function strokePath(points: readonly number[]): string {
  const n = points.length / 2
  if (n === 0) return ''
  const p = (i: number) => `${round(points[2 * i]!)} ${round(points[2 * i + 1]!)}`
  // A dot: a zero-length line still draws its round caps.
  if (n === 1) return `M${p(0)}L${p(0)}`
  let d = `M${p(0)}`
  for (let i = 1; i < n - 1; i++) {
    const mx = (points[2 * i]! + points[2 * i + 2]!) / 2
    const my = (points[2 * i + 1]! + points[2 * i + 3]!) / 2
    d += `Q${p(i)} ${round(mx)} ${round(my)}`
  }
  return `${d}L${p(n - 1)}`
}

const round = (v: number) => Math.round(v * 10) / 10

const SVG = 'http://www.w3.org/2000/svg'
/** How long the laser's trail lingers, ms. */
const TRAIL_MS = 220

/** The drawn layer over the slides: the current slide's strokes and the laser. */
export class InkLayer {
  readonly el: SVGSVGElement
  readonly book = new InkBook()
  private slide = -1
  private readonly strokes: SVGGElement
  private readonly trail: SVGPolylineElement
  private readonly dot: SVGCircleElement
  private laser: Array<{ x: number; y: number; t: number }> = []
  private at: [number, number] | null = null
  private frame = 0

  constructor(
    private readonly doc: Document,
    canvas: { width: number; height: number },
  ) {
    const el = doc.createElementNS(SVG, 'svg')
    el.classList.add('blitz-ink')
    el.setAttribute('aria-hidden', 'true')
    this.strokes = doc.createElementNS(SVG, 'g')
    this.trail = doc.createElementNS(SVG, 'polyline')
    this.trail.classList.add('blitz-laser-trail')
    this.dot = doc.createElementNS(SVG, 'circle')
    this.dot.classList.add('blitz-laser')
    this.dot.setAttribute('r', '9')
    el.append(this.strokes, this.trail, this.dot)
    this.el = el
    this.resize(canvas)
    this.drawLaser()
  }

  resize(canvas: { width: number; height: number }): void {
    this.el.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`)
  }

  showSlide(slide: number): void {
    if (slide === this.slide) return
    this.slide = slide
    this.drawStrokes()
  }

  apply(e: InkEvent): void {
    if (e.op === 'laser') {
      this.at = e.at
      if (e.at) this.laser.push({ x: e.at[0], y: e.at[1], t: performance.now() })
      this.drawLaser()
      return
    }
    // An intent, never applied as it is (the deck resolves it).
    if (e.op === 'undo') return
    this.book.apply(e)
    if (e.op !== 'sync' && e.slide !== this.slide) return
    if (e.op === 'stroke') this.drawStroke(this.book.find(e.slide, e.stroke.id)!)
    else if (e.op === 'extend') {
      const s = this.book.find(e.slide, e.id)
      if (s) this.drawStroke(s)
    } else this.drawStrokes()
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.el.remove()
  }

  private drawStrokes() {
    this.strokes.replaceChildren()
    for (const s of this.book.strokes.get(this.slide) ?? []) this.drawStroke(s)
  }

  private drawStroke(s: Stroke) {
    let path = [...this.strokes.children].find((c) => (c as SVGElement).dataset.id === s.id) as SVGPathElement | undefined
    if (!path) {
      path = this.doc.createElementNS(SVG, 'path')
      path.dataset.id = s.id
      path.classList.add('blitz-stroke')
      this.strokes.append(path)
    }
    path.setAttribute('d', strokePath(s.points))
    path.setAttribute('stroke', s.color)
    path.setAttribute('stroke-width', String(s.width))
    if (s.kind) path.dataset.kind = s.kind
  }

  /** The dot where the laser is, and a short trail behind it that fades out. */
  private drawLaser() {
    const now = performance.now()
    this.laser = this.laser.filter((p) => now - p.t < TRAIL_MS)
    const at = this.at
    this.dot.style.display = at ? '' : 'none'
    if (at) {
      this.dot.setAttribute('cx', String(round(at[0])))
      this.dot.setAttribute('cy', String(round(at[1])))
    }
    this.trail.setAttribute('points', this.laser.map((p) => `${round(p.x)},${round(p.y)}`).join(' '))
    cancelAnimationFrame(this.frame)
    if (this.laser.length > 1) this.frame = requestAnimationFrame(() => this.drawLaser())
  }
}

/** The tools that leave strokes. */
export const draws = (tool: Tool) => tool === 'pen' || tool === 'highlighter'

/** What the tool in hand draws with: colour `color` (0–2) of `INK_COLORS`, read through `token`. */
export function penFor(tool: Tool, color: number, token: (name: string) => string): Pick<Stroke, 'color' | 'width' | 'kind'> {
  const ink = token('--blitz-ink') || token('--blitz-accent') || '#ff4d6d'
  const c = (color > 0 && token(INK_COLORS[color] ?? '')) || ink
  return tool === 'highlighter' ? { color: c, width: WIDTH.highlighter, kind: 'highlight' } : { color: c, width: WIDTH.pen }
}

/** A window that holds the tools: the deck, and the presenter view. */
export interface InkKeys {
  tool: Tool
  setTool(tool: Tool): void
  setColor(color: number): void
  undoInk(): void
  clearInk(): void
}

/**
 * The tools' keys, the same in both windows: `L`, `D`, `H` pick up or put
 * down, `1`–`3` pick a colour (and the pen, unless a drawing tool is in
 * hand), `Z` undoes, `C` clears. True when the key was one of them.
 */
export function inkKey(key: string, w: InkKeys): boolean {
  const toggle = (t: Tool) => w.setTool(w.tool === t ? 'none' : t)
  switch (key.toLowerCase()) {
    case 'l':
      toggle('laser')
      return true
    case 'd':
      toggle('pen')
      return true
    case 'h':
      toggle('highlighter')
      return true
    case 'z':
      w.undoInk()
      return true
    case 'c':
      w.clearInk()
      return true
    case '1':
    case '2':
    case '3':
      w.setColor(Number(key) - 1)
      if (!draws(w.tool)) w.setTool('pen')
      return true
  }
  return false
}

export interface InkInput {
  tool(): Tool
  /** The slide ink goes on. */
  slide(): number | undefined
  /** The canvas, as the page shows it (for pointer → canvas pixels). */
  stage: HTMLElement
  canvas: { width: number; height: number }
  /** The stroke's colour, width and kind, read when it starts (the tool in hand). */
  pen(): Pick<Stroke, 'color' | 'width' | 'kind'>
  emit(e: InkEvent): void
}

let strokes = 0

/**
 * Pointer input for the tools, over `surface`. The pen draws with the
 * primary button (or a finger or stylus); the laser follows the pointer.
 * (The deck's gutters and swipes stand down while the pen is out; see
 * `bindPointer`.) Returns the cleanup.
 */
export function bindInk(surface: HTMLElement, input: InkInput, origin: string): () => void {
  /** The stroke under way, and how many of its coordinates have gone out. */
  let drawing: { slide: number; stroke: Stroke; pointer: number; sent: number } | undefined
  let pending = 0
  const drawn = () => draws(input.tool())

  const toCanvas = (e: PointerEvent): [number, number] | null => {
    const r = input.stage.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * input.canvas.width
    const y = ((e.clientY - r.top) / r.height) * input.canvas.height
    if (x < 0 || y < 0 || x > input.canvas.width || y > input.canvas.height) return null
    return [x, y]
  }

  /** The start goes out at once, then new points at most once a frame: only those not sent yet. */
  const flush = () => {
    pending = 0
    if (!drawing) return
    const { slide, stroke } = drawing
    if (drawing.sent === 0) input.emit({ op: 'stroke', slide, stroke: { ...stroke, points: [...stroke.points] } })
    else if (stroke.points.length > drawing.sent) input.emit({ op: 'extend', slide, id: stroke.id, points: stroke.points.slice(drawing.sent) })
    drawing.sent = stroke.points.length
  }
  const later = () => {
    if (!pending) pending = requestAnimationFrame(flush)
  }

  const onDown = (e: PointerEvent) => {
    if (!drawn() || e.button !== 0 || !e.isPrimary) return
    const at = toCanvas(e)
    const slide = input.slide()
    if (!at || slide === undefined) return
    e.preventDefault()
    surface.setPointerCapture?.(e.pointerId)
    drawing = { slide, pointer: e.pointerId, sent: 0, stroke: { id: `${origin}${++strokes}`, ...input.pen(), points: at } }
    flush()
  }

  const onMove = (e: PointerEvent) => {
    const tool = input.tool()
    if (tool === 'laser') {
      input.emit({ op: 'laser', at: toCanvas(e) })
      return
    }
    if (!drawing || e.pointerId !== drawing.pointer) return
    const at = toCanvas(e)
    if (!at) return
    const pts = drawing.stroke.points
    // Skip points too close to the last: they only add weight.
    if (Math.hypot(at[0] - pts[pts.length - 2]!, at[1] - pts[pts.length - 1]!) < 1.5) return
    pts.push(at[0], at[1])
    later()
  }

  const onUp = (e: PointerEvent) => {
    if (!drawing || e.pointerId !== drawing.pointer) return
    cancelAnimationFrame(pending)
    flush()
    drawing = undefined
  }

  const onLeave = () => {
    if (input.tool() === 'laser') input.emit({ op: 'laser', at: null })
  }

  surface.addEventListener('pointerdown', onDown)
  surface.addEventListener('pointermove', onMove)
  surface.addEventListener('pointerup', onUp)
  surface.addEventListener('pointercancel', onUp)
  surface.addEventListener('pointerleave', onLeave)
  return () => {
    cancelAnimationFrame(pending)
    surface.removeEventListener('pointerdown', onDown)
    surface.removeEventListener('pointermove', onMove)
    surface.removeEventListener('pointerup', onUp)
    surface.removeEventListener('pointercancel', onUp)
    surface.removeEventListener('pointerleave', onLeave)
  }
}
