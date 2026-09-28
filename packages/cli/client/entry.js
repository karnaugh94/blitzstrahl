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

// The deck's problems on the page. Its links: the dev server opens the file (only for this machine).
const panel = import.meta.hot
  ? startDevPanel(document, (d) => {
      const q = new URLSearchParams({ file: d.file, line: String(d.span.start.line), column: String(d.span.start.column) })
      void fetch(`/_blitz/open?${q}`)
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
