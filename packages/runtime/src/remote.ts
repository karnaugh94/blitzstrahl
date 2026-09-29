/**
 * The phone remote (presenting.md, *A phone as the remote*; M12.6): the
 * page `blitzstrahl present` gives a paired phone. It shows where the talk
 * is, the timer and the notes, and sends *next* and *previous*. The deck
 * decides; this page only asks and shows. Its words follow the phone's
 * language, like the presenter view's.
 */
import type { DeckPayload } from '@blitzstrahl/core'
import { fill } from '@blitzstrahl/core/i18n'
import { HttpTransport } from './presenter/http.js'
import { formatSigned, pace } from './presenter/pace.js'
import { elapsed, formatElapsed, type PresenterMsg } from './presenter/protocol.js'
import { remoteWords } from '@blitzstrahl/core/i18n-remote'
import { uiWords } from './ui.js'

type DeckState = Extract<PresenterMsg, { type: 'state' }>

const HELLO_MS = 3000
/** No state for this long: the deck (or `present`) has gone. */
const SILENCE_MS = 8000
/** A swipe: this far sideways, and more sideways than down. */
const SWIPE_PX = 60

const css = /* css */ `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0a0c13; color: #e9edf5; font: 17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.br { height: 100%; display: flex; flex-direction: column; padding: max(12px, env(safe-area-inset-top)) 14px max(12px, env(safe-area-inset-bottom)); gap: 10px; }
.br-top { display: flex; align-items: baseline; gap: 10px; }
.br-where { flex: 1; min-width: 0; }
.br-position { font-weight: 600; font-variant-numeric: tabular-nums; }
.br-title { color: #97a2b9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-timer { text-align: right; font-variant-numeric: tabular-nums; }
.br-time { font: 600 28px/1 ui-monospace, "SF Mono", Menlo, monospace; }
.br-sub { font-size: 12px; color: #97a2b9; }
.br[data-pace="behind"] .br-time { color: #ffc24b; }
.br[data-pace="over"] .br-time { color: #ff7a93; }
.br-notes { flex: 1; min-height: 0; overflow-y: auto; background: #121726; border: 1px solid #222a40; border-radius: 10px; padding: 12px 14px; font-size: 20px; }
.br-notes > :first-child { margin-top: 0; }
.br-muted { color: #6f7a93; font-style: italic; }
.br-nav { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; }
.br button { font: inherit; color: inherit; background: #1a2033; border: 1px solid #2b3450; border-radius: 12px; padding: 10px; touch-action: manipulation; }
.br-nav button { min-height: 88px; font-size: 22px; font-weight: 600; }
.br-nav .br-next { background: #1f3a5c; border-color: #2e5584; }
.br button:disabled { opacity: .45; }
.br :focus-visible { outline: 2px solid #6ff0c0; outline-offset: 2px; }
.br-banner { padding: 10px 12px; border-radius: 10px; background: #3a1820; color: #ffc9d3; }
.br-banner[hidden] { display: none; }
`

export function startRemote(doc: Document = document): void {
  const win = doc.defaultView!
  const w = uiWords(doc)
  const r = remoteWords(win.navigator.languages)
  const p = w.presenter
  const style = doc.createElement('style')
  style.textContent = css
  doc.head.append(style)

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
    const e = doc.createElement(tag)
    e.className = cls
    if (text) e.textContent = text
    return e
  }
  const root = el('main', 'br')
  const banner = el('p', 'br-banner')
  banner.setAttribute('role', 'alert')
  const position = el('div', 'br-position', p.connecting)
  const title = el('div', 'br-title')
  const time = el('div', 'br-time', '00:00')
  const sub = el('div', 'br-sub')
  const where = el('div', 'br-where')
  where.append(position, title)
  const timer = el('div', 'br-timer')
  timer.append(time, sub)
  const top = el('header', 'br-top')
  const toggle = el('button', 'br-toggle', p.start)
  toggle.type = 'button'
  toggle.setAttribute('aria-label', p.timerToggle)
  top.append(where, timer, toggle)
  const notes = el('section', 'br-notes')
  notes.setAttribute('aria-label', p.notes)
  const prev = el('button', 'br-prev', '←')
  prev.type = 'button'
  prev.setAttribute('aria-label', p.previous)
  const next = el('button', 'br-next', `${p.next} →`)
  next.type = 'button'
  next.setAttribute('aria-label', p.next)
  const nav = el('nav', 'br-nav')
  nav.append(prev, next)
  root.append(banner, top, notes, nav)
  doc.body.append(root)
  const say = (text: string | undefined) => {
    banner.hidden = !text
    banner.textContent = text ?? ''
  }

  // The pairing is in the address's fragment (`#s=…`), never in a cookie: a reload keeps it.
  const session = new URLSearchParams(win.location.hash.slice(1)).get('s')
  if (!session) {
    say(r.refused)
    position.textContent = ''
    prev.disabled = next.disabled = toggle.disabled = true
    return
  }
  doc.title = r.title

  let payload: DeckPayload | undefined
  let notesTpl: HTMLTemplateElement | undefined
  let state: DeckState | undefined
  /** When the deck's state last arrived; when this page started; whether the deck's page couldn't be read. */
  let heard = 0
  const started = Date.now()
  let failed = false
  let shownNotes: string | undefined

  const relay = new HttpTransport('/_blitz/remote', session, (open) => {
    if (!open) say(r.gone)
  })
  const hello = () => relay.send({ type: 'hello', role: 'remote' })

  const render = () => {
    const quiet = Date.now() - (heard || started) > SILENCE_MS
    say(failed || quiet ? r.gone : undefined)
    if (!state || !payload) return
    const slide = payload.slides[state.slide]
    const steps = slide?.steps ?? 0
    position.textContent = fill(p.position, { n: state.slide + 1, total: payload.slides.length }) + (steps ? ` · ${fill(p.step, { n: state.step, total: steps })}` : '')
    title.textContent = slide?.title ?? ''
    toggle.textContent = state.timer.running ? p.pause : p.start
    const t = elapsed(state.timer)
    const { duration } = payload
    time.textContent = duration ? formatSigned(duration - t, formatElapsed) : formatElapsed(t)
    sub.textContent = duration ? fill(p.elapsed, { time: formatElapsed(t) }) : ''
    if (duration) {
      const got = pace(state, payload.slides.map((s) => s.steps), payload.slides.map(() => 1), t, duration, payload.paceMargin)
      root.dataset.pace = got.status
      timer.setAttribute('aria-label', got.status === 'over' ? fill(p.paceOver, { time: formatElapsed(t - duration) }) : got.status === 'behind' ? fill(p.paceBehind, { time: formatElapsed(got.behind) }) : p.paceOk)
    }
    const atEnd = state.slide === payload.slides.length - 1 && state.step === steps
    next.disabled = atEnd
    prev.disabled = state.slide === 0 && state.step === 0
    // Notes change only on arriving at a slide, so a thumb's scroll holds.
    if (slide && shownNotes !== slide.id) {
      shownNotes = slide.id
      const body = notesTpl?.content.querySelector(`[data-for="${CSS.escape(slide.id)}"]`)
      notes.replaceChildren(...(body ? [...body.cloneNode(true).childNodes] : [el('p', 'br-muted', p.noNotes)]))
      notes.scrollTop = 0
    }
  }

  relay.onMessage((m) => {
    if (m.type !== 'state') return
    heard = Date.now()
    state = m
    render()
  })

  // The deck's slides and notes: its own page, read with the pairing.
  void fetch('/_blitz/remote/deck', { headers: { 'x-blitz-session': session } })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
    .then((html) => {
      const page = new DOMParser().parseFromString(html, 'text/html')
      payload = JSON.parse(page.getElementById('blitz-payload')?.textContent ?? 'null') as DeckPayload
      const tpl = page.getElementById('blitz-notes')
      if (tpl instanceof HTMLTemplateElement) notesTpl = doc.importNode(tpl, true)
      render()
    })
    .catch(() => {
      failed = true
      render()
    })

  prev.addEventListener('click', () => relay.send({ type: 'retreat' }))
  next.addEventListener('click', () => relay.send({ type: 'advance' }))
  toggle.addEventListener('click', () => relay.send({ type: 'timer', action: state?.timer.running ? 'pause' : 'start' }))

  // Swipes anywhere but the notes' scrolling: left is next, as on the deck's screen.
  let start: { x: number; y: number } | undefined
  root.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY }))
  root.addEventListener('pointerup', (e) => {
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    start = undefined
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    relay.send({ type: dx < 0 ? 'advance' : 'retreat' })
  })

  hello()
  win.setInterval(hello, HELLO_MS)
  win.setInterval(render, 500)
  // A phone that wakes up says hello at once, rather than at the next beat.
  doc.addEventListener('visibilitychange', () => doc.visibilityState === 'visible' && hello())
}
