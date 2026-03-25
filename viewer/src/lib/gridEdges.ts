import type { BuildingDimensions } from '../types/system'
import type { GridEdgeKey } from '../types/planLayout'
import { canvasPxToPlanInches } from './planCoordinates'

export interface GridCounts {
  /** Last node index along X (nodes 0..nx inclusive) */
  nx: number
  /** Last node index along Y */
  ny: number
}

/** Node indices 0..nx and 0..ny; last node at (nx*Δ, ny*Δ) ≤ footprint. */
export function gridCounts(footprintWIn: number, footprintDIn: number, deltaIn: number): GridCounts {
  const d = Math.max(1e-6, deltaIn)
  const nx = Math.max(0, Math.floor(footprintWIn / d))
  const ny = Math.max(0, Math.floor(footprintDIn / d))
  return { nx, ny }
}

/** Snap plan inches to the nearest grid node (intersection); clamp to nodes 0..nx and 0..ny inclusive. */
export function snapPlanInchesToGridNode(
  xIn: number,
  yIn: number,
  deltaIn: number,
  nx: number,
  ny: number,
): { cxIn: number; cyIn: number; i: number; j: number } {
  const d = Math.max(1e-6, deltaIn)
  let i = Math.round(xIn / d)
  let j = Math.round(yIn / d)
  i = Math.max(0, Math.min(nx, i))
  j = Math.max(0, Math.min(ny, j))
  return { cxIn: i * d, cyIn: j * d, i, j }
}

/** Cell (i,j) is the square between nodes (i,j) and (i+1,j+1). Valid when nx, ny are node max indices from gridCounts. */
export function planInchesToCell(
  xIn: number,
  yIn: number,
  deltaIn: number,
  nx: number,
  ny: number,
): { i: number; j: number } | null {
  const d = Math.max(1e-6, deltaIn)
  const i = Math.floor(xIn / d)
  const j = Math.floor(yIn / d)
  const maxI = nx - 1
  const maxJ = ny - 1
  if (maxI < 0 || maxJ < 0) return null
  if (i < 0 || j < 0 || i > maxI || j > maxJ) return null
  return { i, j }
}

export function cellsInAxisRectangle(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  nx: number,
  ny: number,
): { i: number; j: number }[] {
  const maxI = nx - 1
  const maxJ = ny - 1
  if (maxI < 0 || maxJ < 0) return []
  const iLo = Math.min(i0, i1)
  const iHi = Math.max(i0, i1)
  const jLo = Math.min(j0, j1)
  const jHi = Math.max(j0, j1)
  const ia = Math.max(0, iLo)
  const ib = Math.min(maxI, iHi)
  const ja = Math.max(0, jLo)
  const jb = Math.min(maxJ, jHi)
  if (ia > ib || ja > jb) return []
  const out: { i: number; j: number }[] = []
  for (let j = ja; j <= jb; j++) {
    for (let i = ia; i <= ib; i++) {
      out.push({ i, j })
    }
  }
  return out
}

function distPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = x1 + t * dx
  const qy = y1 + t * dy
  return Math.hypot(px - qx, py - qy)
}

export interface NearestEdgeHit extends GridEdgeKey {
  distIn: number
}

/**
 * Find nearest grid edge to point in plan inches within footprint.
 * maxDistIn: ignore edges farther than this (e.g. 6" tolerance in inch space scaled by zoom via caller).
 *
 * Only edges within `maxDistIn` can beat the current best; they lie in an O((maxDist/Δ)²) window
 * around the pointer — not O(nx·ny) over the whole lot (critical for pointer-move hover).
 */
export function nearestGridEdge(
  xIn: number,
  yIn: number,
  footprintWIn: number,
  footprintDIn: number,
  deltaIn: number,
  maxDistIn: number,
): NearestEdgeHit | null {
  const { nx, ny } = gridCounts(footprintWIn, footprintDIn, deltaIn)
  const d = Math.max(1e-6, deltaIn)
  const md = Math.max(0, maxDistIn)
  if (nx < 1 || ny < 1) return null

  let best: NearestEdgeHit | null = null

  const pad = 1
  const jLoH = Math.max(0, Math.floor((yIn - md) / d) - pad)
  const jHiH = Math.min(ny, Math.ceil((yIn + md) / d) + pad)
  const iLoH = Math.max(0, Math.floor((xIn - md) / d) - pad)
  const iHiH = Math.min(nx - 1, Math.ceil((xIn + md) / d) + pad)

  for (let j = jLoH; j <= jHiH; j++) {
    const y = j * d
    for (let i = iLoH; i <= iHiH; i++) {
      const x0 = i * d
      const x1 = (i + 1) * d
      const dist = distPointToSegment(xIn, yIn, x0, y, x1, y)
      if (dist <= md && (!best || dist < best.distIn)) {
        best = { axis: 'h', i, j, distIn: dist }
      }
    }
  }

  const iLoV = Math.max(0, Math.floor((xIn - md) / d) - pad)
  const iHiV = Math.min(nx, Math.ceil((xIn + md) / d) + pad)
  const jLoV = Math.max(0, Math.floor((yIn - md) / d) - pad)
  const jHiV = Math.min(ny - 1, Math.ceil((yIn + md) / d) + pad)

  for (let i = iLoV; i <= iHiV; i++) {
    const x = i * d
    for (let j = jLoV; j <= jHiV; j++) {
      const y0 = j * d
      const y1 = (j + 1) * d
      const dist = distPointToSegment(xIn, yIn, x, y0, x, y1)
      if (dist <= md && (!best || dist < best.distIn)) {
        best = { axis: 'v', i, j, distIn: dist }
      }
    }
  }

  return best
}

/** All unit edges along axis-aligned segment between two nodes (inclusive endpoints), same row or column. */
/**
 * Perimeter edges of the axis-aligned rectangle between grid nodes (i0,j0) and (i1,j1).
 * Nodes use the same indexing as `nodeUnderCursor` / wall chains (0..nx, 0..ny).
 */
export function rectangularFrameEdges(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
): GridEdgeKey[] {
  const ia = Math.min(i0, i1)
  const ib = Math.max(i0, i1)
  const ja = Math.min(j0, j1)
  const jb = Math.max(j0, j1)
  const out: GridEdgeKey[] = []
  if (ia < ib) {
    for (let i = ia; i < ib; i++) {
      out.push({ axis: 'h', i, j: ja })
      if (ja < jb) out.push({ axis: 'h', i, j: jb })
    }
  }
  if (ja < jb) {
    for (let j = ja; j < jb; j++) {
      out.push({ axis: 'v', i: ia, j })
      if (ia < ib) out.push({ axis: 'v', i: ib, j })
    }
  }
  return out
}

export function edgesInNodeSpan(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
): GridEdgeKey[] {
  if (i0 === i1) {
    const jMin = Math.min(j0, j1)
    const jMax = Math.max(j0, j1)
    const out: GridEdgeKey[] = []
    for (let j = jMin; j < jMax; j++) {
      out.push({ axis: 'v', i: i0, j })
    }
    return out
  }
  if (j0 === j1) {
    const iMin = Math.min(i0, i1)
    const iMax = Math.max(i0, i1)
    const out: GridEdgeKey[] = []
    for (let i = iMin; i < iMax; i++) {
      out.push({ axis: 'h', i, j: j0 })
    }
    return out
  }
  return []
}

/**
 * Wall stroke along grid from node (i0,j0) toward (i1,j1).
 * - Default: L-shape (horizontal to column i1, then vertical to row j1).
 * - shiftStraight: single axis — horizontal to (i1,j0) or vertical to (i0,j1), whichever target is closer to the cursor.
 */
export function manhattanWallPathEdges(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  shiftStraight: boolean,
  xIn: number,
  yIn: number,
  deltaIn: number,
): GridEdgeKey[] {
  const d = Math.max(1e-6, deltaIn)
  if (shiftStraight) {
    const dh = Math.hypot(xIn - (i1 + 0.5) * d, yIn - (j0 + 0.5) * d)
    const dv = Math.hypot(xIn - (i0 + 0.5) * d, yIn - (j1 + 0.5) * d)
    if (dh <= dv) {
      return edgesInNodeSpan(i0, j0, i1, j0)
    }
    return edgesInNodeSpan(i0, j0, i0, j1)
  }
  return [...edgesInNodeSpan(i0, j0, i1, j0), ...edgesInNodeSpan(i1, j0, i1, j1)]
}

export function nodeUnderCursor(
  xIn: number,
  yIn: number,
  deltaIn: number,
  nx: number,
  ny: number,
  maxDistIn: number,
): { i: number; j: number } | null {
  const d = deltaIn
  const i = Math.round(xIn / d)
  const j = Math.round(yIn / d)
  if (i < 0 || i > nx || j < 0 || j > ny) return null
  const cx = i * d
  const cy = j * d
  if (Math.hypot(xIn - cx, yIn - cy) > maxDistIn) return null
  return { i, j }
}

/**
 * Line-drag end snap: screen pick tolerance (plan inches) can shrink below half a cell when zoomed in,
 * which makes `nodeUnderCursor` return null in the middle of cells and the preview feel like it lags.
 * This floor keeps the nearest grid node resolvable everywhere inside the site grid.
 */
export function wallLineDragEndSnapDistIn(maxDistPickIn: number, gridDeltaIn: number): number {
  const minHalfCell = gridDeltaIn * (Math.SQRT2 / 2 + 0.04)
  return Math.max(maxDistPickIn * 1.2, minHalfCell)
}

/** Convert SVG px to plan inches using building dimensions. */
export function svgPxToPlanInches(d: BuildingDimensions, xPx: number, yPx: number) {
  return canvasPxToPlanInches(d, xPx, yPx)
}

/** Edge segment endpoints in plan inches. */
export function edgeEndpointsInches(key: GridEdgeKey, deltaIn: number): { x1: number; y1: number; x2: number; y2: number } {
  if (key.axis === 'h') {
    const y = key.j * deltaIn
    const x0 = key.i * deltaIn
    const x1 = (key.i + 1) * deltaIn
    return { x1: x0, y1: y, x2: x1, y2: y }
  }
  const x = key.i * deltaIn
  const y0 = key.j * deltaIn
  const y1 = (key.j + 1) * deltaIn
  return { x1: x, y1: y0, x2: x, y2: y1 }
}

/** Grid node (corner) on the given unit edge that is closer to (xIn, yIn) in plan inches. */
export function closerNodeOnEdge(
  key: GridEdgeKey,
  xIn: number,
  yIn: number,
  deltaIn: number,
): { i: number; j: number } {
  const ep = edgeEndpointsInches(key, deltaIn)
  const d1 = Math.hypot(xIn - ep.x1, yIn - ep.y1)
  const d2 = Math.hypot(xIn - ep.x2, yIn - ep.y2)
  if (key.axis === 'h') {
    const j = key.j
    return d1 <= d2 ? { i: key.i, j } : { i: key.i + 1, j }
  }
  const i = key.i
  return d1 <= d2 ? { i, j: key.j } : { i, j: key.j + 1 }
}

export function edgeEndpointsCanvasPx(
  d: BuildingDimensions,
  key: GridEdgeKey,
  deltaIn: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const e = edgeEndpointsInches(key, deltaIn)
  return {
    x1: e.x1 * d.planScale,
    y1: e.y1 * d.planScale,
    x2: e.x2 * d.planScale,
    y2: e.y2 * d.planScale,
  }
}

/** Horizontal or vertical segment vs closed plan-inch rectangle (inclusive). */
export function axisSegmentIntersectsPlanRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): boolean {
  const minX = Math.min(rx0, rx1)
  const maxX = Math.max(rx0, rx1)
  const minY = Math.min(ry0, ry1)
  const maxY = Math.max(ry0, ry1)
  if (Math.abs(ay - by) < 1e-9) {
    const y = ay
    if (y < minY || y > maxY) return false
    const xa = Math.min(ax, bx)
    const xb = Math.max(ax, bx)
    return xa <= maxX && xb >= minX
  }
  if (Math.abs(ax - bx) < 1e-9) {
    const x = ax
    if (x < minX || x > maxX) return false
    const ya = Math.min(ay, by)
    const yb = Math.max(ay, by)
    return ya <= maxY && yb >= minY
  }
  return false
}

export function gridEdgeIntersectsPlanRect(
  key: GridEdgeKey,
  deltaIn: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): boolean {
  const ep = edgeEndpointsInches(key, deltaIn)
  return axisSegmentIntersectsPlanRect(ep.x1, ep.y1, ep.x2, ep.y2, rx0, ry0, rx1, ry1)
}

/**
 * Floor cells whose unit squares intersect the closed plan-inch rectangle.
 * nx, ny from gridCounts — valid cell indices i ∈ [0, nx−1], j ∈ [0, ny−1].
 */
export function cellsIntersectingPlanRect(
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  deltaIn: number,
  nx: number,
  ny: number,
): { i: number; j: number }[] {
  const d = Math.max(1e-6, deltaIn)
  const minX = Math.min(rx0, rx1)
  const maxX = Math.max(rx0, rx1)
  const minY = Math.min(ry0, ry1)
  const maxY = Math.max(ry0, ry1)
  const maxI = nx - 1
  const maxJ = ny - 1
  if (maxI < 0 || maxJ < 0) return []
  const iLo = Math.max(0, Math.floor(minX / d))
  const iHi = Math.min(maxI, Math.ceil(maxX / d) - 1)
  const jLo = Math.max(0, Math.floor(minY / d))
  const jHi = Math.min(maxJ, Math.ceil(maxY / d) - 1)
  if (iLo > iHi || jLo > jHi) return []
  const out: { i: number; j: number }[] = []
  for (let j = jLo; j <= jHi; j++) {
    for (let i = iLo; i <= iHi; i++) {
      out.push({ i, j })
    }
  }
  return out
}
