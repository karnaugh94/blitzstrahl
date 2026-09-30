import { describe, expect, it } from 'vitest'
import { pace, SlideClock, weights } from '../src/presenter/pace.js'

const MIN = 60_000

describe('pace (presenting.md, *Pacing*)', () => {
  const uniform = [1, 1, 1, 1]
  const steps = [0, 3, 0, 0]

  it('progress counts slides, and steps as shares of their slide', () => {
    expect(pace({ slide: 0, step: 0 }, steps, uniform, 0, 20 * MIN).progress).toBe(0)
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 0, 20 * MIN).progress).toBe(0.25)
    expect(pace({ slide: 1, step: 2 }, steps, uniform, 0, 20 * MIN).progress).toBe(0.375)
    expect(pace({ slide: 3, step: 0 }, steps, uniform, 0, 20 * MIN).progress).toBe(0.75)
  })

  it('on pace or ahead is ok; behind past the margin, then over', () => {
    // Slide 2 of 4 is 5 minutes into a 20-minute talk.
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 5 * MIN, 20 * MIN).status).toBe('ok')
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 2 * MIN, 20 * MIN).status).toBe('ok')
    // The default margin is 5 %: one minute of twenty.
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 5.9 * MIN, 20 * MIN).status).toBe('ok')
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 6.1 * MIN, 20 * MIN).status).toBe('behind')
    expect(pace({ slide: 1, step: 0 }, steps, uniform, 6.1 * MIN, 20 * MIN, 2 * MIN).status).toBe('ok')
    expect(pace({ slide: 3, step: 0 }, steps, uniform, 20.1 * MIN, 20 * MIN).status).toBe('over')
  })

  it('rehearsed times weigh the slides', () => {
    // Slide 1 took 3 minutes of 4: arriving at slide 2 after 3 minutes is on pace.
    const w = weights(['a', 'b'], { a: 3 * MIN, b: 1 * MIN })
    expect(pace({ slide: 1, step: 0 }, [0, 0], w, 15 * MIN, 20 * MIN).behind).toBe(0)
  })

  it('weights: a slide added since the rehearsal gets the average; none rehearsed is uniform', () => {
    expect(weights(['a', 'b', 'new'], { a: 1000, b: 3000 })).toEqual([1000, 3000, 2000])
    expect(weights(['a', 'b'], {})).toEqual([1, 1])
  })
})

describe('SlideClock', () => {
  it('adds the timer\'s elapsed time to the slide it was spent on', () => {
    const c = new SlideClock()
    c.at('a', 0)
    c.at('a', 4000)
    c.at('b', 10_000)
    c.at('b', 12_000)
    expect(c.times).toEqual({ a: 10_000, b: 2000 })
    // A reset timer (elapsed going back) adds nothing.
    c.at('b', 0)
    expect(c.times.b).toBe(2000)
  })
})
