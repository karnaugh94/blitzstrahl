import { describe, expect, it } from 'vitest'
import { calendarDate } from '../src/export.js'

describe('calendarDate: the deck date as a PDF creation date', () => {
  it('reads an ISO calendar date, as that day in UTC', () => {
    expect(calendarDate('2026-10-14')?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(calendarDate(' 2026-10-14 ')?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
  })

  it('leaves free-form text and impossible days alone', () => {
    for (const text of [undefined, '', 'Autumn 2026', '14 October 2026', '2026-10', '2026-02-30', '2026-13-01']) {
      expect(calendarDate(text)).toBeUndefined()
    }
  })
})
