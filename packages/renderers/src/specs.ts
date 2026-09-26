/**
 * Checking a render block's spec without a browser, for `blitzstrahl check`
 * (PLAN §7): the same validation and data shaping the renderers do, minus
 * the drawing. No ECharts, no DOM.
 */
import { chartNotes, chartOption, validate as validateChart } from './chart-option.js'
import { parseData } from './data.js'
import { validate as validateEmbed } from './embed.js'
import { asFeatureCollection, markersFromRows, markersFromText, validate as validateMap } from './map-geo.js'
import { validate as validateMermaid } from './mermaid.js'

/** Text of a deck-relative data file, if it was found. */
export type ReadData = (path: string) => string | undefined

/**
 * What would go wrong rendering this block, as the renderer would say it;
 * undefined if nothing. Files that are missing are skipped here: they're
 * reported on their own.
 */
export function specProblem(renderer: string, spec: unknown, read: ReadData): string | undefined {
  try {
    switch (renderer) {
      case 'chart': {
        const s = validateChart(spec)
        if (typeof s.data === 'string') {
          const text = read(s.data)
          if (text === undefined) return undefined
          chartOption(s, parseData(s.data, text), { dur: 0, reducedMotion: true })
        } else chartOption(s, s.data, { dur: 0, reducedMotion: true })
        return undefined
      }
      case 'map': {
        const s = validateMap(spec)
        if (Array.isArray(s.markers)) markersFromRows(s.markers, s.label, s.size)
        else if (typeof s.markers === 'string') {
          const text = read(s.markers)
          if (text !== undefined) markersFromText(s.markers, text, s.label, s.size)
        }
        if (s.regions !== undefined) {
          const text = read(s.regions)
          if (text !== undefined) asFeatureCollection(JSON.parse(text), '`regions`')
        }
        return undefined
      }
      case 'embed':
        validateEmbed(spec)
        return undefined
      default:
        return undefined
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * What's worth knowing about a block that isn't a problem, as the renderer
 * would say it (info). Empty for a block with problems: those are reported
 * by `specProblem`.
 */
export function specNotes(renderer: string, spec: unknown, read: ReadData): string[] {
  if (renderer !== 'chart') return []
  try {
    const s = validateChart(spec)
    if (typeof s.data !== 'string') return chartNotes(s, s.data)
    const text = read(s.data)
    return text === undefined ? [] : chartNotes(s, parseData(s.data, text))
  } catch {
    return []
  }
}

/**
 * A Mermaid diagram's syntax error, as Mermaid's own parser reports it.
 * Some diagram types need a browser just to parse (they sanitise with
 * DOMPurify); anything that isn't a syntax error gets the benefit of the
 * doubt, since the slide itself will show it.
 */
export async function mermaidProblem(spec: unknown): Promise<string | undefined> {
  let source: string
  try {
    source = validateMermaid(spec)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  const { default: mermaid } = await import('mermaid')
  try {
    await mermaid.parse(source)
    return undefined
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/^(Parse|Lexical|Syntax) error|No diagram type detected/i.test(message)) return undefined
    // "Parse error on line 3:", the excerpt and caret, then "Expecting …, got 'EOF'".
    const lines = message.split('\n').filter((l) => l.trim())
    const first = lines[0]!.replace(/:$/, '')
    const last = lines.length > 1 ? lines[lines.length - 1]! : ''
    return last && last !== lines[0] ? `${first}: ${last.length > 160 ? `${last.slice(0, 157)}…` : last}` : first
  }
}

export { asFeatureCollection, isUrl, markersFromText, tileSource, type MapSpec } from './map-geo.js'
