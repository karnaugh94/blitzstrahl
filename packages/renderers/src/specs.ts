/**
 * Checking a render block's spec without a browser, for `blitzstrahl check`
 * (PLAN §7): the same validation and data shaping the renderers do, minus
 * the drawing. No ECharts, no DOM.
 */
import { chartOption, validate as validateChart } from './chart-option.js'
import { parseData } from './data.js'
import { validate as validateEmbed } from './embed.js'
import { asFeatureCollection, markersFromGeoJson, markersFromRows, validate as validateMap } from './map-geo.js'

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
          if (text !== undefined) {
            if (/\.(geo)?json$/i.test(s.markers)) markersFromGeoJson(asFeatureCollection(JSON.parse(text), '`markers`'), s.label, s.size)
            else markersFromRows(parseData(s.markers, text), s.label, s.size)
          }
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
