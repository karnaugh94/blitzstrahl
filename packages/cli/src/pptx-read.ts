/// <reference lib="dom" />
/**
 * Reading a printed slide for an editable PowerPoint (`export --pptx`). This
 * runs in the browser, on a page of the print layout (`.blitz-print >
 * .blitz-slide`), so it must stay self-contained: Playwright sends the
 * function's source, not its module, and nothing outside it exists there.
 *
 * It turns what the browser laid out into what PowerPoint has: text boxes
 * (headings, paragraphs, lists, code), native tables, rectangles for boxes
 * with a plain fill or border, and pictures for whatever has no PowerPoint
 * equivalent (images, charts, maps, diagrams, math). Each picture element
 * is marked `data-pptx-pic="n"` so the exporter can photograph it.
 * Everything that is turned into something editable is marked too, so the
 * slide can then be photographed without it: what's left (the theme's
 * backgrounds and decorations) becomes the slide's background picture.
 */

/** A box on the slide, in CSS pixels from its top left. */
export interface Rect { x: number; y: number; w: number; h: number }

/** A colour as `RRGGBB`, and its opacity from 0 to 1. */
export interface Colour { hex: string; alpha: number }

export interface Run {
  text: string
  /** A line break (`<br>`), in place of text. */
  br?: boolean
  font: string
  /** In CSS pixels. */
  size: number
  colour: Colour
  /** Gradient text: its stops, and the CSS angle in degrees. */
  gradient?: { angle: number; stops: Array<{ colour: Colour; at: number }> }
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  caps?: 'all' | 'small'
  /** Letter spacing, in CSS pixels. */
  spacing?: number
  /** Superscript (positive) or subscript (negative), as a fraction of the size. */
  baseline?: number
  highlight?: Colour
  link?: string
}

export interface Bullet {
  /** A character, or PowerPoint's numbering scheme (`arabicPeriod`…). */
  char?: string
  auto?: string
  /** The number of the first item, when it isn't 1. */
  start?: number
  colour?: Colour
  font?: string
  /** Relative to the text, from 0.25 to 4. */
  scale?: number
}

export interface Paragraph {
  runs: Run[]
  align: 'l' | 'ctr' | 'r' | 'just'
  /** Line height in CSS pixels; undefined is the font's own. */
  lineHeight?: number
  /** Space above, in CSS pixels. */
  before: number
  /** Left margin of the text, and of the first line relative to it (negative: a hanging bullet), in CSS pixels. */
  left: number
  indent: number
  level: number
  bullet?: Bullet
  /** A list item with its bullet drawn by the theme (in the background). */
  noBullet?: boolean
  /** The size of an empty paragraph's line, in CSS pixels. */
  emptySize?: number
}

export interface Line { width: number; colour: Colour; dash?: 'dash' | 'sysDot' }

export interface Fill { colour: Colour }

export interface TextItem {
  kind: 'text'
  rect: Rect
  paragraphs: Paragraph[]
  insets: { l: number; t: number; r: number; b: number }
  fill?: Fill
  line?: Line
  radius?: number
  anchor: 't' | 'ctr' | 'b'
  /** The slide's title: PowerPoint's title placeholder. */
  title?: boolean
  /** Lines don't wrap (`white-space: pre`, `nowrap`). */
  nowrap?: boolean
  name: string
}

export interface ShapeItem {
  kind: 'shape'
  rect: Rect
  fill?: Fill
  line?: Line
  radius?: number
  name: string
}

export interface PictureItem {
  kind: 'picture'
  rect: Rect
  /** Its `data-pptx-pic`. */
  id: number
  alt: string
  name: string
  /** A chart block: its ECharts option, for a native chart (write-pptx.ts). */
  chart?: ChartData
}

/** The parts of the chart renderer's ECharts theme an export uses. */
interface ChartTheme {
  color?: string[]
  textStyle?: { color?: string; fontFamily?: string }
  title?: { textStyle?: { color?: string } }
  categoryAxis?: { axisLabel?: { color?: string; fontSize?: number } }
  valueAxis?: { splitLine?: { lineStyle?: { color?: string } } }
}

export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'scatter'
  horizontal?: boolean
  /** Categories run from the end of the axis (horizontal bars, top to bottom). */
  reversed?: boolean
  stacked?: boolean
  area?: boolean
  smooth?: boolean
  doughnut?: boolean
  title?: string
  categories: string[]
  series: Array<{ name: string; values: Array<number | null>; colour?: Colour; x?: number[]; sizes?: number[] }>
  /** Pie slices' colours. */
  pointColours?: Colour[]
  legend: boolean
  textColour: Colour
  titleColour?: Colour
  /** The value axis's range, as drawn. */
  axis?: { min: number; max: number; interval?: number }
  /** A scatter's horizontal axis, as drawn. */
  xAxis?: { min: number; max: number; interval?: number }
  /** A doughnut's hole, as a percentage of its size. */
  hole?: number
  /** Pie slices labelled with their name and percentage. */
  sliceLabels?: boolean
  /** An area's fill opacity. */
  areaOpacity?: number
  /** Scatter points sized by a third value: the biggest bubble, as a percentage of PowerPoint's default. */
  bubbleScale?: number
  /** Numbers as the chart writes them, as a spreadsheet format. */
  numberFormat?: string
  /** Each value written by its bar or point. */
  labels?: boolean
  gridColour?: Colour
  font: string
  fontSize: number
}

export interface Cell {
  paragraphs: Paragraph[]
  fill?: Fill
  borders: { l?: Line; r?: Line; t?: Line; b?: Line }
  insets: { l: number; t: number; r: number; b: number }
  anchor: 't' | 'ctr' | 'b'
  /** Grid position and spans. */
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

export interface TableItem {
  kind: 'table'
  rect: Rect
  cols: number[]
  rows: number[]
  cells: Cell[]
  name: string
}

export type Item = TextItem | ShapeItem | PictureItem | TableItem

export interface SlideRead {
  items: Item[]
  /** The deck's fonts and colours, from this page: for the presentation's theme. */
  theme: { heading: string; body: string; text: Colour; background: Colour; accents: Colour[] }
}

export function readSlide(page: Element): SlideRead {
  const origin = page.getBoundingClientRect()
  const win = page.ownerDocument.defaultView!
  const style = (el: Element, pseudo?: string) => win.getComputedStyle(el, pseudo)
  const items: Item[] = []
  let pictures = 0
  let names = 0

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect()
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }
  }

  function colour(css: string | null | undefined): Colour | undefined {
    if (!css) return undefined
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(css)
    if (!m) {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(css)
      if (!srgb) return undefined
      const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((v) => Math.round(Number(v) * 255))
      const alpha = srgb[4] === undefined ? 1 : Number(srgb[4])
      return alpha === 0 ? undefined : { hex: [r!, g!, b!].map((v) => v.toString(16).padStart(2, '0')).join(''), alpha }
    }
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
    if (alpha === 0) return undefined
    return { hex: [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join(''), alpha }
  }

  /** The first family in a `font-family` list, as PowerPoint names fonts. */
  function family(css: string): string {
    const GENERIC: Record<string, string> = {
      'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New', 'system-ui': 'Segoe UI', '-apple-system': 'Segoe UI',
      'ui-sans-serif': 'Arial', 'ui-serif': 'Times New Roman', 'ui-monospace': 'Consolas', cursive: 'Comic Sans MS', fantasy: 'Impact',
    }
    const first = (css.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
    return GENERIC[first] ?? first ?? 'Arial'
  }

  function gradient(css: string): Run['gradient'] | undefined {
    const m = /linear-gradient\((.*)\)/.exec(css)
    if (!m) return undefined
    let angle = 180
    const parts = m[1]!.split(/,(?![^(]*\))/).map((p) => p.trim())
    if (/^-?[\d.]+deg$/.test(parts[0]!)) angle = Number.parseFloat(parts.shift()!)
    else if (parts[0]!.startsWith('to ')) {
      const to = parts.shift()!
      angle = to.includes('right') ? 90 : to.includes('left') ? 270 : to.includes('top') ? 0 : 180
    }
    const stops = parts
      .map((p, k) => {
        const c = colour(p)
        const at = /([\d.]+)%\s*$/.exec(p)
        return c ? { colour: c, at: at ? Number(at[1]) / 100 : parts.length === 1 ? 0 : k / (parts.length - 1) } : undefined
      })
      .filter((s): s is { colour: Colour; at: number } => s !== undefined)
    return stops.length >= 2 ? { angle, stops } : undefined
  }

  const visible = (el: Element) => (el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true

  const PICTURE = 'img, svg, canvas, video, audio, iframe, object, embed, picture, math, .katex-display, [data-blitz-block], .blitz-embed, .mermaid'
  const isPicture = (el: Element) => el.matches(PICTURE) && !el.closest('table')

  function line(width: string, lineStyle: string, c: string): Line | undefined {
    const w = Number.parseFloat(width)
    const col = colour(c)
    if (!w || !col || lineStyle === 'none' || lineStyle === 'hidden') return undefined
    const l: Line = { width: w, colour: col }
    if (lineStyle === 'dashed') l.dash = 'dash'
    if (lineStyle === 'dotted') l.dash = 'sysDot'
    return l
  }

  /** A box's own fill and borders: what PowerPoint can draw as a shape. */
  function decoration(el: Element) {
    const cs = style(el)
    const fill = cs.backgroundImage === 'none' ? colour(cs.backgroundColor) : undefined
    const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => line(cs.getPropertyValue(`border-${s.toLowerCase()}-width`), cs.getPropertyValue(`border-${s.toLowerCase()}-style`), cs.getPropertyValue(`border-${s.toLowerCase()}-color`)))
    const same = sides.every((s) => s && sides[0] && s.width === sides[0].width && s.colour.hex === sides[0].colour.hex)
    // A box cut to a shape (a chevron) or drawn with an image stays in the background picture.
    return { fill, sides, uniform: same ? sides[0] : undefined, radius: Number.parseFloat(cs.borderTopLeftRadius) || 0, image: cs.backgroundImage !== 'none' || cs.clipPath !== 'none' || cs.maskImage !== 'none' }
  }

  /** Borders on some sides only, as thin rectangles. */
  function sideBars(el: Element, sides: Array<Line | undefined>) {
    const r = rectOf(el)
    const [t, rt, b, l] = sides
    if (t) items.push({ kind: 'shape', rect: { x: r.x, y: r.y, w: r.w, h: t.width }, fill: { colour: t.colour }, name: `Border ${++names}` })
    if (b) items.push({ kind: 'shape', rect: { x: r.x, y: r.y + r.h - b.width, w: r.w, h: b.width }, fill: { colour: b.colour }, name: `Border ${++names}` })
    if (l) items.push({ kind: 'shape', rect: { x: r.x, y: r.y, w: l.width, h: r.h }, fill: { colour: l.colour }, name: `Border ${++names}` })
    if (rt) items.push({ kind: 'shape', rect: { x: r.x + r.w - rt.width, y: r.y, w: rt.width, h: r.h }, fill: { colour: rt.colour }, name: `Border ${++names}` })
  }

  /** Laid out as a box of its own, not in a line of text. */
  const isBlock = (el: Element) => {
    const d = style(el).display
    return d !== 'none' && !d.startsWith('inline') && !d.startsWith('ruby')
  }

  /** Has text of its own, or only inline children: one text box's worth. */
  function isTextBlock(el: Element): boolean {
    let text = false
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        if (n.textContent!.trim()) text = true
      } else if (n.nodeType === 1) {
        const c = n as Element
        if (!visible(c) && style(c).display === 'none') continue
        if (isBlock(c) || isPicture(c) || c.matches('table')) return false
        if (c.textContent!.trim() || c.matches('br')) text = true
      }
    }
    return text
  }

  function align(cs: CSSStyleDeclaration): Paragraph['align'] {
    const a = cs.textAlign
    const rtl = cs.direction === 'rtl'
    if (a === 'center' || a === '-webkit-center') return 'ctr'
    if (a === 'right' || (a === 'end' && !rtl) || (a === 'start' && rtl)) return 'r'
    if (a === 'justify') return 'just'
    return 'l'
  }

  function runStyle(el: Element, block: Element): Omit<Run, 'text'> {
    const cs = style(el)
    const run: Omit<Run, 'text'> = {
      font: family(cs.fontFamily),
      size: Number.parseFloat(cs.fontSize),
      colour: colour(cs.webkitTextFillColor) ?? colour(cs.color) ?? { hex: '000000', alpha: 1 },
    }
    // Gradient text: transparent glyphs over a background clipped to them.
    for (let e: Element | null = el; e && block.contains(e); e = e.parentElement) {
      const s = style(e)
      if (s.backgroundClip === 'text' || s.getPropertyValue('-webkit-background-clip') === 'text') {
        const g = gradient(s.backgroundImage)
        if (g) {
          run.gradient = g
          run.colour = g.stops[0]!.colour
        }
        e.setAttribute('data-pptx-nobox', '')
        break
      }
    }
    if (Number(cs.fontWeight) >= 600) run.bold = true
    if (cs.fontStyle !== 'normal') run.italic = true
    let deco = ''
    for (let e: Element | null = el; e && block.contains(e); e = e.parentElement) deco += ` ${style(e).textDecorationLine}`
    if (deco.includes('underline')) run.underline = true
    if (deco.includes('line-through')) run.strike = true
    if (cs.textTransform === 'uppercase') run.caps = 'all'
    else if (cs.fontVariantCaps === 'small-caps' || cs.fontVariant === 'small-caps') run.caps = 'small'
    const spacing = Number.parseFloat(cs.letterSpacing)
    if (spacing) run.spacing = spacing
    for (let e: Element | null = el; e && e !== block; e = e.parentElement) {
      const v = style(e).verticalAlign
      if (v === 'super') run.baseline = 0.3
      if (v === 'sub') run.baseline = -0.25
      if (run.baseline !== undefined) break
    }
    // An inline box's background (`code`, `mark`) is a highlight.
    for (let e: Element | null = el; e && e !== block; e = e.parentElement) {
      if (style(e).display.startsWith('inline')) {
        const h = colour(style(e).backgroundColor)
        if (h) {
          run.highlight = h
          e.setAttribute('data-pptx-nobox', '')
          break
        }
        if (style(e).borderBottomStyle !== 'none' || style(e).backgroundImage !== 'none') e.setAttribute('data-pptx-nobox', '')
      }
    }
    const a = el.closest('a[href]')
    if (a && block.contains(a)) {
      const href = (a as HTMLAnchorElement).href
      if (/^(https?:|mailto:)/.test(href)) run.link = href
    }
    return run
  }

  /** The runs of a block's inline content. */
  function runsOf(block: Element, cs: CSSStyleDeclaration): Run[] {
    const runs: Run[] = []
    const pre = /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace) || cs.whiteSpaceCollapse === 'preserve'
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const parent = n.parentElement!
        if (!visible(parent)) return
        let text = n.textContent!
        if (!pre) text = text.replace(/[\t\n\r ]+/g, ' ')
        if (!text) return
        const s = runStyle(parent, block)
        if (pre) {
          text.split('\n').forEach((part, k) => {
            if (k) runs.push({ ...s, text: '', br: true })
            if (part) runs.push({ ...s, text: part })
          })
        } else runs.push({ ...s, text })
        return
      }
      if (n.nodeType !== 1) return
      const el = n as Element
      if (el.matches('br')) {
        runs.push({ ...runStyle(el.parentElement!, block), text: '', br: true })
        return
      }
      if (!visible(el) || el.matches('.katex-mathml, script, style, template')) return
      if (el.matches('img, svg, canvas, video, iframe')) return
      el.childNodes.forEach(walk)
    }
    block.childNodes.forEach(walk)
    if (!pre) {
      // Collapse spaces at the edges and between runs, as the browser does.
      while (runs.length && !runs[0]!.br && !runs[0]!.text.trim()) runs.shift()
      while (runs.length && !runs[runs.length - 1]!.br && !runs[runs.length - 1]!.text.trim()) runs.pop()
      if (runs[0]) runs[0].text = runs[0].text.trimStart()
      const last = runs[runs.length - 1]
      if (last) last.text = last.text.trimEnd()
      for (let k = 1; k < runs.length; k++) {
        if (runs[k - 1]!.text.endsWith(' ') && runs[k]!.text.startsWith(' ')) runs[k]!.text = runs[k]!.text.slice(1)
        if (runs[k - 1]!.br) runs[k]!.text = runs[k]!.text.trimStart()
      }
    }
    // Neighbours styled alike are one run.
    const out: Run[] = []
    for (const r of runs) {
      const prev = out[out.length - 1]
      if (prev && !r.br && !prev.br && sameStyle(prev, r)) prev.text += r.text
      else if (r.text || r.br) out.push({ ...r })
    }
    return out
  }

  function sameStyle(a: Run, b: Run): boolean {
    const { text: _a, ...x } = a
    const { text: _b, ...y } = b
    return JSON.stringify(x) === JSON.stringify(y)
  }

  function lineHeight(cs: CSSStyleDeclaration): number | undefined {
    const v = Number.parseFloat(cs.lineHeight)
    return Number.isNaN(v) ? undefined : v
  }

  /** Hide an element's text from the background picture, but not what its `::before` and `::after` draw. */
  function textRead(el: Element) {
    el.setAttribute('data-pptx-text', '')
    for (const pseudo of ['before', 'after']) {
      const ps = style(el, `::${pseudo}`)
      if (ps.content && ps.content !== 'none' && ps.content !== 'normal') (el as HTMLElement).style.setProperty(`--pptx-${pseudo}`, ps.color)
    }
  }

  function paragraph(el: Element, box: Rect, before: number): Paragraph {
    textRead(el)
    const cs = style(el)
    const r = rectOf(el)
    const p: Paragraph = {
      runs: runsOf(el, cs),
      align: align(cs),
      before,
      left: Math.max(0, r.x + Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.borderLeftWidth) - box.x),
      indent: Number.parseFloat(cs.textIndent) || 0,
      level: 0,
    }
    const lh = lineHeight(cs)
    if (lh !== undefined) p.lineHeight = lh
    if (!p.runs.length) p.emptySize = Number.parseFloat(cs.fontSize)
    return p
  }

  const AUTO: Record<string, string> = {
    decimal: 'arabicPeriod', 'decimal-leading-zero': 'arabicPeriod', 'lower-alpha': 'alphaLcPeriod', 'lower-latin': 'alphaLcPeriod',
    'upper-alpha': 'alphaUcPeriod', 'upper-latin': 'alphaUcPeriod', 'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod',
  }
  const CHARS: Record<string, string> = { disc: '•', circle: '◦', square: '▪', '"-"': '-', "'-'": '-' }

  /** A list's items as paragraphs, nested lists as deeper levels. */
  function listParagraphs(list: Element, box: Rect, level: number, out: Paragraph[], lastBottom: { y: number }) {
    textRead(list)
    const ordered = list.matches('ol')
    let start = ordered ? Number((list as HTMLOListElement).start || 1) : 1
    for (const li of list.children) {
      if (!li.matches('li') || !visible(li)) continue
      const cs = style(li)
      const r = rectOf(li)
      // The item's own text: its inline content, or its paragraphs (a loose list).
      const parts = [...li.childNodes].filter((n) => !(n.nodeType === 1 && (n as Element).matches('ul, ol')))
      const blocks = parts.filter((n) => n.nodeType === 1 && isBlock(n as Element)) as Element[]
      const textRuns = blocks.length
        ? blocks.flatMap((b, k) => [...(k ? [{ ...runStyle(b, b), text: '', br: true }] : []), ...runsOf(b, style(b))])
        : runsOf(li, cs)
      const before = lastBottom.y < 0 ? 0 : Math.max(0, r.y - lastBottom.y)
      const textLeft = r.x + Number.parseFloat(cs.paddingLeft) - box.x
      const p: Paragraph = { runs: textRuns, align: align(cs), before, left: Math.max(0, textLeft), indent: 0, level }
      const lh = lineHeight(cs)
      if (lh !== undefined) p.lineHeight = lh
      const marker = style(li, '::marker')
      const pseudo = style(li, '::before')
      const content = pseudo.content
      const fontSize = Number.parseFloat(cs.fontSize)
      const hang = Number.parseFloat(cs.paddingLeft) > 2 ? Number.parseFloat(cs.paddingLeft) : Math.min(textLeft, fontSize * 1.2)
      if (content && content !== 'none' && content !== 'normal') {
        const text = /^["'](.*)["']$/.exec(content)?.[1]
        if (text) {
          li.setAttribute('data-pptx-bullet', '')
          p.bullet = { char: text, font: family(pseudo.fontFamily) }
          const c = colour(pseudo.color)
          if (c) p.bullet.colour = c
          const scale = Number.parseFloat(pseudo.fontSize) / fontSize
          if (scale && Math.abs(scale - 1) > 0.05) p.bullet.scale = Math.min(4, Math.max(0.25, scale))
        } else if (/counter\(/.test(content)) {
          li.setAttribute('data-pptx-bullet', '')
          p.bullet = { auto: 'arabicPeriod' }
          if (start !== 1) p.bullet.start = start
        } else {
          // Drawn by the theme (a shape): it stays in the background.
          p.noBullet = true
        }
        if (!p.noBullet) p.indent = -hang
      } else if (cs.listStyleType !== 'none' && cs.display === 'list-item') {
        li.setAttribute('data-pptx-bullet', '')
        const type = cs.listStyleType
        if (AUTO[type]) {
          p.bullet = { auto: AUTO[type]! }
          if (start !== 1) p.bullet.start = start
        } else {
          p.bullet = { char: CHARS[type] ?? (/^["'](.*)["']$/.exec(type)?.[1] ?? '•') }
        }
        const c = colour(marker.color)
        if (c) p.bullet.colour = c
        // An outside marker hangs left of the item's box.
        const listLeft = rectOf(list).x + Number.parseFloat(style(list).paddingLeft) - box.x
        p.left = Math.max(0, listLeft)
        p.indent = -Math.min(p.left, fontSize * 1.2)
      } else {
        p.noBullet = true
      }
      if (!p.runs.length) p.emptySize = fontSize
      out.push(p)
      // Nested lists' bottoms are measured from the item's text, not its whole box.
      const nested = [...li.children].filter((c) => c.matches('ul, ol'))
      lastBottom.y = nested.length ? (rectOf(nested[0]!).y) : r.y + r.h
      for (const n of nested) {
        listParagraphs(n, box, level + 1, out, lastBottom)
      }
      lastBottom.y = Math.max(lastBottom.y, r.y + r.h)
      if (ordered) start++
    }
  }

  /**
   * A list that reads as one: items one under the other, each its own
   * text. A list laid out as a row, a grid or cards (a component's steps,
   * a timeline) is shapes and text boxes instead, item by item.
   */
  function flowsAsList(list: Element): boolean {
    const cs = style(list)
    if (cs.display.includes('grid')) return false
    if (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) return false
    let prev: Rect | undefined
    for (const li of list.children) {
      if (!visible(li)) continue
      const r = rectOf(li)
      if (prev && r.y < prev.y + prev.h - 1) return false
      prev = r
      const lcs = style(li)
      if (lcs.display.includes('grid') || (lcs.display.includes('flex') && !lcs.flexDirection.startsWith('column'))) return false
      if (hasBox(li) || lcs.clipPath !== 'none') return false
      for (const c of li.children) if (isBlock(c) && !c.matches('p, ul, ol')) return false
    }
    return true
  }

  const name = (el: Element, fallback: string) => `${fallback} ${++names}`

  function textItem(el: Element, paragraphs: Paragraph[], rect: Rect, insets: TextItem['insets'], deco?: ReturnType<typeof decoration>): TextItem {
    const cs = style(el)
    const item: TextItem = { kind: 'text', rect, paragraphs, insets, anchor: 't', name: name(el, el.matches('h1, h2, h3, h4, h5, h6') ? 'Heading' : el.matches('ul, ol') ? 'List' : el.matches('pre') ? 'Code' : 'Text') }
    if (/^(pre|nowrap)$/.test(cs.whiteSpace) || cs.textWrapMode === 'nowrap') item.nowrap = true
    if (deco) {
      if (deco.fill) item.fill = { colour: deco.fill }
      if (deco.uniform) item.line = deco.uniform
      if (deco.radius) item.radius = deco.radius
    }
    // Centred vertically: across a row, or along a column.
    if (cs.display.includes('flex')) {
      const column = cs.flexDirection.startsWith('column')
      const v = column ? cs.justifyContent : cs.alignItems
      if (v === 'center') item.anchor = 'ctr'
      else if (v === 'flex-end' || v === 'end') item.anchor = 'b'
    } else if (cs.display.includes('grid') && (cs.alignContent === 'center' || cs.alignItems === 'center')) item.anchor = 'ctr'
    return item
  }

  /** Mark an element so the background picture leaves out its fill and borders. */
  const noBox = (el: Element) => el.setAttribute('data-pptx-nobox', '')
  const hide = (el: Element) => el.setAttribute('data-pptx-hide', '')

  function insetsOf(cs: CSSStyleDeclaration) {
    const n = (v: string) => Number.parseFloat(v) || 0
    return {
      l: n(cs.paddingLeft) + n(cs.borderLeftWidth),
      t: n(cs.paddingTop) + n(cs.borderTopWidth),
      r: n(cs.paddingRight) + n(cs.borderRightWidth),
      b: n(cs.paddingBottom) + n(cs.borderBottomWidth),
    }
  }

  /** A block with its own fill or borders: drawn as a shape, unless it's a text box itself. */
  function boxShape(el: Element, deco: ReturnType<typeof decoration>) {
    if (deco.image || (!deco.fill && !deco.sides.some(Boolean))) return
    noBox(el)
    const r = rectOf(el)
    if (deco.fill || deco.uniform) {
      const s: ShapeItem = { kind: 'shape', rect: r, name: `Box ${++names}` }
      if (deco.fill) s.fill = { colour: deco.fill }
      if (deco.uniform) s.line = deco.uniform
      if (deco.radius) s.radius = deco.radius
      items.push(s)
    }
    if (!deco.uniform) sideBars(el, deco.sides)
  }

  function picture(el: Element) {
    const id = pictures++
    el.setAttribute('data-pptx-pic', String(id))
    hide(el)
    const alt = el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? el.getAttribute('title') ?? ''
    const item: PictureItem = { kind: 'picture', rect: rectOf(el), id, alt, name: `${el.matches('[data-blitz-block]') ? 'Chart' : 'Picture'} ${++names}` }
    const chart = chartOf(el)
    if (chart) {
      item.chart = chart
      item.name = `Chart ${names}`
    }
    items.push(item)
  }

  /** An ECharts chart's data and look, from the live instance. */
  function chartOf(el: Element): ChartData | undefined {
    const hook = (el as {
      blitzChart?: { option(): Record<string, unknown>; theme: ChartTheme; spec: { format?: string; prefix?: string; suffix?: string; labels?: boolean }; axis(dim?: 'x' | 'y'): { min: number; max: number; interval?: number } | undefined }
    }).blitzChart
    if (!hook) return undefined
    const o = hook.option() as {
      series?: Array<Record<string, unknown>>
      xAxis?: Array<{ type?: string; data?: unknown[]; inverse?: boolean }>
      yAxis?: Array<{ type?: string; data?: unknown[]; inverse?: boolean }>
      title?: Array<{ text?: string; show?: boolean }>
      legend?: Array<{ show?: boolean }>
      color?: string[]
    }
    const theme = hook.theme
    const series = o.series ?? []
    if (!series.length) return undefined
    const kinds = new Set(series.map((s) => s.type))
    if (kinds.size !== 1) return undefined
    const kind = [...kinds][0] as string
    if (!['bar', 'line', 'pie', 'scatter'].includes(kind)) return undefined
    const palette = (o.color ?? theme.color ?? []).map((c) => colour(c) ?? hexColour(c))
    const cs = style(el)
    const paint = (c: string | undefined) => colour(c) ?? hexColour(c)
    const data: ChartData = {
      type: kind as ChartData['type'],
      categories: [],
      series: [],
      legend: o.legend?.[0]?.show !== false && series.length > 1,
      textColour: paint(theme.categoryAxis?.axisLabel?.color) ?? paint(theme.textStyle?.color) ?? colour(cs.color) ?? { hex: '000000', alpha: 1 },
      font: family(theme.textStyle?.fontFamily ?? cs.fontFamily),
      fontSize: theme.categoryAxis?.axisLabel?.fontSize ?? 18,
    }
    const range = hook.axis()
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) data.axis = range
    if (hook.spec.labels) data.labels = true
    const grid = paint(theme.valueAxis?.splitLine?.lineStyle?.color)
    if (grid) data.gridColour = grid
    const titleColour = paint(theme.title?.textStyle?.color)
    if (titleColour) data.titleColour = titleColour
    const title = o.title?.[0]
    if (title?.text && title.show !== false) data.title = title.text
    const value = (v: unknown): number | null => {
      const x = Array.isArray(v) ? v[v.length - 1] : v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v
      const n = Array.isArray(x) ? Number(x[x.length - 1]) : Number(x)
      return x === null || x === undefined || x === '-' || Number.isNaN(n) ? null : n
    }
    data.numberFormat = excelFormat(hook.spec, Math.max(0, ...series.flatMap((s) => ((s.data as unknown[]) ?? []).map((v) => Math.abs(value(v) ?? 0)))))
    if (kind === 'pie') {
      const s = series[0]!
      const points = (s.data as Array<{ name?: string; value?: unknown; itemStyle?: { color?: string } }>) ?? []
      data.categories = points.map((p) => String(p.name ?? ''))
      data.series = [{ name: String(s.name ?? ''), values: points.map((p) => value(p)) }]
      data.pointColours = points.map((p, k) => colour(p.itemStyle?.color) ?? hexColour(p.itemStyle?.color) ?? palette[k % Math.max(1, palette.length)]!).filter(Boolean) as Colour[]
      const radius = s.radius
      if (Array.isArray(radius) && radius[0] && radius[0] !== '0%' && radius[0] !== 0) {
        data.doughnut = true
        const inner = Number.parseFloat(String(radius[0]))
        const outer = Number.parseFloat(String(radius[1]))
        if (inner > 0 && outer > inner) data.hole = Math.round((100 * inner) / outer)
      }
      if ((s.label as { show?: boolean } | undefined)?.show) data.sliceLabels = true
      data.legend = o.legend?.[0]?.show !== false
      return data
    }
    const xCat = o.xAxis?.[0]?.type === 'category'
    const yCat = o.yAxis?.[0]?.type === 'category'
    if (kind === 'bar' && yCat) data.horizontal = true
    if ((data.horizontal ? o.yAxis?.[0] : o.xAxis?.[0])?.inverse) data.reversed = true
    const axis = data.horizontal ? o.yAxis?.[0] : o.xAxis?.[0]
    if (kind === 'scatter' || (!xCat && !yCat)) {
      data.type = 'scatter'
      data.series = series.map((s, k) => {
        const pts = ((s.data as unknown[]) ?? []).map((p) => (Array.isArray(p) ? p : (p as { value?: unknown[] }).value ?? []) as unknown[])
        const out: ChartData['series'][number] = { name: String(s.name ?? `Series ${k + 1}`), values: pts.map((p) => value(p[1])), x: pts.map((p) => Number(p[0])) }
        if (pts.length && pts.every((p) => p.length > 2)) out.sizes = pts.map((p) => Math.abs(Number(p[2])) || 0)
        const c = seriesColour(s, palette, k)
        if (c) out.colour = c
        return out
      })
      const across = hook.axis('x')
      if (across && Number.isFinite(across.min) && Number.isFinite(across.max)) data.xAxis = across
      // ECharts draws the biggest bubble 60px across; PowerPoint's is about a quarter of the plot's shorter side, measured against the drawing.
      if (data.series.some((s) => s.sizes)) data.bubbleScale = Math.round(Math.min(300, Math.max(10, (100 * 60) / (0.25 * Math.max(1, el.getBoundingClientRect().height * 1.6)))))
      return data
    }
    data.categories = (axis?.data ?? []).map((c) => String(c && typeof c === 'object' && 'value' in c ? (c as { value: unknown }).value : c))
    data.series = series.map((s, k) => {
      const out: ChartData['series'][number] = { name: String(s.name ?? `Series ${k + 1}`), values: ((s.data as unknown[]) ?? []).map(value) }
      const c = seriesColour(s, palette, k)
      if (c) out.colour = c
      return out
    })
    if (series.some((s) => s.stack)) data.stacked = true
    if (kind === 'line' && series.some((s) => s.areaStyle)) {
      data.area = true
      const opacity = (series.find((s) => s.areaStyle)!.areaStyle as { opacity?: number }).opacity
      data.areaOpacity = typeof opacity === 'number' ? opacity : 0.7
    }
    if (kind === 'line' && series.some((s) => s.smooth)) data.smooth = true
    return data
  }

  /** The chart's `format`, `prefix` and `suffix` as a spreadsheet number format. */
  function excelFormat(spec: { format?: string; prefix?: string; suffix?: string }, max: number): string {
    const quote = (t: string | undefined) => (t ? `"${t.replace(/"/g, '')}"` : '')
    let body = 'General'
    if (spec.format === 'compact') body = max >= 1e9 ? '0.0,,,"B"' : max >= 1e6 ? '0.0,,"M"' : max >= 1e4 ? '0.0,"K"' : '#,##0'
    else if (spec.format && /^0(\.0+)?%?$/.test(spec.format)) body = spec.format
    return `${quote(spec.prefix)}${body}${quote(spec.suffix)}`
  }

  function hexColour(c: unknown): Colour | undefined {
    if (typeof c !== 'string') return undefined
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
    if (!m) return undefined
    const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join('') : m[1]!
    return { hex: h.toLowerCase(), alpha: 1 }
  }

  function seriesColour(s: Record<string, unknown>, palette: Array<Colour | undefined>, k: number): Colour | undefined {
    const own = (s.itemStyle as { color?: unknown } | undefined)?.color ?? (s.lineStyle as { color?: unknown } | undefined)?.color ?? s.color
    return colour(own as string) ?? hexColour(own) ?? palette[k % Math.max(1, palette.length)]
  }

  function table(el: HTMLTableElement) {
    // The table draws its own fills and borders; what its cells' ::before draw stays in the background.
    noBox(el)
    for (const part of el.querySelectorAll('thead, tbody, tfoot, tr, th, td')) noBox(part)
    for (const cell of el.querySelectorAll('th, td')) textRead(cell)
    const rect = rectOf(el)
    const rows = [...el.rows].filter((r) => visible(r))
    // Columns start where cells start (the spacing between cells is part of the column before).
    const lefts = new Set<number>([0])
    for (const row of rows) for (const cell of row.cells) lefts.add(Math.round(rectOf(cell).x - rect.x))
    const starts = [...lefts].sort((a, b) => a - b).filter((x, k, all) => k === 0 || x - all[k - 1]! > 3)
    const edges = [...starts, rect.w]
    const cols = edges.slice(1).map((x, k) => x - edges[k]!)
    const heights = rows.map((row) => rectOf(row).h)
    const cells: Cell[] = []
    const colAt = (x: number) => {
      let best = 0
      edges.forEach((e, k) => Math.abs(e - x) < Math.abs(edges[best]! - x) && (best = k))
      return best
    }
    // The first column edge at or past a cell's right side: where its span ends.
    const endAt = (x: number) => {
      const k = edges.findIndex((e) => e >= x - 3)
      return k < 0 ? cols.length : k
    }
    rows.forEach((row, ri) => {
      for (const cell of row.cells) {
        const cs = style(cell)
        const cr = rectOf(cell)
        const col = Math.min(colAt(cr.x - rect.x), cols.length - 1)
        const end = Math.max(col + 1, endAt(cr.x + cr.w - rect.x))
        const c: Cell = {
          paragraphs: cellParagraphs(cell, cr),
          borders: {},
          insets: { l: Number.parseFloat(cs.paddingLeft) || 0, t: Number.parseFloat(cs.paddingTop) || 0, r: Number.parseFloat(cs.paddingRight) || 0, b: Number.parseFloat(cs.paddingBottom) || 0 },
          anchor: cs.verticalAlign === 'middle' ? 'ctr' : cs.verticalAlign === 'bottom' ? 'b' : 't',
          row: ri,
          col,
          rowSpan: Math.max(1, (cell as HTMLTableCellElement).rowSpan),
          colSpan: Math.max(1, end - col),
        }
        let fill = colour(cs.backgroundColor)
        for (let e: Element | null = row; !fill && e && e !== el.parentElement; e = e.parentElement) fill = colour(style(e).backgroundColor)
        if (fill) c.fill = { colour: fill }
        const side = (s: string) => line(cs.getPropertyValue(`border-${s}-width`), cs.getPropertyValue(`border-${s}-style`), cs.getPropertyValue(`border-${s}-color`))
        const [t, r, b, l] = ['top', 'right', 'bottom', 'left'].map(side)
        if (t) c.borders.t = t
        if (r) c.borders.r = r
        if (b) c.borders.b = b
        if (l) c.borders.l = l
        cells.push(c)
      }
    })
    items.push({ kind: 'table', rect, cols, rows: heights, cells, name: `Table ${++names}` })
  }

  function cellParagraphs(cell: Element, cr: Rect): Paragraph[] {
    const out: Paragraph[] = []
    const box = { x: cr.x, y: cr.y, w: cr.w, h: cr.h }
    if (isTextBlock(cell) || !cell.children.length) {
      const p = paragraph(cell, box, 0)
      p.left = 0
      out.push(p)
      return out
    }
    let bottom = -1
    const visit = (el: Element) => {
      for (const c of el.children) {
        if (!visible(c)) continue
        const r = rectOf(c)
        if (c.matches('ul, ol')) {
          const lb = { y: bottom }
          listParagraphs(c, box, 0, out, lb)
          for (const p of out) p.left = Math.max(0, p.left - (Number.parseFloat(style(cell).paddingLeft) || 0))
          bottom = lb.y
        } else if (isTextBlock(c)) {
          const p = paragraph(c, box, bottom < 0 ? 0 : Math.max(0, r.y - bottom))
          p.left = 0
          out.push(p)
          bottom = r.y + r.h
        } else visit(c)
      }
    }
    visit(cell)
    return out
  }

  /** Consecutive paragraphs and lists, one under the other in the same column: one text box. */
  function flow(parent: Element) {
    let group: Element[] = []
    const flush = () => {
      // One paragraph alone is a text box of its own, with its own box and insets.
      if (group.length === 1) walk(group[0]!)
      else if (group.length) textGroup(group)
      group = []
    }
    for (const el of parent.children) {
      if (!visible(el) || style(el).display === 'none') continue
      const list = el.matches('ul, ol')
      const groupable = (list ? flowsAsList(el) : el.matches('p') || (isTextBlock(el) && !el.matches('h1, h2, h3, h4, h5, h6'))) && !hasBox(el) && !el.matches('pre')
      if (groupable && group.length) {
        const prev = rectOf(group[group.length - 1]!)
        const r = rectOf(el)
        if (Math.abs(prev.x - r.x) > 1 || Math.abs(prev.w - r.w) > 1 || r.y < prev.y + prev.h - 1) flush()
      }
      if (groupable && (isTextBlock(el) || list)) {
        group.push(el)
        continue
      }
      flush()
      walk(el)
    }
    flush()
  }

  const hasBox = (el: Element) => {
    const d = decoration(el)
    return !!(d.fill || d.sides.some(Boolean))
  }

  function textGroup(group: Element[]) {
    const rects = group.map(rectOf)
    const box = {
      x: Math.min(...rects.map((r) => r.x)),
      y: Math.min(...rects.map((r) => r.y)),
      w: Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x)),
      h: Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y)),
    }
    const paragraphs: Paragraph[] = []
    let bottom = -1
    group.forEach((el, k) => {
      const r = rects[k]!
      if (el.matches('ul, ol')) {
        const lb = { y: bottom }
        const start = paragraphs.length
        listParagraphs(el, box, 0, paragraphs, lb)
        if (paragraphs[start] && bottom >= 0) paragraphs[start]!.before = Math.max(0, rectOf(el.children[0] ?? el).y - bottom)
        bottom = r.y + r.h
      } else {
        paragraphs.push(paragraph(el, box, bottom < 0 ? 0 : Math.max(0, r.y - bottom)))
        bottom = r.y + r.h
      }
    })
    items.push(textItem(group[0]!, paragraphs, box, { l: 0, t: 0, r: 0, b: 0 }))
  }

  function walk(el: Element) {
    if (!visible(el) || style(el).display === 'none' || el.matches('.blitz-print-missing, script, style, template, .katex-mathml')) return
    if (el.matches('table')) return table(el as HTMLTableElement)
    if (isPicture(el)) return picture(el)
    const deco = decoration(el)
    if (el.matches('ul, ol') && flowsAsList(el)) {
      const box = rectOf(el)
      const paragraphs: Paragraph[] = []
      listParagraphs(el, box, 0, paragraphs, { y: -1 })
      boxShape(el, deco)
      return void items.push(textItem(el, paragraphs, box, { l: 0, t: 0, r: 0, b: 0 }))
    }
    if (isTextBlock(el)) {
      const cs = style(el)
      const rect = rectOf(el)
      const p = paragraph(el, rect, 0)
      const insets = insetsOf(cs)
      p.left = 0
      // Its own fill and even border go on the text box; uneven borders are bars beside it.
      if (deco.fill || deco.sides.some(Boolean)) {
        if (!deco.image) noBox(el)
        if (!deco.uniform && !deco.image) sideBars(el, deco.sides)
      }
      const item = textItem(el, [p], rect, insets, deco.image ? undefined : deco)
      if (!item.fill && !item.line) {
        // No box to draw: the text box is where the text is, below a marker
        // the theme draws first (a timeline's stop), however it's aligned.
        const text = el.ownerDocument.createRange()
        text.selectNodeContents(el)
        const t = text.getBoundingClientRect()
        if (t.height > 0) {
          item.rect = { ...item.rect, y: t.top - origin.top, h: t.height }
          item.insets = { ...item.insets, t: 0, b: 0 }
          item.anchor = 't'
        }
      }
      // One line stays one line, whatever the fonts PowerPoint has.
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(el)
      const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top + q.height / 2)))
      const lines = [...tops].sort((a, b) => a - b).filter((y, k, all) => k === 0 || y - all[k - 1]! > 4)
      if (lines.length === 1 && !p.runs.some((run) => run.br)) {
        item.nowrap = true
        const t = range.getBoundingClientRect()
        if (p.align === 'l' && !item.fill && !item.line && t.width > 0) {
          const right = item.rect.x + item.rect.w
          item.rect = { ...item.rect, x: t.left - origin.left, w: right - (t.left - origin.left) }
          item.insets = { ...item.insets, l: 0 }
        }
      }
      if (el.matches('h1, h2, h3, h4, h5, h6')) item.title = false
      return void items.push(item)
    }
    boxShape(el, deco)
    flow(el)
  }

  flow(page)

  // The slide's title: its first heading, as PowerPoint's title placeholder.
  const label = page.getAttribute('aria-label')
  const heading = items.find((i): i is TextItem => i.kind === 'text' && i.title === false && i.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim() === label)
  if (heading) heading.title = true
  for (const i of items) if (i.kind === 'text' && i.title === false) delete i.title

  const root = style(page)
  const h = page.querySelector('h1, h2, h3')
  const accents: Colour[] = []
  for (let k = 1; k <= 6; k++) {
    const c = colour(root.getPropertyValue(`--blitz-chart-${k}`)) ?? hexColour(root.getPropertyValue(`--blitz-chart-${k}`))
    if (c) accents.push(c)
  }
  return {
    items,
    theme: {
      heading: family(h ? style(h).fontFamily : root.fontFamily),
      body: family(root.fontFamily),
      text: colour(root.color) ?? { hex: '000000', alpha: 1 },
      background: colour(root.backgroundColor) ?? colour(style(page.ownerDocument.body).backgroundColor) ?? { hex: 'ffffff', alpha: 1 },
      accents,
    },
  }
}

/**
 * What the background picture leaves out: the text that was read, and
 * everything drawn as an editable shape. Pictures are photographed without
 * them too (`data-pptx-shot`), so text over a picture isn't in it twice.
 */
export const BACKGROUND_CSS = `
[data-pptx-bg] [data-pptx-text], [data-pptx-bg] [data-pptx-text] *, [data-pptx-shot] [data-pptx-text], [data-pptx-shot] [data-pptx-text] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }
[data-pptx-bg] [data-pptx-text]::before, [data-pptx-shot] [data-pptx-text]::before { color: var(--pptx-before) !important; -webkit-text-fill-color: var(--pptx-before) !important; }
[data-pptx-bg] [data-pptx-text]::after, [data-pptx-shot] [data-pptx-text]::after { color: var(--pptx-after) !important; -webkit-text-fill-color: var(--pptx-after) !important; }
[data-pptx-bg] [data-pptx-bullet]::marker, [data-pptx-bg] [data-pptx-bullet]::before, [data-pptx-shot] [data-pptx-bullet]::marker, [data-pptx-shot] [data-pptx-bullet]::before { color: transparent !important; -webkit-text-fill-color: transparent !important; }
[data-pptx-bg] [data-pptx-hide] { visibility: hidden !important; }
[data-pptx-bg] [data-pptx-nobox], [data-pptx-shot] [data-pptx-nobox] { background: none !important; border-color: transparent !important; box-shadow: none !important; outline: none !important; }
`
