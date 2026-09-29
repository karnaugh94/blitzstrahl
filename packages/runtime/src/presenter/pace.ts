/**
 * Pacing (presenting.md, *Pacing*): how far through the deck the presenter
 * is, against where the clock says they should be, and the rehearsed time
 * of each slide. Pure, apart from `Rehearsals`' storage.
 */
import type { Position } from '../steps.js'

/** A twentieth of the talk, when the deck sets no `pace-margin`. */
export const DEFAULT_MARGIN = 0.05

export type PaceStatus = 'ok' | 'behind' | 'over'

export interface Pace {
  /** How far through the deck, 0–1: slides by their weight, steps as shares of their slide. */
  progress: number
  /** How far through the time, 0–1 (can pass 1). */
  clock: number
  /** How far behind the clock, in ms (negative: ahead). */
  behind: number
  status: PaceStatus
}

/**
 * `weights` is each slide's expected share of the talk: its rehearsed time,
 * or 1 for every slide when there's no rehearsal to go by.
 */
export function pace(pos: Position, steps: readonly number[], weights: readonly number[], elapsed: number, duration: number, margin = duration * DEFAULT_MARGIN): Pace {
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const before = weights.slice(0, pos.slide).reduce((a, b) => a + b, 0)
  const within = (weights[pos.slide] ?? 0) * (pos.step / ((steps[pos.slide] ?? 0) + 1))
  const progress = Math.min(1, (before + within) / total)
  const behind = elapsed - progress * duration
  const status: PaceStatus = elapsed > duration ? 'over' : behind > margin ? 'behind' : 'ok'
  return { progress, clock: elapsed / duration, behind, status }
}

/**
 * Each slide's weight for `pace`: its rehearsed time. A slide without one
 * (added since) gets the average of those that have one. Uniform if none do.
 */
export function weights(ids: readonly string[], times: Readonly<Record<string, number>>): number[] {
  const known = ids.map((id) => times[id]).filter((t): t is number => t !== undefined && t > 0)
  if (!known.length) return ids.map(() => 1)
  const mean = known.reduce((a, b) => a + b, 0) / known.length
  return ids.map((id) => (times[id] && times[id]! > 0 ? times[id]! : mean))
}

/** `-1:30` style, for a countdown past its end: `+1:30`. */
export function formatSigned(ms: number, format: (ms: number) => string): string {
  return ms < 0 ? `+${format(-ms)}` : format(ms)
}

/**
 * Time spent on each slide, by slide id, from the talk timer's elapsed time
 * (so a paused timer adds nothing). `at` is called with the deck's state as
 * it changes and on every tick.
 */
export class SlideClock {
  readonly times: Record<string, number> = {}
  private last: { id: string; elapsed: number } | undefined

  at(id: string | undefined, elapsed: number): void {
    if (this.last && elapsed >= this.last.elapsed) this.times[this.last.id] = (this.times[this.last.id] ?? 0) + (elapsed - this.last.elapsed)
    this.last = id === undefined ? undefined : { id, elapsed }
  }

  reset(): void {
    for (const k of Object.keys(this.times)) delete this.times[k]
    this.last = undefined
  }
}

const PREFIX = 'blitzstrahl:rehearsal:'

/**
 * Rehearsed times per slide id, in the presenter's local storage (never the
 * audience's), one entry per deck. Storage may be missing or refuse: then
 * nothing is remembered, and nothing breaks.
 */
export class Rehearsals {
  private readonly key: string

  constructor(
    private readonly win: Window,
    deck: string,
  ) {
    this.key = PREFIX + deck
  }

  load(): Record<string, number> {
    try {
      const raw = JSON.parse(this.win.localStorage.getItem(this.key) ?? '{}') as unknown
      if (!raw || typeof raw !== 'object') return {}
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>
    } catch {
      return {}
    }
  }

  /**
   * The slides this rehearsal went through replace their old times; the
   * others keep theirs. In whole seconds, as they're shown.
   */
  save(times: Readonly<Record<string, number>>): Record<string, number> {
    const merged = { ...this.load(), ...Object.fromEntries(Object.entries(times).filter(([, v]) => v >= 1000).map(([k, v]) => [k, Math.round(v / 1000) * 1000])) }
    try {
      this.win.localStorage.setItem(this.key, JSON.stringify(merged))
    } catch {
      // storage unavailable: the times last as long as this window
    }
    return merged
  }

  forget(): void {
    try {
      this.win.localStorage.removeItem(this.key)
    } catch {
      // nothing stored
    }
  }
}
