/**
 * Input sources (PLAN §3). Each one only ever calls the navigator surface.
 */

export interface NavTarget {
  advance(): void
  retreat(): void
  first(): void
  last(): void
}

/** Fraction of the viewport width on each side that navigates on click. */
export const GUTTER = 0.1

/** Elements whose clicks belong to themselves, never to the gutters. */
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, details, video, audio, iframe, embed, object, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"]), [data-blitz-interactive]'

export function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null
}

function hasSelection(doc: Document): boolean {
  const sel = doc.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== ''
}

export function bindKeyboard(win: Window, nav: NavTarget, extra: (e: KeyboardEvent) => boolean = () => false): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    let handled = true
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        nav.advance()
        break
      case ' ':
      case 'Spacebar':
        if (e.shiftKey) nav.retreat()
        else nav.advance()
        break
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        nav.retreat()
        break
      case 'Home':
        nav.first()
        break
      case 'End':
        nav.last()
        break
      default:
        handled = extra(e)
    }
    if (handled) e.preventDefault()
  }
  win.addEventListener('keydown', onKey)
  return () => win.removeEventListener('keydown', onKey)
}

/**
 * Edge-click gutters and swipe, on one element. Gutter clicks are ignored
 * over interactive elements and while text is selected (CLAUDE.md: without
 * this, links, hoverable charts and sortable tables break).
 */
export function bindPointer(el: HTMLElement, nav: NavTarget): () => void {
  const doc = el.ownerDocument
  let start: { x: number; y: number; t: number; id: number } | undefined
  let swiped = false

  const zone = (clientX: number): 'left' | 'right' | undefined => {
    const r = el.getBoundingClientRect()
    const x = (clientX - r.left) / r.width
    if (x < GUTTER) return 'left'
    if (x > 1 - GUTTER) return 'right'
    return undefined
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const z = isInteractive(e.target) ? undefined : zone(e.clientX)
    if (z) el.dataset.blitzGutter = z
    else delete el.dataset.blitzGutter
  }

  const onDown = (e: PointerEvent) => {
    swiped = false
    if (e.pointerType === 'mouse' || !e.isPrimary) return
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId }
  }

  const onUp = (e: PointerEvent) => {
    const s = start
    start = undefined
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    const dt = Math.max(1, e.timeStamp - s.t)
    const far = Math.abs(dx) > 120 || (Math.abs(dx) > 40 && Math.abs(dx) / dt > 0.3)
    if (far && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      swiped = true
      if (dx < 0) nav.advance()
      else nav.retreat()
    }
  }

  const onCancel = () => {
    start = undefined
  }

  const onClick = (e: MouseEvent) => {
    if (swiped) {
      swiped = false
      return
    }
    if (e.button !== 0 || e.defaultPrevented || isInteractive(e.target) || hasSelection(doc)) return
    const z = zone(e.clientX)
    if (z === 'left') nav.retreat()
    else if (z === 'right') nav.advance()
  }

  const onLeave = () => delete el.dataset.blitzGutter

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('click', onClick)
  return () => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('pointerleave', onLeave)
    el.removeEventListener('click', onClick)
  }
}
