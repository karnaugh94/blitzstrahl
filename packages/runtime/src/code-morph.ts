/**
 * Magic move (syntax.md §9.1): when auto-animate pairs two code blocks, their
 * tokens move from where they were to where they are; tokens that went away
 * fade out where they were, new ones fade in.
 *
 * Moving code has to stay at full strength while the slides cross-fade, so
 * the new block is *lifted*: moved, for the length of the transition, into
 * a layer above both slides (and, on View Transitions, captured on its own).
 * The layer repeats the block's ancestors, so the theme styles it exactly as
 * it was, and a hidden copy holds its place so nothing around it reflows.
 */

const WORD = /[\p{L}\p{N}_$]/u

/** Pairs of indices into two token lists: the same token, before and after. */
export function matchTokens(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  // Longest common subsequence: tokens that kept their order.
  const n = a.length
  const m = b.length
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      usedA.add(i)
      usedB.add(j)
      i++
      j++
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) i++
    else j++
  }
  // Then words that moved (a line swapped with another): same text, in order.
  // Punctuation only pairs in order, or every comma would fly across the block.
  for (let i = 0; i < n; i++) {
    if (usedA.has(i) || !WORD.test(a[i]!)) continue
    const j = b.findIndex((t, k) => t === a[i] && !usedB.has(k))
    if (j < 0) continue
    pairs.push([i, j])
    usedA.add(i)
    usedB.add(j)
  }
  return pairs
}

interface Token {
  el: HTMLElement
  text: string
  /** Offset from the block's padding box, in local pixels. */
  x: number
  y: number
}

interface Shot {
  /** Border box relative to the slide, in local pixels. */
  left: number
  top: number
  width: number
  height: number
  tokens: Token[]
}

function shoot(pre: HTMLElement): Shot {
  const slide = pre.closest<HTMLElement>('.blitz-slide')!
  const r = pre.getBoundingClientRect()
  const s = slide.getBoundingClientRect()
  const k = r.width / (pre.offsetWidth || r.width) || 1
  const originX = r.left + pre.clientLeft * k
  const originY = r.top + pre.clientTop * k
  // Tokens are measured as the boxes they move as (inline-block), which is
  // also where an absolutely placed ghost lands; inline boxes sit half a
  // leading lower. Nothing paints in between, so the old slide never shows it.
  pre.dataset.blitzTokens = ''
  const tokens = [...pre.querySelectorAll<HTMLElement>('.line > span')].map((el) => {
    const t = el.getBoundingClientRect()
    return { el, text: el.textContent ?? '', x: (t.left - originX) / k, y: (t.top - originY) / k }
  })
  delete pre.dataset.blitzTokens
  return { left: (r.left - s.left) / k, top: (r.top - s.top) / k, width: r.width / k, height: r.height / k, tokens }
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`

export class CodeMorph {
  private readonly old: Shot
  private oldStyle: string | null
  private lifted: { layer: HTMLElement; holder: HTMLElement; style: string | null } | undefined
  private readonly ghosts: HTMLElement[] = []

  /** Measures the old block: call while the old slide is still laid out. */
  constructor(
    private readonly from: HTMLElement,
    private readonly to: HTMLElement,
  ) {
    this.old = shoot(from)
    this.oldStyle = from.getAttribute('style')
  }

  /** The new block takes over from the old one at once, so the old one goes. */
  hideOld(): void {
    this.from.style.visibility = 'hidden'
  }

  /** Move the new block into a layer above both slides. Call once the new slide is laid out. */
  lift(): HTMLElement {
    const pre = this.to
    const slide = pre.closest<HTMLElement>('.blitz-slide')!
    const at = shoot(pre)
    const chain: HTMLElement[] = []
    for (let el = pre.parentElement; el && el !== slide; el = el.parentElement) chain.unshift(el)
    const layer = shallow(slide)
    delete layer.dataset.blitzCurrent
    layer.dataset.blitzLift = ''
    layer.setAttribute('aria-hidden', 'true')
    let parent = layer
    for (const el of chain) {
      const copy = shallow(el)
      copy.dataset.blitzLiftChain = ''
      copy.style.position = 'static'
      copy.style.overflow = 'visible'
      copy.style.transform = 'none'
      parent.append(copy)
      parent = copy
    }
    const holder = pre.cloneNode(true) as HTMLElement
    holder.removeAttribute('id')
    holder.style.visibility = 'hidden'
    const style = pre.getAttribute('style')
    pre.replaceWith(holder)
    Object.assign(pre.style, { position: 'absolute', margin: '0', boxSizing: 'border-box', left: px(at.left), top: px(at.top), width: px(at.width), height: px(at.height) })
    parent.append(pre)
    slide.after(layer)
    this.lifted = { layer, holder, style }
    return layer
  }

  /** The block's and its tokens' animations. Call after `lift`. */
  animate(options: KeyframeAnimationOptions): Animation[] {
    const pre = this.to
    const now = shoot(pre)
    const old = this.old
    const anims: Animation[] = []
    const box = (s: Shot) => ({ left: px(s.left), top: px(s.top), width: px(s.width), height: px(s.height) })
    anims.push(pre.animate([box(old), box(now)], options))

    const pairs = matchTokens(
      old.tokens.map((t) => t.text),
      now.tokens.map((t) => t.text),
    )
    const matched = new Map(pairs.map(([i, j]) => [j, i]))
    const gone = new Set(old.tokens.keys())
    for (const [i] of pairs) gone.delete(i)

    now.tokens.forEach((t, j) => {
      const i = matched.get(j)
      if (i === undefined) {
        anims.push(t.el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], options))
        return
      }
      const o = old.tokens[i]!
      if (Math.abs(o.x - t.x) < 0.5 && Math.abs(o.y - t.y) < 0.5) return
      anims.push(t.el.animate([{ transform: `translate(${px(o.x - t.x)}, ${px(o.y - t.y)})` }, { transform: 'none' }], options))
    })
    for (const i of gone) {
      const o = old.tokens[i]!
      const ghost = o.el.cloneNode(true) as HTMLElement
      ghost.dataset.blitzGhost = ''
      Object.assign(ghost.style, { position: 'absolute', left: px(o.x), top: px(o.y), margin: '0' })
      pre.append(ghost)
      this.ghosts.push(ghost)
      anims.push(ghost.animate([{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], options))
    }
    return anims
  }

  /** Put everything back where it belongs. */
  restore(): void {
    for (const g of this.ghosts.splice(0)) g.remove()
    restoreStyle(this.from, this.oldStyle)
    const l = this.lifted
    if (!l) return
    this.lifted = undefined
    l.holder.replaceWith(this.to)
    restoreStyle(this.to, l.style)
    l.layer.remove()
  }
}

/** A copy of an element without its children or id. */
function shallow(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(false) as HTMLElement
  copy.removeAttribute('id')
  return copy
}

function restoreStyle(el: HTMLElement, style: string | null) {
  if (style === null) el.removeAttribute('style')
  else el.setAttribute('style', style)
}
