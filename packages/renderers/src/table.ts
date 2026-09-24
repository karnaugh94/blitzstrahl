/**
 * The `table` renderer: sortable GFM tables (syntax.md §8, `.sortable`).
 *
 * The table is authored HTML already in the page, so it reads without
 * JavaScript and in the overview. This enhances it in place: each header
 * becomes a button that cycles ascending → descending → as written. Rows
 * glide to their new places (FLIP), unless motion is reduced.
 *
 * Like every renderer, it's mounted on each slide entry and destroyed on
 * leaving, and `destroy` puts the table back as written, so a table always
 * starts a visit in its authored order.
 */
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'

type Direction = 'ascending' | 'descending'

const SUFFIX: Record<string, number> = { '%': 1, k: 1e3, K: 1e3, M: 1e6, B: 1e9, bn: 1e9 }
const NUMBER = /^([-+−]?)\s*[$€£¥]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(%|k|K|M|B|bn)?$/

/** A cell's numeric value (`1,200`, `-3.5%`, `$4.1M`), or undefined for text. */
export function cellNumber(text: string): number | undefined {
  const m = NUMBER.exec(text.trim().replace(/[   ]/g, ''))
  if (!m) return undefined
  const n = Number(m[2]!.replace(/,/g, '')) * (SUFFIX[m[3] ?? ''] ?? 1)
  return m[1] === '-' || m[1] === '−' ? -n : n
}

/**
 * Order of two cells, ascending: numbers by value and before text, text in
 * natural order (`item 2` before `item 10`). Empty cells go last in either
 * direction, so they're handled by the caller.
 */
export function compareCells(a: string, b: string): number {
  const x = cellNumber(a)
  const y = cellNumber(b)
  if (x !== undefined && y !== undefined) return x - y
  if (x !== undefined) return -1
  if (y !== undefined) return 1
  return a.trim().localeCompare(b.trim(), undefined, { numeric: true, sensitivity: 'base' })
}

/** Row order for a column and direction. Stable; empty cells last. */
export function sortedOrder(cells: readonly string[], dir: Direction): number[] {
  const idx = cells.map((_, i) => i)
  const empty = (i: number) => cells[i]!.trim() === ''
  return idx.sort((i, j) => {
    if (empty(i) || empty(j)) return Number(empty(i)) - Number(empty(j))
    const c = compareCells(cells[i]!, cells[j]!)
    return (dir === 'ascending' ? c : -c) || i - j
  })
}

const MOVE_MS = 380

const table: Renderer = {
  mount(el: HTMLElement, _spec: unknown, ctx: RenderCtx): RenderInstance {
    if (!(el instanceof HTMLTableElement)) throw new Error('`.sortable` applies to a table')
    const body = el.tBodies[0]
    const headers = [...(el.tHead?.rows[0]?.cells ?? [])]
    const noop: RenderInstance = { update() {}, resize() {}, destroy() {} }
    if (!body || !headers.length) return noop

    const doc = el.ownerDocument
    const authored = [...body.rows]
    let sorted: { col: number; dir: Direction } | undefined
    const moving: Animation[] = []

    const place = (rows: HTMLTableRowElement[]) => {
      moving.splice(0).forEach((a) => a.cancel())
      const animate = !ctx.reducedMotion && rows.some((r, i) => body.rows[i] !== r)
      // FLIP: remember where each row was, move them, then play from there.
      const before = animate ? new Map(rows.map((r) => [r, r.getBoundingClientRect().top])) : undefined
      body.append(...rows)
      if (!before) return
      // Rects are in screen pixels; the stage is scaled by a transform.
      const scale = el.getBoundingClientRect().height / (el.offsetHeight || 1) || 1
      for (const r of rows) {
        const dy = (before.get(r)! - r.getBoundingClientRect().top) / scale
        if (Math.abs(dy) < 0.5) continue
        moving.push(
          r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
            duration: MOVE_MS,
            easing: 'cubic-bezier(.2, .8, .2, 1)',
          }),
        )
      }
    }

    const sortBy = (col: number) => {
      const dir: Direction | undefined =
        sorted?.col !== col ? 'ascending' : sorted.dir === 'ascending' ? 'descending' : undefined
      sorted = dir && { col, dir }
      headers.forEach((th, i) => {
        if (i === col && dir) th.setAttribute('aria-sort', dir)
        else th.removeAttribute('aria-sort')
      })
      if (!dir) return place(authored)
      const cells = authored.map((r) => r.cells[col]?.textContent ?? '')
      place(sortedOrder(cells, dir).map((i) => authored[i]!))
    }

    const buttons = headers.map((th, col) => {
      const button = doc.createElement('button')
      button.type = 'button'
      button.className = 'blitz-sort'
      button.append(...th.childNodes)
      button.addEventListener('click', () => sortBy(col))
      th.append(button)
      return button
    })

    return {
      update() {},
      resize() {},
      destroy() {
        moving.splice(0).forEach((a) => a.cancel())
        body.append(...authored)
        headers.forEach((th, i) => {
          th.removeAttribute('aria-sort')
          th.replaceChildren(...buttons[i]!.childNodes)
        })
      },
    }
  },
}

export default table
