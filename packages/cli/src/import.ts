/**
 * `blitzstrahl theme import` (docs/cli.md; PLAN §15, M9.4, D11): a
 * PowerPoint template (.potx, or a .pptx: the same package) becomes a CSS
 * theme (docs/themes.md). Colours, fonts, per-layout backgrounds and the
 * logo carry over; everything else is listed, not guessed.
 *
 * A template is a zip of XML parts: `ppt/presentation.xml` names the
 * masters, each master names its theme (colours, fonts) and its layouts,
 * and each part's `_rels` file maps `r:id`s to the parts and media it uses.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, posix, relative, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { CliError } from './errors.js'

export interface ImportOptions {
  /** The folder to write (default: beside the template, named after it). It must be new or empty. */
  out?: string
}

export interface ImportResult {
  outDir: string
  /** The theme's tokens, by name. */
  tokens: Record<string, string>
  /** Per-layout backgrounds: a file in `img/`, or a colour. */
  backgrounds: Record<string, string>
  /** The logo's file in `img/`, if the master has one. */
  logo?: string
  /** What the template has that the theme doesn't, one line each. */
  notCarried: string[]
  /** Worth knowing, but carried: a hard-to-read accent, say. */
  notes: string[]
}

type Xml = Record<string, unknown>

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseAttributeValue: false, trimValues: true })

/** Children named `tag`, always as a list. */
function all(node: unknown, tag: string): Xml[] {
  if (!node || typeof node !== 'object') return []
  const v = (node as Xml)[tag]
  return v === undefined ? [] : Array.isArray(v) ? (v as Xml[]) : [v as Xml]
}
const one = (node: unknown, ...path: string[]): Xml | undefined => {
  let at: unknown = node
  for (const tag of path) at = all(at, tag)[0]
  return at as Xml | undefined
}
const attr = (node: Xml | undefined, name: string): string | undefined => {
  const v = node?.[`@${name}`]
  return v === undefined ? undefined : String(v)
}

/** Blitzstrahl layouts, and the PowerPoint layouts that become them: by kind (`type`), then by name. */
const LAYOUT_MATCH: ReadonlyArray<{ layout: string; types: string[]; names: string[] }> = [
  { layout: 'title', types: ['title'], names: ['title slide'] },
  { layout: 'section', types: ['secHead'], names: ['section header'] },
  { layout: 'default', types: ['obj', 'tx', 'titleOnly'], names: ['title and content', 'title only'] },
  { layout: 'two-col', types: ['twoObj', 'twoTxTwoObj'], names: ['two content', 'comparison'] },
  { layout: 'image-left', types: ['picTx'], names: ['picture with caption'] },
  { layout: 'full-bleed', types: ['blank'], names: ['blank'] },
]
const WEB_IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

export async function importTheme(template: string, options: ImportOptions = {}): Promise<ImportResult> {
  const file = resolve(template)
  if (!existsSync(file)) throw new CliError(`can't find ${template}`)
  const name = basename(file, extname(file))
  const outDir = resolve(options.out ?? join(dirname(file), name))
  if (existsSync(outDir) && readdirSync(outDir).length) {
    throw new CliError(`${relative(process.cwd(), outDir) || outDir} isn't empty; nothing was written (name a new folder: \`--out ${name}-theme\`)`)
  }

  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(readFileSync(file))
  } catch {
    zip = {}
  }
  const xml = (part: string): Xml | undefined => {
    const bytes = zip[part]
    return bytes ? (parser.parse(new TextDecoder().decode(bytes)) as Xml) : undefined
  }
  const presentation = xml('ppt/presentation.xml')
  if (!presentation) throw new CliError(`${template} isn't a PowerPoint template or presentation (.potx, .pptx)`)

  /** The part an `r:id` names, from `part`'s relationships. */
  const rels = (part: string): Map<string, string> => {
    const relsPart = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)
    const map = new Map<string, string>()
    for (const r of all(one(xml(relsPart), 'Relationships'), 'Relationship')) {
      const target = attr(r, 'Target')!
      map.set(attr(r, 'Id')!, attr(r, 'TargetMode') === 'External' ? target : posix.normalize(posix.join(posix.dirname(part), target)))
    }
    return map
  }

  const notCarried: string[] = []
  const notes: string[] = []
  const pres = one(presentation, 'p:presentation')
  const size = one(pres, 'p:sldSz')
  const cx = Number(attr(size, 'cx') ?? 12192000)
  const cy = Number(attr(size, 'cy') ?? 6858000)
  const canvas = { width: 1280, height: Math.round((1280 * cy) / cx) }
  const px = (emu: number) => Math.round((emu * canvas.width) / cx)

  const presRels = rels('ppt/presentation.xml')
  const masterIds = all(one(pres, 'p:sldMasterIdLst'), 'p:sldMasterId').map((m) => attr(m, 'r:id')!)
  const masterPart = presRels.get(masterIds[0]!)
  const master = masterPart ? one(xml(masterPart), 'p:sldMaster') : undefined
  if (!masterPart || !master) throw new CliError(`${template} has no slide master to import`)
  if (masterIds.length > 1) notCarried.push(`${masterIds.length - 1} more slide master${masterIds.length > 2 ? 's' : ''} (only the first is imported)`)
  const masterRels = rels(masterPart)

  // The theme: colours and fonts.
  const themePart = [...masterRels.values()].find((p) => /\/theme\/theme\d+\.xml$/.test(p))
  const theme = themePart ? one(xml(themePart), 'a:theme', 'a:themeElements') : undefined
  if (!theme) throw new CliError(`${template} has no theme (colours and fonts) to import`)
  const scheme: Record<string, string> = {}
  for (const [key, node] of Object.entries(one(theme, 'a:clrScheme') ?? {})) {
    if (!key.startsWith('a:')) continue
    const c = plainColour(node as Xml)
    if (c) scheme[key.slice(2)] = c
  }
  // bg1/tx1/bg2/tx2 name scheme slots through the master's colour map (a dark template maps bg1 to dk1).
  const clrMap = one(master, 'p:clrMap')
  const slot = (n: string) => attr(clrMap, n) ?? ({ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } as Record<string, string>)[n] ?? n
  const schemeColour = (n: string): string | undefined => scheme[/^(bg|tx)[12]$/.test(n) ? slot(n) : n]
  /** A fill's colour (`a:srgbClr`, `a:schemeClr`, `a:sysClr`), with the usual modifiers. */
  const colourOf = (fill: Xml | undefined, placeholder?: string): string | undefined => {
    if (!fill) return undefined
    const s = one(fill, 'a:schemeClr')
    if (s) {
      const v = attr(s, 'val')!
      const base = v === 'phClr' ? placeholder : schemeColour(v)
      return base && modify(base, s)
    }
    const direct = plainColour(fill)
    const node = one(fill, 'a:srgbClr') ?? one(fill, 'a:sysClr')
    return direct && node ? modify(direct, node) : direct
  }

  const fg = schemeColour('tx1') ?? '#000000'
  const bg = schemeColour('bg1') ?? '#ffffff'
  const accents = [1, 2, 3, 4, 5, 6].map((i) => scheme[`accent${i}`])
  if (accents.some((a) => !a)) throw new CliError(`${template}'s colour scheme has no accent colours`)
  const tokens: Record<string, string> = {
    bg,
    fg,
    'fg-muted': mix(fg, bg, 0.4),
    accent: accents[0]!,
    'accent-2': accents[1]!,
    ...Object.fromEntries(accents.map((a, i) => [`chart-${i + 1}`, a!])),
    'chart-7': mix(accents[0]!, '#000000', 0.3),
    'chart-8': mix(accents[1]!, '#000000', 0.3),
  }
  const surface = schemeColour('bg2')
  if (surface) tokens.surface = surface
  if (scheme.hlink) tokens.link = scheme.hlink
  const contrast = ratio(tokens.accent!, bg)
  if (contrast < 4.5) {
    notes.push(`accent ${tokens.accent} is hard to read as text on ${bg} (${contrast.toFixed(1)}:1; 4.5:1 is the least for text). Headings and links use it: set --blitz-accent to a darker ${contrast < 3 ? 'shade' : 'one'} if they're hard to read`)
  }

  const fonts = one(theme, 'a:fontScheme')
  const body = attr(one(fonts, 'a:minorFont', 'a:latin'), 'typeface')
  const heading = attr(one(fonts, 'a:majorFont', 'a:latin'), 'typeface')
  if (body) tokens['font-sans'] = fontStack(body)
  const embedded = Object.keys(zip).filter((p) => p.startsWith('ppt/fonts/'))
  if (embedded.length) notCarried.push(`${embedded.length} embedded font file${embedded.length > 1 ? 's' : ''} (licensed for that file only)`)

  // Pictures go to img/: backgrounds by the layout they're for, the logo as logo.*.
  const images = new Map<string, string>()
  const writes: Array<[string, Uint8Array]> = []
  const image = (part: string, as: string, what: string): string | undefined => {
    const ext = extname(part).slice(1).toLowerCase()
    if (!WEB_IMAGES.has(ext)) {
      notCarried.push(`${what}: a .${ext} picture, which browsers can't show`)
      return undefined
    }
    const done = images.get(part)
    if (done) return done
    const bytes = zip[part]
    if (!bytes) return undefined
    const out = `img/${as}.${ext === 'jpeg' ? 'jpg' : ext}`
    images.set(part, out)
    writes.push([out, bytes])
    return out
  }

  /**
   * A slide part's background: a picture, or a colour. `lost` says what
   * couldn't be carried; neither means it inherits the master's.
   */
  const background = (cSld: Xml | undefined, part: string, as: string, what: string): { value?: string; lost?: string } => {
    const value = (v: string | undefined) => (v === undefined ? {} : { value: v })
    const bgNode = one(cSld, 'p:bg')
    const partRels = rels(part)
    if (bgNode) {
      const pr = one(bgNode, 'p:bgPr')
      const ref = one(bgNode, 'p:bgRef')
      if (pr) {
        const blip = one(pr, 'a:blipFill', 'a:blip')
        if (blip) {
          const target = partRels.get(attr(blip, 'r:embed') ?? '')
          return value(target ? image(target, as, what) : undefined)
        }
        const solid = one(pr, 'a:solidFill')
        if (solid) return value(colourOf(solid))
        return { lost: one(pr, 'a:gradFill') ? 'a gradient background' : one(pr, 'a:pattFill') ? 'a pattern background' : 'its background' }
      }
      if (ref) {
        // The theme's background fill styles, 1001 onwards, coloured by the ref's colour.
        const idx = Number(attr(ref, 'idx') ?? 0)
        const style = Object.entries(one(one(theme, 'a:fmtScheme'), 'a:bgFillStyleLst') ?? {}).flatMap(([k, v]) =>
          k.startsWith('a:') ? (Array.isArray(v) ? v : [v]).map((n) => [k, n] as const) : [],
        )[idx - 1001]
        const placeholder = colourOf(ref)
        if (!style || style[0] === 'a:solidFill') return value(colourOf(style?.[1] as Xml | undefined, placeholder) ?? placeholder)
        return { lost: style[0] === 'a:gradFill' ? 'a gradient background' : 'its background' }
      }
    }
    // A picture that covers the slide is a background too.
    for (const pic of all(one(cSld, 'p:spTree'), 'p:pic')) {
      const ext = one(pic, 'p:spPr', 'a:xfrm', 'a:ext')
      if (Number(attr(ext, 'cx')) * Number(attr(ext, 'cy')) < 0.9 * cx * cy) continue
      const target = partRels.get(attr(one(pic, 'p:blipFill', 'a:blip'), 'r:embed') ?? '')
      if (target) return value(image(target, as, what))
    }
    return {}
  }

  const css: string[] = []
  const backgrounds: Record<string, string> = {}
  /** A background rule. On a colour, text in whichever of fg and bg reads better on it. */
  const rule = (selector: string, value: string) => {
    if (value.startsWith('img/')) return `${selector} { background-image: url("./${value}"); background-size: cover; background-position: center; }`
    const [fgOn, bgOn] = [ratio(tokens.fg!, value), ratio(tokens.bg!, value)]
    const text = fgOn < 4.5 && bgOn > fgOn ? ` color: ${tokens.bg}; --blitz-fg-muted: ${mix(tokens.bg!, value, 0.3)};` : ''
    return `${selector} { background-color: ${value};${text} }`
  }

  const masterBg = background(one(master, 'p:cSld'), masterPart, 'bg-master', 'the master')
  if (masterBg.lost) notCarried.push(`the master: ${masterBg.lost}`)
  if (masterBg.value?.startsWith('img/')) css.push(rule('.blitz-slide', masterBg.value))
  else if (masterBg.value) tokens.bg = masterBg.value

  // The logo: the largest picture on the master that doesn't cover the slide.
  let logo: string | undefined
  let logoCss: string | undefined
  const masterPics = all(one(master, 'p:cSld', 'p:spTree'), 'p:pic')
    .map((pic) => {
      const xfrm = one(pic, 'p:spPr', 'a:xfrm')
      const [off, ext] = [one(xfrm, 'a:off'), one(xfrm, 'a:ext')]
      const box = { x: Number(attr(off, 'x') ?? 0), y: Number(attr(off, 'y') ?? 0), w: Number(attr(ext, 'cx') ?? 0), h: Number(attr(ext, 'cy') ?? 0) }
      return { pic, box }
    })
    .filter(({ box }) => box.w * box.h < 0.9 * cx * cy && box.w > 0)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  if (masterPics.length) {
    const { pic, box } = masterPics[0]!
    const target = masterRels.get(attr(one(pic, 'p:blipFill', 'a:blip'), 'r:embed') ?? '')
    logo = target ? image(target, 'logo', "the master's logo") : undefined
    if (logo) logoCss = `.blitz-chrome [data-chrome="logo"] { top: ${px(box.y)}px; left: ${px(box.x)}px; right: auto; width: ${px(box.w)}px; height: ${px(box.h)}px; transform: none; object-fit: contain; }`
    if (masterPics.length > 1) notCarried.push(`${masterPics.length - 1} more picture${masterPics.length > 2 ? 's' : ''} on the master`)
  }

  // Layouts, in the master's order.
  const layoutParts = all(one(master, 'p:sldLayoutIdLst'), 'p:sldLayoutId').map((l) => masterRels.get(attr(l, 'r:id')!)!).filter(Boolean)
  const found = layoutParts.map((part) => {
    const layout = one(xml(part), 'p:sldLayout')
    const cSld = one(layout, 'p:cSld')
    return { part, layout, cSld, type: attr(layout, 'type') ?? 'cust', name: attr(cSld, 'name') ?? basename(part, '.xml') }
  })
  const used = new Set<string>()
  const matched: Array<{ layout: string; from: (typeof found)[number] }> = []
  for (const m of LAYOUT_MATCH) {
    const byType = m.types.flatMap((t) => found.filter((f) => f.type === t && !used.has(f.part)))
    const byName = found.filter((f) => m.names.includes(f.name.trim().toLowerCase()) && !used.has(f.part))
    const pick = byType[0] ?? byName[0]
    if (!pick) continue
    used.add(pick.part)
    matched.push({ layout: m.layout, from: pick })
  }
  for (const { layout, from } of matched) {
    const what = `layout "${from.name}"`
    const { value, lost } = background(from.cSld, from.part, `bg-${layout}`, what)
    if (lost) notCarried.push(`${what} (${layout}): ${lost}`)
    if (value) {
      backgrounds[layout] = value
      css.push(rule(`[data-layout="${layout}"]`, value))
    }
    // A layout that hides the master's pictures hides the logo too.
    if (logo && attr(from.layout, 'showMasterSp') === '0') css.push(`[data-layout="${layout}"] .blitz-chrome [data-chrome="logo"] { display: none; }`)
  }
  for (const f of found) {
    if (used.has(f.part)) continue
    const kept = background(f.cSld, f.part, `layout-${slugify(f.name)}`, `layout "${f.name}"`).value
    notCarried.push(`layout "${f.name}": matches no blitzstrahl layout${kept?.startsWith('img/') ? ` (its background is ${kept}, to use by hand)` : kept ? ` (its background is ${kept})` : ''}`)
  }
  notCarried.push("placeholders' positions and sizes, shapes and text boxes, text sizes and styles")

  const header = [
    `${name}: a blitzstrahl theme (docs/themes.md), imported from ${basename(file)}`,
    'by `blitzstrahl theme import`. Edit it like any stylesheet.',
    '',
    'Not carried over:',
    ...notCarried.map((n) => `  - ${n}`),
    ...(notes.length ? ['', 'Notes:', ...notes.map((n) => `  - ${n}`)] : []),
  ]
  const stylesheet = [
    `/*\n${header.map((l) => ` * ${l}`.trimEnd()).join('\n')}\n */`,
    '',
    `:root {\n${Object.entries(tokens).map(([k, v]) => `  --blitz-${k}: ${v};`).join('\n')}\n}`,
    '',
    ...(heading && heading !== body ? [`.blitz-slide :is(h1, h2, h3, h4) { font-family: ${fontStack(heading)}; }`, ''] : []),
    ...css,
    ...(logoCss ? ['', logoCss] : []),
    '',
  ].join('\n')

  await mkdir(join(outDir, 'img'), { recursive: true })
  for (const [path, bytes] of writes) await writeFile(join(outDir, path), bytes, { flag: 'wx' })
  await writeFile(join(outDir, 'brand.css'), stylesheet, { flag: 'wx' })
  await writeFile(join(outDir, 'sample.md'), sampleDeck(name, matched.map((m) => m.layout), logo, canvas), { flag: 'wx' })

  const result: ImportResult = { outDir, tokens, backgrounds, notCarried, notes }
  if (logo) result.logo = logo
  return result
}

/** A colour written directly: `a:srgbClr`, or a system colour's last value. */
function plainColour(node: Xml | undefined): string | undefined {
  const rgb = attr(one(node, 'a:srgbClr'), 'val') ?? attr(one(node, 'a:sysClr'), 'lastClr')
  return rgb && /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb.toLowerCase()}` : undefined
}

/** DrawingML's colour modifiers that matter for a fill: luminance, tint and shade (values in 1/1000 %). */
function modify(hex: string, node: Xml): string {
  const v = (n: string) => {
    const a = attr(one(node, `a:${n}`), 'val')
    return a === undefined ? undefined : Number(a) / 100000
  }
  let out = hex
  const [lumMod, lumOff, tint, shade] = [v('lumMod'), v('lumOff'), v('tint'), v('shade')]
  if (lumMod !== undefined || lumOff !== undefined) {
    const [h, s, l] = toHsl(out)
    out = fromHsl(h, s, Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0))))
  }
  if (tint !== undefined) out = mix(out, '#ffffff', 1 - tint)
  if (shade !== undefined) out = mix(out, '#000000', 1 - shade)
  return out
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/** `a` moved toward `b` by `t` (0 is `a`, 1 is `b`). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return hex(x.map((v, i) => v + (y[i]! - v) * t))
}

/** WCAG contrast ratio of two colours. */
export function ratio(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

function toHsl(c: string): [number, number, number] {
  const [r, g, b] = rgb(c).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) return hex([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p
  }
  return hex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255])
}

const SERIFS = /serif|times|georgia|garamond|cambria|palatino|book antiqua|baskerville|minion|caslon/i

/** A template font, named first, then a generic family like it. */
function fontStack(family: string): string {
  const generic = /mono|courier|consol/i.test(family) ? 'monospace' : SERIFS.test(family) && !/sans/i.test(family) ? 'serif' : 'system-ui, sans-serif'
  return `${JSON.stringify(family)}, ${generic}`
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layout'

/** One slide per layout the theme styles, to look at with `dev`. */
function sampleDeck(name: string, layouts: string[], logo: string | undefined, canvas: { width: number; height: number }): string {
  const fm = [`title: ${JSON.stringify(name)}`, 'theme: ./brand.css']
  if (canvas.width !== 1280 || canvas.height !== 720) fm.push(`canvas: ${canvas.width}x${canvas.height}`)
  fm.push(`footer: ${JSON.stringify(name)}`, 'slide-numbers: "{n} / {total}"')
  if (logo) fm.push(`logo: ./${logo}`)
  const slides: Record<string, string> = {
    title: `# ${name}\n\nA sample deck in the imported theme`,
    section: '---\nlayout: section\n---\n\n# A section',
    default: '# Title and content\n\n- A first point\n- A second, with a [link](https://example.org)\n- A third, with *emphasis*',
    'two-col': '---\nlayout: two-col\n---\n\n# Two columns\n\n::: left\nOn the left.\n:::\n\n::: right\nOn the right.\n:::',
    'image-left': '---\nlayout: image-left\n---\n\n# Picture with caption\n\nPut an image in the `image` slot.',
    'full-bleed': '---\nlayout: full-bleed\n---\n\n# Blank',
  }
  const body = ['title', ...layouts.filter((l) => l !== 'title'), 'chart']
    .map((l) =>
      l === 'chart'
        ? '# The palette\n\n```chart\ntype: bar\ndata:\n  - { k: a, v: 1 }\n  - { k: b, v: 2 }\n  - { k: c, v: 3 }\n  - { k: d, v: 4 }\n  - { k: e, v: 5 }\n  - { k: f, v: 6 }\nx: k\ny: v\necharts: { series: [{ colorBy: data }] }\n```'
        : slides[l]!,
    )
    .join('\n\n---\n\n')
  return `---\n${fm.join('\n')}\n---\n\n${body.replace(/^---\n\n---\n/gm, '---\n')}\n`
}
