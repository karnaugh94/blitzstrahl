import { describe, expect, it } from 'vitest'
import { clamp, formatHash, motion, next, parseHash, phaseAt, prev } from '../src/steps.js'

// Three slides with 0, 2 and 1 build steps.
const steps = [0, 2, 1]

describe('step model (syntax.md §6.1)', () => {
  it('advances through every state, then to the next slide', () => {
    const seen = []
    let p: { slide: number; step: number } | undefined = { slide: 0, step: 0 }
    while (p) {
      seen.push(`${p.slide}.${p.step}`)
      p = next(p, steps)
    }
    expect(seen).toEqual(['0.0', '1.0', '1.1', '1.2', '2.0', '2.1'])
  })

  it('retreats from state 0 to the previous slide at its final state', () => {
    expect(prev({ slide: 2, step: 0 }, steps)).toEqual({ slide: 1, step: 2 })
    expect(prev({ slide: 1, step: 2 }, steps)).toEqual({ slide: 1, step: 1 })
    expect(prev({ slide: 0, step: 0 }, steps)).toBeUndefined()
  })

  it('clamps jumps into range', () => {
    expect(clamp({ slide: 9, step: 9 }, steps)).toEqual({ slide: 2, step: 1 })
    expect(clamp({ slide: -1, step: -3 }, steps)).toEqual({ slide: 0, step: 0 })
    expect(clamp({ slide: 1, step: 7 }, steps)).toEqual({ slide: 1, step: 2 })
  })

  it('classifies motion so only forward motion animates', () => {
    expect(motion(undefined, { slide: 0, step: 0 })).toBe('enter')
    expect(motion({ slide: 0, step: 0 }, { slide: 1, step: 0 })).toBe('enter')
    expect(motion({ slide: 2, step: 0 }, { slide: 1, step: 2 })).toBe('enter-snap')
    expect(motion({ slide: 1, step: 0 }, { slide: 1, step: 2 })).toBe('step-forward')
    expect(motion({ slide: 1, step: 2 }, { slide: 1, step: 1 })).toBe('step-back')
    expect(motion({ slide: 1, step: 1 }, { slide: 1, step: 1 })).toBe('none')
  })
})

describe('phaseAt (§6.2, §6.3)', () => {
  it('entrance: hidden before, shown inside, hidden after the out-step', () => {
    const r = { in: 2, out: 4 }
    expect([1, 2, 4, 5].map((s) => phaseAt('entrance', r, s))).toEqual(['hidden', 'shown', 'shown', 'hidden'])
  })

  it('emphasis: always visible, active inside its range', () => {
    const r = { in: 2 }
    expect([0, 1, 2, 9].map((s) => phaseAt('emphasis', r, s))).toEqual(['shown', 'shown', 'active', 'active'])
  })
})

describe('URL state', () => {
  const ids = ['intro', 'pipeline', 'end']
  it('round-trips ids and steps', () => {
    expect(formatHash({ slide: 1, step: 0 }, ids)).toBe('#/pipeline')
    expect(formatHash({ slide: 1, step: 2 }, ids)).toBe('#/pipeline/2')
    expect(parseHash('#/pipeline/2', ids)).toEqual({ slide: 1, step: 2 })
  })
  it('falls back to a 1-based index', () => {
    expect(parseHash('#/3', ids)).toEqual({ slide: 2, step: 0 })
    expect(parseHash('#/nope', ids)).toBeUndefined()
    expect(parseHash('#top', ids)).toBeUndefined()
  })
})
