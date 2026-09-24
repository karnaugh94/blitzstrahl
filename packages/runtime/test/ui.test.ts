import { describe, expect, it } from 'vitest'
import { findSlide } from '../src/ui.js'

const slides = [
  { id: 'intro', title: 'Welcome' },
  { id: 'q3', title: 'Q3 revenue' },
  { id: 'slide-3' },
  { id: 'wrap', title: 'Revenue, summed up' },
]

describe('go-to prompt matching', () => {
  it('numbers are 1-based and bounded', () => {
    expect(findSlide('2', slides)).toBe(1)
    expect(findSlide('0', slides)).toBeUndefined()
    expect(findSlide('5', slides)).toBeUndefined()
  })

  it('an exact id wins, with or without a #/ prefix', () => {
    expect(findSlide('wrap', slides)).toBe(3)
    expect(findSlide('#/q3', slides)).toBe(1)
  })

  it('then a title prefix, then a title substring, ignoring case', () => {
    expect(findSlide('rev', slides)).toBe(3)
    expect(findSlide('REVENUE', slides)).toBe(3)
    expect(findSlide('venue', slides)).toBe(1)
    expect(findSlide('zzz', slides)).toBeUndefined()
    expect(findSlide('  ', slides)).toBeUndefined()
  })
})
