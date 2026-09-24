/**
 * A headless Chromium for the commands that need a real browser (the
 * overflow check, PDF export, `check`), through playwright-core, which
 * never downloads browsers itself.
 */
type Chromium = typeof import('playwright-core').chromium
export type Browser = Awaited<ReturnType<Chromium['launch']>>

export const NO_BROWSER = 'no browser to run it in; install one with `npx playwright install chromium`'

/** Playwright's own Chromium if installed, else an installed Chrome or Edge. */
export async function launchBrowser(): Promise<Browser | undefined> {
  const { chromium } = await import('playwright-core')
  for (const opts of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch(opts)
    } catch {
      // try the next one
    }
  }
  return undefined
}
