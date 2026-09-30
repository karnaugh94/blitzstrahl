/**
 * What a screen reader says for a chart or a map (syntax.md §8.2): the
 * author's `alt=` (on the block, as `aria-label`, from the parser), then a
 * description from the data, in the deck's language.
 */
import { fill, strings } from '@blitzstrahl/core/i18n'

type Words = ReturnType<typeof strings>['deck']['aria']

export function ariaWords(lang: string): Words {
  return strings(lang).deck.aria
}

/**
 * ECharts' `aria` option, its templates in our words: `alt`, the chart's
 * kind and title, its series, and their first values. `category` is the
 * dimension that holds a point's category (read out as its name, so not
 * again as a value).
 */
export function chartAria(words: Words, kind: string, alt: string | undefined, category?: number): Record<string, unknown> {
  const type = (words as Record<string, string>)[kind] ?? words.chart
  const lead = alt ? `${alt} ` : ''
  return {
    enabled: true,
    label: {
      general: { withTitle: lead + fill(words.titled, { type, title: '{title}' }), withoutTitle: lead + fill(words.untitled, { type }) },
      series: {
        maxCount: 8,
        single: { prefix: '', withName: ' {seriesName}:', withoutName: '' },
        multiple: { prefix: ' ' + fill(words.seriesCount, { count: '{seriesCount}' }), withName: ' {seriesName}:', withoutName: '', separator: { middle: '', end: '' } },
      },
      data: {
        maxCount: 8,
        allData: ' ',
        partialData: ' ' + fill(words.firstItems, { count: '{displayCnt}' }) + ' ',
        withName: '{name} {value}',
        withoutName: '{value}',
        separator: { middle: '; ', end: '.' },
        ...(category === undefined ? {} : { excludeDimensionId: [category] }),
      },
    },
  }
}

/** A map: `alt`, then its places by name (the first eight). */
export function mapLabel(words: Words, alt: string | undefined, names: string[]): string {
  const named = names.filter(Boolean)
  const shown = named.slice(0, 8).join(', ') + (named.length > 8 ? ', …' : '')
  const about = named.length ? `${words.map}. ${fill(words.places, { count: named.length, names: shown })}` : `${words.map}.`
  return alt ? `${alt} ${about}` : about
}

/**
 * Make `el` one image to a screen reader; the returned function puts back
 * what was there (renderers restore the DOM on `destroy`).
 */
export function asImage(el: HTMLElement): () => void {
  const role = el.getAttribute('role')
  const label = el.getAttribute('aria-label')
  el.setAttribute('role', 'img')
  return () => {
    if (role === null) el.removeAttribute('role')
    else el.setAttribute('role', role)
    if (label === null) el.removeAttribute('aria-label')
    else el.setAttribute('aria-label', label)
  }
}
