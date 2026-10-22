/**
 * A slide's shapes as PresentationML (`export --pptx`): what pptx-read.ts
 * read from the browser, as text boxes, tables, rectangles, pictures and
 * native charts, each where the browser put it.
 *
 * Sizes are CSS pixels on the way in: a slide is 96 pixels to the inch, so
 * a pixel is 9525 EMU and three quarters of a point.
 */
import { strToU8, zipSync } from 'fflate'
import type { Cell, ChartData, Colour, Item, Line, Paragraph, Rect, Run, TableItem, TextItem } from './pptx-read.js'

export const EMU = 9525
const emu = (px: number) => Math.round(px * EMU)
/** Hundredths of a point. */
const pts = (px: number) => Math.round(px * 75)

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const OFFDOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export function esc(s: string): string {
  return s
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    // Characters XML 1.0 can't carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
}

/** What a slide's shapes refer to: pictures, links and charts, as relationships of the slide. */
export interface SlideParts {
  /** A link's relationship id. */
  link(url: string): string
  /** A picture's PNG by its `data-pptx-pic`. */
  picture(id: number): string | undefined
  /** Add a chart part; returns its relationship id. */
  chart(data: ChartData): string
  lang: string
}

export function solid(c: Colour): string {
  const alpha = c.alpha < 1 ? `<a:alpha val="${Math.round(c.alpha * 100000)}"/>` : ''
  return `<a:solidFill><a:srgbClr val="${c.hex.toUpperCase()}">${alpha}</a:srgbClr></a:solidFill>`
}

function lineXml(l: Line | undefined): string {
  if (!l) return '<a:ln><a:noFill/></a:ln>'
  return `<a:ln w="${emu(l.width)}">${solid(l.colour)}${l.dash ? `<a:prstDash val="${l.dash}"/>` : ''}</a:ln>`
}

function xfrm(r: Rect, tag = 'a:xfrm'): string {
  return `<${tag}><a:off x="${emu(r.x)}" y="${emu(r.y)}"/><a:ext cx="${Math.max(1, emu(r.w))}" cy="${Math.max(1, emu(r.h))}"/></${tag}>`
}

function geometry(r: Rect, radius: number | undefined): string {
  if (!radius) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  const adj = Math.min(50000, Math.round((radius / Math.max(1, Math.min(r.w, r.h))) * 100000))
  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`
}

export function shapesXml(items: Item[], parts: SlideParts, canvas: { width: number; height: number }): string {
  let id = 2
  return items
    .map((item) => {
      const n = id++
      switch (item.kind) {
        case 'shape':
          return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="${esc(item.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
            + `<p:spPr>${xfrm(item.rect)}${geometry(item.rect, item.radius)}${item.fill ? solid(item.fill.colour) : '<a:noFill/>'}${lineXml(item.line)}</p:spPr>`
            + `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="${esc(parts.lang)}"/></a:p></p:txBody></p:sp>`
        case 'text':
          return textXml(item, n, parts, canvas)
        case 'table':
          return tableXml(item, n, parts)
        case 'picture': {
          if (item.chart) {
            const rid = parts.chart(item.chart)
            return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${n}" name="${esc(item.name)}" descr="${esc(item.alt)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
              + `${xfrm(item.rect, 'p:xfrm')}<a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`
          }
          const rid = parts.picture(item.id)
          if (!rid) return ''
          return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="${esc(item.name)}" descr="${esc(item.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
            + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
            + `<p:spPr>${xfrm(item.rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
        }
      }
    })
    .join('')
}

/**
 * Fonts measure a little differently in PowerPoint, so a box gets some
 * room to grow, on the side its text grows towards, within the slide.
 */
function roomy(item: TextItem, canvas: { width: number; height: number }): Rect {
  const r = { ...item.rect }
  // A line that doesn't wrap can have all the room it likes: it only matters where it's aligned.
  const extra = item.nowrap ? Math.max(r.w * 0.3, 48) : Math.min(r.w * 0.06, 48)
  const align = item.paragraphs[0]?.align ?? 'l'
  if (align === 'ctr') {
    const grow = Math.min(extra / 2, r.x, canvas.width - r.x - r.w)
    r.x -= Math.max(0, grow)
    r.w += 2 * Math.max(0, grow)
  } else if (align === 'r') {
    const grow = Math.max(0, Math.min(extra, r.x))
    r.x -= grow
    r.w += grow
  } else {
    r.w += Math.max(0, Math.min(extra, canvas.width - r.x - r.w))
  }
  return r
}

function textXml(item: TextItem, n: number, parts: SlideParts, canvas: { width: number; height: number }): string {
  const rect = roomy(item, canvas)
  const grownLeft = item.rect.x - rect.x
  const ins = item.insets
  const body = `<a:bodyPr wrap="${item.nowrap ? 'none' : 'square'}" lIns="${emu(ins.l + grownLeft)}" tIns="${emu(ins.t)}" rIns="${emu(ins.r)}" bIns="${emu(ins.b)}" rtlCol="0" anchor="${item.anchor}"><a:noAutofit/></a:bodyPr>`
  const nv = item.title
    ? `<p:nvSpPr><p:cNvPr id="${n}" name="Title ${n}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`
    : `<p:nvSpPr><p:cNvPr id="${n}" name="${esc(item.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
  return `<p:sp>${nv}<p:spPr>${xfrm(rect)}${geometry(rect, item.radius)}${item.fill ? solid(item.fill.colour) : '<a:noFill/>'}${lineXml(item.line)}</p:spPr>`
    + `<p:txBody>${body}<a:lstStyle/>${paragraphsXml(item.paragraphs, parts)}</p:txBody></p:sp>`
}

export function paragraphsXml(paragraphs: Paragraph[], parts: SlideParts): string {
  if (!paragraphs.length) return `<a:p><a:endParaRPr lang="${esc(parts.lang)}"/></a:p>`
  return paragraphs.map((p) => paragraphXml(p, parts)).join('')
}

function paragraphXml(p: Paragraph, parts: SlideParts): string {
  const attrs = [`algn="${p.align}"`]
  if (p.left) attrs.push(`marL="${emu(p.left)}"`)
  if (p.indent) attrs.push(`indent="${emu(Math.max(-p.left, p.indent))}"`)
  if (p.level) attrs.push(`lvl="${Math.min(8, p.level)}"`)
  let inner = ''
  if (p.lineHeight) inner += `<a:lnSpc><a:spcPts val="${Math.min(158400, pts(p.lineHeight))}"/></a:lnSpc>`
  else inner += '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>'
  inner += `<a:spcBef><a:spcPts val="${Math.min(158400, pts(p.before))}"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>`
  const b = p.bullet
  if (b) {
    if (b.colour) inner += `<a:buClr><a:srgbClr val="${b.colour.hex.toUpperCase()}"/></a:buClr>`
    if (b.scale) inner += `<a:buSzPct val="${Math.round(b.scale * 100000)}"/>`
    if (b.auto) inner += `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${b.auto}"${b.start && b.start !== 1 ? ` startAt="${b.start}"` : ''}/>`
    else inner += `<a:buFont typeface="${esc(b.font && !/symbol|wingdings/i.test(b.font) ? b.font : 'Arial')}"/><a:buChar char="${esc(b.char ?? '•')}"/>`
  } else {
    inner += '<a:buNone/>'
  }
  const runs = p.runs.map((r) => runXml(r, parts)).join('')
  const end = p.runs[p.runs.length - 1]
  const endSize = end ? end.size : p.emptySize
  return `<a:p><a:pPr ${attrs.join(' ')}>${inner}</a:pPr>${runs}<a:endParaRPr lang="${esc(parts.lang)}"${endSize ? ` sz="${clampSize(endSize)}"` : ''} dirty="0"/></a:p>`
}

const clampSize = (px: number) => Math.min(400000, Math.max(100, pts(px)))

function runProps(r: Omit<Run, 'text'>, parts: SlideParts, tag = 'a:rPr'): string {
  const attrs = [`lang="${esc(parts.lang)}"`, `sz="${clampSize(r.size)}"`]
  if (r.bold) attrs.push('b="1"')
  else attrs.push('b="0"')
  if (r.italic) attrs.push('i="1"')
  if (r.underline) attrs.push('u="sng"')
  if (r.strike) attrs.push('strike="sngStrike"')
  if (r.caps) attrs.push(`cap="${r.caps}"`)
  if (r.spacing) attrs.push(`spc="${Math.round(pts(r.spacing))}"`)
  if (r.baseline) attrs.push(`baseline="${Math.round(r.baseline * 100000)}"`)
  attrs.push('dirty="0"')
  let fill = solid(r.colour)
  if (r.gradient) {
    // CSS angles run clockwise from up; DrawingML's from right.
    const ang = (((r.gradient.angle - 90) % 360) + 360) % 360
    fill = `<a:gradFill rotWithShape="1"><a:gsLst>${r.gradient.stops.map((s) => `<a:gs pos="${Math.round(s.at * 100000)}"><a:srgbClr val="${s.colour.hex.toUpperCase()}"/></a:gs>`).join('')}</a:gsLst><a:lin ang="${Math.round(ang * 60000)}" scaled="0"/></a:gradFill>`
  }
  const highlight = r.highlight ? `<a:highlight><a:srgbClr val="${r.highlight.hex.toUpperCase()}"/></a:highlight>` : ''
  const font = `<a:latin typeface="${esc(r.font)}"/><a:ea typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>`
  let link = ''
  if (r.link) {
    link = `<a:hlinkClick r:id="${parts.link(r.link)}"/>`
  }
  return `<${tag} ${attrs.join(' ')}>${fill}${highlight}${font}${link}</${tag}>`
}

function runXml(r: Run, parts: SlideParts): string {
  if (r.br) {
    const { link: _link, text: _text, ...style } = r
    return `<a:br>${runProps(style, parts)}</a:br>`
  }
  return `<a:r>${runProps(r, parts)}<a:t>${esc(r.text)}</a:t></a:r>`
}

function tableXml(t: TableItem, n: number, parts: SlideParts): string {
  const grid = t.cols.map((w) => `<a:gridCol w="${Math.max(1, emu(w))}"/>`).join('')
  // Every grid position is a cell: the ones a merged cell covers say so.
  const at = new Map<string, Cell>()
  const covered = new Map<string, 'h' | 'v' | 'hv'>()
  for (const c of t.cells) {
    at.set(`${c.row},${c.col}`, c)
    for (let r = c.row; r < c.row + c.rowSpan && r < t.rows.length; r++) {
      for (let k = c.col; k < c.col + c.colSpan && k < t.cols.length; k++) {
        if (r === c.row && k === c.col) continue
        covered.set(`${r},${k}`, r === c.row ? 'h' : k === c.col ? 'v' : 'hv')
      }
    }
  }
  const rows = t.rows
    .map((h, r) => {
      const cells = t.cols
        .map((_, k) => {
          const cell = at.get(`${r},${k}`)
          const cover = covered.get(`${r},${k}`)
          if (!cell || cover) {
            const merge = cover === 'h' ? ' hMerge="1"' : cover === 'v' ? ' vMerge="1"' : cover === 'hv' ? ' hMerge="1" vMerge="1"' : ''
            const none = ['lnL', 'lnR', 'lnT', 'lnB'].map((t) => `<a:${t} w="0"><a:noFill/></a:${t}>`).join('')
            return `<a:tc${merge}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="${esc(parts.lang)}"/></a:p></a:txBody><a:tcPr>${none}<a:noFill/></a:tcPr></a:tc>`
          }
          const span = `${cell.colSpan > 1 ? ` gridSpan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : ''}`
          const side = (tag: string, l: Line | undefined) => (l ? `<a:${tag} w="${emu(l.width)}">${solid(l.colour)}${l.dash ? `<a:prstDash val="${l.dash}"/>` : ''}</a:${tag}>` : `<a:${tag} w="0"><a:noFill/></a:${tag}>`)
          const pr = `<a:tcPr marL="${emu(cell.insets.l)}" marR="${emu(cell.insets.r)}" marT="${emu(cell.insets.t)}" marB="${emu(cell.insets.b)}" anchor="${cell.anchor}">`
            + side('lnL', cell.borders.l) + side('lnR', cell.borders.r) + side('lnT', cell.borders.t) + side('lnB', cell.borders.b)
            + (cell.fill ? solid(cell.fill.colour) : '<a:noFill/>')
            + '</a:tcPr>'
          return `<a:tc${span}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphsXml(cell.paragraphs, parts)}</a:txBody>${pr}</a:tc>`
        })
        .join('')
      return `<a:tr h="${emu(h)}">${cells}</a:tr>`
    })
    .join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${n}" name="${esc(t.name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `${xfrm(t.rect, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">`
    + `<a:tbl><a:tblPr firstRow="0" bandRow="0"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

/* Charts --------------------------------------------------------------- */

/** A spreadsheet column's letter, from 0. */
const column = (k: number): string => (k < 26 ? String.fromCharCode(65 + k) : column(Math.floor(k / 26) - 1) + column(k % 26))

function textProps(d: ChartData, lang: string, size = d.fontSize, bold = false): string {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${clampSize(size)}" b="${bold ? 1 : 0}">${solid(d.textColour)}<a:latin typeface="${esc(d.font)}"/><a:cs typeface="${esc(d.font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="${esc(lang)}"/></a:p></c:txPr>`
}

function strCache(f: string, values: string[]): string {
  return `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values.map((v, k) => `<c:pt idx="${k}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`
}

function numCache(f: string, values: Array<number | null>, format = 'General'): string {
  return `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${esc(format)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, k) => (v === null ? '' : `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef>`
}

/** A native chart (`c:chartSpace`), its values cached and in the embedded workbook beside it. */
export function chartXml(d: ChartData, lang: string): string {
  const rows = Math.max(d.categories.length, ...d.series.map((s) => s.values.length))
  const fmt = d.numberFormat ?? 'General'
  const numFmt = `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/>`
  const scalingOf = (a: ChartData['axis']) => a ? `<c:scaling><c:orientation val="minMax"/><c:max val="${a.max}"/><c:min val="${a.min}"/></c:scaling>` : '<c:scaling><c:orientation val="minMax"/></c:scaling>'
  const scaling = d.axis ? `<c:scaling><c:orientation val="minMax"/><c:max val="${d.axis.max}"/><c:min val="${d.axis.min}"/></c:scaling>` : '<c:scaling><c:orientation val="minMax"/></c:scaling>'
  const labels = d.labels ? `<c:dLbls>${numFmt}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(d, lang, 16)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : ''
  const range = (k: number) => `Sheet1!$${column(k)}$2:$${column(k)}$${rows + 1}`
  const name = (k: number) => `Sheet1!$${column(k)}$1`
  const grid = d.gridColour ?? { hex: d.textColour.hex, alpha: 0.25 }
  const axisLine = `<c:spPr><a:ln w="9525">${solid(grid)}</a:ln></c:spPr>`
  const noLine = '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
  const gridlines = `<c:majorGridlines><c:spPr><a:ln w="9525">${solid(grid)}<a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>`
  const catAx = (pos: string, del = false) => `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="${d.reversed ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="${del ? 1 : 0}"/><c:axPos val="${pos}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textProps(d, lang)}<c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
  const valAx = (id: number, cross: number, pos: string, lines: boolean) => `<c:valAx><c:axId val="${id}"/>${lines ? scaling : scalingOf(d.xAxis)}<c:delete val="0"/><c:axPos val="${pos}"/>${lines ? gridlines : ''}${numFmt}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${noLine}${textProps(d, lang)}<c:crossAx val="${cross}"/><c:crosses val="${d.reversed && lines ? 'max' : 'autoZero'}"/><c:crossBetween val="${d.type === 'scatter' ? 'midCat' : 'between'}"/>${(lines ? d.axis : d.xAxis)?.interval ? `<c:majorUnit val="${(lines ? d.axis : d.xAxis)!.interval}"/>` : ''}</c:valAx>`
  const tx = (k: number) => `<c:tx>${strCache(name(k + 1), [d.series[k]!.name])}</c:tx>`
  const cat = `<c:cat>${strCache(range(0), d.categories)}</c:cat>`
  const fillOf = (k: number) => (d.series[k]!.colour ? solid(d.series[k]!.colour!) : '')

  let plot = ''
  if (d.type === 'bar') {
    const sers = d.series.map((s, k) => `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx(k)}<c:spPr>${fillOf(k)}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${labels}${cat}<c:val>${numCache(range(k + 1), s.values, fmt)}</c:val></c:ser>`).join('')
    plot = `<c:barChart><c:barDir val="${d.horizontal ? 'bar' : 'col'}"/><c:grouping val="${d.stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="80"/>${d.stacked ? '<c:overlap val="100"/>' : ''}<c:axId val="111"/><c:axId val="222"/></c:barChart>`
      + catAx(d.horizontal ? 'l' : 'b') + valAx(222, 111, d.horizontal ? 'b' : 'l', true)
  } else if (d.type === 'line' && d.area) {
    const sers = d.series.map((s, k) => `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx(k)}<c:spPr>${d.series[k]!.colour ? solid({ ...d.series[k]!.colour!, alpha: d.areaOpacity ?? 0.6 }) : ''}<a:ln w="28575">${d.series[k]!.colour ? solid(d.series[k]!.colour!) : ''}</a:ln></c:spPr>${labels}${cat}<c:val>${numCache(range(k + 1), s.values, fmt)}</c:val></c:ser>`).join('')
    plot = `<c:areaChart><c:grouping val="${d.stacked ? 'stacked' : 'standard'}"/><c:varyColors val="0"/>${sers}<c:axId val="111"/><c:axId val="222"/></c:areaChart>` + catAx('b') + valAx(222, 111, 'l', true)
  } else if (d.type === 'line') {
    const sers = d.series.map((s, k) => `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx(k)}<c:spPr><a:ln w="28575" cap="rnd">${fillOf(k)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${fillOf(k)}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>${labels}${cat}<c:val>${numCache(range(k + 1), s.values, fmt)}</c:val><c:smooth val="${d.smooth ? 1 : 0}"/></c:ser>`).join('')
    plot = `<c:lineChart><c:grouping val="${d.stacked ? 'stacked' : 'standard'}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>` + catAx('b') + valAx(222, 111, 'l', true)
  } else if (d.type === 'pie') {
    const s = d.series[0]!
    const points = (d.pointColours ?? []).map((c, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${solid(c)}<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join('')
    const sliceLabels = d.sliceLabels
      ? `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(d, lang)}${d.doughnut ? '' : '<c:dLblPos val="outEnd"/>'}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator>  </c:separator><c:showLeaderLines val="1"/></c:dLbls>`
      : ''
    const ser = `<c:ser><c:idx val="0"/><c:order val="0"/>${tx(0)}${points}${sliceLabels}${cat}<c:val>${numCache(range(1), s.values)}</c:val></c:ser>`
    plot = d.doughnut
      ? `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="${Math.min(90, Math.max(10, d.hole ?? 50))}"/></c:doughnutChart>`
      : `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`
  } else if (d.series.some((s) => s.sizes)) {
    // Bubbles: like a scatter, with each point's size as a third column.
    const sers = d.series.map((s, k) => `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx>${strCache(name(3 * k + 1), [s.name])}</c:tx><c:spPr>${s.colour ? solid({ ...s.colour, alpha: 0.75 }) : ''}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/><c:xVal>${numCache(range(3 * k), s.x ?? [])}</c:xVal><c:yVal>${numCache(range(3 * k + 1), s.values, fmt)}</c:yVal><c:bubbleSize>${numCache(range(3 * k + 2), s.sizes ?? s.values.map(() => 1))}</c:bubbleSize><c:bubble3D val="0"/></c:ser>`).join('')
    plot = `<c:bubbleChart><c:varyColors val="0"/>${sers}<c:bubbleScale val="${d.bubbleScale ?? 100}"/><c:showNegBubbles val="0"/><c:axId val="111"/><c:axId val="222"/></c:bubbleChart>` + valAx(111, 222, 'b', false) + valAx(222, 111, 'l', true)
  } else {
    // Scatter: each series' x values are its own column, then its y values.
    const sers = d.series.map((s, k) => `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx>${strCache(name(2 * k + 1), [s.name])}</c:tx><c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr>${fillOf(k)}<a:ln><a:noFill/></a:ln></c:spPr></c:marker><c:xVal>${numCache(range(2 * k), s.x ?? [])}</c:xVal><c:yVal>${numCache(range(2 * k + 1), s.values, fmt)}</c:yVal><c:smooth val="0"/></c:ser>`).join('')
    plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}<c:axId val="111"/><c:axId val="222"/></c:scatterChart>` + valAx(111, 222, 'b', false) + valAx(222, 111, 'l', true)
  }

  const title = d.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${clampSize(24)}" b="1">${solid(d.titleColour ?? d.textColour)}<a:latin typeface="${esc(d.font)}"/></a:defRPr></a:pPr><a:r><a:rPr lang="${esc(lang)}" sz="${clampSize(24)}" b="1">${solid(d.titleColour ?? d.textColour)}<a:latin typeface="${esc(d.font)}"/></a:rPr><a:t>${esc(d.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>'
  const legend = d.legend ? `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${textProps(d, lang)}</c:legend>` : ''
  return `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:date1904 val="0"/><c:lang val="${esc(lang)}"/><c:roundedCorners val="0"/>`
    + `<c:chart>${title}<c:plotArea><c:layout/>${plot}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(d, lang)}`
    + `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
}

/** The chart's values as a workbook, so "Edit Data" in PowerPoint opens them. */
export function chartWorkbook(d: ChartData): Uint8Array {
  const table: Array<Array<string | number | null>> = []
  if (d.type === 'scatter' && d.series.some((s) => s.sizes)) {
    const rows = Math.max(0, ...d.series.map((s) => s.values.length))
    table.push(d.series.flatMap((s) => [`${s.name} (x)`, s.name, `${s.name} (size)`]))
    for (let r = 0; r < rows; r++) table.push(d.series.flatMap((s) => [s.x?.[r] ?? null, s.values[r] ?? null, s.sizes?.[r] ?? null]))
  } else if (d.type === 'scatter') {
    const rows = Math.max(0, ...d.series.map((s) => s.values.length))
    table.push(d.series.flatMap((s) => [`${s.name} (x)`, s.name]))
    for (let r = 0; r < rows; r++) table.push(d.series.flatMap((s) => [s.x?.[r] ?? null, s.values[r] ?? null]))
  } else {
    table.push(['', ...d.series.map((s) => s.name)])
    const rows = Math.max(d.categories.length, ...d.series.map((s) => s.values.length))
    for (let r = 0; r < rows; r++) table.push([d.categories[r] ?? '', ...d.series.map((s) => s.values[r] ?? null)])
  }
  const sheet = table
    .map((row, r) => `<row r="${r + 1}">${row.map((v, k) => {
      const ref = `${column(k)}${r + 1}`
      if (v === null || v === '') return ''
      return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
    }).join('')}</row>`)
    .join('')
  const x = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`)
  const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
  return zipSync({
    '[Content_Types].xml': x(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/></Types>`),
    '_rels/.rels': x(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OFFDOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': x(`<workbook xmlns="${SS}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': x(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OFFDOC}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFDOC}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': x(`<styleSheet xmlns="${SS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': x(`<worksheet xmlns="${SS}"><sheetData>${sheet}</sheetData></worksheet>`),
  })
}
