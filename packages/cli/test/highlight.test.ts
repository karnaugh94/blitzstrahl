import type { Element } from 'hast'
import { describe, expect, it } from 'vitest'
import { parseDeck } from '@blitzstrahl/core'
import { highlightDeck } from '../src/highlight.js'

const md = [
  '# Code',
  '',
  '```ts {.big @1}',
  'const x: number = 1 // one',
  '```',
  '',
  '```nosuchlang',
  'plain',
  '```',
  '',
  '```text',
  'also plain',
  '```',
  '',
  '::: notes',
  '```js',
  'go()',
  '```',
  ':::',
].join('\n')

const pres = (nodes: unknown[]): Element[] =>
  (nodes as Element[]).flatMap((n) => (n.type !== 'element' ? [] : n.tagName === 'pre' ? [n] : pres(n.children)))

describe('code highlighting', () => {
  it('colours tokens with theme variables, keeping the <pre> as the deck wrote it', async () => {
    const { deck } = parseDeck(md, { file: 'deck.md' })
    const diags = await highlightDeck(deck, md)
    const [ts, other, text] = pres(deck.slides[0]!.content)
    expect(ts!.properties).toMatchObject({ dataBlitzStepIn: 1, className: ['big'] })
    expect(ts!.properties.tabIndex).toBeUndefined()
    const html = JSON.stringify(ts)
    expect(html).toContain('var(--blitz-code-token-keyword)')
    expect(html).toContain('var(--blitz-code-token-comment)')
    expect(JSON.stringify(other)).not.toContain('--blitz-code')
    expect(JSON.stringify(text)).not.toContain('--blitz-code')
    expect(JSON.stringify(deck.slides[0]!.notes)).toContain('var(--blitz-code-token-function)')
    expect(diags).toEqual([
      expect.objectContaining({ code: 'code/unknown-language', span: { start: { line: 7, column: 1 }, end: { line: 7, column: 1 } } }),
    ])
  })

  it('keeps the text exactly', async () => {
    const src = '```py\nif a < b:\n    print("<&>")\n```'
    const { deck } = parseDeck(src)
    await highlightDeck(deck, src)
    const text = (n: unknown): string => {
      const e = n as { type: string; value?: string; children?: unknown[] }
      return e.type === 'text' ? e.value! : (e.children ?? []).map(text).join('')
    }
    expect(text(pres(deck.slides[0]!.content)[0])).toBe('if a < b:\n    print("<&>")')
  })
})
