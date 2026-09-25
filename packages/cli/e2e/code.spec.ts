/**
 * Code highlighting (syntax.md §8): colours come from the theme, and a code
 * block is content, not an interactive element.
 */
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { buildAndServe } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))
let url = ''
let server: Server

test.beforeAll(async () => {
  ;({ url, server } = await buildAndServe(join(here, 'fixtures/code.md')))
})

test.afterAll(() => server?.close())

test('tokens take the theme’s code colours', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  const colour = (text: string) => page.locator('#code span', { hasText: new RegExp(`^\\s*${text}$`) }).first().evaluate((e) => getComputedStyle(e).color)
  const token = (name: string) =>
    page.evaluate((n) => {
      const probe = document.createElement('span')
      probe.style.color = `var(--blitz-code-token-${n})`
      document.querySelector('.blitz-slide')!.append(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    }, name)
  expect(await colour('const')).toBe(await token('keyword'))
  expect(await colour('42')).toBe(await token('constant'))
  expect(await colour('the')).toBe(await token('comment'))
  expect(await token('keyword')).not.toBe(await token('comment'))
})

test('a code block in the edge gutter doesn’t stop a click from navigating', async ({ page }) => {
  await page.goto(url)
  await page.waitForFunction(() => window.blitz)
  const box = (await page.locator('#code').boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(1280 * 0.9)
  await page.mouse.click(1280 - 20, box.y + box.height / 2)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
})

test('`lines=` moves the focus one group per step, and the text after it comes next', async ({ page }) => {
  await page.goto(`${url}#/lines`)
  await page.waitForFunction(() => window.blitz)
  const lit = () =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#lines .line')].map((l) => Number(getComputedStyle(l).opacity) > 0.9))
  expect(await page.evaluate(() => window.blitz!.steps[2])).toBe(3)
  await expect.poll(lit).toEqual([true, false, false])
  await page.keyboard.press('ArrowRight')
  await expect.poll(lit).toEqual([false, true, true])
  await page.keyboard.press('ArrowRight')
  await expect.poll(lit).toEqual([true, true, true])
  await expect(page.getByText('After')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('After')).toBeVisible()
  // Backwards snaps straight to the earlier focus.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await lit()).toEqual([false, true, true])
})
