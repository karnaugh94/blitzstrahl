import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { themes } from '@blitzstrahl/themes'
import { renderPage } from '../src/html.js'

const page = (md: string) =>
  renderPage({ deck: parseDeck(md).deck, inline: {}, assetUrl: (p) => p, theme: themes.aurora!, entry: { code: '' } })

describe('the page', () => {
  it("carries the deck's author as <meta name=\"author\">, escaped", () => {
    expect(page('---\nauthor: Ada "Countess" Lovelace & co\n---\n\n# S\n')).toContain('<meta name="author" content="Ada &quot;Countess&quot; Lovelace &amp; co">')
    expect(page('# S\n')).not.toContain('name="author"')
  })
})
