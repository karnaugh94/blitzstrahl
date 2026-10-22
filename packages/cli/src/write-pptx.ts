/**
 * A deck as a PowerPoint presentation (`export --out talk.pptx`): each page
 * the runtime prints (a slide at its final step, or with `steps` each step)
 * is a full-slide picture, and the slide's presenter notes are its speaker
 * notes, so the talk can be given from PowerPoint, Keynote or Google Slides.
 *
 * The package is the smallest one PowerPoint opens without repairing: one
 * master, one blank layout, a theme, and a notes master for the notes.
 */
import { zipSync, strToU8 } from 'fflate'
import type { Element, ElementContent } from 'hast'
import type { DeckMeta } from '@blitzstrahl/core'
import { VERSION } from './version.js'

export interface PptxPage {
  /** The page as a PNG, at any scale of the canvas. */
  png: Uint8Array
  /** What the picture shows, for screen readers: the slide's title. */
  alt: string
  /** The slide's presenter notes, as paragraphs. */
  notes: NoteParagraph[]
}

export interface NoteParagraph {
  runs: NoteRun[]
  /** A list item, at this depth (0 is the first level). */
  list?: { level: number; ordered: boolean }
}

export interface NoteRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

/** Pixels to EMU, at 96 pixels to the inch. */
const EMU = 9525

/** Notes pages are portrait letter, as PowerPoint's own. */
const NOTES = { cx: 6858000, cy: 9144000 }

export function writePptx(pages: PptxPage[], canvas: { width: number; height: number }, meta: DeckMeta, now = new Date()): Uint8Array {
  const size = { cx: canvas.width * EMU, cy: canvas.height * EMU }
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, xml: string) => (files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`))

  put('[Content_Types].xml', contentTypes(pages.length))
  put('_rels/.rels', rels([
    ['rId1', `${OFFDOC}/officeDocument`, 'ppt/presentation.xml'],
    ['rId2', `${PKG}/metadata/core-properties`, 'docProps/core.xml'],
    ['rId3', `${OFFDOC}/extended-properties`, 'docProps/app.xml'],
  ]))
  put('docProps/core.xml', core(meta, now))
  put('docProps/app.xml', app(pages.length))

  put('ppt/presentation.xml', presentation(pages.length, size))
  put('ppt/_rels/presentation.xml.rels', rels([
    ['rId1', `${OFFDOC}/slideMaster`, 'slideMasters/slideMaster1.xml'],
    ['rId2', `${OFFDOC}/notesMaster`, 'notesMasters/notesMaster1.xml'],
    ['rId3', `${OFFDOC}/theme`, 'theme/theme1.xml'],
    ['rId4', `${OFFDOC}/presProps`, 'presProps.xml'],
    ['rId5', `${OFFDOC}/viewProps`, 'viewProps.xml'],
    ['rId6', `${OFFDOC}/tableStyles`, 'tableStyles.xml'],
    ...pages.map((_, i): Rel => [`rId${10 + i}`, `${OFFDOC}/slide`, `slides/slide${i + 1}.xml`]),
  ]))
  put('ppt/presProps.xml', `<p:presentationPr ${NS}/>`)
  put('ppt/viewProps.xml', `<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="80000"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  put('ppt/tableStyles.xml', `<a:tblStyleLst xmlns:a="${A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  put('ppt/theme/theme1.xml', theme('blitzstrahl'))
  put('ppt/theme/theme2.xml', theme('blitzstrahl notes'))

  put('ppt/slideMasters/slideMaster1.xml', master())
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    ['rId1', `${OFFDOC}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
    ['rId2', `${OFFDOC}/theme`, '../theme/theme1.xml'],
  ]))
  put('ppt/slideLayouts/slideLayout1.xml', layout())
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', `${OFFDOC}/slideMaster`, '../slideMasters/slideMaster1.xml']]))
  put('ppt/notesMasters/notesMaster1.xml', notesMaster(size))
  put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', `${OFFDOC}/theme`, '../theme/theme2.xml']]))

  pages.forEach((page, i) => {
    const n = i + 1
    files[`ppt/media/image${n}.png`] = page.png
    put(`ppt/slides/slide${n}.xml`, slide(page, size))
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels([
      ['rId1', `${OFFDOC}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${OFFDOC}/image`, `../media/image${n}.png`],
      ['rId3', `${OFFDOC}/notesSlide`, `../notesSlides/notesSlide${n}.xml`],
    ]))
    put(`ppt/notesSlides/notesSlide${n}.xml`, notesSlide(page.notes, size, meta.lang))
    put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([
      ['rId1', `${OFFDOC}/notesMaster`, '../notesMasters/notesMaster1.xml'],
      ['rId2', `${OFFDOC}/slide`, `../slides/slide${n}.xml`],
    ]))
  })
  // PNGs are already compressed.
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.endsWith('.png') ? [v, { level: 0 }] : v])), { level: 6 })
}

/**
 * Presenter notes as paragraphs: one per paragraph, heading or list item,
 * with bold, italic and code runs; everything else is its text.
 */
export function noteParagraphs(nodes: ElementContent[]): NoteParagraph[] {
  const out: NoteParagraph[] = []
  const block = (children: ElementContent[], list?: NoteParagraph['list']) => {
    const runs: NoteRun[] = []
    const inline = (n: ElementContent, style: Omit<NoteRun, 'text'>) => {
      if (n.type === 'text') {
        const text = n.value.replace(/\s+/g, ' ')
        if (text) runs.push({ text, ...style })
      } else if (n.type === 'element') {
        if (n.tagName === 'br') runs.push({ text: '\n', ...style })
        const s = { ...style }
        if (n.tagName === 'strong' || n.tagName === 'b') s.bold = true
        if (n.tagName === 'em' || n.tagName === 'i') s.italic = true
        if (n.tagName === 'code') s.code = true
        n.children.forEach((c) => inline(c, s))
      }
    }
    children.forEach((c) => inline(c, {}))
    // Whitespace between tags at either end isn't text.
    while (runs.length && !runs[0]!.text.trim()) runs.shift()
    while (runs.length && !runs[runs.length - 1]!.text.trim()) runs.pop()
    if (runs.length) {
      runs[0]!.text = runs[0]!.text.trimStart()
      runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.trimEnd()
    }
    const p: NoteParagraph = { runs: runs.filter((r) => r.text) }
    if (list) p.list = list
    if (p.runs.length) out.push(p)
  }
  const walk = (n: ElementContent, level: number) => {
    if (n.type !== 'element') {
      if (n.type === 'text' && n.value.trim()) block([n])
      return
    }
    if (n.tagName === 'ul' || n.tagName === 'ol') {
      for (const li of n.children) {
        if (li.type !== 'element' || li.tagName !== 'li') continue
        const own = li.children.filter((c) => !(c.type === 'element' && (c.tagName === 'ul' || c.tagName === 'ol')))
        // A loose list's items are paragraphs.
        const inner = own.flatMap((c) => (c.type === 'element' && c.tagName === 'p' ? c.children : [c]))
        block(inner, { level, ordered: n.tagName === 'ol' })
        li.children.forEach((c) => c.type === 'element' && (c.tagName === 'ul' || c.tagName === 'ol') && walk(c, level + 1))
      }
    } else if (/^(p|h[1-6]|pre|blockquote|div|section|figure|figcaption|dt|dd)$/.test(n.tagName) && !n.children.some(isBlock)) {
      block(n.children)
    } else if (BLOCKS.test(n.tagName) || n.children.some(isBlock)) {
      n.children.forEach((c) => walk(c, level))
    } else {
      block([n])
    }
  }
  nodes.forEach((n) => walk(n, 0))
  return out
}

const BLOCKS = /^(p|h[1-6]|ul|ol|li|pre|blockquote|div|section|table|thead|tbody|tr|figure|figcaption|dl|dt|dd|hr)$/
const isBlock = (n: ElementContent): n is Element => n.type === 'element' && BLOCKS.test(n.tagName)

type Rel = [id: string, type: string, target: string]

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`
const OFFDOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument'

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    // Characters XML 1.0 can't carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
}

function rels(list: Rel[]): string {
  return `<Relationships xmlns="${PKG}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`
}

function contentTypes(n: number): string {
  const over = (part: string, type: string) => `<Override PartName="/${part}" ContentType="${type}"/>`
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/>`
    + over('ppt/presentation.xml', `${CT}.presentationml.presentation.main+xml`)
    + over('ppt/presProps.xml', `${CT}.presentationml.presProps+xml`)
    + over('ppt/viewProps.xml', `${CT}.presentationml.viewProps+xml`)
    + over('ppt/tableStyles.xml', `${CT}.presentationml.tableStyles+xml`)
    + over('ppt/theme/theme1.xml', `${CT}.theme+xml`)
    + over('ppt/theme/theme2.xml', `${CT}.theme+xml`)
    + over('ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`)
    + over('ppt/slideLayouts/slideLayout1.xml', `${CT}.presentationml.slideLayout+xml`)
    + over('ppt/notesMasters/notesMaster1.xml', `${CT}.presentationml.notesMaster+xml`)
    + Array.from({ length: n }, (_, i) => over(`ppt/slides/slide${i + 1}.xml`, `${CT}.presentationml.slide+xml`) + over(`ppt/notesSlides/notesSlide${i + 1}.xml`, `${CT}.presentationml.notesSlide+xml`)).join('')
    + over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
    + over('docProps/app.xml', `${CT}.extended-properties+xml`)
    + `</Types>`
}

function core(meta: DeckMeta, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z')
  return `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(meta.title)}</dc:title>`
    + (meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : '')
    + `<dc:language>${esc(meta.lang)}</dc:language>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`
    + `</cp:coreProperties>`
}

function app(n: number): string {
  return `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>blitzstrahl ${VERSION}</Application><Slides>${n}</Slides><Notes>${n}</Notes></Properties>`
}

function presentation(n: number, size: { cx: number; cy: number }): string {
  const ids = Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')
  return `<p:presentation ${NS} saveSubsetFonts="1">`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>`
    + (n ? `<p:sldIdLst>${ids}</p:sldIdLst>` : '')
    + `<p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="${NOTES.cx}" cy="${NOTES.cy}"/>`
    + `<p:defaultTextStyle>${levels(1800)}</p:defaultTextStyle>`
    + `</p:presentation>`
}

/** Nine list levels of plain text at `size` (hundredths of a point). */
function levels(size: number): string {
  return Array.from({ length: 9 }, (_, i) => `<a:lvl${i + 1}pPr marL="${i * 457200}" algn="l" rtl="0"><a:defRPr sz="${size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i + 1}pPr>`).join('')
}

const GROUP = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'

function master(): string {
  return `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>`
    + `<p:clrMap ${CLR_MAP}/>`
    + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`
    + `<p:txStyles><p:titleStyle>${levels(4400)}</p:titleStyle><p:bodyStyle>${levels(2800)}</p:bodyStyle><p:otherStyle>${levels(1800)}</p:otherStyle></p:txStyles>`
    + `</p:sldMaster>`
}

function layout(): string {
  return `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

function slide(page: PptxPage, size: { cx: number; cy: number }): string {
  const name = page.alt ? ` name="${esc(page.alt.slice(0, 200))}"` : ''
  return `<p:sld ${NS}><p:cSld${name}><p:spTree>${GROUP}`
    + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide" descr="${esc(page.alt)}"/><p:cNvPicPr><a:picLocks noGrp="1" noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.cx}" cy="${size.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

/** Where the slide's picture and the notes sit on a notes page, fitted to the slide's shape. */
function notesBoxes(size: { cx: number; cy: number }) {
  const w = 6096000
  const h = Math.round((w * size.cy) / size.cx)
  const img = { x: (NOTES.cx - w) / 2, y: 685800, cx: w, cy: Math.min(h, 3429000) }
  if (img.cy < h) {
    img.cx = Math.round((img.cy * size.cx) / size.cy)
    img.x = Math.round((NOTES.cx - img.cx) / 2)
  }
  const body = { x: 685800, y: img.y + img.cy + 228600, cx: NOTES.cx - 2 * 685800, cy: NOTES.cy - (img.y + img.cy + 228600) - 685800 }
  return { img, body }
}

const xfrm = (b: { x: number; y: number; cx: number; cy: number }) => `<a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.cx}" cy="${b.cy}"/></a:xfrm>`

function notesMaster(size: { cx: number; cy: number }): string {
  const { img, body } = notesBoxes(size)
  return `<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}`
    + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>`
    + `<p:spPr>${xfrm(img)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>`
    + `<p:spPr>${xfrm(body)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
    + `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:notesStyle>${levels(1200)}</p:notesStyle></p:notesMaster>`
}

function notesSlide(notes: NoteParagraph[], size: { cx: number; cy: number }, lang: string): string {
  const { img, body } = notesBoxes(size)
  const paras = notes.map((p) => {
    const lvl = p.list?.level ?? 0
    const ppr = p.list
      ? `<a:pPr marL="${(lvl + 1) * 285750}" lvl="${Math.min(lvl, 8)}" indent="-285750">${p.list.ordered ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : '<a:buFont typeface="Arial"/><a:buChar char="•"/>'}</a:pPr>`
      : ''
    const runs = p.runs.map((r) => {
      const attrs = `lang="${esc(lang)}" dirty="0"${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''}`
      const font = r.code ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : ''
      return r.text.split('\n').map((t, k) => `${k ? `<a:br><a:rPr ${attrs}/></a:br>` : ''}${t ? `<a:r><a:rPr ${attrs}>${font}</a:rPr><a:t>${esc(t)}</a:t></a:r>` : ''}`).join('')
    })
    return `<a:p>${ppr}${runs.join('')}</a:p>`
  })
  return `<p:notes ${NS}><p:cSld><p:spTree>${GROUP}`
    + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(img)}</p:spPr></p:sp>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(body)}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/>${paras.length ? paras.join('') : `<a:p><a:endParaRPr lang="${esc(lang)}"/></a:p>`}</p:txBody></p:sp>`
    + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}

/** Office's own theme, which every part of the package may name colours and fonts from. */
function theme(name: string): string {
  const fill = (k: number) => `<a:solidFill><a:schemeClr val="phClr">${k ? `<a:shade val="${100000 - k * 5000}"/>` : ''}</a:schemeClr></a:solidFill>`
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`
  const srgb = (tag: string, v: string) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`
  return `<a:theme xmlns:a="${A}" name="${esc(name)}"><a:themeElements>`
    + `<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>`
    + srgb('dk2', '44546A') + srgb('lt2', 'E7E6E6') + srgb('accent1', '4472C4') + srgb('accent2', 'ED7D31') + srgb('accent3', 'A5A5A5')
    + srgb('accent4', 'FFC000') + srgb('accent5', '5B9BD5') + srgb('accent6', '70AD47') + srgb('hlink', '0563C1') + srgb('folHlink', '954F72')
    + `</a:clrScheme>`
    + `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fill(0)}${fill(1)}${fill(2)}</a:fillStyleLst>`
    + `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>`
    + `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>`
    + `<a:bgFillStyleLst>${fill(0)}${fill(1)}${fill(2)}</a:bgFillStyleLst></a:fmtScheme>`
    + `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}
