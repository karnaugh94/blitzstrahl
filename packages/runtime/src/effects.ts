/**
 * Built-in effects (syntax.md §6.3), driven by the Web Animations API.
 *
 * Directional names give the direction of motion: `fade-up` rises into place.
 * Entrance effects animate an element in; emphasis effects are CSS states
 * (see `css.ts`) toggled by `data-blitz-active`, so they need no keyframes here.
 */
import type { AnimSpec } from '@blitzstrahl/core'

export const DEFAULT_DUR = 600

const EASINGS: Record<string, string> = {
  linear: 'linear',
  in: 'cubic-bezier(.4,0,1,1)',
  out: 'cubic-bezier(0,0,.2,1)',
  'in-out': 'cubic-bezier(.4,0,.2,1)',
  'out-expo': 'cubic-bezier(.16,1,.3,1)',
  'in-out-expo': 'cubic-bezier(.87,0,.13,1)',
  'out-back': 'cubic-bezier(.34,1.56,.64,1)',
}

export function easing(name: string | undefined): string {
  if (!name) return EASINGS['out-expo']!
  return EASINGS[name] ?? name
}

const D = 28 // px travelled by the fade-* family
const S = 180 // px travelled by the slide-in-* family

const KEYFRAMES: Record<string, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  'fade-up': [{ opacity: 0, transform: `translateY(${D}px)` }, { opacity: 1, transform: 'none' }],
  'fade-down': [{ opacity: 0, transform: `translateY(-${D}px)` }, { opacity: 1, transform: 'none' }],
  'fade-left': [{ opacity: 0, transform: `translateX(${D}px)` }, { opacity: 1, transform: 'none' }],
  'fade-right': [{ opacity: 0, transform: `translateX(-${D}px)` }, { opacity: 1, transform: 'none' }],
  pop: [
    { opacity: 0, transform: 'scale(.6)' },
    { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
    { opacity: 1, transform: 'scale(1)' },
  ],
  zoom: [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }],
  'blur-in': [{ opacity: 0, filter: 'blur(14px)' }, { opacity: 1, filter: 'blur(0)' }],
  'slide-in-up': [{ opacity: 0, transform: `translateY(${S}px)` }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: 'none' }],
  'slide-in-down': [{ opacity: 0, transform: `translateY(-${S}px)` }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: 'none' }],
  'slide-in-left': [{ opacity: 0, transform: `translateX(${S}px)` }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: 'none' }],
  'slide-in-right': [{ opacity: 0, transform: `translateX(-${S}px)` }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: 'none' }],
}

/** Effects that move the box, so inline elements must become inline-block. */
export function needsBox(effect: string): boolean {
  return /^(fade-|slide-in-|pop$|zoom$)/.test(effect)
}

export interface Played {
  finished: Promise<void>
  /** Jump to the end state immediately. */
  finish(): void
}

const done: Played = { finished: Promise.resolve(), finish() {} }

/** Animate `el` in (or, with `reverse`, back out). The caller sets visibility. */
export function playEntrance(el: HTMLElement, anim: AnimSpec, reverse = false): Played {
  const timing: KeyframeAnimationOptions = {
    duration: anim.dur ?? DEFAULT_DUR,
    delay: reverse ? 0 : (anim.delay ?? 0),
    easing: easing(anim.ease),
    direction: reverse ? 'reverse' : 'normal',
    fill: 'backwards',
  }
  switch (anim.effect) {
    case 'count-up':
      return countUp(el, anim, timing)
    case 'typewriter':
      return typewriter(el, anim, timing)
    case 'draw':
      return draw(el, timing)
  }
  const frames = KEYFRAMES[anim.effect] ?? KEYFRAMES.fade!
  return wrap(el.animate(frames, timing))
}

/** Quick fade used when an element leaves at its out-step. */
export function playExit(el: HTMLElement, anim: AnimSpec): Played {
  return wrap(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.min(anim.dur ?? DEFAULT_DUR, 300), easing: 'ease-out' }))
}

function wrap(a: Animation): Played {
  return {
    finished: a.finished.then(
      () => undefined,
      () => undefined,
    ),
    finish: () => {
      try {
        a.finish()
      } catch {
        a.cancel()
      }
    },
  }
}

/** Drives a JS-side effect on a fake animation so delay/duration/easing still come from WAAPI. */
function driven(el: HTMLElement, timing: KeyframeAnimationOptions, frame: (t: number) => void, end: () => void): Played {
  const a = el.animate([{}, {}], { ...timing, fill: 'none' })
  let raf = 0
  const tick = () => {
    const p = a.effect?.getComputedTiming().progress
    frame(p == null ? (a.playState === 'finished' ? 1 : 0) : p)
    if (a.playState !== 'finished' && a.playState !== 'idle') raf = requestAnimationFrame(tick)
  }
  tick()
  const finished = a.finished.then(
    () => undefined,
    () => undefined,
  ).then(() => {
    cancelAnimationFrame(raf)
    end()
  })
  return {
    finished,
    finish: () => {
      cancelAnimationFrame(raf)
      try {
        a.finish()
      } catch {
        a.cancel()
      }
      end()
    },
  }
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/

/** `count-up`: the element's own numeral is the target; `from=` the start (§6.3). */
function countUp(el: HTMLElement, anim: AnimSpec, timing: KeyframeAnimationOptions): Played {
  const text = el.dataset.blitzCountText ?? el.textContent ?? ''
  el.dataset.blitzCountText = text
  const m = NUMBER.exec(text)
  if (!m) return done
  const target = Number(m[0].replace(/,/g, ''))
  const from = Number(anim.options.from ?? 0)
  const decimals = m[0].split('.')[1]?.length ?? 0
  const grouped = m[0].includes(',')
  const fmt = (n: number) => {
    const s = n.toFixed(decimals)
    return grouped ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s
  }
  const before = text.slice(0, m.index)
  const after = text.slice(m.index + m[0].length)
  // Replace only the text, keep the element's width stable while counting.
  el.style.fontVariantNumeric = 'tabular-nums'
  return driven(
    el,
    timing,
    (t) => {
      el.textContent = before + fmt(from + (target - from) * t) + after
    },
    () => {
      el.textContent = text
    },
  )
}

/** `typewriter`: reveals text node by text node, `cps` characters per second. */
function typewriter(el: HTMLElement, anim: AnimSpec, timing: KeyframeAnimationOptions): Played {
  const nodes: Text[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const originals = nodes.map((n) => n.data)
  const total = originals.reduce((a, s) => a + s.length, 0)
  if (!total) return done
  const cps = Number(anim.options.cps ?? 0)
  const duration = cps > 0 ? (total / cps) * 1000 : (anim.dur ?? Math.max(DEFAULT_DUR, total * 35))
  const restore = () => nodes.forEach((n, i) => (n.data = originals[i]!))
  return driven(
    el,
    { ...timing, duration, easing: 'linear' },
    (t) => {
      let left = Math.round(total * t)
      nodes.forEach((n, i) => {
        const o = originals[i]!
        n.data = o.slice(0, Math.max(0, left))
        left -= o.length
      })
    },
    restore,
  )
}

/** `draw`: strokes SVG shapes in. Falls back to `fade` when there are none. */
function draw(el: HTMLElement, timing: KeyframeAnimationOptions): Played {
  const shapes = [...el.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, circle, ellipse, rect')]
  if (!shapes.length) return wrap(el.animate(KEYFRAMES.fade!, timing))
  const anims = shapes.map((s) => {
    const len = typeof s.getTotalLength === 'function' ? s.getTotalLength() : 1000
    return s.animate(
      [
        { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
        { strokeDasharray: `${len}`, strokeDashoffset: '0' },
      ],
      timing,
    )
  })
  return {
    finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
    finish: () => anims.forEach((a) => a.finish()),
  }
}
