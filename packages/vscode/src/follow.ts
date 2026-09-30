/**
 * The preview's two readings of `blitzstrahl dev`: the address it printed,
 * and the slide an editor line is in (`/_blitz/slides`). Pure: no VS Code.
 */

export interface Slide {
  id: string
  /** 1-based: the line after the `---` above it. */
  line: number
}

/** The slide a 0-based editor line is in: the last one starting at or before it. */
export function slideAt(slides: readonly Slide[], line: number): Slide | undefined {
  let found = slides[0]
  for (const s of slides) if (s.line - 1 <= line) found = s
  return found
}

/** The address `dev` prints (`Local:   http://localhost:5173/`), from its output so far. */
export function devUrl(output: string): string | undefined {
  return /Local:\s+(http:\/\/\S+)/.exec(output.replace(/\x1b\[[0-9;]*m/g, ''))?.[1]
}
