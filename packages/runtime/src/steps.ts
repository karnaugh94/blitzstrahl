/**
 * The step model (syntax.md §6.1), as pure functions. No DOM: unit-tested
 * directly, and the only place that decides what "advance" means.
 */
import type { EffectKind, StepRange } from '@blitzstrahl/core'

export interface Position {
  slide: number
  step: number
}

/** Steps per slide, indexed by slide. */
export type StepCounts = readonly number[]

export function next(pos: Position, steps: StepCounts): Position | undefined {
  if (pos.step < (steps[pos.slide] ?? 0)) return { slide: pos.slide, step: pos.step + 1 }
  if (pos.slide < steps.length - 1) return { slide: pos.slide + 1, step: 0 }
  return undefined
}

export function prev(pos: Position, steps: StepCounts): Position | undefined {
  if (pos.step > 0) return { slide: pos.slide, step: pos.step - 1 }
  if (pos.slide > 0) return { slide: pos.slide - 1, step: steps[pos.slide - 1] ?? 0 }
  return undefined
}

export function clamp(pos: Position, steps: StepCounts): Position {
  if (steps.length === 0) return { slide: 0, step: 0 }
  const slide = Math.min(Math.max(0, Math.trunc(pos.slide)), steps.length - 1)
  const step = Math.min(Math.max(0, Math.trunc(pos.step)), steps[slide] ?? 0)
  return { slide, step }
}

/**
 * How the deck got from one position to another. Decides what animates:
 * only forward motion plays effects; everything else snaps (§6.3, `reverse`).
 */
export type Motion =
  | 'none'
  /** Same slide, one or more steps forward. */
  | 'step-forward'
  /** Same slide, backward. */
  | 'step-back'
  /** Arrived on a new slide at state 0 (advance, or a jump to its start). */
  | 'enter'
  /** Arrived on a new slide anywhere else (retreat, deep link). */
  | 'enter-snap'

export function motion(from: Position | undefined, to: Position): Motion {
  if (!from || from.slide !== to.slide) return to.step === 0 ? 'enter' : 'enter-snap'
  if (to.step > from.step) return 'step-forward'
  if (to.step < from.step) return 'step-back'
  return 'none'
}

/**
 * - `hidden`: an entrance element outside its range
 * - `shown`: visible, no emphasis
 * - `active`: an emphasis element inside its range
 */
export type Phase = 'hidden' | 'shown' | 'active'

export function phaseAt(kind: EffectKind, range: StepRange, step: number): Phase {
  const inside = step >= range.in && (range.out === undefined || step <= range.out)
  if (kind === 'emphasis') return inside ? 'active' : 'shown'
  return inside ? 'shown' : 'hidden'
}

/** URL state (PLAN §3): `#/slide-id` or `#/slide-id/step`; a number is a 1-based slide index. */
export function parseHash(hash: string, ids: readonly string[]): Position | undefined {
  const m = /^#\/([^/]+)(?:\/(\d+))?\/?$/.exec(hash)
  if (!m) return undefined
  const key = decodeURIComponent(m[1]!)
  let slide = ids.indexOf(key)
  if (slide < 0 && /^\d+$/.test(key)) slide = Number(key) - 1
  if (slide < 0) return undefined
  return { slide, step: m[2] ? Number(m[2]) : 0 }
}

export function formatHash(pos: Position, ids: readonly string[]): string {
  const id = ids[pos.slide] ?? String(pos.slide + 1)
  return `#/${encodeURIComponent(id)}${pos.step > 0 ? `/${pos.step}` : ''}`
}
