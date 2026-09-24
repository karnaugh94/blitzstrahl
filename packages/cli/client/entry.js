// Browser entry for every deck. Plain JS: shipped as-is and bundled per deck
// by Vite. Renderers are wired here as lazy loaders so each lands in its own
// chunk and the runtime never imports a renderer directly.
import { start } from '@blitzstrahl/runtime'

const deck = start({
  renderers: {
    chart: () => import('@blitzstrahl/renderers/chart'),
  },
})

if (import.meta.hot) {
  import.meta.hot.on('blitz:update', ({ payload, stage, notes, diagnostics }) => {
    if (!location.hash.startsWith('#presenter')) document.title = payload.title
    deck.update(payload, stage, notes)
    report(diagnostics)
  })
  report(JSON.parse(document.getElementById('blitz-diagnostics')?.textContent || '[]'))
}

function report(diagnostics) {
  for (const d of diagnostics) {
    const at = `${d.file}:${d.span.start.line}:${d.span.start.column}`
    const log = d.severity === 'error' ? console.error : d.severity === 'warning' ? console.warn : console.info
    log(`[blitzstrahl] ${at}: ${d.message} [${d.code}]`)
  }
}
