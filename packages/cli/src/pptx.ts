/**
 * A PowerPoint presentation as a deck (docs/powerpoint.md): `blitzstrahl dev
 * talk.pptx` shows its slides as they look in PowerPoint, without the
 * animations. Each slide becomes one block of raw HTML (syntax.md §1) with
 * every shape absolutely placed on the canvas, and its speaker notes become
 * `::: notes`. The markdown that comes out is an ordinary deck, so dev,
 * build, export, present and check all work on it unchanged.
 *
 * A .pptx is a zip of XML parts: `ppt/presentation.xml` lists the slides,
 * each slide names its layout, each layout its master, and the master its
 * theme (colours, fonts, line and fill styles). A shape's position, text
 * style and bullets are inherited along that chain, a placeholder from the
 * layout's and master's placeholder of the same kind. Pictures are carried
 * as `data:` URLs, so the deck needs no files beside it.
 *
 * Legacy binary files (.ppt, .pps) and OpenDocument (.odp) are converted to
 * .pptx first by LibreOffice, when it's installed (legacyToPptx).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { unzipSync } from 'fflate'
import { specProblem } from '@blitzstrahl/renderers/specs'
import { fontStack, fromHsl, mix, rgb, toHsl } from './colour.js'
import { CliError } from './errors.js'

/** Files that are a PowerPoint package (a zip of XML parts). */
export const PPTX = /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i
/** Files LibreOffice converts to a package first. */
export const LEGACY = /\.(ppt|pps|pot|odp|otp)$/i
/** Any presentation `loadDeck` reads instead of markdown. */
export const PRESENTATION = /\.(pptx|pptm|ppsx|ppsm|potx|potm|ppt|pps|pot|odp|otp)$/i

export interface Presentation {
  /** The deck, as markdown. */
  source: string
  /** What the presentation has that the deck doesn't show, one line each. */
  notCarried: string[]
}

/* ------------------------------------------------------------------ XML -- */

/** An element: local name (no prefix), attributes as written (`r:embed`), children in order. */
interface El {
  tag: string
  at: Record<string, string>
  kids: El[]
  /** Character data, for `#text` nodes. */
  text?: string
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
})

/** fast-xml-parser's ordered output → El. `mc:AlternateContent` is replaced by its fallback, which any reader can show. */
function toEls(nodes: unknown[]): El[] {
  const out: El[] = []
  for (const node of nodes as Array<Record<string, unknown>>) {
    const name = Object.keys(node).find((k) => k !== ':@')
    if (!name || name.startsWith('?')) continue
    if (name === '#text') {
      out.push({ tag: '#text', at: {}, kids: [], text: String(node[name]) })
      continue
    }
    const el: El = { tag: name.slice(name.indexOf(':') + 1), at: (node[':@'] as Record<string, string>) ?? {}, kids: toEls(node[name] as unknown[]) }
    if (el.tag === 'AlternateContent') {
      const pick = child(el, 'Fallback') ?? child(el, 'Choice')
      if (pick) out.push(...pick.kids)
      continue
    }
    out.push(el)
  }
  return out
}

const child = (el: El | undefined, tag: string): El | undefined => el?.kids.find((k) => k.tag === tag)
const children = (el: El | undefined, tag: string): El[] => el?.kids.filter((k) => k.tag === tag) ?? []
/** The element at a path of child tags. */
const at = (el: El | undefined, ...path: string[]): El | undefined => path.reduce<El | undefined>((e, t) => child(e, t), el)
const num = (v: string | undefined, fallback: number): number => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v))
const textOf = (el: El): string => el.kids.map((k) => (k.tag === '#text' ? k.text! : '')).join('')
/** `true`/`1`/`on` (OOXML booleans). */
const yes = (v: string | undefined) => v === '1' || v === 'true' || v === 'on'

/* ----------------------------------------------------------- the package -- */

interface Rel {
  target: string
  type: string
  external: boolean
}

class Package {
  private cache = new Map<string, El | undefined>()
  private relCache = new Map<string, Map<string, Rel>>()
  private uris = new Map<string, string | undefined>()
  constructor(private zip: Record<string, Uint8Array>) {}

  has(part: string): boolean {
    return part in this.zip
  }

  /** A part's root element. */
  xml(part: string): El | undefined {
    if (!this.cache.has(part)) {
      const bytes = this.zip[part]
      let root: El | undefined
      if (bytes) {
        try {
          root = toEls(parser.parse(new TextDecoder().decode(bytes)) as unknown[]).find((e) => e.tag !== '#text')
        } catch {
          root = undefined
        }
      }
      this.cache.set(part, root)
    }
    return this.cache.get(part)
  }

  /** A part's relationships, by id, with targets resolved to part names. */
  rels(part: string): Map<string, Rel> {
    let map = this.relCache.get(part)
    if (map) return map
    map = new Map()
    const dir = part.slice(0, part.lastIndexOf('/') + 1)
    const relsPart = `${dir}_rels/${part.slice(dir.length)}.rels`
    for (const r of children(this.xml(relsPart), 'Relationship')) {
      const external = r.at.TargetMode === 'External'
      const target = r.at.Target ?? ''
      map.set(r.at.Id ?? '', { target: external ? target : resolvePart(dir, target), type: (r.at.Type ?? '').replace(/^.*\//, ''), external })
    }
    this.relCache.set(part, map)
    return map
  }

  /** The first related part of a type (`slideLayout`, `notesSlide`). */
  related(part: string, type: string): string | undefined {
    for (const r of this.rels(part).values()) if (r.type === type && !r.external) return r.target
    return undefined
  }

  /** A picture as a `data:` URL, or undefined when browsers can't show its format. */
  dataUri(part: string): string | undefined {
    if (!this.uris.has(part)) {
      const bytes = this.zip[part]
      const type = IMAGE_TYPES[extname(part).slice(1).toLowerCase()]
      this.uris.set(part, bytes && type ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : undefined)
    }
    return this.uris.get(part)
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/** `../media/image1.png` from `ppt/slides/` → `ppt/media/image1.png`. A leading `/` is the package root. */
function resolvePart(dir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

/* --------------------------------------------------------------- colour -- */

interface Colour {
  hex: string
  alpha: number
}

interface Theme {
  scheme: Record<string, string>
  major: string
  minor: string
  fills: El[]
  lines: El[]
  bgFills: El[]
}

const PRESET_COLOURS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', ltGray: '#d3d3d3', dkGray: '#a9a9a9', orange: '#ffa500', purple: '#800080',
  navy: '#000080', teal: '#008080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff',
}
const SYSTEM_COLOURS: Record<string, string> = { windowText: '#000000', window: '#ffffff', btnFace: '#f0f0f0', highlight: '#0078d7', highlightText: '#ffffff' }

const css = (c: Colour): string => {
  if (c.alpha >= 0.999) return c.hex
  const [r, g, b] = rgb(c.hex)
  return `rgba(${r}, ${g}, ${b}, ${+c.alpha.toFixed(3)})`
}

/* ------------------------------------------------------------- the deck -- */

/** Where shapes go: EMUs to canvas pixels, relative to the element they're drawn in. */
interface Frame {
  ox: number
  oy: number
  sx: number
  sy: number
}

/** A part whose shapes are being drawn: a slide, its layout or its master, or a SmartArt drawing. */
interface Source {
  part: string
}

interface Placeholder {
  type: string
  idx?: string
}

/** A paint: CSS for HTML, and for SVG an attribute value plus any `<defs>` it needs. */
type Paint = { kind: 'none' } | { kind: 'solid'; colour: Colour } | { kind: 'gradient'; stops: Array<[number, Colour]>; angle: number; radial: boolean } | { kind: 'image'; url: string; tile: boolean }

interface Line {
  width: number
  paint: Paint
  dash?: string
  /** Line ends (`a:headEnd`, `a:tailEnd`): their `type`, `w` and `len`. */
  head?: El
  tail?: El
}

/** Converts a presentation package to a deck. `name` is the file's name, for the title. */
export function pptxToMarkdown(bytes: Uint8Array, name: string): Presentation {
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(bytes)
  } catch {
    zip = {}
  }
  const pkg = new Package(zip)
  const presentation = pkg.xml('ppt/presentation.xml')
  if (!presentation) throw new CliError(`${name} isn't a PowerPoint presentation (.pptx): it has no ppt/presentation.xml`)
  return new Converter(pkg, presentation, name).convert()
}

/**
 * PowerPoint's built-in table styles aren't always saved in the file
 * (`ppt/tableStyles.xml`): its default, Medium Style 2, in each accent, is
 * written out here, as PowerPoint defines it.
 */
const MEDIUM_STYLE_2: Record<string, string> = {
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1',
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1',
  '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2',
  '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4',
  '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5',
  '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6',
}

function mediumStyle2(id: string, accent: string): El | undefined {
  const ln = (w: number) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>`
  const fill = (mod: string) => `<a:fill><a:solidFill><a:schemeClr val="${accent}">${mod}</a:schemeClr></a:solidFill></a:fill>`
  const strong = (name: string, border = '') =>
    `<a:${name}><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${border}</a:tcBdr>${fill('')}</a:tcStyle></a:${name}>`
  const sides = ['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((s) => `<a:${s}>${ln(12700)}</a:${s}>`).join('')
  const xml =
    `<a:tblStyle xmlns:a="a" styleId="${id}">` +
    `<a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${sides}</a:tcBdr>${fill('<a:tint val="20000"/>')}</a:tcStyle></a:wholeTbl>` +
    `<a:band1H><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1H>` +
    `<a:band1V><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1V>` +
    strong('lastCol') +
    strong('firstCol') +
    strong('lastRow', `<a:top>${ln(38100)}</a:top>`) +
    strong('firstRow', `<a:bottom>${ln(38100)}</a:bottom>`) +
    '</a:tblStyle>'
  return toEls(parser.parse(xml) as unknown[])[0]
}

/** Bullet numbering schemes (`a:buAutoNum`): how a number is written, and what wraps it. */
const NUMBERING: Record<string, (n: number) => string> = {
  arabic: (n) => String(n),
  alphaLc: (n) => letters(n).toLowerCase(),
  alphaUc: (n) => letters(n),
  romanLc: (n) => roman(n).toLowerCase(),
  romanUc: (n) => roman(n),
}
function letters(n: number): string {
  let s = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s
  return s
}
function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let s = ''
  let k = n
  for (const [v, r] of table) while (k >= v) (s += r), (k -= v)
  return s
}
function autoNumber(scheme: string, n: number): string {
  const m = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(.*)$/.exec(scheme)
  const write = NUMBERING[m?.[1] ?? 'arabic']!
  const v = write(n)
  switch (m?.[2]) {
    case 'ParenBoth':
      return `(${v})`
    case 'ParenR':
      return `${v})`
    case 'Plain':
      return v
    case 'Minus':
      return `- ${v} -`
    default:
      return `${v}.`
  }
}

/** Characters in symbol fonts that bullets use, as the Unicode a browser can show. */
const SYMBOL_BULLETS: Record<string, string> = { '\uf0b7': '•', '\uf0a7': '▪', '\uf076': '❖', '\uf0d8': '➢', '\uf0fc': '✓', '\uf0a8': '◆', '\uf06e': '■', '\uf071': '❑', '§': '▪', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'o': 'o' }

/** Text for HTML. Line breaks too: a blank line would end the slide's raw HTML block. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;')
const px = (v: number) => `${+v.toFixed(2)}px`
const r2 = (v: number) => +v.toFixed(2)

class Converter {
  private notCarried = new Set<string>()
  private theme!: Theme
  private clrMap: Record<string, string> = {}
  private canvas: { width: number; height: number }
  private cx: number
  private cy: number
  /** Canvas pixels per point. */
  private ptPx: number
  private defaultTextStyle: El | undefined
  private tableStyles: El | undefined
  private gradientId = 0
  private slideNumber = 0

  constructor(
    private pkg: Package,
    private presentation: El,
    private name: string,
  ) {
    const size = child(presentation, 'sldSz')
    this.cx = num(size?.at.cx, 12192000)
    this.cy = num(size?.at.cy, 6858000)
    this.canvas = { width: 1280, height: Math.round((1280 * this.cy) / this.cx) }
    this.ptPx = this.canvas.width / (this.cx / 12700)
    this.defaultTextStyle = child(presentation, 'defaultTextStyle')
    const styles = pkg.related('ppt/presentation.xml', 'tableStyles')
    this.tableStyles = styles ? pkg.xml(styles) : undefined
  }

  private lose(what: string) {
    this.notCarried.add(what)
  }

  convert(): Presentation {
    const pres = 'ppt/presentation.xml'
    const rels = this.pkg.rels(pres)
    const ids = children(child(this.presentation, 'sldIdLst'), 'sldId')
    const slides: string[] = []
    let hidden = 0
    let transitions = false
    for (const id of ids) {
      const part = rels.get(id.at['r:id'] ?? '')?.target
      const slide = part ? this.pkg.xml(part) : undefined
      if (!part || !slide) continue
      if (slide.at.show === '0') {
        hidden++
        continue
      }
      if (child(slide, 'transition')) transitions = true
      if (child(slide, 'timing')) this.lose('animations: each slide shows at its end state')
      this.slideNumber = slides.length + 1
      slides.push(this.slide(part, slide))
    }
    if (hidden) this.lose(`${hidden} hidden slide${hidden > 1 ? 's' : ''} (left out, as in a slide show)`)
    if (transitions) this.lose('slide transitions: every slide fades in')
    if (!slides.length) throw new CliError(`${this.name} has no slides to show`)

    const core = this.pkg.xml('docProps/core.xml')
    const title = core ? textOf(child(core, 'title') ?? { tag: '', at: {}, kids: [] }).trim() : ''
    const author = core ? textOf(child(core, 'creator') ?? { tag: '', at: {}, kids: [] }).trim() : ''
    const fm = [`title: ${JSON.stringify(title || basename(this.name, extname(this.name)))}`]
    if (author) fm.push(`author: ${JSON.stringify(author)}`)
    if (this.canvas.width !== 1280 || this.canvas.height !== 720) fm.push(`canvas: ${this.canvas.width}x${this.canvas.height}`)
    fm.push(`transition: ${transitions ? 'fade' : 'none'}`)
    // Theme rules (`.blitz-slide td`, `img`) would restyle the slides' own
    // elements: inside .blitz-pptx everything starts from the browser's
    // defaults, and the inline styles say the rest. Not SVG: reverting would
    // drop its presentation attributes (`fill`, `d`) too. Not charts either,
    // which are render blocks styled by the runtime.
    const reset = '<style>.blitz-slide .blitz-pptx.blitz-pptx, .blitz-slide .blitz-pptx.blitz-pptx :not(svg, svg *, [data-blitz-block], [data-blitz-block] *) { all: revert; box-sizing: border-box; } .blitz-slide .blitz-pptx.blitz-pptx a { color: inherit; }</style>'
    return {
      source: `---\n${fm.join('\n')}\n---\n\n${reset}\n${slides.join('\n\n---\n\n')}\n`,
      notCarried: [...this.notCarried],
    }
  }

  /* ---- one slide ---- */

  private slide(part: string, slide: El): string {
    const layoutPart = this.pkg.related(part, 'slideLayout')
    const layout = layoutPart ? this.pkg.xml(layoutPart) : undefined
    const masterPart = layoutPart ? this.pkg.related(layoutPart, 'slideMaster') : undefined
    const master = masterPart ? this.pkg.xml(masterPart) : undefined
    const themePart = masterPart ? this.pkg.related(masterPart, 'theme') : undefined
    this.theme = this.readTheme(themePart)

    // The colour map: the master's, unless the layout or slide overrides it.
    this.clrMap = { ...(child(master, 'clrMap')?.at ?? {}) }
    for (const el of [layout, slide]) {
      const over = at(el, 'clrMapOvr', 'overrideClrMapping')
      if (over) this.clrMap = { ...over.at }
    }

    const chain: Chain = { slide, layout, master, layoutPart, masterPart }
    const frame: Frame = { ox: 0, oy: 0, sx: this.canvas.width / this.cx, sy: this.canvas.height / this.cy }
    const html: string[] = []
    // Master shapes, then the layout's, then the slide's: placeholders on the
    // master and layout are only prompts, and never shown.
    const showMaster = slide.at.showMasterSp !== '0'
    if (showMaster && master && layout?.at.showMasterSp !== '0') html.push(this.tree(at(master, 'cSld', 'spTree'), { part: masterPart! }, frame, chain, true))
    if (showMaster && layout) html.push(this.tree(at(layout, 'cSld', 'spTree'), { part: layoutPart! }, frame, chain, true))
    html.push(this.tree(at(slide, 'cSld', 'spTree'), { part }, frame, chain, false))

    const bg = this.background(chain, part)
    const label = esc(this.slideTitle(slide) ?? `Slide ${this.slideNumber}`)
    // What's past the slide's edge is hidden, as in PowerPoint, and isn't overflow (data-blitz-clip).
    const root = `<div class="blitz-pptx" data-blitz-clip role="img" aria-label="${label}" style="position:absolute;inset:0;overflow:hidden;line-height:1.2;${bg}">${html.join('')}</div>`
    const notes = this.notes(part)
    return notes ? `${root}\n\n::: notes\n${notes}\n:::` : root
  }

  /** The text of the slide's title placeholder, for screen readers. */
  private slideTitle(slide: El): string | undefined {
    for (const sp of children(at(slide, 'cSld', 'spTree'), 'sp')) {
      const ph = at(sp, 'nvSpPr', 'nvPr', 'ph')
      if (ph && /^(title|ctrTitle)$/.test(ph.at.type ?? '')) {
        const t = children(child(sp, 'txBody'), 'p').map((p) => this.plainText(p)).join(' ').trim()
        if (t) return t
      }
    }
    return undefined
  }

  private plainText(p: El): string {
    return p.kids.map((k) => (k.tag === 'r' || k.tag === 'fld' ? textOf(child(k, 't') ?? k) : k.tag === 'br' ? ' ' : '')).join('')
  }

  private readTheme(part: string | undefined): Theme {
    const el = part ? at(this.pkg.xml(part), 'themeElements') : undefined
    const scheme: Record<string, string> = {}
    for (const c of child(el, 'clrScheme')?.kids ?? []) {
      if (c.tag === '#text') continue
      const v = child(c, 'srgbClr')?.at.val ?? child(c, 'sysClr')?.at.lastClr
      if (v && /^[0-9a-f]{6}$/i.test(v)) scheme[c.tag] = `#${v.toLowerCase()}`
    }
    const fonts = child(el, 'fontScheme')
    const fmt = child(el, 'fmtScheme')
    const list = (tag: string) => (child(fmt, tag)?.kids ?? []).filter((k) => k.tag !== '#text')
    return {
      scheme,
      major: at(fonts, 'majorFont', 'latin')?.at.typeface ?? 'Calibri Light',
      minor: at(fonts, 'minorFont', 'latin')?.at.typeface ?? 'Calibri',
      fills: list('fillStyleLst'),
      lines: list('lnStyleLst'),
      bgFills: list('bgFillStyleLst'),
    }
  }

  /* ---- colours and paints ---- */

  private schemeColour(name: string): string | undefined {
    const mapped = /^(bg|tx)[12]$/.test(name) ? (this.clrMap[name] ?? ({ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } as Record<string, string>)[name]!) : name
    return this.theme.scheme[mapped]
  }

  /** The colour an element holds (`a:solidFill`, `a:gs`, `a:buClr`…), modifiers applied. `ph` is what `phClr` means here. */
  private colour(holder: El | undefined, ph?: Colour): Colour | undefined {
    if (!holder) return undefined
    for (const c of holder.kids) {
      let base: Colour | undefined
      switch (c.tag) {
        case 'srgbClr':
          base = /^[0-9a-f]{6}$/i.test(c.at.val ?? '') ? { hex: `#${c.at.val!.toLowerCase()}`, alpha: 1 } : undefined
          break
        case 'schemeClr': {
          if (c.at.val === 'phClr') base = ph
          else {
            const h = this.schemeColour(c.at.val ?? '')
            base = h ? { hex: h, alpha: 1 } : undefined
          }
          break
        }
        case 'sysClr': {
          const h = c.at.lastClr && /^[0-9a-f]{6}$/i.test(c.at.lastClr) ? `#${c.at.lastClr.toLowerCase()}` : SYSTEM_COLOURS[c.at.val ?? '']
          base = h ? { hex: h, alpha: 1 } : undefined
          break
        }
        case 'prstClr': {
          const h = PRESET_COLOURS[c.at.val ?? '']
          base = h ? { hex: h, alpha: 1 } : undefined
          break
        }
        case 'scrgbClr': {
          const ch = ['r', 'g', 'b'].map((k) => Math.round(Math.min(1, num(c.at[k], 0) / 100000) ** (1 / 2.2) * 255))
          base = { hex: `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`, alpha: 1 }
          break
        }
        case 'hslClr':
          base = { hex: fromHsl(num(c.at.hue, 0) / 21600000, num(c.at.sat, 0) / 100000, num(c.at.lum, 0) / 100000), alpha: 1 }
          break
        default:
          continue
      }
      return base && modify(base, c)
    }
    return undefined
  }

  /** The theme's fill or background style `idx` (`p:style`'s `fillRef`, `p:bgRef`), coloured `ph`. */
  private themeFill(idx: number, ph: Colour | undefined): Paint | undefined {
    const style = idx >= 1001 ? this.theme.bgFills[idx - 1001] : idx > 0 ? this.theme.fills[idx - 1] : undefined
    if (!style) return idx === 0 ? { kind: 'none' } : undefined
    return this.paint({ tag: 'holder', at: {}, kids: [style] }, undefined, ph)
  }

  /** The fill set in `holder` (`spPr`, `bgPr`, `tcPr`, `rPr`), or undefined if it sets none. */
  private paint(holder: El | undefined, source: Source | undefined, ph?: Colour, group?: Paint): Paint | undefined {
    for (const f of holder?.kids ?? []) {
      switch (f.tag) {
        case 'noFill':
          return { kind: 'none' }
        case 'solidFill': {
          const c = this.colour(f, ph)
          return c ? { kind: 'solid', colour: c } : undefined
        }
        case 'gradFill': {
          const stops = children(child(f, 'gsLst'), 'gs')
            .map((gs): [number, Colour | undefined] => [num(gs.at.pos, 0) / 1000, this.colour(gs, ph)])
            .filter((s): s is [number, Colour] => !!s[1])
            .sort((a, b) => a[0] - b[0])
          if (!stops.length) return undefined
          const lin = child(f, 'lin')
          return { kind: 'gradient', stops, angle: num(lin?.at.ang, 0) / 60000, radial: !lin && !!child(f, 'path') }
        }
        case 'blipFill': {
          const url = source && this.blipUrl(f, source)
          if (!url) return undefined
          return { kind: 'image', url, tile: !!child(f, 'tile') }
        }
        case 'pattFill': {
          // A pattern, as its foreground colour over its background, blended.
          const fg = this.colour(child(f, 'fgClr'), ph)
          const bg = this.colour(child(f, 'bgClr'), ph)
          this.lose('pattern fills: shown as a plain colour')
          if (fg && bg) return { kind: 'solid', colour: { hex: mix(bg.hex, fg.hex, 0.4), alpha: bg.alpha } }
          return fg ? { kind: 'solid', colour: fg } : undefined
        }
        case 'grpFill':
          return group
      }
    }
    return undefined
  }

  /** A picture fill's URL: its SVG if it carries one, else its bitmap. */
  private blipUrl(blipFill: El, source: Source): string | undefined {
    const blip = child(blipFill, 'blip')
    if (!blip) return undefined
    const rels = this.pkg.rels(source.part)
    const svg = (child(blip, 'extLst')?.kids ?? []).flatMap((e) => e.kids).find((k) => k.tag === 'svgBlip')
    for (const id of [svg?.at['r:embed'], blip.at['r:embed']]) {
      const rel = id ? rels.get(id) : undefined
      if (!rel || rel.external) continue
      const url = this.pkg.dataUri(rel.target)
      if (url) return url
      this.lose(`pictures in formats browsers can't show (.${extname(rel.target).slice(1).toLowerCase()}): an empty frame in their place`)
    }
    if (blip.at['r:link']) this.lose('linked pictures (not stored in the file)')
    return undefined
  }

  private paintCss(p: Paint): string {
    switch (p.kind) {
      case 'none':
        return 'transparent'
      case 'solid':
        return css(p.colour)
      case 'gradient': {
        const stops = p.stops.map(([pos, c]) => `${css(c)} ${r2(pos)}%`).join(', ')
        return p.radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(${r2(p.angle + 90)}deg, ${stops})`
      }
      case 'image':
        return p.tile ? `url('${p.url}')` : `url('${p.url}') center / 100% 100% no-repeat`
    }
  }

  /** An SVG `fill`/`stroke` value; gradients and pictures add to `defs`. */
  private paintSvg(p: Paint, defs: string[]): string {
    switch (p.kind) {
      case 'none':
        return 'none'
      case 'solid':
        return css(p.colour)
      case 'gradient': {
        const id = `blitz-pptx-g${++this.gradientId}-${this.slideNumber}`
        const stops = p.stops.map(([pos, c]) => `<stop offset="${r2(pos)}%" stop-color="${c.hex}"${c.alpha < 1 ? ` stop-opacity="${r2(c.alpha)}"` : ''}/>`).join('')
        defs.push(p.radial ? `<radialGradient id="${id}">${stops}</radialGradient>` : `<linearGradient id="${id}" gradientTransform="rotate(${r2(p.angle)} .5 .5)">${stops}</linearGradient>`)
        return `url(#${id})`
      }
      case 'image': {
        const id = `blitz-pptx-g${++this.gradientId}-${this.slideNumber}`
        defs.push(`<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${p.url}" width="1" height="1" preserveAspectRatio="none"/></pattern>`)
        return `url(#${id})`
      }
    }
  }

  /* ---- backgrounds ---- */

  private background(chain: Chain, slidePart: string): string {
    const levels: Array<[El | undefined, string | undefined]> = [
      [chain.slide, slidePart],
      [chain.layout, chain.layoutPart],
      [chain.master, chain.masterPart],
    ]
    for (const [el, part] of levels) {
      const bg = at(el, 'cSld', 'bg')
      if (!bg || !part) continue
      const pr = child(bg, 'bgPr')
      const ref = child(bg, 'bgRef')
      const paint = pr ? this.paint(pr, { part }) : ref ? this.themeFill(num(ref.at.idx, 0), this.colour(ref)) : undefined
      if (!paint) continue
      if (paint.kind === 'image' && !paint.tile) return `background:url('${paint.url}') center / cover no-repeat;`
      return `background:${this.paintCss(paint)};`
    }
    return 'background:#ffffff;'
  }

  /* ---- shape trees ---- */

  /** The shapes of an `spTree` or `grpSp`, in order (later ones on top). `inherited`: a layout's or master's, without placeholders. */
  private tree(tree: El | undefined, source: Source, frame: Frame, chain: Chain, inherited: boolean, group?: Paint): string {
    const out: string[] = []
    for (const el of tree?.kids ?? []) {
      switch (el.tag) {
        case 'sp':
        case 'cxnSp': {
          const nv = child(el, el.tag === 'sp' ? 'nvSpPr' : 'nvCxnSpPr')
          if (yes(child(nv, 'cNvPr')?.at.hidden)) break
          const ph = at(nv, 'nvPr', 'ph')
          if (inherited && ph) break
          out.push(this.shape(el, source, frame, chain, ph ? { type: ph.at.type ?? 'body', ...(ph.at.idx !== undefined ? { idx: ph.at.idx } : {}) } : undefined, group))
          break
        }
        case 'pic': {
          if (yes(at(el, 'nvPicPr', 'cNvPr')?.at.hidden)) break
          const ph = at(el, 'nvPicPr', 'nvPr', 'ph')
          if (inherited && ph) break
          out.push(this.picture(el, source, frame, chain, ph ? { type: ph.at.type ?? 'body', ...(ph.at.idx !== undefined ? { idx: ph.at.idx } : {}) } : undefined))
          if (at(el, 'nvPicPr', 'nvPr', 'videoFile') || at(el, 'nvPicPr', 'nvPr', 'audioFile')) this.lose('video and sound: their poster frame is shown')
          break
        }
        case 'grpSp': {
          if (yes(at(el, 'nvGrpSpPr', 'cNvPr')?.at.hidden)) break
          const pr = child(el, 'grpSpPr')
          const xfrm = child(pr, 'xfrm')
          const box = this.box(xfrm, frame)
          const chOff = child(xfrm, 'chOff')
          const chExt = child(xfrm, 'chExt')
          const ext = child(xfrm, 'ext')
          const inner: Frame = {
            ox: num(chOff?.at.x, 0),
            oy: num(chOff?.at.y, 0),
            sx: frame.sx * (num(ext?.at.cx, 1) / (num(chExt?.at.cx, 0) || num(ext?.at.cx, 1))),
            sy: frame.sy * (num(ext?.at.cy, 1) / (num(chExt?.at.cy, 0) || num(ext?.at.cy, 1))),
          }
          const fill = this.paint(pr, source, undefined, group) ?? group
          out.push(`<div style="${this.placeCss(box, xfrm)}">${this.tree(el, source, inner, chain, inherited, fill)}</div>`)
          break
        }
        case 'graphicFrame': {
          if (yes(at(el, 'nvGraphicFramePr', 'cNvPr')?.at.hidden)) break
          if (inherited && at(el, 'nvGraphicFramePr', 'nvPr', 'ph')) break
          out.push(this.graphicFrame(el, source, frame, chain))
          break
        }
        case 'contentPart':
          this.lose('ink drawings')
          break
      }
    }
    return out.join('')
  }

  /** A box in the current frame, from an `xfrm`. */
  private box(xfrm: El | undefined, frame: Frame): Box {
    const off = child(xfrm, 'off')
    const ext = child(xfrm, 'ext')
    return {
      x: (num(off?.at.x, 0) - frame.ox) * frame.sx,
      y: (num(off?.at.y, 0) - frame.oy) * frame.sy,
      w: num(ext?.at.cx, 0) * frame.sx,
      h: num(ext?.at.cy, 0) * frame.sy,
    }
  }

  /** `position: absolute` at `box`, turned as the `xfrm` says. Flips are left to whoever draws (text doesn't mirror). */
  private placeCss(box: Box, xfrm: El | undefined, flips = false): string {
    const rot = num(xfrm?.at.rot, 0) / 60000
    const t: string[] = []
    if (rot) t.push(`rotate(${r2(rot)}deg)`)
    if (flips && yes(xfrm?.at.flipH)) t.push('scaleX(-1)')
    if (flips && yes(xfrm?.at.flipV)) t.push('scaleY(-1)')
    return `position:absolute;left:${px(box.x)};top:${px(box.y)};width:${px(box.w)};height:${px(box.h)};${t.length ? `transform:${t.join(' ')};` : ''}`
  }

  /** The layout's and master's placeholders this one inherits from, nearest first. */
  private inheritedPlaceholders(ph: Placeholder | undefined, chain: Chain): El[] {
    if (!ph) return []
    const find = (el: El | undefined, byIdx: boolean): El | undefined => {
      const shapes = [...children(at(el, 'cSld', 'spTree'), 'sp'), ...children(at(el, 'cSld', 'spTree'), 'pic')]
      const phOf = (s: El) => at(s, 'nvSpPr', 'nvPr', 'ph') ?? at(s, 'nvPicPr', 'nvPr', 'ph')
      const kind = (t: string) => (t === 'ctrTitle' ? 'title' : /^(obj|body|subTitle|pic|chart|tbl|dgm|media|clipArt)$/.test(t) ? 'body' : t)
      if (byIdx && ph.idx !== undefined) {
        const hit = shapes.find((s) => phOf(s)?.at.idx === ph.idx)
        if (hit) return hit
      }
      return shapes.find((s) => phOf(s) && (phOf(s)!.at.type ?? 'body') === ph.type) ?? shapes.find((s) => phOf(s) && kind(phOf(s)!.at.type ?? 'body') === kind(ph.type))
    }
    const out: El[] = []
    const fromLayout = find(chain.layout, true)
    if (fromLayout) out.push(fromLayout)
    const fromMaster = find(chain.master, false)
    if (fromMaster) out.push(fromMaster)
    return out
  }

  /** A shape's `xfrm`: its own, or its placeholder's on the layout or master. */
  private xfrmOf(spPr: El | undefined, inherited: El[]): El | undefined {
    const own = child(spPr, 'xfrm')
    if (child(own, 'off') && child(own, 'ext')) return own
    for (const el of inherited) {
      const x = at(el, 'spPr', 'xfrm')
      if (child(x, 'off') && child(x, 'ext')) return x
    }
    return own
  }

  /* ---- shapes ---- */

  private shape(sp: El, source: Source, frame: Frame, chain: Chain, ph: Placeholder | undefined, group: Paint | undefined): string {
    const spPr = child(sp, 'spPr')
    const inherited = this.inheritedPlaceholders(ph, chain)
    const xfrm = this.xfrmOf(spPr, inherited)
    const box = this.box(xfrm, frame)
    const style = child(sp, 'style')

    // Fill: the shape's own, its placeholder's, or its style's.
    const styleFill = style && child(style, 'fillRef') ? this.themeFill(num(child(style, 'fillRef')!.at.idx, 0), this.colour(child(style, 'fillRef'))) : undefined
    let fill = this.paint(spPr, source, undefined, group)
    for (const el of inherited) fill ??= this.paint(child(el, 'spPr'), { part: '' }, undefined, group)
    fill ??= styleFill ?? { kind: 'none' }
    const line = this.line(spPr, style, inherited)

    const parts: string[] = []
    const w = box.w
    const h = box.h
    if (fill.kind !== 'none' || line) {
      const geom = this.geometry(spPr ?? { tag: 'spPr', at: {}, kids: [] }, inherited, w, h)
      if (geom.length) parts.push(this.svg(geom, fill, line, w, h, xfrm))
    }
    const body = child(sp, 'txBody')
    if (body && this.hasText(body)) parts.push(this.textBody(body, sp, inherited, ph, chain, source, style))
    if (!parts.length) return ''
    const alt = child(child(sp, 'nvSpPr'), 'cNvPr')?.at.descr
    return `<div${alt ? ` aria-label="${esc(alt)}"` : ''} style="${this.placeCss(box, xfrm)}">${parts.join('')}</div>`
  }

  private hasText(body: El): boolean {
    return children(body, 'p').some((p) => p.kids.some((k) => (k.tag === 'r' || k.tag === 'fld') && textOf(child(k, 't') ?? k).length > 0))
  }

  /** A shape's outline: its own `a:ln`, over its style's `lnRef`. Undefined when there's none. */
  private line(spPr: El | undefined, style: El | undefined, inherited: El[] = []): Line | undefined {
    let ln = child(spPr, 'ln')
    for (const el of inherited) ln ??= at(el, 'spPr', 'ln')
    const ref = child(style, 'lnRef')
    const styleLn = ref ? this.theme.lines[num(ref.at.idx, 0) - 1] : undefined
    const refColour = ref ? this.colour(ref) : undefined
    const paint = this.paint(ln, undefined) ?? (styleLn ? this.paint(styleLn, undefined, refColour) : undefined)
    if (!paint || paint.kind === 'none') return undefined
    const width = num(ln?.at.w ?? styleLn?.at.w, 9525) * (this.canvas.width / this.cx)
    const dash = child(ln, 'prstDash')?.at.val ?? child(styleLn, 'prstDash')?.at.val
    const out: Line = { width: Math.max(width, 0.75), paint }
    if (dash && dash !== 'solid') out.dash = dash
    const head = child(ln, 'headEnd')
    const tail = child(ln, 'tailEnd')
    if (head?.at.type && head.at.type !== 'none') out.head = head
    if (tail?.at.type && tail.at.type !== 'none') out.tail = tail
    return out
  }

  /** The shape's outline paths, in pixels: one or more `[d, filled, stroked]`. */
  private geometry(spPr: El, inherited: El[], w: number, h: number): Array<[string, boolean, boolean]> {
    const cust = child(spPr, 'custGeom')
    if (cust) return customGeometry(cust, w, h)
    let prst = child(spPr, 'prstGeom')
    for (const el of inherited) prst ??= at(el, 'spPr', 'prstGeom')
    const name = prst?.at.prst ?? 'rect'
    const adj: Record<string, number> = {}
    for (const gd of children(child(prst, 'avLst'), 'gd')) {
      const m = /^val\s+(-?\d+)/.exec(gd.at.fmla ?? '')
      if (m && gd.at.name) adj[gd.at.name] = Number(m[1])
    }
    const d = presetPath(name, w, h, adj)
    if (d === undefined) {
      this.lose(`shapes of kinds blitzstrahl can't draw yet (${name}): drawn as rectangles`)
      return [[presetPath('rect', w, h, {})!, true, true]]
    }
    return [[d, !/^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5]|arc|bracketPair|leftBracket|rightBracket|leftBrace|rightBrace)$/.test(name), true]]
  }

  private svg(paths: Array<[string, boolean, boolean]>, fill: Paint, line: Line | undefined, w: number, h: number, xfrm: El | undefined): string {
    const defs: string[] = []
    const fillValue = this.paintSvg(fill, defs)
    const stroke = line ? this.paintSvg(line.paint, defs) : 'none'
    const sw = line ? r2(line.width) : 0
    let markers = ''
    if (line && (line.head || line.tail)) {
      const colour = line.paint.kind === 'solid' ? css(line.paint.colour) : 'currentColor'
      // Sizes as PowerPoint's: small, medium and large are 2, 3 and 5 line widths (at least 2pt).
      const scale = (v: string | undefined) => ({ sm: 2, lg: 5 })[v ?? ''] ?? 3
      const marker = (end: El, start: boolean) => {
        const id = `blitz-pptx-m${++this.gradientId}-${this.slideNumber}`
        const type = end.at.type!
        const base = Math.max(line.width, 2 * this.ptPx)
        const [mw, ml] = [scale(end.at.w) * base, scale(end.at.len) * base]
        const shape = type === 'oval' ? '<circle cx="5" cy="5" r="5"/>' : type === 'diamond' ? '<path d="M0 5 L5 0 L10 5 L5 10 Z"/>' : type === 'arrow' ? `<path d="M0 0 L10 5 L0 10" fill="none" stroke="${colour}" stroke-width="1.5"/>` : type === 'stealth' ? '<path d="M0 0 L10 5 L0 10 L3 5 Z"/>' : '<path d="M0 0 L10 5 L0 10 Z"/>'
        defs.push(`<marker id="${id}" viewBox="0 0 10 10" preserveAspectRatio="none" markerUnits="userSpaceOnUse" refX="${type === 'oval' || type === 'diamond' ? 5 : 9}" refY="5" markerWidth="${r2(ml)}" markerHeight="${r2(mw)}" orient="${start ? 'auto-start-reverse' : 'auto'}" fill="${colour}">${shape}</marker>`)
        return id
      }
      if (line.head) markers += ` marker-start="url(#${marker(line.head, true)})"`
      if (line.tail) markers += ` marker-end="url(#${marker(line.tail, false)})"`
    }
    const dash = line?.dash ? ` stroke-dasharray="${dashArray(line.dash, line.width)}"` : ''
    const body = paths
      .map(([d, filled, stroked]) => `<path d="${d}" fill="${filled ? fillValue : 'none'}" stroke="${stroked ? stroke : 'none'}"${stroked && line ? ` stroke-width="${sw}"${dash}${markers}` : ''}/>`)
      .join('')
    const flip: string[] = []
    if (yes(xfrm?.at.flipH)) flip.push('scaleX(-1)')
    if (yes(xfrm?.at.flipV)) flip.push('scaleY(-1)')
    return `<svg aria-hidden="true" width="${r2(Math.max(w, 1))}" height="${r2(Math.max(h, 1))}" viewBox="0 0 ${r2(Math.max(w, 1))} ${r2(Math.max(h, 1))}" style="position:absolute;left:0;top:0;overflow:visible;${flip.length ? `transform:${flip.join(' ')};` : ''}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`
  }

  /* ---- pictures ---- */

  private picture(pic: El, source: Source, frame: Frame, chain: Chain, ph: Placeholder | undefined): string {
    const spPr = child(pic, 'spPr')
    const inherited = this.inheritedPlaceholders(ph, chain)
    const xfrm = this.xfrmOf(spPr, inherited)
    const box = this.box(xfrm, frame)
    const blipFill = child(pic, 'blipFill')
    const url = blipFill ? this.blipUrl(blipFill, source) : undefined
    const alt = at(pic, 'nvPicPr', 'cNvPr')?.at.descr ?? ''
    const line = this.line(spPr, child(pic, 'style'))
    const prst = child(spPr, 'prstGeom')?.at.prst
    const clip = prst === 'ellipse' ? 'clip-path:ellipse(50% 50%);' : prst === 'roundRect' ? `border-radius:${px(Math.min(box.w, box.h) * 0.16667)};` : ''
    let img = ''
    if (url) {
      // Cropping (`a:srcRect`, in thousandths of a percent) as background size and position.
      const src = child(blipFill, 'srcRect')
      const [l, t, r, b] = ['l', 't', 'r', 'b'].map((k) => num(src?.at[k], 0) / 100000) as [number, number, number, number]
      const sizeX = 100 / Math.max(0.0001, 1 - l - r)
      const sizeY = 100 / Math.max(0.0001, 1 - t - b)
      const posX = l + r === 0 ? 0 : (l / (l + r)) * 100
      const posY = t + b === 0 ? 0 : (t / (t + b)) * 100
      const flip = [yes(xfrm?.at.flipH) ? 'scaleX(-1)' : '', yes(xfrm?.at.flipV) ? 'scaleY(-1)' : ''].filter(Boolean).join(' ')
      img = `<div role="img" aria-label="${esc(alt)}" style="position:absolute;inset:0;background:url(&quot;${url}&quot;) ${r2(posX)}% ${r2(posY)}% / ${r2(sizeX)}% ${r2(sizeY)}% no-repeat;${clip}${flip ? `transform:${flip};` : ''}"></div>`
    }
    const outline = line ? this.svg([[presetPath(prst === 'ellipse' ? 'ellipse' : 'rect', box.w, box.h, {})!, false, true]], { kind: 'none' }, line, box.w, box.h, undefined) : ''
    if (!img && !outline) return ''
    return `<div style="${this.placeCss(box, xfrm)}">${img}${outline}</div>`
  }

  /* ---- tables, charts, SmartArt ---- */

  private graphicFrame(gf: El, source: Source, frame: Frame, chain: Chain): string {
    const xfrm = child(gf, 'xfrm')
    const box = this.box(xfrm, frame)
    const data = at(gf, 'graphic', 'graphicData')
    const uri = data?.at.uri ?? ''
    if (child(data, 'tbl')) return `<div style="${this.placeCss(box, xfrm)}">${this.table(child(data, 'tbl')!, source, chain, frame)}</div>`
    if (uri.endsWith('/diagram')) {
      const drawing = this.smartArtDrawing(data!, source)
      if (drawing) {
        const inner: Frame = { ox: 0, oy: 0, sx: frame.sx, sy: frame.sy }
        return `<div style="${this.placeCss(box, xfrm)}">${this.tree(drawing.tree, { part: drawing.part }, inner, chain, false)}</div>`
      }
      this.lose('SmartArt saved without its drawing')
      return ''
    }
    if (uri.endsWith('/chart')) return this.chart(data!, source, box, xfrm) ?? this.chartPlaceholder(data!, source, box, xfrm)
    if (uri.endsWith('/ole')) {
      this.lose('embedded objects')
      return ''
    }
    return ''
  }

  /** SmartArt keeps a drawing of itself (`dsp:drawing`), referenced from its data part. */
  private smartArtDrawing(data: El, source: Source): { tree: El; part: string } | undefined {
    const relIds = child(data, 'relIds')
    const rels = this.pkg.rels(source.part)
    const dataPart = rels.get(relIds?.at['r:dm'] ?? '')?.target
    const dm = dataPart ? this.pkg.xml(dataPart) : undefined
    const ext = (child(dm, 'extLst')?.kids ?? []).flatMap((e) => e.kids).find((k) => k.tag === 'dataModelExt')
    const drawingPart = rels.get(ext?.at.relId ?? '')?.target ?? [...rels.values()].find((r) => r.type === 'diagramDrawing')?.target
    const drawing = drawingPart ? this.pkg.xml(drawingPart) : undefined
    const tree = child(drawing, 'spTree')
    return tree && drawingPart ? { tree, part: drawingPart } : undefined
  }

  /**
   * A chart, as a `chart` block (docs/renderers/chart.md) drawn from the
   * values PowerPoint keeps with it. The block can't be raw HTML, so the
   * slide's HTML is broken around it: a blank line, the fence, a blank line.
   * Its colours are the chart's own, set as the theme tokens it reads.
   */
  private chart(data: El, source: Source, box: Box, xfrm: El | undefined): string | undefined {
    const part = this.pkg.rels(source.part).get(child(data, 'chart')?.at['r:id'] ?? '')?.target
    const space = part ? this.pkg.xml(part) : undefined
    const chart = child(space, 'chart')
    const plot = child(chart, 'plotArea')
    const kinds = (plot?.kids ?? []).filter((k) => k.tag.endsWith('Chart'))
    const kind = kinds[0]
    if (!kind || !part) return undefined
    if (kinds.length > 1) this.lose('combination charts: only their first kind of series is shown')
    const sers = children(kind, 'ser')
    if (!sers.length) return undefined
    const textOfRef = (ref: El | undefined) => children(at(ref, 'strRef', 'strCache') ?? at(ref, 'numRef', 'numCache') ?? at(ref, 'strLit') ?? at(ref, 'numLit'), 'pt')
    const points = (ref: El | undefined) => {
      const out = new Map<number, string>()
      for (const pt of textOfRef(ref)) out.set(num(pt.at.idx, 0), textOf(child(pt, 'v') ?? pt))
      return out
    }
    const names = sers.map((s, i) => {
      const n = [...points(child(s, 'tx')).values()][0] ?? textOf(child(child(s, 'tx'), 'v') ?? { tag: '', at: {}, kids: [] })
      return n.trim() || `Series ${i + 1}`
    })
    const unique = names.map((n, i) => (names.indexOf(n) === i ? n : `${n} (${i + 1})`))
    const axisTitle = children(at(plot, 'catAx', 'title', 'tx', 'rich'), 'p').map((p) => this.plainText(p)).join(' ').trim()
    let xName = axisTitle || 'Category'
    while (unique.includes(xName)) xName += ' '
    const value = (v: string | undefined) => (v === undefined || v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v))

    const spec: Record<string, unknown> = {}
    const tag = kind.tag.replace(/3D/, '')
    const grouping = child(kind, 'grouping')?.at.val
    const stacked = grouping === 'stacked' || grouping === 'percentStacked'
    if (grouping === 'percentStacked') this.lose('100% stacked charts: shown stacked, as values')
    let rows: Array<Record<string, unknown>>
    if (tag === 'scatterChart' || tag === 'bubbleChart') {
      spec.type = 'scatter'
      rows = sers.flatMap((s, i) => {
        const xs = points(child(s, 'xVal'))
        const ys = points(child(s, 'yVal'))
        const sizes = points(child(s, 'bubbleSize'))
        return [...ys.keys()].map((k) => ({ x: value(xs.get(k)) ?? k + 1, y: value(ys.get(k)), ...(tag === 'bubbleChart' ? { size: value(sizes.get(k)) ?? 1 } : {}), ...(sers.length > 1 ? { series: unique[i] } : {}) }))
      })
      Object.assign(spec, { x: 'x', y: 'y' }, sers.length > 1 ? { series: 'series' } : {}, tag === 'bubbleChart' ? { size: 'size' } : {})
    } else {
      const cats = points(child(sers[0], 'cat'))
      const count = Math.max(cats.size, ...sers.map((s) => points(child(s, 'val')).size))
      const vals = sers.map((s) => points(child(s, 'val')))
      rows = Array.from({ length: count }, (_, k) => ({ [xName]: cats.get(k) ?? String(k + 1), ...Object.fromEntries(unique.map((n, i) => [n, value(vals[i]!.get(k))])) }))
      // Categories must be unique, or the chart would add them up.
      const seen = new Set<string>()
      for (const r of rows) {
        let c = String(r[xName])
        while (seen.has(c)) c += ' '
        seen.add(c)
        r[xName] = c
      }
      if (tag === 'pieChart' || tag === 'doughnutChart' || tag === 'ofPieChart') {
        spec.type = 'pie'
        if (tag === 'doughnutChart') spec.donut = true
        rows = rows.map((r) => ({ [xName]: r[xName], [unique[0]!]: Math.abs(Number(r[unique[0]!] ?? 0)) }))
        Object.assign(spec, { x: xName, y: unique[0] })
        if (sers.length > 1) this.lose('pie charts with more than one series: the first is shown')
      } else if (tag === 'barChart') {
        spec.type = 'bar'
        if (child(kind, 'barDir')?.at.val === 'bar') {
          spec.horizontal = true
          // PowerPoint draws the first category at the bottom, unless its axis runs the other way.
          if (at(plot, 'catAx', 'scaling', 'orientation')?.at.val !== 'maxMin') rows.reverse()
        }
        Object.assign(spec, { x: xName, y: unique }, stacked ? { stack: true } : {})
      } else if (tag === 'lineChart' || tag === 'areaChart') {
        spec.type = 'line'
        if (tag === 'areaChart') spec.area = true
        if (sers.some((s) => yes(child(s, 'smooth')?.at.val))) spec.smooth = true
        Object.assign(spec, { x: xName, y: unique }, stacked ? { stack: true } : {})
      } else {
        this.lose(`charts of kinds the chart renderer doesn't draw (${tag.replace(/Chart$/, '')}): an outlined frame with their title`)
        return undefined
      }
    }
    spec.data = rows
    const title = children(at(chart, 'title', 'tx', 'rich'), 'p').map((p) => this.plainText(p)).join(' ').trim()
    const autoTitle = child(chart, 'title') && !title && sers.length === 1 ? unique[0] : undefined
    if (title || (autoTitle && child(chart, 'autoTitleDeleted')?.at.val !== '1')) spec.title = title || autoTitle
    spec.legend = !!child(chart, 'legend')
    if (yes(at(kind, 'dLbls', 'showVal')?.at.val) || sers.some((s) => yes(at(s, 'dLbls', 'showVal')?.at.val))) spec.labels = true
    else if (spec.type === 'pie') spec.labels = false

    // Colours: each series' own (each slice's, for a pie), else the theme's accents in turn.
    const accents = [1, 2, 3, 4, 5, 6].map((i) => this.theme.scheme[`accent${i}`] ?? '#4472c4')
    const fillOf = (holder: El | undefined) => {
      const p = this.paint(child(holder, 'spPr'), { part })
      return p?.kind === 'solid' ? css(p.colour) : p?.kind === 'gradient' ? css(p.stops[0]![1]) : undefined
    }
    let colours: string[]
    if (spec.type === 'pie') {
      const dPts = new Map(children(sers[0], 'dPt').map((d) => [num(child(d, 'idx')?.at.val, 0), fillOf(d)]))
      colours = rows.map((_, k) => dPts.get(k) ?? accents[k % 6]!)
    } else {
      colours = sers.map((s, i) => {
        // Points coloured one by one, all alike, colour the series.
        const own = [...new Set(children(s, 'dPt').map((d) => fillOf(d)))]
        return (own.length === 1 && own[0]) || fillOf(s) || (tag === 'lineChart' || tag === 'scatterChart' ? this.lineColour(s) : undefined) || accents[i % 6]!
      })
    }
    // Text: the chart's, else its axes'.
    const defRPr = [space, child(plot, 'valAx'), child(plot, 'catAx')].map((el) => at(el, 'txPr', 'p', 'pPr', 'defRPr')).filter((e): e is El => !!e)
    const text = defRPr.map((d) => this.colour(child(d, 'solidFill'))).find(Boolean) ?? (this.schemeColour('tx1') ? { hex: this.schemeColour('tx1')!, alpha: 1 } : { hex: '#000000', alpha: 1 })
    const sz = defRPr.map((d) => d.at.sz).find(Boolean)
    if (sz) {
      const size = Math.round((num(sz, 1000) / 100) * this.ptPx)
      const label = { axisLabel: { fontSize: size } }
      spec.echarts = { xAxis: label, yAxis: label, legend: { textStyle: { fontSize: size } }, title: { textStyle: { fontSize: Math.round(size * 1.3) } } }
    }
    const vars = [
      ...colours.slice(0, 8).map((c, i) => `--blitz-chart-${i + 1}:${c}`),
      `--blitz-fg:${css(text)}`,
      `--blitz-fg-muted:${css({ hex: mix(text.hex, '#ffffff', 0.35), alpha: 1 })}`,
      `--blitz-rule:${css({ hex: mix(text.hex, '#ffffff', 0.82), alpha: 1 })}`,
      `--blitz-font-sans:${esc(fontStack(this.theme.minor))}`,
      'color:var(--blitz-fg)',
    ]
    if (specProblem('chart', spec, () => undefined)) return undefined
    const bg = this.paint(child(space, 'spPr'), { part })
    if (bg && bg.kind !== 'none' && bg.kind !== 'image') vars.push(`background:${this.paintCss(bg)}`)
    const json = JSON.stringify(spec).replace(/`/g, '\\u0060')
    const altText = (typeof spec.title === 'string' ? spec.title : undefined) ?? `A ${spec.horizontal ? 'bar' : spec.type === 'bar' ? 'column' : String(spec.type)} chart`
    const alt = ` alt="${altText.replace(/["\\{}\n]/g, ' ').trim()}"`
    return `<div style="${this.placeCss(box, xfrm)}${vars.join(';')}">\n\n\`\`\`chart {height=${Math.max(1, Math.round(box.h))}${alt}}\n${json}\n\`\`\`\n\n</div>`
  }

  /** A line series' colour: its line's (`c:spPr/a:ln`). */
  private lineColour(ser: El): string | undefined {
    const p = this.paint(at(ser, 'spPr', 'ln'), undefined)
    return p?.kind === 'solid' ? css(p.colour) : undefined
  }

  private chartPlaceholder(data: El, source: Source, box: Box, xfrm: El | undefined): string {
    const part = this.pkg.rels(source.part).get(child(data, 'chart')?.at['r:id'] ?? '')?.target
    const chart = part ? child(this.pkg.xml(part), 'chart') : undefined
    const title = children(at(chart, 'title', 'tx', 'rich'), 'p').map((p) => this.plainText(p)).join(' ').trim()
    const label = title || 'Chart'
    return `<div role="img" aria-label="${esc(label)}" style="${this.placeCss(box, xfrm)}border:1px dashed #999;display:flex;align-items:center;justify-content:center;font:${px(14 * this.ptPx)} system-ui, sans-serif;color:#777;">${esc(label)}</div>`
  }

  private table(tbl: El, source: Source, chain: Chain, frame: Frame): string {
    const grid = children(child(tbl, 'tblGrid'), 'gridCol').map((c) => num(c.at.w, 0) * frame.sx)
    const pr = child(tbl, 'tblPr')
    const styleId = textOf(child(pr, 'tableStyleId') ?? { tag: '', at: {}, kids: [] }).trim()
    const builtIn = MEDIUM_STYLE_2[styleId.toUpperCase()]
    const style = children(this.tableStyles, 'tblStyle').find((s) => s.at.styleId === styleId) ?? (builtIn ? mediumStyle2(styleId, builtIn) : undefined)
    if (styleId && !style) this.lose("table styles PowerPoint didn't save in the file: tables show their own formatting only")
    const flags = { firstRow: yes(pr?.at.firstRow), lastRow: yes(pr?.at.lastRow), firstCol: yes(pr?.at.firstCol), lastCol: yes(pr?.at.lastCol), bandRow: yes(pr?.at.bandRow), bandCol: yes(pr?.at.bandCol) }
    const rows = children(tbl, 'tr')
    const cols = `<colgroup>${grid.map((w) => `<col style="width:${px(w)}">`).join('')}</colgroup>`
    const body = rows
      .map((tr, ri) => {
        let ci = 0
        const cells = children(tr, 'tc')
          .map((tc) => {
            const c = ci
            ci += 1
            if (yes(tc.at.hMerge) || yes(tc.at.vMerge)) return ''
            // The parts of the table style that apply to this cell, weakest first.
            const parts = ['wholeTbl']
            if (flags.bandRow) parts.push((flags.firstRow ? ri - 1 : ri) % 2 === 0 ? 'band1H' : 'band2H')
            if (flags.bandCol) parts.push((flags.firstCol ? c - 1 : c) % 2 === 0 ? 'band1V' : 'band2V')
            if (flags.lastCol && c === grid.length - 1) parts.push('lastCol')
            if (flags.firstCol && c === 0) parts.push('firstCol')
            if (flags.lastRow && ri === rows.length - 1) parts.push('lastRow')
            if (flags.firstRow && ri === 0) parts.push('firstRow')
            return this.cell(tc, source, chain, style, parts, ri === 0, c === 0, ri === rows.length - 1, c === grid.length - 1)
          })
          .join('')
        return `<tr style="height:${px(num(tr.at.h, 0) * frame.sy)}">${cells}</tr>`
      })
      .join('')
    return `<table style="border-collapse:collapse;table-layout:fixed;width:100%;border-spacing:0;">${cols}${body}</table>`
  }

  private cell(tc: El, source: Source, chain: Chain, style: El | undefined, parts: string[], top: boolean, left: boolean, bottom: boolean, right: boolean): string {
    const tcPr = child(tc, 'tcPr')
    let fill: Paint | undefined
    let textColour: Colour | undefined
    let bold = false
    const borders: Record<string, Line | undefined> = {}
    for (const name of parts) {
      const part = child(style, name)
      if (!part) continue
      const tcStyle = child(part, 'tcStyle')
      const f = child(tcStyle, 'fill')
      const fillRef = child(tcStyle, 'fillRef')
      const p = f ? this.paint(f, source) : fillRef ? this.themeFill(num(fillRef.at.idx, 0), this.colour(fillRef)) : undefined
      if (p) fill = p
      const bdr = child(tcStyle, 'tcBdr')
      const side = (tag: string): Line | undefined => {
        const s = child(bdr, tag)
        const ln = child(s, 'ln')
        if (ln) return this.line({ tag: 'spPr', at: {}, kids: [ln] }, undefined)
        const ref = child(s, 'lnRef')
        return ref ? this.line(undefined, { tag: 'style', at: {}, kids: [ref] }) : undefined
      }
      const edges: Array<[string, string]> = [
        ['left', left ? 'left' : 'insideV'],
        ['right', right ? 'right' : 'insideV'],
        ['top', top ? 'top' : 'insideH'],
        ['bottom', bottom ? 'bottom' : 'insideH'],
      ]
      for (const [edge, tag] of edges) {
        if (child(bdr, tag)) borders[edge] = side(tag)
      }
      const tx = child(part, 'tcTxStyle')
      if (tx) {
        if (tx.at.b === 'on') bold = true
        if (tx.at.b === 'off') bold = false
        textColour = this.colour(tx) ?? this.colour(child(tx, 'fontRef')) ?? textColour
      }
    }
    fill = this.paint(tcPr, source) ?? fill
    for (const [edge, tag] of [['left', 'lnL'], ['right', 'lnR'], ['top', 'lnT'], ['bottom', 'lnB']] as const) {
      const ln = child(tcPr, tag)
      if (ln) borders[edge] = this.line({ tag: 'spPr', at: {}, kids: [ln] }, undefined)
    }
    const st: string[] = []
    if (fill && fill.kind !== 'none') st.push(`background:${this.paintCss(fill)}`)
    for (const [edge, l] of Object.entries(borders)) {
      if (l && l.paint.kind !== 'none') st.push(`border-${edge}:${px(l.width)} ${l.dash ? 'dashed' : 'solid'} ${l.paint.kind === 'solid' ? css(l.paint.colour) : '#000'}`)
    }
    const mar = (k: string, d: number) => px(num(tcPr?.at[k], d) * (this.canvas.width / this.cx))
    st.push(`padding:${mar('marT', 45720)} ${mar('marR', 91440)} ${mar('marB', 45720)} ${mar('marL', 91440)}`)
    st.push(`vertical-align:${{ ctr: 'middle', b: 'bottom' }[tcPr?.at.anchor ?? ''] ?? 'top'}`)
    const span = `${num(tc.at.gridSpan, 1) > 1 ? ` colspan="${tc.at.gridSpan}"` : ''}${num(tc.at.rowSpan, 1) > 1 ? ` rowspan="${tc.at.rowSpan}"` : ''}`
    const body = child(tc, 'txBody')
    const text = body ? this.paragraphs(body, { lists: this.defaultTextStyle ? [this.defaultTextStyle] : [], defaults: this.defaultTextStyle ? 1 : 0, kind: 'other', fontColour: textColour, bold, scale: 1, lineReduction: 0 }, source) : ''
    return `<td${span} style="${st.join(';')}">${text}</td>`
  }

  /* ---- text ---- */

  /** The list styles a placeholder's text inherits, weakest first. */
  private textChain(kind: 'title' | 'body' | 'other', body: El, inherited: El[], chain: Chain): { lists: El[]; defaults: number } {
    const lists: El[] = []
    if (this.defaultTextStyle) lists.push(this.defaultTextStyle)
    const tx = child(chain.master, 'txStyles')
    const master = child(tx, kind === 'title' ? 'titleStyle' : kind === 'body' ? 'bodyStyle' : 'otherStyle')
    if (master && kind !== 'other') lists.push(master)
    const defaults = lists.length
    for (const el of [...inherited].reverse()) {
      const l = at(el, 'txBody', 'lstStyle')
      if (l) lists.push(l)
    }
    const own = child(body, 'lstStyle')
    if (own) lists.push(own)
    return { lists, defaults }
  }

  private textBody(body: El, sp: El, inherited: El[], ph: Placeholder | undefined, chain: Chain, source: Source, style: El | undefined): string {
    const kind = !ph ? 'other' : /^(title|ctrTitle)$/.test(ph.type) ? 'title' : /^(body|obj|subTitle)$/.test(ph.type) || ph.idx !== undefined && !/^(dt|ftr|sldNum|hdr)$/.test(ph.type) ? 'body' : 'other'
    // Body properties: the shape's own over its placeholders'.
    const prs = [...inherited.map((el) => at(el, 'txBody', 'bodyPr')).reverse(), child(body, 'bodyPr')].filter((e): e is El => !!e)
    const bp = (name: string) => prs.reduce<string | undefined>((v, el) => el.at[name] ?? v, undefined)
    const autofit = prs.reduce<El | undefined>((v, el) => child(el, 'normAutofit') ?? (child(el, 'noAutofit') || child(el, 'spAutoFit') ? undefined : v), undefined)
    const scale = num(autofit?.at.fontScale, 100000) / 100000
    const lineReduction = num(autofit?.at.lnSpcReduction, 0) / 100000
    const emu = this.canvas.width / this.cx
    const pad = [num(bp('tIns'), 45720), num(bp('rIns'), 91440), num(bp('bIns'), 45720), num(bp('lIns'), 91440)].map((v) => px(v * emu))
    const anchor = bp('anchor') ?? (kind === 'title' ? 'ctr' : 't')
    const justify = { t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'flex-start', dist: 'space-between' }[anchor] ?? 'flex-start'
    const vert = bp('vert')
    const st = [`position:absolute;inset:0;padding:${pad.join(' ')};display:flex;flex-direction:column;justify-content:${justify}`]
    st.push(bp('wrap') === 'none' ? 'white-space:pre' : 'white-space:pre-wrap;overflow-wrap:break-word')
    if (bp('anchorCtr') === '1') st.push('align-items:center')
    if (vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVert') st.push('writing-mode:vertical-rl')
    else if (vert === 'vert270') st.push('writing-mode:vertical-rl;transform:rotate(180deg)')
    const fontRef = child(style, 'fontRef')
    const ctx: TextCtx = {
      ...this.textChain(kind, body, inherited, chain),
      kind,
      fontColour: fontRef ? this.colour(fontRef) : undefined,
      fontFace: fontRef?.at.idx === 'major' ? this.theme.major : fontRef?.at.idx === 'minor' ? this.theme.minor : undefined,
      scale,
      lineReduction,
    }
    if (kind === 'title') ctx.fontFace ??= this.theme.major
    return `<div style="${st.join(';')}">${this.paragraphs(body, ctx, source)}</div>`
  }

  private paragraphs(body: El, ctx: TextCtx, source: Source): string {
    const counters: number[] = []
    let out = ''
    for (const p of children(body, 'p')) {
      const pPr = child(p, 'pPr')
      const level = Math.min(9, num(pPr?.at.lvl, 0) + 1)
      const levelOf = (l: El) => child(l, `lvl${level}pPr`) ?? (l === this.defaultTextStyle ? child(l, 'defPPr') : undefined)
      const levels = ctx.lists.map(levelOf).filter((e): e is El => !!e)
      const pChain = pPr ? [...levels, pPr] : levels
      // The shape style's font colour and face beat the deck's defaults, not the shape's own list style.
      const weak = ctx.lists.slice(0, ctx.defaults).map(levelOf).filter((e): e is El => !!e && !!child(e, 'defRPr')).length
      const pAttr = (name: string) => pChain.reduce<string | undefined>((v, el) => el.at[name] ?? v, undefined)
      const pChild = (...tags: string[]) => pChain.reduce<El | undefined>((v, el) => el.kids.find((k) => tags.includes(k.tag)) ?? v, undefined)
      const defRPrs = pChain.map((el) => child(el, 'defRPr')).filter((e): e is El => !!e)

      const runs = p.kids.filter((k) => k.tag === 'r' || k.tag === 'br' || k.tag === 'fld')
      const firstRPr = child(runs.find((r) => r.tag !== 'br'), 'rPr') ?? child(p, 'endParaRPr')
      const first = this.runStyle([...defRPrs, ...(firstRPr ? [firstRPr] : [])], weak, ctx)
      const size = first.size

      // Spacing: lines, and before and after the paragraph.
      const st: string[] = []
      const lnSpc = pChild('lnSpc')
      const pct = child(lnSpc, 'spcPct')
      const pts = child(lnSpc, 'spcPts')
      if (pts) st.push(`line-height:${px((num(pts.at.val, 0) / 100) * this.ptPx)}`)
      else st.push(`line-height:${r2(Math.max(0.5, (pct ? num(pct.at.val, 100000) / 100000 : 1) - ctx.lineReduction) * 1.2)}`)
      const spacing = (tag: string) => {
        const s = pChild(tag)
        const sp = child(s, 'spcPts')
        const sc = child(s, 'spcPct')
        return sp ? (num(sp.at.val, 0) / 100) * this.ptPx : sc ? (num(sc.at.val, 0) / 100000) * size * 1.2 : 0
      }
      const before = spacing('spcBef') * (1 - ctx.lineReduction)
      const after = spacing('spcAft') * (1 - ctx.lineReduction)
      if (before && out) st.push(`margin-top:${px(before)}`)
      if (after) st.push(`margin-bottom:${px(after)}`)
      const algn = pAttr('algn')
      st.push(`text-align:${{ ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn ?? ''] ?? 'left'}`)
      const emu = this.canvas.width / this.cx
      const marL = num(pAttr('marL'), 0) * emu
      const indent = num(pAttr('indent'), 0) * emu
      if (marL) st.push(`padding-left:${px(marL)}`)
      if (indent) st.push(`text-indent:${px(indent)}`)
      st.push(`font-size:${px(size)}`)

      // The bullet, hanging in the indent when there is one.
      const hasText = runs.some((r) => r.tag !== 'br' && textOf(child(r, 't') ?? r).length > 0)
      const bu = pChild('buNone', 'buChar', 'buAutoNum', 'buBlip')
      let bullet = ''
      if (bu && bu.tag !== 'buNone' && hasText) {
        let mark: string
        if (bu.tag === 'buAutoNum') {
          counters.length = level
          counters[level - 1] = (counters[level - 1] ?? num(bu.at.startAt, 1) - 1) + 1
          mark = autoNumber(bu.at.type ?? 'arabicPeriod', counters[level - 1]!)
        } else if (bu.tag === 'buChar') {
          const ch = bu.at.char ?? '•'
          mark = SYMBOL_BULLETS[ch] && /symbol|wingdings/i.test(pChild('buFont', 'buFontTx')?.at.typeface ?? '') ? SYMBOL_BULLETS[ch]! : ch
        } else mark = '•'
        const buClr = pChild('buClr', 'buClrTx')
        const colour = buClr?.tag === 'buClr' ? this.colour(buClr) : undefined
        const szPct = pChild('buSzPct', 'buSzPts', 'buSzTx')
        const bsize = szPct?.tag === 'buSzPct' ? (num(szPct.at.val, 100000) / 100000) * size : szPct?.tag === 'buSzPts' ? (num(szPct.at.val, 0) / 100) * this.ptPx * ctx.scale : size
        const font = pChild('buFont', 'buFontTx')
        const face = font?.tag === 'buFont' && font.at.typeface && !/symbol|wingdings/i.test(font.at.typeface) ? `font-family:${esc(fontStack(this.face(font.at.typeface)))};` : ''
        const width = indent < 0 ? `display:inline-block;min-width:${px(-indent)};text-indent:0;` : 'margin-right:.4em;'
        bullet = `<span style="${width}font-size:${px(bsize)};color:${colour ? css(colour) : first.colour};${face}white-space:pre">${esc(mark)}</span>`
      } else if (bu?.tag !== 'buAutoNum') counters.length = Math.min(counters.length, level - 1)

      let text = ''
      for (const r of runs) {
        if (r.tag === 'br') {
          text += '<br>'
          continue
        }
        const rPr = child(r, 'rPr')
        let value = textOf(child(r, 't') ?? { tag: '', at: {}, kids: [] })
        if (r.tag === 'fld' && r.at.type === 'slidenum') value = String(this.slideNumber)
        if (!value) continue
        const link = child(rPr, 'hlinkClick')
        // Linked text is in the theme's link colour, underlined, as PowerPoint shows it.
        const linkStyle: El[] = link ? [{ tag: 'rPr', at: { u: 'sng' }, kids: [{ tag: 'solidFill', at: {}, kids: [{ tag: 'schemeClr', at: { val: 'hlink' }, kids: [] }] }] }] : []
        const s = this.runStyle([...defRPrs, ...(rPr ? [rPr] : []), ...linkStyle], weak, ctx)
        const span = `<span style="${s.css}">${esc(value.replace(/[\r\n\v]/g, ' '))}</span>`
        const rel = link ? this.pkg.rels(source.part).get(link.at['r:id'] ?? '') : undefined
        text += rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? `<a href="${esc(rel.target)}" target="_blank" rel="noopener">${span}</a>` : span
      }
      // An empty paragraph still takes a line.
      if (!text) text = '<br>'
      out += `<div style="${st.join(';')}">${bullet}${text}</div>`
    }
    return out
  }

  /** A run's look from its properties, weakest first; the first `weak` are the deck's defaults. */
  private runStyle(rprs: El[], weak: number, ctx: TextCtx): { css: string; size: number; colour: string } {
    const a = (name: string) => rprs.reduce<string | undefined>((v, el) => el.at[name] ?? v, undefined)
    const find = (list: El[], tags: string[]) => list.reduce<El | undefined>((v, el) => el.kids.find((k) => tags.includes(k.tag)) ?? v, undefined)
    const c = (...tags: string[]) => find(rprs, tags)
    const strong = (...tags: string[]) => find(rprs.slice(weak), tags)
    const size = (num(a('sz'), 1800) / 100) * this.ptPx * ctx.scale
    const fill = ctx.fontColour ? strong('solidFill', 'gradFill', 'noFill') : c('solidFill', 'gradFill', 'noFill')
    let colour: Colour | undefined
    if (fill?.tag === 'solidFill') colour = this.colour(fill)
    else if (fill?.tag === 'gradFill') colour = this.colour(child(child(fill, 'gsLst'), 'gs'))
    colour ??= ctx.fontColour ?? (this.schemeColour('tx1') ? { hex: this.schemeColour('tx1')!, alpha: 1 } : { hex: '#000000', alpha: 1 })
    const colourCss = fill?.tag === 'noFill' ? 'transparent' : css(colour)
    const latin = (ctx.fontFace ? strong('latin') : c('latin'))?.at.typeface
    const face = this.face(latin ?? ctx.fontFace ?? (ctx.kind === 'title' ? this.theme.major : this.theme.minor))
    const st = [`font-size:${px(size)}`, `color:${colourCss}`, `font-family:${esc(fontStack(face))}`]
    const bold = a('b')
    if (yes(bold) || (bold === undefined && ctx.bold)) st.push('font-weight:bold')
    if (yes(a('i'))) st.push('font-style:italic')
    const deco: string[] = []
    const u = a('u')
    if (u && u !== 'none') deco.push('underline')
    const strike = a('strike')
    if (strike && strike !== 'noStrike') deco.push('line-through')
    if (deco.length) st.push(`text-decoration:${deco.join(' ')}`)
    const baseline = num(a('baseline'), 0)
    if (baseline) st.push(`vertical-align:${baseline > 0 ? 'super' : 'sub'};font-size:${px(size * 0.66)}`)
    const cap = a('cap')
    if (cap === 'all') st.push('text-transform:uppercase')
    else if (cap === 'small') st.push('font-variant:small-caps')
    const spc = num(a('spc'), 0)
    if (spc) st.push(`letter-spacing:${px((spc / 100) * this.ptPx)}`)
    const highlight = c('highlight')
    const hl = highlight ? this.colour(highlight) : undefined
    if (hl) st.push(`background:${css(hl)}`)
    return { css: st.join(';'), size, colour: colourCss }
  }

  /** A theme font reference (`+mj-lt`, `+mn-lt`) as the font it names. */
  private face(typeface: string): string {
    if (typeface.startsWith('+mj')) return this.theme.major
    if (typeface.startsWith('+mn')) return this.theme.minor
    return typeface
  }

  /* ---- notes ---- */

  private notes(slidePart: string): string | undefined {
    const part = this.pkg.related(slidePart, 'notesSlide')
    const notes = part ? this.pkg.xml(part) : undefined
    if (!notes) return undefined
    const lines: string[] = []
    for (const sp of children(at(notes, 'cSld', 'spTree'), 'sp')) {
      const ph = at(sp, 'nvSpPr', 'nvPr', 'ph')
      if (!ph || (ph.at.type ?? 'body') !== 'body') continue
      for (const p of children(child(sp, 'txBody'), 'p')) lines.push(escapeMarkdown(p.kids.map((k) => (k.tag === 'r' ? textOf(child(k, 't') ?? k) : k.tag === 'br' ? '\n' : '')).join('')))
    }
    const text = lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
    return text || undefined
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Chain {
  slide: El
  layout: El | undefined
  master: El | undefined
  layoutPart: string | undefined
  masterPart: string | undefined
}

interface TextCtx {
  /** List styles (`a:lstStyle`, `p:titleStyle`…), weakest first. */
  lists: El[]
  /** How many of `lists` are the deck's defaults (`p:defaultTextStyle`, the master's text styles). */
  defaults: number
  kind: 'title' | 'body' | 'other'
  /** The colour and font the shape's style (`p:style`'s `fontRef`) gives text. */
  fontColour?: Colour | undefined
  fontFace?: string | undefined
  /** Table cells: bold from the table style. */
  bold?: boolean
  /** Shrink-to-fit (`a:normAutofit`): font scale and line spacing reduction. */
  scale: number
  lineReduction: number
}

/** DrawingML's colour modifiers, in order. */
function modify(base: Colour, node: El): Colour {
  let hex = base.hex
  let alpha = base.alpha
  for (const m of node.kids) {
    const v = num(m.at.val, 100000) / 100000
    switch (m.tag) {
      case 'lumMod': {
        const [h, s, l] = toHsl(hex)
        hex = fromHsl(h, s, Math.min(1, Math.max(0, l * v)))
        break
      }
      case 'lumOff': {
        const [h, s, l] = toHsl(hex)
        hex = fromHsl(h, s, Math.min(1, Math.max(0, l + v)))
        break
      }
      case 'satMod': {
        const [h, s, l] = toHsl(hex)
        hex = fromHsl(h, Math.min(1, Math.max(0, s * v)), l)
        break
      }
      // Tint and shade work in linear light, as Office does: black tinted
      // 75% is #898989, not the #404040 mixing sRGB values would give.
      case 'tint':
        hex = linear(hex, (c) => c * v + (1 - v))
        break
      case 'shade':
        hex = linear(hex, (c) => c * v)
        break
      case 'alpha':
        alpha = v
        break
      case 'alphaMod':
        alpha *= v
        break
      case 'inv':
        hex = `#${rgb(hex).map((c) => (255 - c).toString(16).padStart(2, '0')).join('')}`
        break
      case 'gray': {
        const [r, g, b] = rgb(hex)
        const y = Math.round(0.299 * r! + 0.587 * g! + 0.114 * b!)
        hex = `#${[y, y, y].map((c) => c.toString(16).padStart(2, '0')).join('')}`
        break
      }
    }
  }
  return { hex, alpha }
}

/** `hex` with `f` applied to each channel in linear light (0 to 1). */
function linear(hex: string, f: (c: number) => number): string {
  const out = rgb(hex).map((v) => {
    const s = v / 255
    const l = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    const m = Math.min(1, Math.max(0, f(l)))
    const back = m <= 0.0031308 ? m * 12.92 : 1.055 * m ** (1 / 2.4) - 0.055
    return Math.round(back * 255)
  })
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** `prstDash` as an SVG dash array, scaled by the line's width. */
function dashArray(dash: string, w: number): string {
  const pattern: Record<string, number[]> = {
    dot: [1, 1], sysDot: [1, 1], dash: [4, 3], sysDash: [3, 1], lgDash: [8, 3],
    dashDot: [4, 3, 1, 3], sysDashDot: [3, 1, 1, 1], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDotDot: [3, 1, 1, 1, 1, 1],
  }
  return (pattern[dash] ?? [4, 3]).map((v) => r2(v * Math.max(w, 1))).join(' ')
}

/** A preset shape's outline (`a:prstGeom`), or undefined for one not drawn yet. */
export function presetPath(name: string, w: number, h: number, adj: Record<string, number>): string | undefined {
  const ss = Math.min(w, h)
  const a = (key: string, d: number) => (adj[key] ?? (key === 'adj1' ? adj.adj : undefined) ?? d) / 100000
  const P = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L')} Z`
  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    `M${r2(cx - rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx + rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx - rx)} ${r2(cy)} Z`
  /** A rectangle with each corner rounded by its own radius: top-left, top-right, bottom-right, bottom-left. */
  const rounded = (tl: number, tr: number, br: number, bl: number) =>
    `M${r2(tl)} 0 H${r2(w - tr)} ${tr ? `A${r2(tr)} ${r2(tr)} 0 0 1 ${r2(w)} ${r2(tr)}` : ''} V${r2(h - br)} ${br ? `A${r2(br)} ${r2(br)} 0 0 1 ${r2(w - br)} ${r2(h)}` : ''} H${r2(bl)} ${bl ? `A${r2(bl)} ${r2(bl)} 0 0 1 0 ${r2(h - bl)}` : ''} V${r2(tl)} ${tl ? `A${r2(tl)} ${r2(tl)} 0 0 1 ${r2(tl)} 0` : ''} Z`
  /** An arrow pointing right in a w×h box, mapped through `map`. */
  const arrow = (W: number, H: number, map: (x: number, y: number) => [number, number], both = false) => {
    const t = H * a('adj1', 50000)
    const hl = Math.min(W, H) * a('adj2', 50000) * (both ? 1 : 1)
    const y1 = (H - t) / 2
    const pts: Array<[number, number]> = both
      ? [[0, H / 2], [hl, 0], [hl, y1], [W - hl, y1], [W - hl, 0], [W, H / 2], [W - hl, H], [W - hl, y1 + t], [hl, y1 + t], [hl, H]]
      : [[0, y1], [W - hl, y1], [W - hl, 0], [W, H / 2], [W - hl, H], [W - hl, y1 + t], [0, y1 + t]]
    return P(pts.map(([x, y]) => map(x, y)))
  }
  switch (name) {
    case 'rect':
    case 'flowChartProcess':
    case 'textBox':
      return P([[0, 0], [w, 0], [w, h], [0, h]])
    case 'roundRect':
    case 'flowChartAlternateProcess': {
      const r = ss * a('adj', 16667)
      return rounded(r, r, r, r)
    }
    case 'round1Rect': {
      const r = ss * a('adj', 16667)
      return rounded(0, r, 0, 0)
    }
    case 'round2SameRect': {
      const r = ss * a('adj1', 16667)
      const r2_ = ss * a('adj2', 0)
      return rounded(r, r, r2_, r2_)
    }
    case 'round2DiagRect': {
      const r = ss * a('adj1', 16667)
      const r2_ = ss * a('adj2', 0)
      return rounded(r, r2_, r, r2_)
    }
    case 'flowChartTerminator':
      return rounded(Math.min(h / 2, w / 2), Math.min(h / 2, w / 2), Math.min(h / 2, w / 2), Math.min(h / 2, w / 2))
    case 'snip1Rect': {
      const x = ss * a('adj', 16667)
      return P([[0, 0], [w - x, 0], [w, x], [w, h], [0, h]])
    }
    case 'snip2SameRect': {
      const x = ss * a('adj1', 16667)
      return P([[x, 0], [w - x, 0], [w, x], [w, h], [0, h], [0, x]])
    }
    case 'ellipse':
    case 'flowChartConnector':
      return ellipse(w / 2, h / 2, w / 2, h / 2)
    case 'donut': {
      const t = ss * a('adj', 25000)
      return `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, Math.max(0, w / 2 - t), Math.max(0, h / 2 - t))}`
    }
    case 'line':
    case 'straightConnector1':
      return `M0 0 L${r2(w)} ${r2(h)}`
    case 'bentConnector2':
      return `M0 0 H${r2(w)} V${r2(h)}`
    case 'bentConnector3':
    case 'bentConnector4':
    case 'bentConnector5': {
      const x = w * a('adj1', 50000)
      return `M0 0 H${r2(x)} V${r2(h)} H${r2(w)}`
    }
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5':
      return `M0 0 C${r2(w / 2)} 0 ${r2(w / 2)} ${r2(h)} ${r2(w)} ${r2(h)}`
    case 'triangle':
    case 'flowChartExtract':
      return P([[w * a('adj', 50000), 0], [w, h], [0, h]])
    case 'rtTriangle':
      return P([[0, 0], [w, h], [0, h]])
    case 'diamond':
    case 'flowChartDecision':
      return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const x = name === 'parallelogram' ? ss * a('adj', 25000) : w / 5
      return P([[x, 0], [w, 0], [w - x, h], [0, h]])
    }
    case 'trapezoid': {
      const x = ss * a('adj', 25000)
      return P([[0, h], [x, 0], [w - x, 0], [w, h]])
    }
    case 'pentagon':
      return P([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]])
    case 'hexagon': {
      const x = ss * a('adj', 25000)
      return P([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]])
    }
    case 'octagon': {
      const x = ss * a('adj', 29289)
      return P([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]])
    }
    case 'homePlate': {
      const x = w - ss * a('adj', 50000)
      return P([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]])
    }
    case 'chevron': {
      const x = ss * a('adj', 50000)
      return P([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]])
    }
    case 'plus':
    case 'flowChartSummingJunction': {
      const x = ss * a('adj', 25000)
      return P([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]])
    }
    case 'rightArrow':
      return arrow(w, h, (x, y) => [x, y])
    case 'leftArrow':
      return arrow(w, h, (x, y) => [w - x, y])
    case 'downArrow':
      return arrow(h, w, (x, y) => [y, x])
    case 'upArrow':
      return arrow(h, w, (x, y) => [y, h - x])
    case 'leftRightArrow':
      return arrow(w, h, (x, y) => [x, y], true)
    case 'upDownArrow':
      return arrow(h, w, (x, y) => [y, x], true)
    case 'star4':
    case 'star5':
    case 'star6':
    case 'star8': {
      const n = Number(name.slice(4))
      const inner = n === 4 ? 0.25 : n === 5 ? 0.382 : n === 6 ? 0.5 : 0.7
      const pts: Array<[number, number]> = []
      for (let i = 0; i < n * 2; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / n
        const k = i % 2 ? inner : 1
        pts.push([w / 2 + (w / 2) * k * Math.cos(ang), h / 2 + (h / 2) * k * Math.sin(ang)])
      }
      return P(pts)
    }
    case 'wedgeRectCallout':
      return P([[0, 0], [w, 0], [w, h], [0, h]])
    case 'wedgeRoundRectCallout': {
      const r = ss * 0.16667
      return rounded(r, r, r, r)
    }
    case 'wedgeEllipseCallout':
      return ellipse(w / 2, h / 2, w / 2, h / 2)
    case 'flowChartDocument':
      return `M0 0 H${r2(w)} V${r2(h * 0.83)} C${r2(w * 0.75)} ${r2(h * 0.66)} ${r2(w * 0.25)} ${r2(h * 1.05)} 0 ${r2(h * 0.9)} Z`
    case 'leftBracket':
      return `M${r2(w)} 0 Q0 0 0 ${r2(w)} V${r2(h - w)} Q0 ${r2(h)} ${r2(w)} ${r2(h)}`
    case 'rightBracket':
      return `M0 0 Q${r2(w)} 0 ${r2(w)} ${r2(w)} V${r2(h - w)} Q${r2(w)} ${r2(h)} 0 ${r2(h)}`
    case 'can': {
      const ry = Math.min(h / 2, ss * a('adj', 25000) / 2)
      return `M0 ${r2(ry)} A${r2(w / 2)} ${r2(ry)} 0 0 1 ${r2(w)} ${r2(ry)} V${r2(h - ry)} A${r2(w / 2)} ${r2(ry)} 0 0 1 0 ${r2(h - ry)} Z M0 ${r2(ry)} A${r2(w / 2)} ${r2(ry)} 0 0 0 ${r2(w)} ${r2(ry)}`
    }
    default:
      return undefined
  }
}

/** `a:custGeom`'s paths, scaled to the shape's box: `[d, filled, stroked]` each. */
function customGeometry(cust: El, w: number, h: number): Array<[string, boolean, boolean]> {
  const out: Array<[string, boolean, boolean]> = []
  for (const path of children(child(cust, 'pathLst'), 'path')) {
    const sx = num(path.at.w, 0) ? w / num(path.at.w, 1) : 1
    const sy = num(path.at.h, 0) ? h / num(path.at.h, 1) : 1
    const pt = (el: El | undefined): [number, number] => [num(el?.at.x, 0) * sx, num(el?.at.y, 0) * sy]
    let d = ''
    let cur: [number, number] = [0, 0]
    let start: [number, number] = [0, 0]
    for (const cmd of path.kids) {
      switch (cmd.tag) {
        case 'moveTo':
          cur = start = pt(child(cmd, 'pt'))
          d += `M${r2(cur[0])} ${r2(cur[1])} `
          break
        case 'lnTo':
          cur = pt(child(cmd, 'pt'))
          d += `L${r2(cur[0])} ${r2(cur[1])} `
          break
        case 'cubicBezTo': {
          const ps = children(cmd, 'pt').map(pt)
          if (ps.length === 3) {
            d += `C${ps.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' ')} `
            cur = ps[2]!
          }
          break
        }
        case 'quadBezTo': {
          const ps = children(cmd, 'pt').map(pt)
          if (ps.length === 2) {
            d += `Q${ps.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' ')} `
            cur = ps[1]!
          }
          break
        }
        case 'arcTo': {
          const rx = num(cmd.at.wR, 0) * sx
          const ry = num(cmd.at.hR, 0) * sy
          const st = (num(cmd.at.stAng, 0) / 60000) * (Math.PI / 180)
          const sw = (num(cmd.at.swAng, 0) / 60000) * (Math.PI / 180)
          const cx = cur[0] - rx * Math.cos(st)
          const cy = cur[1] - ry * Math.sin(st)
          const end: [number, number] = [cx + rx * Math.cos(st + sw), cy + ry * Math.sin(st + sw)]
          if (Math.abs(sw) >= 2 * Math.PI - 1e-6) {
            // A full turn: two halves, since one SVG arc can't end where it starts.
            const mid: [number, number] = [cx + rx * Math.cos(st + sw / 2), cy + ry * Math.sin(st + sw / 2)]
            d += `A${r2(rx)} ${r2(ry)} 0 1 ${sw > 0 ? 1 : 0} ${r2(mid[0])} ${r2(mid[1])} `
          }
          d += `A${r2(rx)} ${r2(ry)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r2(end[0])} ${r2(end[1])} `
          cur = end
          break
        }
        case 'close':
          d += 'Z '
          cur = start
          break
      }
    }
    if (d) out.push([d.trim(), path.at.fill !== 'none', path.at.stroke !== '0' && path.at.stroke !== 'false'])
  }
  return out
}

/** Text for a `::: notes` block: markdown's own characters escaped, so the notes read as written. */
function escapeMarkdown(s: string): string {
  return s
    .replace(/[\\`*_{}[\]<>#|~]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([-+]|\d+[.)]|:::)/gm, (_, sp: string, m: string) => `${sp}\\${m}`)
}

/* -------------------------------------------------- legacy (.ppt, .odp) -- */

/** LibreOffice's `soffice`, from BLITZSTRAHL_SOFFICE, the PATH, or where installers put it. */
export function findSoffice(): string | undefined {
  const env = process.env.BLITZSTRAHL_SOFFICE
  if (env) return env
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const n of names) if (dir && existsSync(join(dir, n))) return join(dir, n)
  }
  const known =
    process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : process.platform === 'win32'
        ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
        : ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice']
  return known.find((f) => existsSync(f))
}

/**
 * A legacy .ppt (or .pps, .pot, .odp) as .pptx bytes, converted by
 * LibreOffice in a profile of its own, so a LibreOffice the author has open
 * doesn't swallow the request.
 */
export function legacyToPptx(file: string): Uint8Array {
  const soffice = findSoffice()
  const kind = extname(file).toLowerCase()
  if (!soffice) {
    throw new CliError(
      `${basename(file)} is a ${kind === '.odp' ? 'LibreOffice (.odp)' : 'legacy PowerPoint (' + kind + ')'} file, which blitzstrahl reads through LibreOffice, and it isn't installed. Install LibreOffice (https://www.libreoffice.org), set BLITZSTRAHL_SOFFICE to its soffice, or save the file as .pptx`,
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'blitz-pptx-'))
  try {
    const profile = pathToFileURL(join(work, 'profile')).href
    try {
      execFileSync(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', work, file], { stdio: 'pipe', timeout: 180_000 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError(`can't run LibreOffice (${soffice}), to read ${basename(file)}: set BLITZSTRAHL_SOFFICE to its soffice, or save the file as .pptx`)
      const why = (err as { stderr?: Buffer }).stderr?.toString().trim().split('\n').pop()
      throw new CliError(`LibreOffice couldn't convert ${basename(file)} to .pptx${why ? `: ${why}` : ''}`)
    }
    const out = readdirSync(work).find((f) => f.toLowerCase().endsWith('.pptx'))
    if (!out) throw new CliError(`LibreOffice couldn't convert ${basename(file)} to .pptx`)
    return readFileSync(join(work, out))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** A presentation file as a deck: a package directly, anything else through LibreOffice. */
export function readPresentation(file: string): Presentation {
  const bytes = PPTX.test(file) ? readFileSync(file) : legacyToPptx(file)
  const deck = pptxToMarkdown(bytes, basename(file))
  if (LEGACY.test(file)) deck.notCarried.unshift(`${basename(file)} was converted to .pptx by LibreOffice first: what it doesn't convert isn't shown`)
  return deck
}
