/**
 * Presenter mode (PLAN §4), driven across two real windows: the deck and the
 * presenter popup it spawns (or that spawns it). The deck is authoritative:
 * the presenter only sends intents.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/presenter.md')))
})

test.afterAll(() => server?.close())

const pos = (page: Page | Frame) => page.evaluate(() => window.blitz?.pos)

/** Open the deck and press P; resolves to the presenter window. */
async function openBoth(page: Page, hash = '') {
  await page.goto(url + hash)
  await page.waitForFunction(() => window.blitz)
  const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
  await presenter.waitForLoadState()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  return presenter
}

/** The presenter's mirror iframes. */
const mirror = (presenter: Page, title: 'Current slide' | 'Next slide') => {
  const frame = presenter.frame({ url: title === 'Current slide' ? /#mirror$/ : /#mirror-still$/ })
  if (!frame) throw new Error(`no ${title} mirror`)
  return frame
}

test('P opens the presenter: notes, position, and live current/next mirrors', async ({ page }) => {
  const presenter = await openBoth(page)
  await expect(presenter).toHaveTitle('Presenter · Presenter fixture')
  await expect(presenter.locator('.bp-notes')).toContainText('Say hello. Opening notes.')
  await expect(presenter.locator('.bp-notes strong')).toHaveText('hello')
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 1 of 4')
  await expect.poll(() => pos(mirror(presenter, 'Current slide'))).toEqual({ slide: 0, step: 0 })
  await expect.poll(() => pos(mirror(presenter, 'Next slide'))).toEqual({ slide: 1, step: 0 })
  await expect(presenter.locator('.bp-next h2')).toHaveText('Next: Steps')

  // The audience never renders notes.
  await expect(page.getByText('Opening notes')).toHaveCount(0)
  // P again brings the same window forward: no second window, no reload.
  await presenter.evaluate(() => ((window as { stillHere?: boolean }).stillHere = true))
  await page.keyboard.press('p')
  await page.waitForTimeout(300)
  expect(page.context().pages()).toHaveLength(2)
  expect(await presenter.evaluate(() => (window as { stillHere?: boolean }).stillHere)).toBe(true)
})

test('presenter keys drive the deck; the deck drives the presenter', async ({ page }) => {
  const presenter = await openBoth(page)
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 0 })
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 0 of 2')
  await expect(presenter.locator('.bp-next h2')).toHaveText('Next: step 1 of 2')
  await expect.poll(() => pos(mirror(presenter, 'Next slide'))).toEqual({ slide: 1, step: 1 })
  await expect(presenter.locator('.bp-notes')).toContainText('Two builds on this slide.')

  // The next preview shows its state settled, with no motion.
  expect(await mirror(presenter, 'Next slide').evaluate(() => document.getAnimations().length)).toBe(0)

  await page.keyboard.press('ArrowRight')
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 1 of 2')
  await expect.poll(() => pos(mirror(presenter, 'Current slide'))).toEqual({ slide: 1, step: 1 })
  // The current one plays the step's effect, as the audience sees it.
  expect(await mirror(presenter, 'Current slide').evaluate(() => document.getAnimations().length)).toBeGreaterThan(0)

  await presenter.keyboard.press('End')
  await expect.poll(() => pos(page)).toEqual({ slide: 3, step: 0 })
  await expect(presenter.locator('.bp-next h2')).toHaveText('End of deck')

  await presenter.keyboard.press('ArrowLeft')
  await expect.poll(() => pos(page)).toEqual({ slide: 2, step: 0 })
  await expect(presenter.locator('.bp-notes')).toContainText('No notes for this slide.')
})

test('blackout, the slide grid and go-to work from the presenter', async ({ page }) => {
  const presenter = await openBoth(page)
  await presenter.getByRole('button', { name: 'Black out the audience screen (B)' }).click()
  await expect.poll(() => page.evaluate(() => window.blitz!.blackout)).toBe(true)
  await expect(presenter.locator('.bp-black')).toBeVisible()
  await presenter.keyboard.press('b')
  await expect.poll(() => page.evaluate(() => window.blitz!.blackout)).toBe(false)

  await presenter.keyboard.press('Escape')
  await presenter.getByRole('option', { name: '3. Quiet slide' }).click()
  await expect.poll(() => pos(page)).toEqual({ slide: 2, step: 0 })

  await presenter.keyboard.press('g')
  await presenter.keyboard.type('clos')
  await presenter.keyboard.press('Enter')
  await expect.poll(() => pos(page)).toEqual({ slide: 3, step: 0 })
})

test('the timer lives in the deck: it starts on the first move and survives a presenter reload', async ({ page }) => {
  const presenter = await openBoth(page)
  const timer = () => page.evaluate(() => window.blitz!.presenter!.timer)
  expect((await timer()).running).toBe(false)
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(async () => (await timer()).running).toBe(true)

  await presenter.getByRole('button', { name: 'Start or pause the timer' }).click()
  await expect.poll(async () => (await timer()).running).toBe(false)
  const paused = (await timer()).elapsed
  expect(paused).toBeGreaterThan(0)

  await presenter.reload()
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 0 of 2')
  expect((await timer()).elapsed).toBe(paused)

  await presenter.getByRole('button', { name: 'Reset the timer' }).click()
  await expect.poll(async () => (await timer()).elapsed).toBe(0)
  await expect(presenter.locator('.bp-elapsed')).toHaveText('00:00')
})

test('a first step (not only a slide change) starts the timer', async ({ page }) => {
  const presenter = await openBoth(page, '#/steps')
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.blitz!.presenter!.timer.running)).toBe(true)
})

test('reloading the deck reconnects the presenter', async ({ page }) => {
  const presenter = await openBoth(page, '#/steps/1')
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 1 of 2')
  await page.reload()
  await page.waitForFunction(() => window.blitz)
  // The reloaded deck lost its handle; the presenter's heartbeat re-adopts it.
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => pos(page)).toEqual({ slide: 1, step: 2 })
  await expect(presenter.locator('.bp-position')).toHaveText('Slide 2 of 4 · Step 2 of 2')
})

test('#presenter opened on its own says so, and can open the audience window', async ({ page }) => {
  await page.goto(url + '#presenter')
  await expect(page.locator('.bp-status')).toHaveText('No audience window')
  await expect(page.locator('.bp-connect')).toBeVisible()
  const [audience] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: 'Open audience window' }).click()])
  await audience.waitForFunction(() => window.blitz)
  await expect(page.locator('.bp-status')).toHaveText('Connected')
  await expect(page.locator('.bp-connect')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => pos(audience)).toEqual({ slide: 1, step: 0 })
})

test('closing the audience window is noticed', async ({ page }) => {
  const presenter = await openBoth(page)
  await page.close()
  await expect(presenter.locator('.bp-status')).toHaveText('No audience window')
})
