// The dev server's browser entry. Plain JS, served by Vite. Renderers are
// lazy loaders, built in and the deck's plugins', from a virtual module the
// dev server writes (dev.ts), so the runtime never imports a renderer.
import { start } from '@blitzstrahl/runtime'
import { startDevPanel } from '@blitzstrahl/runtime/dev-panel'
import renderers from 'virtual:blitzstrahl-renderers'

const deck = start({
  renderers,
  // Dev: badge overflowing slides and report them to the terminal.
  dev: !!import.meta.hot,
  onOverflow: (found) => import.meta.hot?.send('blitz:overflow', found),
})

// An editor's preview (packages/vscode) frames the page and says so: then
// the editor opens files itself, in its own window.
let editor
window.addEventListener('message', (e) => {
  if (e.source === window.parent && window.parent !== window && e.data?.blitzEditor === 1) editor = e.source
})

// The deck's problems on the page. Its links: the editor framing the page, or
// the dev server (only for this machine).
const panel = import.meta.hot
  ? startDevPanel(document, (d) => {
      const at = { file: d.file, line: d.span.start.line, column: d.span.start.column }
      if (editor) return editor.postMessage({ blitzOpen: at }, '*')
      void fetch(`/_blitz/open?${new URLSearchParams({ file: at.file, line: String(at.line), column: String(at.column) })}`)
    })
  : undefined

if (import.meta.hot) {
  import.meta.hot.on('blitz:update', ({ payload, stage, notes, diagnostics }) => {
    if (!location.hash.startsWith('#presenter')) document.title = payload.title
    deck.update(payload, stage, notes)
    report(diagnostics)
  })
  // A theme's CSS changed: swap it in. The update that follows remounts the
  // slide, so charts pick up new tokens, and measures overflow again.
  import.meta.hot.on('blitz:css', ({ css }) => {
    const style = document.querySelector('style[data-blitz-theme]')
    if (style) style.textContent = css
  })
  // A save the dev server couldn't load: the page keeps the last deck.
  import.meta.hot.on('blitz:diagnostics', report)
  report(JSON.parse(document.getElementById('blitz-diagnostics')?.textContent || '[]'))
}

function report(diagnostics) {
  panel?.show(diagnostics)
  for (const d of diagnostics) {
    const at = `${d.file}:${d.span.start.line}:${d.span.start.column}`
    const log = d.severity === 'error' ? console.error : d.severity === 'warning' ? console.warn : console.info
    log(`[blitzstrahl] ${at}: ${d.message} [${d.code}]`)
  }
}
