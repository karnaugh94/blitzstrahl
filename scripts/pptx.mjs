// A PowerPoint presentation, made from scratch: the fixture presentations
// as decks are tested with (docs/powerpoint.md). Kestrel Transit is the
// fictional organisation of potx.mjs. Each slide leans on something
// PowerPoint files really do: placeholders that take their place and text
// style from the layout and master, shapes coloured by the theme's style
// matrix, a cropped picture, a group that scales its children, a table in a
// built-in style that isn't saved in the file, a chart, speaker notes, and a
// hidden slide.
//
// Deterministic, byte for byte: same input, same file.
import { zipSync } from 'fflate'
import { KESTREL, png } from './potx.mjs'

const W = 12192000
const H = 6858000
/** EMUs per canvas pixel, for a 16:9 slide on blitzstrahl's 1280-wide canvas. */
export const EMU = W / 1280

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = (list) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`
const tree = (inner = '') => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree>`
const xfrm = (x, y, w, h, extra = '') => `<a:xfrm${extra}><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm>`
/** A placeholder: `type`, `idx`, an optional box in pixels, its text. */
const ph = (id, type, { idx, box, lst = '', body = '<a:p><a:endParaRPr/></a:p>' } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type} ${id}"/><p:cNvSpPr/><p:nvPr><p:ph${type === 'body' ? '' : ` type="${type}"`}${idx === undefined ? '' : ` idx="${idx}"`}/></p:nvPr></p:nvSpPr>`
  + `<p:spPr>${box ? xfrm(...box) : ''}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle>${lst}</a:lstStyle>${body}</p:txBody></p:sp>`
/** A run of text, with the run's attributes and children (its colour, a link). */
const run = (text, attrs = '', kids = '') => `<a:r><a:rPr lang="en-GB"${attrs}>${kids}</a:rPr><a:t>${text}</a:t></a:r>`

/** The presentation, as the bytes of a .pptx. */
export function makePresentation() {
  const k = KESTREL
  const files = {}
  const put = (path, text) => (files[path] = typeof text === 'string' ? new TextEncoder().encode(text) : text)

  // A 40×20 picture: its left quarter orange, the rest teal. Cropped by a quarter on the left, only teal shows.
  put('ppt/media/image1.png', png(40, 20, (x) => (x < 10 ? [224, 122, 31] : [11, 122, 117])))

  put('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  put('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Kestrel quarterly</dc:title><dc:creator>Ana Ruiz</dc:creator></cp:coreProperties>`)

  const slides = 4
  put('ppt/presentation.xml', `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${Array.from({ length: slides }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/>`
    + '<p:defaultTextStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>')
  put('ppt/_rels/presentation.xml.rels', rels([
    ['rIdM', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ...Array.from({ length: slides }, (_, i) => [`rIdS${i + 1}`, 'slide', `slides/slide${i + 1}.xml`]),
    ['rIdT', 'theme', 'theme/theme1.xml'],
    ['rIdTS', 'tableStyles', 'tableStyles.xml'],
  ]))
  // As PowerPoint writes it: the default style named, its definition left to PowerPoint.
  put('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)

  const scheme = (tag, v) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`
  put('ppt/theme/theme1.xml', `${XML}<a:theme ${NS} name="Kestrel"><a:themeElements><a:clrScheme name="Kestrel">`
    + `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>${scheme('lt1', k.lt1)}${scheme('dk2', k.dk2)}${scheme('lt2', k.lt2)}`
    + k.accents.map((c, i) => scheme(`accent${i + 1}`, c)).join('')
    + `${scheme('hlink', k.hlink)}${scheme('folHlink', k.hlink)}</a:clrScheme>`
    + `<a:fontScheme name="Kestrel"><a:majorFont><a:latin typeface="${k.heading}"/></a:majorFont><a:minorFont><a:latin typeface="${k.body}"/></a:minorFont></a:fontScheme>`
    + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    + '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>'
    + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    + '<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>')

  // The master: where titles and bodies go, how their text looks, and a teal band under every slide.
  const band = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 700, 1280, 20)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>`
  put('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>`
    + tree(ph(2, 'title', { box: [80, 40, 1120, 120] }) + ph(3, 'body', { idx: 1, box: [80, 200, 1120, 460] }) + band)
    + '</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/><p:sldLayoutId id="2147483651" r:id="rId3"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
    + '<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>'
    + '<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl2pPr></p:bodyStyle>'
    + '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>')
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml'],
    ['rId3', 'slideLayout', '../slideLayouts/slideLayout3.xml'],
    ['rIdTheme', 'theme', '../theme/theme1.xml'],
  ]))

  // Layouts: a title slide that moves and restyles its placeholders, title and content as the master has them, and a blank one without the master's band.
  const centred = '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr>'
  const layouts = [
    ['title', 'Title Slide', ph(2, 'ctrTitle', { box: [160, 220, 960, 160], lst: '<a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr>' }) + ph(3, 'subTitle', { idx: 1, box: [160, 400, 960, 100], lst: centred }), ''],
    ['obj', 'Title and Content', ph(2, 'title') + ph(3, 'body', { idx: 1 }), ''],
    ['blank', 'Blank', '', ' showMasterSp="0"'],
  ]
  layouts.forEach(([type, name, shapes, attrs], i) => {
    put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${XML}<p:sldLayout ${NS} type="${type}"${attrs}><p:cSld name="${name}">${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
    put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  })

  const slide = (n, layout, shapes, extra = [], attrs = '') => {
    put(`ppt/slides/slide${n}.xml`, `${XML}<p:sld ${NS}${attrs}><p:cSld>${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels([['rId1', 'slideLayout', `../slideLayouts/slideLayout${layout}.xml`], ...extra]))
  }
  const para = (inner, pPr = '') => `<a:p>${pPr}${inner}</a:p>`

  // 1. Title: both placeholders placed and styled by the layout.
  slide(1, 1, ph(2, 'ctrTitle', { body: para(run('Quarterly review')) }) + ph(3, 'subTitle', { idx: 1, body: para(run('Where we are &amp; &lt;where&gt; we go')) }))

  // 2. Title and content: bullets on two levels, numbering, a link, speaker notes.
  slide(2, 2,
    ph(2, 'title', { body: para(run('Agenda')) })
    + ph(3, 'body', {
      idx: 1,
      body: para(run('Revenue', ' b="1"', '<a:solidFill><a:srgbClr val="C23B4A"/></a:solidFill>'))
        + para(run('Europe grew fastest'), '<a:pPr lvl="1"/>')
        + para(run('First step'), '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>')
        + para(run('Second step'), '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>')
        + para(run('Read the report', '', '<a:hlinkClick r:id="rIdLink"/>')),
    }),
    [['rIdLink', 'hyperlink', 'https://example.org/report', true], ['rIdN', 'notesSlide', '../notesSlides/notesSlide1.xml']],
  )
  put('ppt/notesSlides/notesSlide1.xml', `${XML}<p:notes ${NS}><p:cSld>${tree(ph(2, 'sldImg') + ph(3, 'body', { idx: 1, body: para(run('Pause *here*')) + para(run('- then go on')) }))}</p:cSld></p:notes>`)
  put('ppt/notesSlides/_rels/notesSlide1.xml.rels', rels([['rId1', 'slide', '../slides/slide2.xml']]))

  // 3. Blank: shapes, a picture, a group, a table and a chart.
  const style = (fill, font) => `<p:style><a:lnRef idx="1"><a:schemeClr val="${fill}"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="${fill}"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="${fill}"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="${font}"/></a:fontRef></p:style>`
  const rounded = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Rounded"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(40, 40, 300, 100)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr>${style('accent2', 'lt1')}<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${para(run('Rounded'), '<a:pPr algn="ctr"/>')}</p:txBody></p:sp>`
  const triangle = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(380, 40, 100, 100)}<a:custGeom><a:pathLst><a:path w="2" h="2"><a:moveTo><a:pt x="1" y="0"/></a:moveTo><a:lnTo><a:pt x="2" y="2"/></a:lnTo><a:lnTo><a:pt x="0" y="2"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="7A4FA0"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`
  // A group drawn at half its children's scale: the circle at child (0, 0, 200, 200) lands at (520, 40, 100, 100).
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${520 * EMU}" y="${40 * EMU}"/><a:ext cx="${100 * EMU}" cy="${100 * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${200 * EMU}" cy="${200 * EMU}"/></a:xfrm></p:grpSpPr>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Circle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * EMU}" cy="${200 * EMU}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></p:spPr></p:sp></p:grpSp>`
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="6" name="Picture" descr="A teal square"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:srcRect l="25000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(660, 40, 150, 100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  const arrow = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="7" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(850, 90, 200, 0)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="19050"><a:tailEnd type="triangle"/></a:ln></p:spPr>${style('accent1', 'tx1')}</p:cxnSp>`
  const cell = (t) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(run(t))}</a:txBody><a:tcPr/></a:tc>`
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(40, 200, 400, 120).replace(/a:xfrm/g, 'p:xfrm')}`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>'
    + `<a:tblGrid><a:gridCol w="${200 * EMU}"/><a:gridCol w="${200 * EMU}"/></a:tblGrid>`
    + `<a:tr h="${60 * EMU}">${cell('Region')}${cell('Riders')}</a:tr><a:tr h="${60 * EMU}">${cell('North')}${cell('1200')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(480, 200, 600, 400).replace(/a:xfrm/g, 'p:xfrm')}`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>'
  // Half off the slide's right edge: PowerPoint hides what's past it.
  const bleed = `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Bleed"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(1200, 600, 160, 160)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></p:spPr></p:sp>`
  slide(3, 3, rounded + triangle + group + picture + arrow + table + chart + bleed, [['rIdImg', 'image', '../media/image1.png'], ['rIdChart', 'chart', '../charts/chart1.xml']])

  const series = (i, name, values, colour) =>
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
    + `<c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr>`
    + `<c:cat><c:strRef><c:strCache><c:ptCount val="3"/>${['Q1', 'Q2', 'Q3'].map((q, j) => `<c:pt idx="${j}"><c:v>${q}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`
    + `<c:val><c:numRef><c:numCache><c:ptCount val="3"/>${values.map((v, j) => `<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`
  put('ppt/charts/chart1.xml', `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>`
    + '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Riders by quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/>'
    + `<c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series(0, 'Bus', [120, 140, 160], '0B7A75')}${series(1, 'Tram', [90, 95, 130], 'E07A1F')}</c:barChart></c:plotArea>`
    + '<c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>')

  // 4. Hidden: left out, as a slide show does.
  slide(4, 2, ph(2, 'title', { body: para(run('Backup slide')) }), [], ' show="0"')

  // Content types last, so every part written above is listed.
  const ML = 'application/vnd.openxmlformats-officedocument'
  const TYPES = [
    [/^ppt\/presentation\.xml$/, `${ML}.presentationml.presentation.main+xml`],
    [/^ppt\/slides\//, `${ML}.presentationml.slide+xml`],
    [/^ppt\/slideLayouts\//, `${ML}.presentationml.slideLayout+xml`],
    [/^ppt\/slideMasters\//, `${ML}.presentationml.slideMaster+xml`],
    [/^ppt\/notesSlides\//, `${ML}.presentationml.notesSlide+xml`],
    [/^ppt\/theme\//, `${ML}.theme+xml`],
    [/^ppt\/tableStyles\.xml$/, `${ML}.presentationml.tableStyles+xml`],
    [/^ppt\/charts\//, `${ML}.drawingml.chart+xml`],
    [/^docProps\/core\.xml$/, 'application/vnd.openxmlformats-package.core-properties+xml'],
  ]
  const overrides = Object.keys(files)
    .filter((p) => p.endsWith('.xml'))
    .map((p) => [p, TYPES.find(([re]) => re.test(p))?.[1]])
    .filter(([, t]) => t)
    .map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`)
  put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${overrides.join('')}</Types>`)

  const mtime = new Date(2026, 9, 1, 12, 0, 0)
  return zipSync(Object.fromEntries(Object.entries(files).map(([p, b]) => [p, [b, { mtime }]])), { level: 9 })
}
