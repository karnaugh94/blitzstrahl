import { describe, expect, it } from 'vitest'
import { IR_VERSION, type Deck } from '../src/index.js'

describe('Deck IR', () => {
  it('is at version 1', () => {
    expect(IR_VERSION).toBe(1)
  })

  it('accepts a minimal deck', () => {
    const deck: Deck = {
      irVersion: IR_VERSION,
      source: 'deck.md',
      meta: {
        title: 'Empty',
        lang: 'en',
        theme: 'aurora',
        canvas: { width: 1280, height: 720 },
        transition: { name: 'fade' },
        extra: {},
      },
      slides: [],
      assets: [],
    }
    expect(deck.slides).toHaveLength(0)
  })
})
