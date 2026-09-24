/**
 * Slide transitions (syntax.md §9, PLAN §3). One keyframe table, two engines:
 *
 * - `ViewTransitionEngine`: `document.startViewTransition()`, with the
 *   keyframes played on the `::view-transition-old/new` pseudo-elements.
 * - `WaapiEngine`: the required fallback (Safari lags on View Transitions).
 *   Keeps the outgoing slide displayed and animates both `<section>`s.
 *
 * Backward motion plays the entering slide's transition mirrored: the same
 * keyframes with the roles of the two slides swapped, run in reverse.
 */
import type { TransitionName } from '@blitzstrahl/core'

export interface SlideMotion {
  old: Keyframe[]
  new: Keyframe[]
  /** Which slide paints on top while both are visible. */
  top: 'old' | 'new'
}

const still: Keyframe[] = [{ transform: 'none' }, { transform: 'none' }]

const OFFSET = {
  left: ['translateX(100%)', 'translateX(-100%)'],
  right: ['translateX(-100%)', 'translateX(100%)'],
  up: ['translateY(100%)', 'translateY(-100%)'],
  down: ['translateY(-100%)', 'translateY(100%)'],
} as const

/** Keyframes for a forward transition; `undefined` means an instant cut. */
export function slideMotion(name: TransitionName): SlideMotion | undefined {
  if (name === 'none') return undefined
  if (name === 'fade' || name === 'auto-animate') {
    // auto-animate is M4; until then it cross-fades.
    return { old: still, new: [{ opacity: 0 }, { opacity: 1 }], top: 'new' }
  }
  if (name === 'zoom') {
    return { old: still, new: [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], top: 'new' }
  }
  const [kind, dir] = name.split('-') as ['push' | 'cover' | 'uncover', keyof typeof OFFSET]
  const [enterFrom, exitTo] = OFFSET[dir]
  const enter: Keyframe[] = [{ transform: enterFrom }, { transform: 'none' }]
  const exit: Keyframe[] = [{ transform: 'none' }, { transform: exitTo }]
  if (kind === 'push') return { old: exit, new: enter, top: 'new' }
  if (kind === 'cover') return { old: still, new: enter, top: 'new' }
  return { old: exit, new: still, top: 'old' }
}

export interface TransitionRun {
  from: HTMLElement
  to: HTMLElement
  motion: SlideMotion
  /** Going backwards: play mirrored. */
  reverse: boolean
  dur: number
  easing: string
  /** Swap the DOM to the new state. Called exactly once. */
  commit(): void
  /** The outgoing slide is no longer visible. Called exactly once, after `commit`. */
  done(): void
}

export interface TransitionEngine {
  readonly kind: 'view' | 'waapi'
  /** A transition is pending or playing. */
  readonly running: boolean
  run(t: TransitionRun): void
  /** Jump a running transition to its end state (commit and done included). */
  finish(): void
}

/** Keyframes and stacking for each of the two slides, mirroring when reversed. */
export function roles(t: TransitionRun): { from: Keyframe[]; to: Keyframe[]; fromOnTop: boolean; options: KeyframeAnimationOptions } {
  const m = t.motion
  return {
    from: t.reverse ? m.new : m.old,
    to: t.reverse ? m.old : m.new,
    fromOnTop: t.reverse ? m.top === 'new' : m.top === 'old',
    options: { duration: t.dur, easing: t.easing, fill: 'both', direction: t.reverse ? 'reverse' : 'normal' },
  }
}

function once(fn: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    fn()
  }
}

export class WaapiEngine implements TransitionEngine {
  readonly kind = 'waapi'
  private settle: (() => void) | undefined

  get running(): boolean {
    return this.settle !== undefined
  }

  run(t: TransitionRun): void {
    this.finish()
    t.commit()
    const r = roles(t)
    const { from, to } = t
    from.dataset.blitzOutgoing = ''
    from.style.zIndex = r.fromOnTop ? '2' : '0'
    to.style.zIndex = '1'
    const anims = [from.animate(r.from, r.options), to.animate(r.to, r.options)]
    const settle = once(() => {
      if (this.settle === settle) this.settle = undefined
      for (const a of anims) a.cancel()
      delete from.dataset.blitzOutgoing
      from.style.zIndex = ''
      to.style.zIndex = ''
      t.done()
    })
    this.settle = settle
    void Promise.all(anims.map((a) => a.finished)).then(settle, () => {})
  }

  finish(): void {
    this.settle?.()
  }
}

/** The subset of the View Transitions API used here. */
interface ViewTransitionLike {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition(): void
}
type StartViewTransition = (cb: () => void) => ViewTransitionLike

export class ViewTransitionEngine implements TransitionEngine {
  readonly kind = 'view'
  private settle: (() => void) | undefined

  constructor(private readonly doc: Document) {}

  get running(): boolean {
    return this.settle !== undefined
  }

  static supported(doc: Document): boolean {
    return typeof (doc as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
  }

  run(t: TransitionRun): void {
    this.finish()
    const root = this.doc.documentElement
    const r = roles(t)
    const commit = once(t.commit)
    const done = once(t.done)
    root.dataset.blitzVtTop = r.fromOnTop ? 'old' : 'new'
    const start = (this.doc as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(this.doc)
    // The snapshot of the old slide is an image, so its renderers can go
    // as soon as the DOM has switched.
    const vt = start(() => {
      commit()
      done()
    })
    const anims: Animation[] = []
    const settle = once(() => {
      if (this.settle === skip) this.settle = undefined
      commit()
      done()
      // `fill: both` would otherwise keep them listed after the pseudo-elements are gone.
      for (const a of anims) a.cancel()
      delete root.dataset.blitzVtTop
    })
    const skip = () => {
      vt.skipTransition()
      settle()
    }
    this.settle = skip
    vt.ready.then(
      () => {
        anims.push(
          root.animate(r.from, { ...r.options, pseudoElement: '::view-transition-old(blitz-stage)' }),
          root.animate(r.to, { ...r.options, pseudoElement: '::view-transition-new(blitz-stage)' }),
        )
      },
      () => {},
    )
    vt.finished.then(settle, settle)
  }

  finish(): void {
    this.settle?.()
  }
}
