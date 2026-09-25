import { describe, expect, it } from 'vitest'
import { matchTokens } from '../src/code-morph.js'

const words = (s: string) => s.split(' ')
const matched = (a: string, b: string) => matchTokens(words(a), words(b)).map(([i, j]) => `${words(a)[i]}${i}→${j}`)

describe('magic move token matching', () => {
  it('keeps the longest run of tokens in order', () => {
    expect(matched('add ( a , b )', 'add ( a : n , b : n )')).toEqual(['add0→0', '(1→1', 'a2→2', ',3→5', 'b4→6', ')5→9'])
  })

  it('pairs words that moved out of order, but not punctuation', () => {
    // Two lines swapped: LCS keeps one; the other's words still pair.
    expect(matched('x = 1 ; y = 2 ;', 'y = 2 ; x = 1 ;')).toEqual(['y4→0', '=5→1', '26→2', ';7→3', 'x0→4', '12→6'])
  })

  it('pairs nothing when nothing is shared', () => {
    expect(matchTokens(['a'], ['b'])).toEqual([])
    expect(matchTokens([], ['b'])).toEqual([])
  })
})
