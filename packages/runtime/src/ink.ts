/**
 * Drawing and the laser pointer (M4): ink over the slide, in canvas
 * coordinates, so it scales with the canvas and sits where it was drawn.
 *
 * The deck holds the ink, like everything else (the presenter protocol's
 * rule): input anywhere, in the deck or on the presenter's preview, becomes
 * an `InkEvent` the deck applies and then broadcasts. Strokes are kept per
 * slide for as long as the page is open; they're never printed or saved.
 */

export type Tool = 'none' | 'laser' | 'pen'

export interface Stroke {
  /** Unique per window that drew it; a repeat replaces (the stroke grows as it's drawn). */
  id: string
  color: string
  width: number
  /** Flat `x, y` pairs in canvas pixels. */
  points: number[]
}

export type InkEvent =
  | { op: 'stroke'; slide: number; stroke: Stroke }
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
      if (k >= 0) list[k] = e.stroke
      else list.push(e.stroke)
      this.strokes.set(e.slide, list)
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
    this.book.apply(e)
    if (e.op === 'stroke' && e.slide === this.slide) this.drawStroke(e.stroke)
    else if (e.op !== 'stroke' && (e.op === 'sync' || e.slide === this.slide)) this.drawStrokes()
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

export interface InkInput {
  tool(): Tool
  /** The slide ink goes on. */
  slide(): number | undefined
  /** The canvas, as the page shows it (for pointer → canvas pixels). */
  stage: HTMLElement
  canvas: { width: number; height: number }
  /** The pen's colour and width, read when a stroke starts. */
  pen(): { color: string; width: number }
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
  let drawing: { slide: number; stroke: Stroke; pointer: number } | undefined
  let pending = 0

  const toCanvas = (e: PointerEvent): [number, number] | null => {
    const r = input.stage.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * input.canvas.width
    const y = ((e.clientY - r.top) / r.height) * input.canvas.height
    if (x < 0 || y < 0 || x > input.canvas.width || y > input.canvas.height) return null
    return [x, y]
  }

  /** Stroke updates go out at most once a frame; the stroke keeps growing in between. */
  const flush = () => {
    pending = 0
    if (drawing) input.emit({ op: 'stroke', slide: drawing.slide, stroke: { ...drawing.stroke, points: [...drawing.stroke.points] } })
  }
  const later = () => {
    if (!pending) pending = requestAnimationFrame(flush)
  }

  const onDown = (e: PointerEvent) => {
    if (input.tool() !== 'pen' || e.button !== 0 || !e.isPrimary) return
    const at = toCanvas(e)
    const slide = input.slide()
    if (!at || slide === undefined) return
    e.preventDefault()
    surface.setPointerCapture?.(e.pointerId)
    const { color, width } = input.pen()
    drawing = { slide, pointer: e.pointerId, stroke: { id: `${origin}${++strokes}`, color, width, points: at } }
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
