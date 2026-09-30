/**
 * `count-up` reads its numeral the way the element's language writes
 * numbers, and counts in its style (PLAN D3′): a German `4,2 %` goes through
 * `2,1 %`, never `21 %` (1.0 counted to 42 and snapped back to 4,2). In an
 * English deck, `4,2` isn't a number, so it doesn't count.
 */
import { expect, test } from '@playwright/test'
import { buildAndServe } from './serve.js'

test('count-up counts in the way each language writes numbers', async ({ page }) => {
  const { url, server } = await buildAndServe('packages/cli/e2e/fixtures/count-up.md')
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    await page.keyboard.press('ArrowRight')
    // Stop every count at half time and let one frame draw it.
    const halfway = await page.evaluate(async () => {
      const ids = ['de', 'dots', 'en', 'fr', 'neg', 'comma-in-en']
      for (const id of ids) {
        for (const a of document.getElementById(id)!.getAnimations()) {
          a.pause()
          a.currentTime = 500
        }
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)!.textContent]))
    })
    expect(halfway).toEqual({
      de: '2,1 %',
      dots: '617.284 Menschen',
      en: '$617.25',
      fr: '5 697 visites',
      neg: '−1,8 °C',
      'comma-in-en': '4,2 %',
    })
    // And each lands exactly on what the author wrote.
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
    await expect(page.locator('#de')).toHaveText('4,2 %')
    await expect(page.locator('#dots')).toHaveText('1.234.567 Menschen')
    await expect(page.locator('#neg')).toHaveText('−3,5 °C')
  } finally {
    server.close()
  }
})
