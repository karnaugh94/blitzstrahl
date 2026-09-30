/**
 * The preview panel's page: the deck in a frame, moved by hash (the deck
 * follows `hashchange`, so moving never reloads it). Pure: no VS Code, so
 * e2e can load it in a browser.
 */
import { randomBytes } from 'node:crypto'

export function page(url: string): string {
  const nonce = randomBytes(16).toString('base64')
  const origin = new URL(url).origin
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>html, body, iframe { margin: 0; padding: 0; border: 0; width: 100%; height: 100%; overflow: hidden; background: #000 }</style>
</head><body>
<iframe src="${url}" title="Preview" allow="fullscreen; autoplay"></iframe>
<script nonce="${nonce}">
  const frame = document.querySelector('iframe')
  const base = ${JSON.stringify(url)}
  const origin = new URL(base).origin
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined
  // Tell the deck an editor frames it, so its dev panel's links come here.
  frame.addEventListener('load', () => frame.contentWindow.postMessage({ blitzEditor: 1 }, origin))
  window.addEventListener('message', (e) => {
    if (e.source === frame.contentWindow) {
      if (e.data?.blitzOpen) vscode?.postMessage({ open: e.data.blitzOpen })
    } else if (typeof e.data?.hash === 'string') frame.src = base + e.data.hash
  })
</script>
</body></html>`
}
