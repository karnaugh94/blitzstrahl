/**
 * The dev server's diagnostics on the page (PLAN §15, M8.1; docs/cli.md
 * `dev`): a panel listing the deck's errors and warnings at file:line:col,
 * each opening the editor there, and a banner while the deck has errors.
 * Only the dev server's entry imports it, so it's never in a build, and
 * only the deck itself shows it: not the presenter's previews (mirrors).
 */
import type { Diagnostic } from '@blitzstrahl/core'
import { fill } from '@blitzstrahl/core/i18n'
import { pageMode } from './presenter/protocol.js'
import { uiWords } from './ui.js'

/** Opens a diagnostic's place in the author's editor (the dev server's entry wires it). */
export type OpenInEditor = (d: Diagnostic) => void

const CSS = `
.blitz-dev-banner {
  position: fixed; left: 0; right: 0; top: 0; z-index: 46; padding: 6px 12px; text-align: center;
  font: 600 13px/1.4 system-ui, sans-serif; color: #fff; background: #c2183f; pointer-events: none;
}
html[data-blitz-dev-errors] .blitz-overflow-badge { top: 44px; }
.blitz-dev-panel {
  position: fixed; left: 12px; bottom: 12px; z-index: 45; max-width: min(720px, calc(100vw - 24px));
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  font: 13px/1.4 system-ui, sans-serif; color: #fff;
}
.blitz-dev-panel[hidden], .blitz-dev-banner[hidden], .blitz-dev-list[hidden] { display: none; }
.blitz-dev-toggle {
  font: 600 13px/1.4 system-ui, sans-serif; color: #fff; background: #9a5b00; border: 0; border-radius: 999px;
  padding: 4px 12px; cursor: pointer; box-shadow: 0 6px 24px rgba(0, 0, 0, .4);
}
.blitz-dev-panel[data-severity="error"] .blitz-dev-toggle { background: #c2183f; }
.blitz-dev-list {
  margin: 0; padding: 8px 12px; list-style: none; max-height: 50vh; overflow: auto;
  background: rgba(20, 20, 24, .95); border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .4);
}
.blitz-dev-list li { padding: 3px 0 3px 12px; border-left: 3px solid #e0a100; margin: 2px 0; }
.blitz-dev-list li[data-severity="error"] { border-left-color: #ff4d6d; }
.blitz-dev-at {
  font: 12px/1.4 ui-monospace, monospace; color: #9ecbff; background: none; border: 0; padding: 0;
}
button.blitz-dev-at { cursor: pointer; text-decoration: underline; }
html[data-blitz-printing] :is(.blitz-dev-panel, .blitz-dev-banner) { display: none !important; }
`

/** The panel, on the deck's own page; undefined on the presenter's and its previews. */
export function startDevPanel(doc: Document, open?: OpenInEditor): DevPanel | undefined {
  return pageMode(doc.defaultView!.location.hash) === 'audience' ? new DevPanel(doc, open) : undefined
}

export class DevPanel {
  private readonly style: HTMLStyleElement
  private readonly root: HTMLElement
  private readonly toggle: HTMLButtonElement
  private readonly list: HTMLOListElement
  private readonly banner: HTMLElement
  private readonly words
  /** The errors shown last, to open the panel only when a save brings a new one. */
  private errors = new Set<string>()

  constructor(
    private readonly doc: Document,
    private readonly open: OpenInEditor | undefined,
  ) {
    this.words = uiWords(doc).dev
    this.style = doc.createElement('style')
    this.style.textContent = CSS
    doc.head.append(this.style)
    this.banner = doc.createElement('div')
    this.banner.className = 'blitz-dev-banner'
    this.banner.setAttribute('role', 'alert')
    this.banner.hidden = true
    this.root = doc.createElement('section')
    this.root.className = 'blitz-dev-panel'
    this.root.setAttribute('aria-label', this.words.problems)
    this.root.hidden = true
    this.toggle = doc.createElement('button')
    this.toggle.type = 'button'
    this.toggle.className = 'blitz-dev-toggle'
    this.toggle.setAttribute('aria-expanded', 'false')
    this.toggle.addEventListener('click', () => this.expand(this.toggle.getAttribute('aria-expanded') !== 'true'))
    this.list = doc.createElement('ol')
    this.list.className = 'blitz-dev-list'
    this.list.hidden = true
    this.root.append(this.list, this.toggle)
    // Space and Enter press the panel's buttons, not the deck's next step.
    this.root.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
    })
    doc.body.append(this.banner, this.root)
  }

  /** Show `diagnostics` (all of them: infos are left out here). */
  show(diagnostics: readonly Diagnostic[]): void {
    // Errors first, then warnings, each in the order of the file.
    const shown = diagnostics.filter((d) => d.severity === 'error').concat(diagnostics.filter((d) => d.severity === 'warning'))
    const errors = shown.filter((d) => d.severity === 'error')
    const warnings = shown.length - errors.length
    const html = this.doc.documentElement
    if (errors.length) html.dataset.blitzDevErrors = ''
    else delete html.dataset.blitzDevErrors
    this.banner.hidden = errors.length === 0
    this.banner.textContent = this.words.wontBuild
    this.root.hidden = shown.length === 0
    this.root.dataset.severity = errors.length ? 'error' : 'warning'
    const counts = [errors.length ? fill(this.words.errors, { n: errors.length }) : '', warnings ? fill(this.words.warnings, { n: warnings }) : '']
    this.toggle.textContent = counts.filter(Boolean).join(' · ')

    this.list.replaceChildren(
      ...shown.map((d) => {
        const li = this.doc.createElement('li')
        li.dataset.severity = d.severity
        const at = `${d.file}:${d.span.start.line}:${d.span.start.column}`
        const place = this.open ? this.doc.createElement('button') : this.doc.createElement('span')
        place.className = 'blitz-dev-at'
        place.textContent = at
        if (place instanceof HTMLButtonElement) {
          place.type = 'button'
          place.title = this.words.openInEditor
          place.addEventListener('click', () => this.open!(d))
        }
        const message = this.doc.createElement('span')
        message.className = 'blitz-dev-message'
        message.textContent = d.message
        li.append(place, ' ', message)
        return li
      }),
    )
    const keys = new Set(errors.map((d) => `${d.span.start.line}:${d.span.start.column}:${d.code}:${d.message}`))
    if ([...keys].some((k) => !this.errors.has(k))) this.expand(true)
    else if (!shown.length) this.expand(false)
    this.errors = keys
  }

  private expand(open: boolean) {
    this.list.hidden = !open
    this.toggle.setAttribute('aria-expanded', String(open))
  }

  destroy(): void {
    this.root.remove()
    this.banner.remove()
    this.style.remove()
    delete this.doc.documentElement.dataset.blitzDevErrors
  }
}
