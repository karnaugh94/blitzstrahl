/**
 * The overflow detector (PLAN §7). Silent overflow is the most common way a
 * markdown deck embarrasses its author, so this is a product feature: dev
 * shows a badge, `build` lists warnings, `build --strict` fails.
 *
 * Each slide is measured as a clone inside the stage (same CSS, no running
 * animations, no slide transition moving it). Hidden build steps use
 * `visibility`, so every step's content is laid out at once and one
 * measurement covers all of a slide's states.
 */

import { TOLERANCE, type Overflow } from './overflow-report.js'

/** Measure every slide. `mark` flags offending elements in the real slides. */
export async function measureOverflow(
  stage: HTMLElement,
  slides: ReadonlyArray<{ id: string }>,
  canvas: { width: number; height: number },
  mark = false,
): Promise<Overflow[]> {
  const doc = stage.ownerDocument
  await doc.fonts?.ready
  const sections = [...stage.querySelectorAll<HTMLElement>(':scope > .blitz-slide')]
  await Promise.all([...stage.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))

  const host = doc.createElement('div')
  host.className = 'blitz-measure'
  host.setAttribute('aria-hidden', 'true')
  stage.append(host)
  const out: Overflow[] = []
  try {
    for (const [i, section] of sections.entries()) {
      const originals = [...section.querySelectorAll<HTMLElement>('*')]
      const copy = section.cloneNode(true) as HTMLElement
      const copies = [...copy.querySelectorAll<HTMLElement>('*')]
      for (const el of [copy, ...copies]) el.removeAttribute('id')
      delete copy.dataset.blitzCurrent
      delete copy.dataset.blitzOutgoing
      copy.style.removeProperty('z-index')
      copy.dataset.blitzMeasure = ''
      host.replaceChildren(copy)
      await Promise.all([...copy.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))

      const found = measure(copy, copies, canvas)
      if (mark) {
        for (const el of originals) delete el.dataset.blitzOverflow
        for (const k of found.culprits) originals[k]!.dataset.blitzOverflow = ''
      }
      if (found.clipped.length || Object.values(found.beyond).some((v) => v > 0)) {
        out.push({ slide: i, id: slides[i]?.id ?? String(i + 1), beyond: found.beyond, clipped: found.clipped })
      }
    }
  } finally {
    host.remove()
  }
  return out
}

function measure(section: HTMLElement, els: HTMLElement[], canvas: { width: number; height: number }) {
  const box = section.getBoundingClientRect()
  const scale = box.width / canvas.width || 1
  const beyond = { top: 0, right: 0, bottom: 0, left: 0 }
  const culprits = new Set<number>()
  const clipped: Overflow['clipped'] = []
  const view = section.ownerDocument.defaultView!

  const check = (r: DOMRect, k: number) => {
    if (r.width === 0 && r.height === 0) return
    const top = (box.top - r.top) / scale
    const right = (r.right - box.right) / scale
    const bottom = (r.bottom - box.bottom) / scale
    const left = (box.left - r.left) / scale
    let hit = false
    for (const [side, v] of [['top', top], ['right', right], ['bottom', bottom], ['left', left]] as const) {
      if (v > TOLERANCE) {
        beyond[side] = Math.max(beyond[side], Math.round(v))
        hit = true
      }
    }
    if (hit) culprits.add(k)
  }

  const range = section.ownerDocument.createRange()
  /** Elements that clip their content: what's inside them can't be seen past them. */
  const clippers = new Set<Element>()
  const insideClipper = (el: Element) => {
    for (let p = el.parentElement; p && p !== section; p = p.parentElement) if (clippers.has(p)) return true
    return false
  }
  els.forEach((el, k) => {
    // Renderers size and clip their own output.
    if (el.closest('[data-blitz-block]') && !el.hasAttribute('data-blitz-block')) return
    const hidden = insideClipper(el)
    if (hidden) return
    check(el.getBoundingClientRect(), k)
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      range.selectNodeContents(node)
      check(range.getBoundingClientRect(), k)
    }
    if (el.hasAttribute('data-blitz-block')) return
    const style = view.getComputedStyle(el)
    const clips = (v: string) => v !== 'visible'
    if (clips(style.overflowX) || clips(style.overflowY)) clippers.add(el)
    const right = clips(style.overflowX) ? el.scrollWidth - el.clientWidth : 0
    const bottom = clips(style.overflowY) ? el.scrollHeight - el.clientHeight : 0
    if (right > TOLERANCE || bottom > TOLERANCE) {
      culprits.add(k)
      clipped.push({ what: describe(el), right: Math.max(0, right), bottom: Math.max(0, bottom) })
    }
  })
  return { beyond, culprits, clipped }
}

function describe(el: HTMLElement): string {
  if (el.tagName === 'PRE') return 'a code block'
  if (el.tagName === 'TABLE') return 'a table'
  if (el.tagName === 'IMG') return 'an image'
  const cls = [...el.classList].filter((c) => !c.startsWith('blitz-'))[0]
  return cls ? `a \`.${cls}\` element` : `a <${el.tagName.toLowerCase()}>`
}
