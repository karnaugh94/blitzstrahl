/**
 * What `blitzstrahl present` adds to the deck's page (M12.6): the deck
 * takes a phone's intents through the server's relay, and the presenter
 * view gets a **Remote** button that pairs a phone. Never in `build`'s
 * output, and never in a standalone file.
 */
import { fill } from '@blitzstrahl/core/i18n'
import { remoteWords } from '@blitzstrahl/core/i18n-remote'
import type { Deck } from './deck.js'
import { HttpTransport } from './presenter/http.js'
import { remoteMayAsk } from './presenter/protocol.js'
import type { PresenterView } from './presenter/view.js'

/** A phone that said nothing for this long has gone (it says hello every few seconds). */
const PHONE_SILENCE_MS = 10_000

export function linkRemote(win: Window = window): void {
  const deck = (win as unknown as { blitz?: Deck }).blitz
  if (deck?.presenter) {
    const relay = new HttpTransport('/_blitz/remote/deck')
    let phone = 0
    relay.onMessage((m) => {
      if (m.type === 'hello' && m.role === 'remote') phone = Date.now()
    })
    deck.presenter.attach(relay, remoteMayAsk, () => Date.now() - phone < PHONE_SILENCE_MS)
  }
  if (win.location.hash === '#presenter') void presenterButton(win)
}

async function presenterButton(win: Window) {
  const view = await new Promise<PresenterView>((resolve) => {
    const look = () => {
      const v = (win as unknown as { blitzPresenter?: PresenterView }).blitzPresenter
      if (v) resolve(v)
      else win.setTimeout(look, 50)
    }
    look()
  })
  const doc = win.document
  const w = remoteWords(win.navigator.languages)
  const style = doc.createElement('style')
  style.textContent = `.blitz-remote-pair { text-align: center; max-width: 360px; }
.blitz-remote-qr svg { display: block; width: 260px; height: 260px; margin: 8px auto; padding: 12px; background: #fff; border-radius: 8px; }
.blitz-remote-pair p { overflow-wrap: anywhere; }`
  doc.head.append(style)
  view.addButton(w.button, w.buttonTitle, async () => {
    // Each press makes a new code: the phone that uses it replaces the one paired before.
    const res = await fetch('/_blitz/remote/pair', { method: 'POST', headers: { 'x-blitz': '1' } })
    if (!res.ok) return
    const { url, svg } = (await res.json()) as { url: string; svg: string }
    const box = doc.createElement('div')
    box.className = 'blitz-remote-pair'
    const title = doc.createElement('h2')
    title.textContent = w.pairHeading
    const code = doc.createElement('div')
    code.className = 'blitz-remote-qr'
    // Our own server's QR code, made by `uqr`.
    code.innerHTML = svg
    code.querySelector('svg')?.setAttribute('role', 'img')
    code.querySelector('svg')?.setAttribute('aria-label', w.qrLabel)
    const text = doc.createElement('p')
    text.textContent = fill(w.orOpen, { url })
    const note = doc.createElement('p')
    note.className = 'blitz-dialog-hint'
    note.textContent = w.once
    box.append(title, code, text, note)
    view.openDialog(box, w.pairHeading)
  })
}
