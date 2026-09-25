/**
 * The `mermaid` renderer (syntax.md §8; docs/renderers/mermaid.md): the
 * fence body is a Mermaid diagram, drawn with the deck's own colours and
 * type, so a diagram looks like part of the deck (CLAUDE.md: visualisations
 * must never look pasted in).
 *
 * Mermaid lays text out with the browser, so it runs in the page, lazily
 * like every renderer. Text is set in the deck's font at its text size, and
 * the diagram is scaled down to fit its block, never up.
 */
import type { RenderCtx, RenderInstance, Renderer } from '@blitzstrahl/runtime'

export function validate(spec: unknown): string {
  if (typeof spec !== 'string' || !spec.trim()) throw new Error('the block is empty: write a Mermaid diagram, e.g. `flowchart LR` then `A --> B`')
  return spec
}

/** Mermaid's `base` theme variables, from the deck's tokens. */
export function themeVariables(token: (name: string) => string): Record<string, string | boolean> {
  const t = (name: string, fallback: string) => token(`--blitz-${name}`) || fallback
  const bg = t('bg', '#ffffff')
  const surface = t('surface', bg)
  const surface2 = t('surface-2', surface)
  const fg = t('fg', '#111111')
  const muted = t('fg-muted', fg)
  const rule = t('rule', muted)
  const accent = t('accent', fg)
  const accent2 = t('accent-2', accent)
  const palette = Array.from({ length: 8 }, (_, i) => t(`chart-${i + 1}`, i % 2 ? accent2 : accent))
  const vars: Record<string, string | boolean> = {
    darkMode: isDark(bg),
    background: bg,
    fontFamily: t('font-sans', 'sans-serif'),
    fontSize: t('text', '18px'),
    textColor: fg,
    titleColor: fg,
    lineColor: muted,
    primaryColor: surface2,
    primaryTextColor: fg,
    primaryBorderColor: accent,
    secondaryColor: surface,
    secondaryTextColor: fg,
    secondaryBorderColor: accent2,
    tertiaryColor: surface,
    tertiaryTextColor: fg,
    tertiaryBorderColor: rule,
    mainBkg: surface2,
    nodeBorder: accent,
    nodeTextColor: fg,
    clusterBkg: surface,
    clusterBorder: rule,
    edgeLabelBackground: bg,
    noteBkgColor: surface,
    noteTextColor: fg,
    noteBorderColor: rule,
    actorBkg: surface2,
    actorBorder: accent,
    actorTextColor: fg,
    actorLineColor: muted,
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: rule,
    labelTextColor: fg,
    loopTextColor: fg,
    activationBkgColor: surface,
    activationBorderColor: accent,
    sequenceNumberColor: bg,
    pieTitleTextColor: fg,
    pieSectionTextColor: bg,
    pieLegendTextColor: fg,
    pieStrokeColor: bg,
    pieOuterStrokeColor: rule,
    pieOpacity: '1',
    pieTitleTextSize: t('text', '18px'),
    pieSectionTextSize: t('text-small', '16px'),
    pieLegendTextSize: t('text-small', '16px'),
  }
  palette.forEach((c, i) => {
    vars[`pie${i + 1}`] = c
    vars[`git${i}`] = c
    vars[`cScale${i}`] = c
  })
  return vars
}

/** Relative luminance below one half. Accepts `#rgb`, `#rrggbb` and `rgb()`. */
function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  let rgb: number[] | undefined
  if (hex) rgb = (hex.length === 3 ? [...hex].map((c) => c + c) : hex.match(/../g)!).map((h) => parseInt(h, 16))
  else rgb = /rgba?\(([^)]+)\)/.exec(color)?.[1]!.split(/[\s,/]+/).slice(0, 3).map(Number)
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return false
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}

let renders = 0

const mermaid: Renderer = {
  async mount(el: HTMLElement, raw: unknown, ctx: RenderCtx): Promise<RenderInstance> {
    const source = validate(raw)
    const { default: m } = await import('mermaid')
    const vars = themeVariables(ctx.token)
    // Sequence diagrams take their type from their own settings, not the theme's.
    const font = { fontFamily: String(vars.fontFamily), fontSize: parseFloat(String(vars.fontSize)) || 18 }
    m.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: vars,
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      // Sized here, to the block, not by Mermaid to its container.
      flowchart: { useMaxWidth: false },
      sequence: {
        useMaxWidth: false,
        actorFontFamily: font.fontFamily,
        actorFontSize: font.fontSize,
        messageFontFamily: font.fontFamily,
        messageFontSize: font.fontSize,
        noteFontFamily: font.fontFamily,
        noteFontSize: font.fontSize,
      },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      pie: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      mindmap: { useMaxWidth: false },
      timeline: { useMaxWidth: false },
      gitGraph: { useMaxWidth: false },
    })
    // Mermaid measures text as it draws, so it draws somewhere laid out:
    // not in the scaled stage (its labels would measure scaled), and not
    // hidden (a PDF export hides everything but the pages). See runtime css.
    // It queues concurrent renders itself (PDF export mounts them all at once).
    const doc = el.ownerDocument
    const scratch = doc.createElement('div')
    scratch.className = 'blitz-scratch'
    doc.body.append(scratch)
    let svg: string
    try {
      ;({ svg } = await m.render(`blitz-mermaid-${++renders}`, source, scratch))
    } finally {
      scratch.remove()
    }
    const box = doc.createElement('div')
    box.className = 'blitz-mermaid'
    box.innerHTML = svg
    el.append(box)
    const drawing = box.querySelector('svg')!
    fit(drawing, box)
    if (!ctx.reducedMotion) drawing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' })
    return {
      update() {},
      resize: () => fit(drawing, box),
      destroy: () => box.remove(),
    }
  },
}

/** Scale the drawing down to fit the block, keeping its aspect; never up. */
function fit(svg: SVGSVGElement, box: HTMLElement) {
  const vb = svg.viewBox.baseVal
  const w = vb?.width || svg.width.baseVal.value
  const h = vb?.height || svg.height.baseVal.value
  if (!w || !h) return
  const scale = Math.min(1, box.clientWidth / w || 1, box.clientHeight / h || 1)
  svg.style.maxWidth = 'none'
  svg.setAttribute('width', String(w * scale))
  svg.setAttribute('height', String(h * scale))
}

export default mermaid
