/**
 * Overflow findings (overflow.ts) and their wording. DOM-free, so the CLI
 * can word build warnings the same way the dev badge does
 * (`@blitzstrahl/runtime/overflow-report`).
 */

export interface Overflow {
  slide: number
  id: string
  /** Logical px of content beyond each canvas edge (0 when inside). */
  beyond: { top: number; right: number; bottom: number; left: number }
  /** Boxes that cut off their own content (`overflow: hidden`, e.g. a code block). */
  clipped: Array<{ what: string; right: number; bottom: number }>
}

/** Less than this is rounding, not overflow. */
export const TOLERANCE = 1

/** One line per problem, for consoles and badges. */
export function describeOverflow(o: Overflow): string[] {
  const lines: string[] = []
  const sides = (['bottom', 'right', 'top', 'left'] as const).filter((s) => o.beyond[s] > 0)
  if (sides.length) lines.push(`content runs off the canvas: ${sides.map((s) => `${o.beyond[s]}px past the ${s}`).join(', ')}`)
  for (const c of o.clipped) {
    const parts = [c.bottom > TOLERANCE ? `${c.bottom}px at the bottom` : '', c.right > TOLERANCE ? `${c.right}px on the right` : ''].filter(Boolean)
    lines.push(`${c.what} cuts off its content (${parts.join(' and ')} hidden)`)
  }
  return lines
}
