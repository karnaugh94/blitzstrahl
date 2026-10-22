/**
 * Colour and font helpers shared by the PowerPoint readers: `theme import`
 * (import.ts) and presentations as decks (pptx.ts).
 */

export const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
export const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/** `a` moved toward `b` by `t` (0 is `a`, 1 is `b`). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return hex(x.map((v, i) => v + (y[i]! - v) * t))
}

/** WCAG contrast ratio of two colours. */
export function ratio(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

export function toHsl(c: string): [number, number, number] {
  const [r, g, b] = rgb(c).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

export function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) return hex([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p
  }
  return hex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255])
}

const SERIFS = /serif|times|georgia|garamond|cambria|palatino|book antiqua|baskerville|minion|caslon/i

/** A template font, named first, then a generic family like it. */
export function fontStack(family: string): string {
  const generic = /mono|courier|consol/i.test(family) ? 'monospace' : SERIFS.test(family) && !/sans/i.test(family) ? 'serif' : 'system-ui, sans-serif'
  return `${JSON.stringify(family)}, ${generic}`
}
