/**
 * Video and audio (syntax.md §13). A clip plays when it's shown, on slide
 * entry or at its step, and pauses and rewinds to `start` when it's hidden
 * or its slide is left. `end` holds the frame, or goes back to `start` with
 * `loop`. Only the audience's window plays: the presenter's previews and
 * mirrors show clips paused and silent, so there's no double sound.
 *
 * The markup carries the options: `data-blitz-start`, `-end`, `-loop`,
 * `-autoplay="false"`. There's never an HTML `autoplay`, which would start
 * every slide's clip when the page loads.
 */
export const MEDIA = 'video[data-blitz-media], audio[data-blitz-media]'

/** Clips this page has started since they were last shown. */
const started = new WeakSet<HTMLMediaElement>()

const startOf = (m: HTMLMediaElement) => Number(m.dataset.blitzStart ?? 0)
const endOf = (m: HTMLMediaElement) => (m.dataset.blitzEnd === undefined ? undefined : Number(m.dataset.blitzEnd))

/** Once per element. `plays`: this window is the audience's. */
export function wireMedia(m: HTMLMediaElement, plays: boolean): void {
  if (!plays) {
    m.muted = true
    seek(m, startOf(m))
    return
  }
  const finish = () => {
    if (m.dataset.blitzLoop === 'true') {
      seek(m, startOf(m))
      void play(m)
    } else m.pause()
  }
  m.addEventListener('timeupdate', () => {
    const end = endOf(m)
    if (end !== undefined && m.currentTime >= end && !m.paused) finish()
  })
  m.addEventListener('ended', finish)
  // Without controls, a click on a video pauses and resumes it.
  if (m instanceof HTMLVideoElement && !m.controls) {
    m.addEventListener('click', () => {
      if (!m.paused) return m.pause()
      const end = endOf(m)
      if (end !== undefined && m.currentTime >= end) seek(m, startOf(m))
      void play(m)
    })
  }
}

/** Bring a clip in line with whether it's shown. */
export function showMedia(m: HTMLMediaElement, shown: boolean, plays: boolean): void {
  if (!shown) return rewind(m)
  if (!plays || started.has(m) || m.dataset.blitzAutoplay === 'false') return
  started.add(m)
  seek(m, startOf(m))
  void play(m)
}

/** Paused, back at `start`, ready to play again. */
export function rewind(m: HTMLMediaElement): void {
  started.delete(m)
  if (!m.paused) m.pause()
  seek(m, startOf(m))
}

/** A frame to print: the poster, or the frame at `start`. Resolves when it's there (or after `ms`). */
export function mediaFrame(m: HTMLMediaElement, ms: number): Promise<void> {
  m.muted = true
  m.preload = 'auto'
  const done = new Promise<void>((resolve) => {
    if (m instanceof HTMLVideoElement && m.poster) {
      const img = new Image()
      img.src = m.poster
      return void img.decode().then(resolve, resolve)
    }
    if (m instanceof HTMLAudioElement) return resolve()
    const at = startOf(m)
    const ready = () => {
      if (Math.abs(m.currentTime - at) < 0.05 && m.readyState >= 2) return resolve()
      m.addEventListener('seeked', () => resolve(), { once: true })
      m.currentTime = at
    }
    m.addEventListener('error', () => resolve(), { once: true })
    if (m.readyState >= 2) return ready()
    m.addEventListener('loadeddata', ready, { once: true })
    // A clone printed from `preload="metadata"`: fetch its frames now.
    m.load()
  })
  return Promise.race([done, new Promise<void>((r) => setTimeout(r, ms))])
}

function seek(m: HTMLMediaElement, t: number) {
  if (m.readyState >= 1) {
    if (m.currentTime !== t) m.currentTime = t
  } else if (t > 0) {
    m.addEventListener('loadedmetadata', () => (m.currentTime = t), { once: true })
  }
}

/** Play; if the browser refuses sound before any key press or click, play muted (syntax.md §13). */
async function play(m: HTMLMediaElement) {
  try {
    await m.play()
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'NotAllowedError' || m.muted) return
    m.muted = true
    await m.play().catch(() => {})
  }
}
