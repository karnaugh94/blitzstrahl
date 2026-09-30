// A PowerPoint template, made from scratch: the fixture `theme import`
// is tested with (PLAN §15, M9.4), and the source of the public corporate
// example (examples/corporate, M9.5). Kestrel Transit is a fictional
// organisation. Only the parts `theme import` reads are here, with the
// kinds of things real templates do: pictures and a colour as layout
// backgrounds, a layout with its own name, a gradient, a logo on the
// master, a layout that hides the master's pictures.
//
// Deterministic, byte for byte: same input, same file.
import { deflateSync } from 'node:zlib'
import { zipSync } from 'fflate'

const EMU = 9525 // per CSS pixel at 96 dpi
const W = 12192000
const H = 6858000

/** A PNG of `w`×`h` pixels, each `pixel(x, y)` → [r, g, b] or, with `alpha`, [r, g, b, a]. */
export function png(w, h, pixel, alpha = false) {
  const n = alpha ? 4 : 3
  const raw = Buffer.alloc((w * n + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * n + 1)
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), row + 1 + x * n)
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/** The Kestrel Transit palette. `dark` swaps the master's colour map, as dark templates do. */
export const KESTREL = {
  dk1: '1B2A3A', lt1: 'FFFFFF', dk2: '2C4A63', lt2: 'EEF3F6',
  accents: ['0B7A75', 'E07A1F', '6B8F2A', '7A4FA0', 'C23B4A', '3A78C2'],
  hlink: '0B5F9A',
  body: 'Source Sans 3',
  heading: 'Source Serif 4',
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const rels = (list) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`)
    .join('')}</Relationships>`
const tree = (inner = '') => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree>`
const placeholder = (id, type) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
const picture = (id, rid, x, y, cx, cy) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>`
const pictureBg = (rid) => `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`

/** The template, as the bytes of a .potx. `accent` replaces accent 1 (six hex digits). */
export function makeTemplate({ dark = false, accent } = {}) {
  const k = accent ? { ...KESTREL, accents: [accent, ...KESTREL.accents.slice(1)] } : KESTREL
  const [teal, orange] = [hex(`#${k.accents[0]}`), hex(`#${k.accents[1]}`)]
  const navy = hex(`#${k.dk1}`)
  const white = [255, 255, 255]
  const files = {}
  const put = (path, text) => (files[path] = typeof text === 'string' ? new TextEncoder().encode(text) : text)

  // Pictures: a title background (navy, a teal band, an orange stripe), a
  // content background (white, a teal bar), a quote background, and a logo.
  put('ppt/media/image1.png', png(320, 180, (x, y) => (y > 120 && y < 126 ? orange : x + y * 0.6 > 250 && x + y * 0.6 < 290 ? teal : navy)))
  put('ppt/media/image2.png', png(320, 180, (x, y) => (y < 6 && x < 80 ? teal : white)))
  put('ppt/media/image3.png', png(320, 180, (x, y) => (x < 12 ? orange : hex(`#${k.lt2}`))))
  put('ppt/media/image4.png', png(120, 40, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 256 ? [...teal, 255] : x > 44 && y > 14 && y < 26 ? [...orange, 255] : [0, 0, 0, 0]), true))

  put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`)
  put('ppt/presentation.xml', `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  put('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml']]))

  const scheme = (tag, v) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`
  put('ppt/theme/theme1.xml', `${XML}<a:theme ${NS} name="Kestrel"><a:themeElements><a:clrScheme name="Kestrel">`
    + `<a:dk1><a:sysClr val="windowText" lastClr="${k.dk1}"/></a:dk1>${scheme('lt1', k.lt1)}${scheme('dk2', k.dk2)}${scheme('lt2', k.lt2)}`
    + k.accents.map((c, i) => scheme(`accent${i + 1}`, c)).join('')
    + `${scheme('hlink', k.hlink)}${scheme('folHlink', k.hlink)}</a:clrScheme>`
    + `<a:fontScheme name="Kestrel"><a:majorFont><a:latin typeface="${k.heading}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${k.body}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:gs></a:gsLst></a:gradFill></a:bgFillStyleLst></a:fmtScheme>'
    + '</a:themeElements></a:theme>')

  // Layouts, in the master's order: [file, type, name, background, extra].
  const layouts = [
    ['title', 'Title Slide', pictureBg('rId2'), [['rId2', 'image', '../media/image1.png']], placeholder(2, 'ctrTitle')],
    ['obj', 'Title and Content', pictureBg('rId2'), [['rId2', 'image', '../media/image2.png']], placeholder(2, 'title') + placeholder(3, 'body')],
    // No kind, as in many real templates: matched by its name.
    [undefined, 'Section Header', '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>', [], placeholder(2, 'title')],
    ['twoObj', 'Two Content', '', [], placeholder(2, 'title')],
    [undefined, 'Quote', pictureBg('rId2'), [['rId2', 'image', '../media/image3.png']], placeholder(2, 'body')],
    [undefined, 'Closing', '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="tx2"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>', [], placeholder(2, 'title')],
    ['blank', 'Blank', '', [], ''],
  ]
  layouts.forEach(([type, name, bg, extra, shapes], i) => {
    const attrs = `${type ? ` type="${type}"` : ''}${type === 'blank' ? ' showMasterSp="0"' : ''} preserve="1"`
    put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${XML}<p:sldLayout ${NS}${attrs}><p:cSld name="${name}">${bg}${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
    put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideMasters/slideMaster1.xml'], ...extra]))
  })

  const clrMap = dark
    ? '<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    : '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  const logo = picture(10, 'rIdLogo', W - 88 * EMU - 150 * EMU, 20 * EMU, 150 * EMU, 50 * EMU)
  put('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${tree(placeholder(2, 'title') + placeholder(3, 'body') + logo)}</p:cSld>${clrMap}`
    + `<p:sldLayoutIdLst>${layouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldLayoutIdLst></p:sldMaster>`)
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    ...layouts.map((_, i) => [`rId${i + 1}`, 'slideLayout', `../slideLayouts/slideLayout${i + 1}.xml`]),
    ['rIdTheme', 'theme', '../theme/theme1.xml'],
    ['rIdLogo', 'image', '../media/image4.png'],
  ]))

  const mtime = new Date(2026, 8, 28, 12, 0, 0)
  return zipSync(Object.fromEntries(Object.entries(files).map(([p, b]) => [p, [b, { mtime }]])), { level: 9 })
}
