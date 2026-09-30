/**
 * Which markdown is a deck (README, *Which files are decks*): the deck
 * frontmatter's `blitzstrahl:` line, and nothing else. Pure: no VS Code.
 */

const OPEN = /^﻿?---[ \t]*$/
const CLOSE = /^(---|\.\.\.)[ \t]*$/
const MARKER = /^blitzstrahl[ \t]*:/

/** The deck frontmatter's lines, 0-based: `[first, closing)`, or undefined if there is none. */
export function frontmatterLines(lines: readonly string[]): [number, number] | undefined {
  if (!OPEN.test(lines[0] ?? '')) return undefined
  for (let i = 1; i < lines.length; i++) if (CLOSE.test(lines[i]!)) return [1, i]
  return undefined
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Whether the text is a blitzstrahl deck: its frontmatter says `blitzstrahl:`. */
export function isDeck(text: string): boolean {
  const lines = splitLines(text.slice(0, 64 * 1024))
  const fm = frontmatterLines(lines)
  return !!fm && lines.slice(fm[0], fm[1]).some((l) => MARKER.test(l))
}

/**
 * Where to put `blitzstrahl: 1.1`, and what: the first line of an existing
 * frontmatter, or a new frontmatter at the top.
 */
export function markerEdit(text: string, version: string): { line: number; insert: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const line = `blitzstrahl: ${majorMinor(version)}`
  return frontmatterLines(splitLines(text)) ? { line: 1, insert: line + eol } : { line: 0, insert: `---${eol}${line}${eol}---${eol}${eol}` }
}

/** `1.1.0-rc.2` → `1.1`. */
export function majorMinor(version: string): string {
  return version.split(/[.-]/).slice(0, 2).join('.')
}
