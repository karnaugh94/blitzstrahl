/**
 * Pacing and notes in the presenter view (presenting.md, *Pacing*; M12.1–2).
 * The timer lives in the deck; tests set it there, as a paused time, rather
 * than wait for minutes to pass.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/pacing.md')))
})

test.afterAll(() => server?.close())

const MIN = 60_000

async function openBoth(page: Page) {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await presenter.waitForLoadState()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  return presenter
}

/** Stop the deck's timer at `ms` and tell the presenter at once (not at the next heartbeat). */
async function setTimer(page: Page, ms: number) {
  await page.evaluate((elapsed) => {
    const bridge = window.blitz!.presenter! as unknown as { timer: object; broadcast(): void }
    bridge.timer = { running: false, elapsed }
    bridge.broadcast()
  }, ms)
}

test('with a duration, the timer counts down and the bar shows the pace', async ({ page }) => {
  const presenter = await openBoth(page)
  const bar = presenter.locator('.bp-pace')
  await expect(presenter.locator('.bp-elapsed')).toHaveText('04:00')
  await expect(bar).toBeVisible()

  // 20 s behind: within the deck's `pace-margin` (30 s), though past the default 5 % (12 s).
  await setTimer(page, 20_000)
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'ok')

  // Slide 1 of 4, one minute into four: a minute behind.
  await setTimer(page, 1 * MIN)
  await expect(presenter.locator('.bp-elapsed')).toHaveText('03:00')
  await expect(presenter.locator('.bp-elapsed-sub')).toHaveText('01:00 elapsed')
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'behind')
  await expect(bar).toHaveAttribute('aria-label', 'Behind by 01:00')
  await expect(presenter.locator('.bp-elapsed')).toHaveCSS('color', 'rgb(255, 194, 75)')

  // Slide 3 after a minute: ahead, which is fine.
  await presenter.keyboard.press('ArrowRight')
  await presenter.keyboard.press('ArrowRight')
  await setTimer(page, 1 * MIN)
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'ok')
  await expect(bar).toHaveAttribute('aria-label', 'On pace')
  // The fill is how far through the deck (half), the mark where the clock is (a quarter).
  const width = (sel: string) => presenter.locator(sel).evaluate((e) => e.getBoundingClientRect())
  const [track, fill, mark] = await Promise.all([width('.bp-pace'), width('.bp-pace-fill'), width('.bp-pace-mark')])
  expect(fill.width / track.width).toBeCloseTo(0.5, 2)
  expect((mark.left + mark.width / 2 - track.left) / track.width).toBeCloseTo(0.25, 1)

  // Past the end: red, counting up.
  await setTimer(page, 5 * MIN)
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'over')
  await expect(presenter.locator('.bp-elapsed')).toHaveText('+01:00')
  await expect(bar).toHaveAttribute('aria-label', 'Over time by 01:00')
  await expect(presenter.locator('.bp-elapsed')).toHaveCSS('color', 'rgb(255, 122, 147)')
})

test('a rehearsal times each slide, is kept, and weighs the pace', async ({ page }) => {
  const presenter = await openBoth(page)
  await presenter.getByRole('button', { name: /^Time each slide/ }).click()
  await expect(presenter.getByRole('button', { name: /^Time each slide/ })).toHaveAttribute('aria-pressed', 'true')
  // It started the deck's timer from zero.
  await expect.poll(() => page.evaluate(() => window.blitz!.presenter!.timer.running)).toBe(true)
  await setTimer(page, 0)
  await expect(presenter.locator('.bp-elapsed-sub')).toHaveText('00:00 elapsed')
  await setTimer(page, 3 * MIN)
  await expect(presenter.locator('.bp-slide-time')).toHaveText('This slide 03:00')
  await presenter.keyboard.press('ArrowRight')
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4')
  await setTimer(page, 3.5 * MIN)
  await expect(presenter.locator('.bp-elapsed-sub')).toHaveText('03:30 elapsed')
  await presenter.getByRole('button', { name: /^Time each slide/ }).click()

  const stored = await presenter.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('blitzstrahl:rehearsal:')))
  expect(stored).toHaveLength(1)
  expect(JSON.parse(stored[0]![1])).toEqual({ one: 3 * MIN, two: 0.5 * MIN })
  // Both windows share the origin's storage: all of it is the presenter's. And no cookies.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => !/^blitzstrahl:(rehearsal:|notes-size$)/.test(k)))).toEqual([])
  expect(await page.context().cookies()).toEqual([])

  // Kept across a reload; shown beside the slide and in the grid.
  await presenter.reload()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await expect(presenter.locator('.bp-slide-time')).toContainText('rehearsed 00:30')
  await presenter.keyboard.press('o')
  await expect(presenter.locator('.blitz-thumb').nth(0)).toHaveAttribute('aria-label', '1. One (Notes, 03:00)')
  await expect(presenter.locator('.blitz-thumb').nth(1)).toHaveAttribute('aria-label', '2. Two (00:30)')
  await expect(presenter.locator('.blitz-thumb').nth(1).locator('.blitz-thumb-mark')).toHaveText(['00:30'])
  await expect(presenter.locator('.blitz-thumb').nth(3)).toHaveAttribute('aria-label', '4. Four')
  await presenter.keyboard.press('Escape')

  // Rehearsed: 3:00 and 0:30, and the two slides not rehearsed get the average,
  // 1:45 each. Slide 1 is 3 of those 7 minutes: reaching slide 2 is on pace
  // 1:43 into a 4-minute talk, where an even share would be 0:48 behind.
  await setTimer(page, 1.7 * MIN)
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'ok')

  await presenter.getByRole('button', { name: 'Forget the rehearsed times' }).click()
  await expect(presenter.locator('.bp')).toHaveAttribute('data-pace', 'behind')
  await expect(presenter.getByRole('button', { name: 'Forget the rehearsed times' })).toBeHidden()
  expect(await presenter.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('blitzstrahl:rehearsal:')))).toEqual([])
})

test('J and K scroll the notes; the arrows still turn slides; a new slide starts at the top', async ({ page }) => {
  const presenter = await openBoth(page)
  const notes = presenter.locator('.bp-notes')
  const top = () => notes.evaluate((e) => e.scrollTop)
  await expect(notes).toContainText('Opening notes.')
  await presenter.keyboard.press('j')
  await presenter.keyboard.press('j')
  await expect.poll(top).toBeGreaterThan(0)
  const after = await top()
  // The heartbeat re-renders the view; it mustn't scroll the notes back.
  await presenter.waitForTimeout(2000)
  expect(await top()).toBe(after)
  await presenter.keyboard.press('k')
  await expect.poll(top).toBeLessThan(after)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 0, step: 0 })

  await presenter.keyboard.press('j')
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
  await presenter.keyboard.press('ArrowRight')
  await expect(notes).toContainText("Three's notes.")
  expect(await top()).toBe(0)
})

test('without a duration there is no countdown and no pace bar', async ({ page }) => {
  const plain = await buildAndServe(join(here, 'fixtures/presenter.md'))
  try {
    await page.goto(plain.url)
    await page.waitForFunction(() => window.blitz)
    const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
    await expect(presenter.locator('.bp-status')).toHaveText('Connected')
    await expect(presenter.locator('.bp-elapsed')).toHaveText('00:00')
    await expect(presenter.locator('.bp-pace')).toBeHidden()
    await expect(presenter.locator('.bp-elapsed-sub')).toBeHidden()
  } finally {
    plain.server.close()
  }
})
