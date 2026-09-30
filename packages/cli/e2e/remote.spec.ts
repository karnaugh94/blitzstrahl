/**
 * `blitzstrahl present` and the phone remote (M12.6). The deck runs in one
 * browser context on this machine; the "phone" in another, reaching the
 * server by this machine's network address, so the server sees it as the
 * network does. Skipped where the machine has no network address.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { present, type Presenting } from '../dist/index.js'
import { lanAddresses } from '../dist/present.js'

const here = dirname(fileURLToPath(import.meta.url))
const lan = lanAddresses()[0]
test.skip(!lan, 'no network address to reach the server by')

let p: Presenting

test.beforeEach(async () => {
  const r = await present(join(here, 'fixtures/presenter.md'), { port: 0, open: false, quiet: true })
  if (!r.ok) throw new Error('present failed')
  p = r
})

test.afterEach(async () => {
  await p?.close()
})

const pos = (page: Page) => page.evaluate(() => window.blitz?.pos)

async function openDeck(browser: Browser) {
  const deck = await (await browser.newContext()).newPage()
  await deck.goto(p.url)
  await deck.waitForFunction(() => window.blitz)
  return deck
}

/** A phone: its own browser context, by the network address. */
async function openPhone(browser: Browser, url = p.pair(lan).url) {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage()
  await phone.goto(url)
  return phone
}

test('a paired phone drives the deck and follows it: position, notes, timer', async ({ browser }) => {
  const deck = await openDeck(browser)
  const phone = await openPhone(browser)
  // The pairing lives in the fragment, not in a cookie.
  expect(new URL(phone.url()).hash).toMatch(/^#s=[\w-]{20,}$/)
  expect(await phone.context().cookies()).toEqual([])

  await expect(phone.locator('.br-position')).toHaveText('Slide 1 of 4')
  await expect(phone.locator('.br-title')).toHaveText('Opening')
  await expect(phone.locator('.br-notes')).toContainText('Say hello. Opening notes.')
  await phone.getByRole('button', { name: 'Next' }).click()
  await expect.poll(() => pos(deck)).toEqual({ slide: 1, step: 0 })
  await expect(phone.locator('.br-position')).toHaveText('Slide 2 of 4 · Step 0 of 2')
  await expect(phone.locator('.br-notes')).toContainText('Two builds on this slide.')
  // The timer started at the first move, with a phone there, as with the presenter view.
  await expect.poll(() => deck.evaluate(() => window.blitz!.presenter!.timer.running)).toBe(true)

  // The deck's own keys reach the phone.
  await deck.keyboard.press('End')
  await expect(phone.locator('.br-position')).toHaveText('Slide 4 of 4')
  await expect(phone.getByRole('button', { name: 'Next' })).toBeDisabled()
  await phone.getByRole('button', { name: 'Previous' }).click()
  await expect.poll(() => pos(deck)).toEqual({ slide: 2, step: 0 })

  // Pausing from the phone pauses the deck's timer.
  await phone.getByRole('button', { name: 'Start or pause the timer' }).click()
  await expect.poll(() => deck.evaluate(() => window.blitz!.presenter!.timer.running)).toBe(false)
  await expect(phone.locator('.br-toggle')).toHaveText('Start')

  // A swipe to the left is next.
  const box = (await phone.locator('.br-notes').boundingBox())!
  await phone.mouse.move(box.x + box.width - 20, box.y + 40)
  await phone.mouse.down()
  await phone.mouse.move(box.x + 20, box.y + 50, { steps: 5 })
  await phone.mouse.up()
  await expect.poll(() => pos(deck)).toEqual({ slide: 3, step: 0 })

  // A reload keeps the pairing.
  await phone.reload()
  await expect(phone.locator('.br-position')).toHaveText('Slide 4 of 4')
  await expect(phone.locator('.br-banner')).toBeHidden()
})

test('the network gets nothing but the remote: a wrong or used code is refused', async ({ browser }) => {
  const deck = await openDeck(browser)
  const code = p.pair(lan).url
  const origin = new URL(code).origin
  const net = await (await browser.newContext()).newPage()
  // Not the deck, not its files, not the relay's deck end.
  for (const path of ['/', '/index.html', '/_blitz/remote/deck', '/_blitz/remote/deck/events', '/_blitz/remote/events?s=nope']) {
    expect((await net.request.get(origin + path)).status(), path).toBe(403)
  }
  expect((await net.request.post(origin + '/_blitz/remote/pair', { headers: { 'x-blitz': '1' } })).status()).toBe(403)
  expect((await net.request.post(origin + '/_blitz/remote/send', { headers: { 'x-blitz': '1', 'x-blitz-session': 'nope' }, data: { blitz: 'blitzstrahl/presenter@1', type: 'advance' } })).status()).toBe(403)

  // A wrong code: the remote says it isn't paired, and can do nothing.
  const wrong = await openPhone(browser, `${origin}/r/wrong-code`)
  await expect(wrong.locator('.br-banner')).toContainText('isn’t paired')
  await expect(wrong.getByRole('button', { name: 'Next' })).toBeDisabled()

  // The right code pairs once; used again, it's refused.
  const phone = await openPhone(browser, code)
  await expect(phone.locator('.br-position')).toHaveText('Slide 1 of 4')
  const again = await openPhone(browser, code)
  await expect(again.locator('.br-banner')).toContainText('isn’t paired')
  expect(await pos(deck)).toEqual({ slide: 0, step: 0 })
})

test('a phone can only turn slides and start or pause the timer', async ({ browser }) => {
  const deck = await openDeck(browser)
  const phone = await openPhone(browser)
  await expect(phone.locator('.br-position')).toHaveText('Slide 1 of 4')
  const session = new URLSearchParams(new URL(phone.url()).hash.slice(1)).get('s')!
  const sent = (msg: object) =>
    phone.evaluate(
      ([m, s]) => fetch('/_blitz/remote/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1', 'x-blitz-session': s }, body: JSON.stringify({ blitz: 'blitzstrahl/presenter@1', ...m }) }).then((r) => r.status),
      [msg, session] as const,
    )
  for (const m of [{ type: 'goto', slide: 3, step: 0 }, { type: 'blackout', on: true }, { type: 'timer', action: 'reset' }, { type: 'ink', event: { op: 'clear', slide: 0 } }, { type: 'state', slide: 2, step: 0, blackout: true, timer: { running: false, elapsed: 0 } }]) {
    expect(await sent(m)).toBe(204)
  }
  expect(await sent({ type: 'advance' })).toBe(204)
  await expect.poll(() => pos(deck)).toEqual({ slide: 1, step: 0 })
  // Only the advance did anything.
  expect(await deck.evaluate(() => window.blitz!.blackout)).toBe(false)
  // Without our header (a form on another site can't send one), nothing at all.
  expect(await phone.evaluate((s) => fetch('/_blitz/remote/send', { method: 'POST', headers: { 'x-blitz-session': s }, body: '{}' }).then((r) => r.status), session)).toBe(403)
})

test('Remote in the presenter view pairs a new phone, and the old one is let go', async ({ browser }) => {
  const deck = await openDeck(browser)
  const first = await openPhone(browser)
  await expect(first.locator('.br-position')).toHaveText('Slide 1 of 4')

  const [presenter] = await Promise.all([deck.context().waitForEvent('page'), deck.keyboard.press('p')])
  await expect(presenter.locator('.bp-status')).toHaveText('Connected')
  await presenter.getByRole('button', { name: 'Pair a phone as the remote' }).click()
  const dialog = presenter.getByRole('dialog', { name: 'Pair a phone as the remote' })
  await expect(dialog.getByRole('img', { name: 'QR code for the remote' })).toBeVisible()
  const text = (await dialog.locator('p').first().textContent())!
  const url = /(http:\/\/\S+\/r\/[\w-]+)/.exec(text)![1]!
  expect(url).toContain(`:${p.port}/r/`)

  // The QR code's address, by the network address the test can reach.
  const second = await openPhone(browser, url.replace(/\/\/[^/]+/, `//${lan}:${p.port}`))
  await expect(second.locator('.br-position')).toHaveText('Slide 1 of 4')
  await expect(first.locator('.br-banner')).toContainText('isn’t answering', { timeout: 15_000 })
  await second.getByRole('button', { name: 'Next' }).click()
  await expect.poll(() => pos(deck)).toEqual({ slide: 1, step: 0 })
})

test('when present stops, the phone says so', async ({ browser }) => {
  await openDeck(browser)
  const phone = await openPhone(browser)
  await expect(phone.locator('.br-position')).toHaveText('Slide 1 of 4')
  await p.close()
  await expect(phone.locator('.br-banner')).toContainText('isn’t answering', { timeout: 15_000 })
})
