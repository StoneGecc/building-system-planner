import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { prepareSvgContent } from './exportAll'

function ensureSvgXmlns(svgStr: string): string {
  if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
    return svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return svgStr
}

/** Fix unescaped ampersands that break XML parsing (e.g. in user-edited labels) */
function sanitizeSvgForXml(svgStr: string): string {
  return svgStr.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
}

function parseSvgStringToElement(svgStr: string): SVGSVGElement {
  const withXmlns = ensureSvgXmlns(svgStr)
  const sanitized = sanitizeSvgForXml(withXmlns)
  const parser = new DOMParser()

  const xmlDoc = parser.parseFromString(
    '<?xml version="1.0" encoding="utf-8"?>\n' + sanitized,
    'image/svg+xml'
  )
  let svg = xmlDoc.querySelector('svg')
  const parserError = xmlDoc.querySelector('parsererror')

  if (!svg || parserError) {
    const htmlDoc = parser.parseFromString(
      '<!DOCTYPE html><html><body>' + sanitized + '</body></html>',
      'text/html'
    )
    svg = htmlDoc.querySelector('svg')
  }

  if (!svg) {
    const errDetail = parserError?.textContent?.slice(0, 100) || 'Unknown XML error'
    throw new Error(`SVG parse failed for PDF export: ${errDetail}`)
  }
  return svg
}

function safeBasename(base: string): string {
  const trimmed = base.trim().replace(/\.(svg|pdf)$/i, '')
  const safe = trimmed.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.length > 0 ? safe : 'plan-layout'
}

function svgSizePt(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height }
  }
  const w = svg.width.baseVal.value
  const h = svg.height.baseVal.value
  if (w > 0 && h > 0) {
    return { w, h }
  }
  return { w: 1200, h: 800 }
}

/**
 * PlanLayoutEditor draws the construction grid via `<pattern>` + `fill="url(#…)"` rects for performance.
 * svg2pdf.js often drops or mis-renders pattern fills, so the PDF looks like it's missing most grid lines.
 * This expands those patterns into plain grid lines (no node dots — PDF export omits dots by design).
 */
function expandPlanLayoutGridPatternsForPdf(svg: SVGSVGElement): boolean {
  const defs = svg.querySelector('defs')
  if (!defs) return false

  const patterns = Array.from(defs.querySelectorAll('pattern'))
  let hPat: SVGPatternElement | null = null
  let vPat: SVGPatternElement | null = null
  let dPat: SVGPatternElement | null = null

  for (const pat of patterns) {
    const p = pat as SVGPatternElement
    const pw = p.width.baseVal.value
    const ph = p.height.baseVal.value
    const line = pat.querySelector('line')
    const circle = pat.querySelector('circle')
    if (line?.getAttribute('stroke') === '#ddd') {
      const x1 = parseFloat(line.getAttribute('x1') || '0')
      const x2 = parseFloat(line.getAttribute('x2') || '0')
      const y1 = parseFloat(line.getAttribute('y1') || '0')
      const y2 = parseFloat(line.getAttribute('y2') || '0')
      if (pw > ph && ph > 0 && Math.abs(y1 - y2) < 0.01 && y1 <= ph * 0.51) {
        if (Math.abs(x2 - (pw - x1)) < 1.5) hPat = p
      }
      if (ph > pw && pw > 0 && Math.abs(x1 - x2) < 0.01 && x1 <= pw * 0.51) {
        if (Math.abs(y2 - (ph - y1)) < 1.5) vPat = p
      }
    }
    if (circle && Math.abs(pw - ph) < 0.01 && pw > 0) {
      if (circle.getAttribute('fill') === '#6a635a') dPat = p
    }
  }

  if (!hPat || !vPat) return false

  const cw = hPat.width.baseVal.value
  const cellPx = hPat.height.baseVal.value
  const ch = vPat.height.baseVal.value
  const trim = parseFloat(hPat.querySelector('line')!.getAttribute('x1') || '0')

  const ids = new Set([hPat.id, vPat.id, dPat?.id].filter(Boolean) as string[])
  const rects = Array.from(svg.querySelectorAll('rect')).filter((r) => {
    const fill = r.getAttribute('fill') || ''
    const m = fill.match(/^url\(#([^)]+)\)$/)
    return Boolean(m && ids.has(m[1]!))
  })
  if (rects.length === 0) return false

  const NS = 'http://www.w3.org/2000/svg'
  const parentEl = rects[0].parentNode as Element
  const useEditorGridGroup =
    parentEl.tagName.toLowerCase() === 'g' && parentEl.getAttribute('id') === 'plan-export-grid'

  rects.forEach((r) => r.remove())

  const container: SVGGElement = useEditorGridGroup
    ? (parentEl as SVGGElement)
    : (() => {
        const g = document.createElementNS(NS, 'g')
        g.setAttribute('id', 'plan-export-grid')
        g.setAttribute('pointer-events', 'none')
        g.setAttribute('aria-hidden', 'true')
        const gridTitle = document.createElementNS(NS, 'title')
        gridTitle.textContent = 'Grid'
        g.appendChild(gridTitle)
        parentEl.appendChild(g)
        return g
      })()

  if (useEditorGridGroup && !container.querySelector('title')) {
    const t = document.createElementNS(NS, 'title')
    t.textContent = 'Grid'
    container.insertBefore(t, container.firstChild)
  }

  /** Slightly thicker than 0.35 so pdf renderers don’t clip sub-pixel strokes. */
  const gridStroke = '0.55'

  for (let j = 0; j * cellPx <= ch + 1e-6; j++) {
    const y = j * cellPx
    const line = document.createElementNS(NS, 'line')
    line.setAttribute('x1', String(trim))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(cw - trim))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#dddddd')
    line.setAttribute('stroke-width', gridStroke)
    container.appendChild(line)
  }

  for (let i = 0; i * cellPx <= cw + 1e-6; i++) {
    const x = i * cellPx
    const line = document.createElementNS(NS, 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(trim))
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(ch - trim))
    line.setAttribute('stroke', '#dddddd')
    line.setAttribute('stroke-width', gridStroke)
    container.appendChild(line)
  }

  hPat.remove()
  vPat.remove()
  if (dPat) dPat.remove()

  if (!defs.querySelector('*')) defs.remove()

  return true
}

/**
 * Remove the grid-node dot pattern (PlanLayoutEditor `patGridDots`, id suffix `-gd`) so exports omit dots.
 * Uses both structural detection and the stable `-gd` id suffix so stripping survives serializer quirks.
 */
function stripPlanLayoutGridDotsFromSvg(svg: SVGSVGElement): void {
  const defs = svg.querySelector('defs')

  const dotsPatternIds = new Set<string>()
  if (defs) {
    for (const pat of defs.querySelectorAll('pattern')) {
      const p = pat as SVGPatternElement
      const pw = p.width.baseVal.value
      const ph = p.height.baseVal.value
      const circle = pat.querySelector('circle')
      const fill = circle?.getAttribute('fill')?.toLowerCase() ?? ''
      const isDotTile =
        circle &&
        Math.abs(pw - ph) < 0.01 &&
        pw > 0 &&
        (fill === '#6a635a' || fill === 'rgb(106, 99, 90)')
      if (isDotTile || pat.id.endsWith('-gd')) {
        dotsPatternIds.add(pat.id)
      }
    }
    for (const id of dotsPatternIds) {
      defs.querySelector(`#${CSS.escape(id)}`)?.remove()
    }
    if (!defs.querySelector('*')) defs.remove()
  }

  for (const r of svg.querySelectorAll('rect[fill]')) {
    const fill = r.getAttribute('fill') || ''
    const m = fill.match(/^url\(#([^)]+)\)$/)
    if (!m) continue
    const refId = m[1]!
    if (dotsPatternIds.has(refId) || refId.endsWith('-gd')) r.remove()
  }

  const gridG = svg.querySelector('#plan-export-grid')
  gridG?.querySelectorAll('circle').forEach((c) => c.remove())
}

/**
 * Floor/stair cells use a subtle on-screen stroke (`rgba(0,0,0,0.12)`) so adjacent
 * fills read as separate tiles. Illustrator imports that as a grey outline on every
 * rectangle. Remove stroke on exported SVG only; on-canvas view unchanged.
 */
function stripFloorCellStrokesForSvgExport(svg: SVGSVGElement): void {
  const floor = svg.querySelector('#plan-export-floor')
  if (!floor) return
  for (const el of floor.querySelectorAll('rect')) {
    el.setAttribute('stroke', 'none')
    el.removeAttribute('stroke-width')
  }
}

/**
 * svg2pdf and Adobe Illustrator often mis-handle `hsl()` / `hsla()` on SVG attributes (fills read as black).
 * Rewrite to `rgb()` / `rgba()` via computed style resolution.
 */
function convertHslPaintAttributesToRgb(svg: SVGSVGElement): void {
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)

  const convert = (el: Element) => {
    for (const attr of ['stroke', 'fill', 'stop-color', 'flood-color', 'lighting-color'] as const) {
      const v = el.getAttribute(attr)
      if (!v || v === 'none' || v.startsWith('url(')) continue
      if (!/hsl/i.test(v)) continue
      try {
        probe.style.color = ''
        probe.style.color = v
        const rgb = getComputedStyle(probe).color
        if (rgb && /^rgba?\(/.test(rgb)) el.setAttribute(attr, rgb)
      } catch {
        /* ignore invalid color */
      }
    }
    for (const child of el.children) convert(child)
  }

  convert(svg)
  document.body.removeChild(probe)
}

function prepareSvgForPlanPdfExport(svgEl: SVGSVGElement): SVGSVGElement {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  stripPlanLayoutGridDotsFromSvg(clone)
  expandPlanLayoutGridPatternsForPdf(clone)
  convertHslPaintAttributesToRgb(clone)
  const serializer = new XMLSerializer()
  const raw = serializer.serializeToString(clone)
  return parseSvgStringToElement(raw)
}

/**
 * Download the live plan / elevation layout canvas as a standalone SVG (vector).
 * Uses a deep clone so the on-screen zoom (CSS scale on a parent) does not affect output.
 */
export function downloadPlanLayoutSvg(svgEl: SVGSVGElement | null, basename: string): void {
  if (!svgEl) {
    alert('Plan canvas is not ready to export.')
    return
  }
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  stripPlanLayoutGridDotsFromSvg(clone)
  stripFloorCellStrokesForSvgExport(clone)
  convertHslPaintAttributesToRgb(clone)
  const serializer = new XMLSerializer()
  const raw = serializer.serializeToString(clone)
  const fileStr = prepareSvgContent(raw)
  const name = safeBasename(basename)
  const blob = new Blob([fileStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Raster-free PDF via svg2pdf (same stack as the main sheet export).
 */
export async function downloadPlanLayoutPdf(svgEl: SVGSVGElement | null, basename: string): Promise<void> {
  if (!svgEl) {
    alert('Plan canvas is not ready to export.')
    return
  }
  const { w, h } = svgSizePt(svgEl)
  const svgForPdf = prepareSvgForPlanPdfExport(svgEl)

  const doc = new jsPDF({
    unit: 'pt',
    format: [w, h],
    orientation: w >= h ? 'landscape' : 'portrait',
  })

  await doc.svg(svgForPdf, {
    x: 0,
    y: 0,
    width: w,
    height: h,
  })

  const name = safeBasename(basename)
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
