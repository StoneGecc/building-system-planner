import type { BuildingDimensions } from '../types/system'

/** Plan canvas size in SVG user units (= plan px at planScale). */
export function footprintCanvasSizePx(d: BuildingDimensions): { w: number; h: number } {
  return {
    w: d.footprintWidth * d.planScale,
    h: d.footprintDepth * d.planScale,
  }
}

export function planInchesToCanvasPx(d: BuildingDimensions, xIn: number, yIn: number): { x: number; y: number } {
  return { x: xIn * d.planScale, y: yIn * d.planScale }
}

export function canvasPxToPlanInches(d: BuildingDimensions, xPx: number, yPx: number): { xIn: number; yIn: number } {
  return { xIn: xPx / d.planScale, yIn: yPx / d.planScale }
}

/** Client coords → SVG user coords using element CTM (works with parent CSS scale). */
export function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const inv = ctm.inverse()
  const p = pt.matrixTransform(inv)
  return { x: p.x, y: p.y }
}
