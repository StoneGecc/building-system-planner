import type { Layer } from '../types/system'

export const MIN_LAYER_PX = 14

/**
 * Parse a raw thickness string from the CSV into a numeric inch value.
 * Handles fractions (3/32), ranges (5–7, 6-12 (gap)), "~ to" notation,
 * "x" profiles, "dia." pipe sizes, and "varies" / "—".
 */
export function parseThickness(val: string): number {
  if (!val || val === '—' || val === 'varies') return 4

  const s = val.trim()

  // "3 dia." → 3
  if (s.toLowerCase().includes('dia')) return parseFloat(s) || 3

  // "~9 to 10.5"
  const toMatch = s.replace(/~/g, '').match(/([\d.]+)\s+to\s+([\d.]+)/i)
  if (toMatch) return (parseFloat(toMatch[1]) + parseFloat(toMatch[2])) / 2

  // "6–12 (gap)" or "1–1.5" or "5-7"
  const dashMatch = s.match(/^([\d.]+)\s*[–\-]\s*([\d.]+)/)
  if (dashMatch) return (parseFloat(dashMatch[1]) + parseFloat(dashMatch[2])) / 2

  // "0.75 x 1.5 profile" → first number (height in section)
  const xMatch = s.match(/^([\d.]+)\s*x/i)
  if (xMatch) return parseFloat(xMatch[1])

  // "3/32" or "1/4"
  const fracMatch = s.match(/^(\d+)\/(\d+)$/)
  if (fracMatch) return parseInt(fracMatch[1]) / parseInt(fracMatch[2])

  const n = parseFloat(s)
  return isNaN(n) ? 4 : n
}

/** Pixels per inch for to-scale drawings. 3" = 1'-0" → 24 px/in */
export const DETAIL_SCALE_PX_PER_IN = 24

/**
 * Compute pixel sizes for layers drawn to scale.
 * Each layer is thickness (inches) × pxPerInch. Minimum 2px for visibility.
 */
export function computeLayerSizesToScale(
  layers: Layer[],
  pxPerInch: number = DETAIL_SCALE_PX_PER_IN,
): number[] {
  return layers.map(l => Math.max(2, Math.round(parseThickness(l.thickness) * pxPerInch)))
}

/**
 * Compute pixel sizes for each layer using a proportional + minimum scheme.
 * Formula: size_i = MIN + (thickness_i / totalThickness) * (totalPx - n * MIN)
 * This guarantees every layer ≥ MIN and the sum equals totalPx.
 */
export function computeLayerSizes(layers: Layer[], totalPx: number): number[] {
  const thicknesses = layers.map(l => parseThickness(l.thickness))
  const total = thicknesses.reduce((a, b) => a + b, 0)

  if (total === 0) return layers.map(() => totalPx / layers.length)

  const n = layers.length
  const minTotal = n * MIN_LAYER_PX

  if (minTotal >= totalPx) {
    return layers.map(() => totalPx / n)
  }

  const extraPx = totalPx - minTotal
  return thicknesses.map(t => MIN_LAYER_PX + (t / total) * extraPx)
}

export interface LayerRect {
  x: number
  y: number
  w: number
  h: number
}

/** Build layer rectangles for a WALL section (layers stacked left → right). */
export function buildWallRects(
  sizes: number[],
  sectionX: number,
  sectionY: number,
  sectionH: number,
): LayerRect[] {
  const rects: LayerRect[] = []
  let currentX = sectionX
  for (const w of sizes) {
    rects.push({ x: currentX, y: sectionY, w, h: sectionH })
    currentX += w
  }
  return rects
}

/** Build layer rectangles for a horizontal section (layers stacked top → bottom). */
export function buildHorizRects(
  sizes: number[],
  sectionX: number,
  sectionY: number,
  sectionW: number,
): LayerRect[] {
  const rects: LayerRect[] = []
  let currentY = sectionY
  for (const h of sizes) {
    rects.push({ x: sectionX, y: currentY, w: sectionW, h })
    currentY += h
  }
  return rects
}

/**
 * Compute callout Y positions with consistent spacing.
 * When fixedSpacingPx is provided: uses fixed spacing from top (consistent spacing).
 * Otherwise: distributes evenly in span, then de-clusters.
 */
export function computeCalloutYPositions(
  count: number,
  yStart: number,
  yEnd: number,
  minSpacingPx = 46,
  fixedSpacingPx?: number,
): number[] {
  if (count === 0) return []
  if (fixedSpacingPx != null) {
    // Fixed spacing: first item center at yStart + spacing/2, then spacing between each
    return Array.from({ length: count }, (_, i) => yStart + (i + 0.5) * fixedSpacingPx)
  }
  const span = yEnd - yStart
  const spacing = span / count
  const positions = Array.from({ length: count }, (_, i) => yStart + (i + 0.5) * spacing)
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - positions[i - 1] < minSpacingPx) {
      positions[i] = positions[i - 1] + minSpacingPx
    }
  }
  return positions
}
