import { describe, expect, it } from 'vitest'
import type { TransitionName } from '@blitzstrahl/core'
import { roles, slideMotion, type TransitionRun } from '../src/transitions.js'

const run = (name: TransitionName, reverse: boolean): TransitionRun => ({
  from: {} as HTMLElement,
  to: {} as HTMLElement,
  motion: slideMotion(name)!,
  reverse,
  dur: 100,
  easing: 'linear',
  commit() {},
  done() {},
})

const end = (frames: Keyframe[]) => frames[frames.length - 1]!.transform

describe('slide transitions (syntax.md §9)', () => {
  it('`none` is an instant cut', () => {
    expect(slideMotion('none')).toBeUndefined()
  })

  it('push: both move in the named direction', () => {
    const m = slideMotion('push-up')!
    expect(end(m.old)).toBe('translateY(-100%)')
    expect(m.new[0]!.transform).toBe('translateY(100%)')
  })

  it('cover moves only the new slide, on top; uncover only the old, on top', () => {
    expect(slideMotion('cover-left')).toMatchObject({ top: 'new', old: [{ transform: 'none' }, { transform: 'none' }] })
    expect(slideMotion('uncover-left')).toMatchObject({ top: 'old', new: [{ transform: 'none' }, { transform: 'none' }] })
  })

  it('backward swaps the roles, keeps the moving slide on top, and runs in reverse', () => {
    for (const name of ['push-left', 'cover-down', 'uncover-right', 'zoom', 'fade'] as const) {
      const fwd = roles(run(name, false))
      const back = roles(run(name, true))
      expect(back.from, name).toEqual(fwd.to)
      expect(back.to, name).toEqual(fwd.from)
      expect(back.fromOnTop, name).toBe(!fwd.fromOnTop)
      expect(back.options.direction).toBe('reverse')
    }
  })
})
