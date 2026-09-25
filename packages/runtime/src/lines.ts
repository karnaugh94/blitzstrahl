/**
 * `lines=` on a code block (syntax.md §8.1): at each step, one group of
 * lines is in focus and the rest are dimmed. The groups and their steps
 * come resolved from the parser, as JSON in `data-blitz-lines`.
 */

interface LineStep {
  in: number
  /** Inclusive, 1-based ranges; `null` means every line. */
  lines: Array<[number, number]> | null
}

/** Mark the lines in focus at `step`. Styling is the runtime CSS's. */
export function focusLines(pre: HTMLElement, step: number): void {
  let steps: LineStep[]
  try {
    steps = JSON.parse(pre.dataset.blitzLines ?? '[]') as LineStep[]
  } catch {
    return
  }
  const group = steps.filter((s) => s.in <= step).at(-1)?.lines ?? null
  if (group) pre.dataset.blitzLinesOn = ''
  else delete pre.dataset.blitzLinesOn
  pre.querySelectorAll<HTMLElement>('.line').forEach((line, i) => {
    const n = i + 1
    if (group?.some(([a, b]) => n >= a && n <= b)) line.dataset.blitzFocus = ''
    else delete line.dataset.blitzFocus
  })
}
