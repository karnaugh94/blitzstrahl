/**
 * A headless Chromium for the commands that need a real browser (the
 * overflow check, PDF export, `check`), through playwright-core, which
 * never downloads browsers itself.
 */
type Chromium = typeof import('playwright-core').chromium
export type Browser = Awaited<ReturnType<Chromium['launch']>>

import { createRequire } from 'node:module'

/**
 * How to install the Chromium this playwright-core finds. Pinned: a plain
 * `npx playwright install` fetches the latest Playwright, whose Chromium
 * build ours may not look for.
 */
const PLAYWRIGHT = (createRequire(import.meta.url)('playwright-core/package.json') as { version: string }).version
export const INSTALL_BROWSER = `\`npx playwright@${PLAYWRIGHT} install chromium\``

export const NO_BROWSER = `no browser to run it in; install one with ${INSTALL_BROWSER}`

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
