import type { BuildingDimensions } from '../types/system'
import { edgeKeyString, type GridEdgeKey, type PlacedGridEdge } from '../types/planLayout'
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

function clamp01Seg(t: number): number {
  return Math.max(0, Math.min(1, t))
}

function segmentParamHittingHorizontal(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  yLine: number,
  xSegLo: number,
  xSegHi: number,
): number | null {
  const xLo = Math.min(xSegLo, xSegHi)
  const xHi = Math.max(xSegLo, xSegHi)
  const dy = y1 - y0
  const eps = 1e-9
  if (Math.abs(dy) < eps) {
    if (Math.abs(y0 - yLine) > 1e-6) return null
    const xs0 = Math.min(x0, x1)
    const xs1 = Math.max(x0, x1)
    const ix0 = Math.max(xs0, xLo)
    const ix1 = Math.min(xs1, xHi)
    if (ix1 < ix0 - eps) return null
    const dx = x1 - x0
    if (Math.abs(dx) < eps) return null
    const t = (ix0 - x0) / dx
    if (t < -eps || t > 1 + eps) return null
    return clamp01Seg(t)
  }
  const t = (yLine - y0) / dy
  if (t < -eps || t > 1 + eps) return null
  const x = x0 + t * (x1 - x0)
  if (x < xLo - eps || x > xHi + eps) return null
  return clamp01Seg(t)
}

function segmentParamHittingVertical(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  xLine: number,
  ySegLo: number,
  ySegHi: number,
): number | null {
  const yLo = Math.min(ySegLo, ySegHi)
  const yHi = Math.max(ySegLo, ySegHi)
  const dx = x1 - x0
  const eps = 1e-9
  if (Math.abs(dx) < eps) {
    if (Math.abs(x0 - xLine) > 1e-6) return null
    const ys0 = Math.min(y0, y1)
    const ys1 = Math.max(y0, y1)
    const iy0 = Math.max(ys0, yLo)
    const iy1 = Math.min(ys1, yHi)
    if (iy1 < iy0 - eps) return null
    const dy = y1 - y0
    if (Math.abs(dy) < eps) return null
    const t = (iy0 - y0) / dy
    if (t < -eps || t > 1 + eps) return null
    return clamp01Seg(t)
  }
  const t = (xLine - x0) / dx
  if (t < -eps || t > 1 + eps) return null
  const y = y0 + t * (y1 - y0)
  if (y < yLo - eps || y > yHi + eps) return null
  return clamp01Seg(t)
}

/**
 * Ordered h/v unit edges the straight segment between two grid nodes crosses (plan inches).
 * Used for connection-detail erase one segment at a time (diagonals included).
 */
export function gridUnitEdgesCrossedByStraightNodeSegment(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  deltaIn: number,
  nx: number,
  ny: number,
): GridEdgeKey[] {
  const d = Math.max(1e-6, deltaIn)
  if (i0 === i1 && j0 === j1) return []
  const x0 = i0 * d
  const y0 = j0 * d
  const x1 = i1 * d
  const y1 = j1 * d

  const bi0 = Math.max(0, Math.min(i0, i1) - 2)
  const bi1 = Math.min(nx, Math.max(i0, i1) + 2)
  const bj0 = Math.max(0, Math.min(j0, j1) - 2)
  const bj1 = Math.min(ny, Math.max(j0, j1) + 2)

  const hits: { t: number; key: GridEdgeKey }[] = []

  for (let j = bj0; j <= bj1; j++) {
    if (j < 0 || j > ny) continue
    const yLine = j * d
    for (let i = bi0; i <= bi1 - 1; i++) {
      if (i < 0 || i >= nx) continue
      const xa = i * d
      const xb = (i + 1) * d
      const t = segmentParamHittingHorizontal(x0, y0, x1, y1, yLine, xa, xb)
      if (t != null) hits.push({ t, key: { axis: 'h', i, j } })
    }
  }

  for (let i = bi0; i <= bi1; i++) {
    if (i < 0 || i > nx) continue
    const xLine = i * d
    for (let j = bj0; j <= bj1 - 1; j++) {
      if (j < 0 || j >= ny) continue
      const ya = j * d
      const yb = (j + 1) * d
      const t = segmentParamHittingVertical(x0, y0, x1, y1, xLine, ya, yb)
      if (t != null) hits.push({ t, key: { axis: 'v', i, j } })
    }
  }

  hits.sort(
    (a, b) =>
      a.t - b.t ||
      a.key.axis.localeCompare(b.key.axis) ||
      a.key.i - b.key.i ||
      a.key.j - b.key.j,
  )
  const out: GridEdgeKey[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    const k = edgeKeyString(h.key)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h.key)
  }
  return out
}

/** Same as {@link gridUnitEdgesCrossedByStraightNodeSegment} for connection-detail irregular axes (`xsIn` / `ysIn` node lines). */
export function gridUnitEdgesCrossedByConnectionDetailSegment(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): GridEdgeKey[] {
  if (xsIn.length < 2 || ysIn.length < 2) return []
  if (i0 === i1 && j0 === j1) return []
  const x0 = xsIn[i0]
  const y0 = ysIn[j0]
  const x1 = xsIn[i1]
  const y1 = ysIn[j1]
  if (x0 == null || y0 == null || x1 == null || y1 == null) return []

  const bi0 = Math.max(0, Math.min(i0, i1) - 2)
  const bi1 = Math.min(xsIn.length - 1, Math.max(i0, i1) + 2)
  const bj0 = Math.max(0, Math.min(j0, j1) - 2)
  const bj1 = Math.min(ysIn.length - 1, Math.max(j0, j1) + 2)

  const hits: { t: number; key: GridEdgeKey }[] = []

  for (let j = bj0; j <= bj1; j++) {
    const yLine = ysIn[j]
    if (yLine == null) continue
    for (let i = bi0; i <= bi1 - 1; i++) {
      const xa = xsIn[i]
      const xb = xsIn[i + 1]
      if (xa == null || xb == null) continue
      const t = segmentParamHittingHorizontal(x0, y0, x1, y1, yLine, xa, xb)
      if (t != null) hits.push({ t, key: { axis: 'h', i, j } })
    }
  }

  for (let i = bi0; i <= bi1; i++) {
    const xLine = xsIn[i]
    if (xLine == null) continue
    for (let j = bj0; j <= bj1 - 1; j++) {
      const ya = ysIn[j]
      const yb = ysIn[j + 1]
      if (ya == null || yb == null) continue
      const t = segmentParamHittingVertical(x0, y0, x1, y1, xLine, ya, yb)
      if (t != null) hits.push({ t, key: { axis: 'v', i, j } })
    }
  }

  hits.sort(
    (a, b) =>
      a.t - b.t ||
      a.key.axis.localeCompare(b.key.axis) ||
      a.key.i - b.key.i ||
      a.key.j - b.key.j,
  )
  const out: GridEdgeKey[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    const k = edgeKeyString(h.key)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h.key)
  }
  return out
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

function cellMidIrregular(
  xsIn: readonly number[],
  ysIn: readonly number[],
  cellI: number,
  cellJ: number,
): { x: number; y: number } {
  const xi0 = Math.max(0, Math.min(cellI, xsIn.length - 2))
  const yj0 = Math.max(0, Math.min(cellJ, ysIn.length - 2))
  return {
    x: (xsIn[xi0]! + xsIn[xi0 + 1]!) / 2,
    y: (ysIn[yj0]! + ysIn[yj0 + 1]!) / 2,
  }
}

/** Same as {@link manhattanWallPathEdges} using irregular node lines from connection-detail assembly axes. */
export function manhattanWallPathEdgesConnectionDetail(
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  shiftStraight: boolean,
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): GridEdgeKey[] {
  if (!shiftStraight) {
    return [...edgesInNodeSpan(i0, j0, i1, j0), ...edgesInNodeSpan(i1, j0, i1, j1)]
  }
  if (xsIn.length < 2 || ysIn.length < 2) {
    return manhattanWallPathEdges(i0, j0, i1, j1, true, xIn, yIn, 1)
  }
  const ci1 = Math.max(0, Math.min(i1, xsIn.length - 2))
  const cj0 = Math.max(0, Math.min(j0, ysIn.length - 2))
  const ci0 = Math.max(0, Math.min(i0, xsIn.length - 2))
  const cj1 = Math.max(0, Math.min(j1, ysIn.length - 2))
  const mH = cellMidIrregular(xsIn, ysIn, ci1, cj0)
  const mV = cellMidIrregular(xsIn, ysIn, ci0, cj1)
  const dh = Math.hypot(xIn - mH.x, yIn - mH.y)
  const dv = Math.hypot(xIn - mV.x, yIn - mV.y)
  if (dh <= dv) return edgesInNodeSpan(i0, j0, i1, j0)
  return edgesInNodeSpan(i0, j0, i0, j1)
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

/** Canvas pixel shift for arch `perpOffsetPlanIn` (MEP edges → zero). */
export function archEdgePerpOffsetCanvasPx(
  e: Pick<PlacedGridEdge, 'axis' | 'perpOffsetPlanIn' | 'source'>,
  d: BuildingDimensions,
): { dx: number; dy: number } {
  if ((e.source ?? 'arch') !== 'arch') return { dx: 0, dy: 0 }
  const o = Number(e.perpOffsetPlanIn)
  if (!Number.isFinite(o) || Math.abs(o) < 1e-12) return { dx: 0, dy: 0 }
  const s = d.planScale
  if (e.axis === 'h') return { dx: 0, dy: o * s }
  return { dx: o * s, dy: 0 }
}

/**
 * Wall mass for one grid segment as a filled band **centered on the grid line** (same as stroke geometry),
 * so it lines up with the wall line rather than sitting on one side of it.
 */
export function archWallBandRectCanvasPx(
  d: BuildingDimensions,
  key: GridEdgeKey,
  deltaIn: number,
  systemId: string,
): { x: number; y: number; width: number; height: number } {
  const dIn = Math.max(1e-6, deltaIn)
  const thIn = Math.max(1e-6, d.thicknessBySystem[systemId] ?? 6)
  const bandIn = Math.min(thIn, dIn)
  const s = d.planScale
  const bw = bandIn * s
  if (key.axis === 'h') {
    const x = key.i * dIn * s
    const yC = key.j * dIn * s
    return { x, y: yC - bw / 2, width: dIn * s, height: bw }
  }
  const xC = key.i * dIn * s
  const y = key.j * dIn * s
  return { x: xC - bw / 2, y, width: bw, height: dIn * s }
}

/** `archWallBandRectCanvasPx` shifted by arch perpendicular offset (opening / wall bands). */
export function archWallBandRectCanvasPxForPlacedEdge(
  bd: BuildingDimensions,
  e: PlacedGridEdge,
  deltaIn: number,
): { x: number; y: number; width: number; height: number } {
  const r = archWallBandRectCanvasPx(bd, e, deltaIn, e.systemId)
  const off = archEdgePerpOffsetCanvasPx(e, bd)
  return { x: r.x + off.dx, y: r.y + off.dy, width: r.width, height: r.height }
}

/** Endpoints in canvas px including arch perpendicular offset (for lines / thin bands). */
export function placedArchEdgeEndpointsCanvasPx(
  bd: BuildingDimensions,
  e: PlacedGridEdge,
  deltaIn: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const base = edgeEndpointsCanvasPx(bd, e, deltaIn)
  const off = archEdgePerpOffsetCanvasPx(e, bd)
  return {
    x1: base.x1 + off.dx,
    y1: base.y1 + off.dy,
    x2: base.x2 + off.dx,
    y2: base.y2 + off.dy,
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

// ─── Connection-detail irregular grid (axes from assembly layer edges, plan inches) ─────────

export function edgeEndpointsConnectionDetailInches(
  key: GridEdgeKey,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { x1: number; y1: number; x2: number; y2: number } {
  if (xsIn.length < 2 || ysIn.length < 2) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 }
  }
  if (key.axis === 'h') {
    const y = ysIn[key.j]
    const x0 = xsIn[key.i]
    const x1 = xsIn[key.i + 1]
    if (y == null || x0 == null || x1 == null) return { x1: 0, y1: 0, x2: 0, y2: 0 }
    return { x1: x0, y1: y, x2: x1, y2: y }
  }
  const x = xsIn[key.i]
  const y0 = ysIn[key.j]
  const y1 = ysIn[key.j + 1]
  if (x == null || y0 == null || y1 == null) return { x1: 0, y1: 0, x2: 0, y2: 0 }
  return { x1: x, y1: y0, x2: x, y2: y1 }
}

export function edgeEndpointsConnectionDetailCanvasPx(
  d: BuildingDimensions,
  key: GridEdgeKey,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { x1: number; y1: number; x2: number; y2: number } {
  const e = edgeEndpointsConnectionDetailInches(key, xsIn, ysIn)
  const s = d.planScale
  return { x1: e.x1 * s, y1: e.y1 * s, x2: e.x2 * s, y2: e.y2 * s }
}

export function snapPlanInchesToConnectionDetailNodes(
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { cxIn: number; cyIn: number; i: number; j: number } {
  if (xsIn.length === 0 || ysIn.length === 0) {
    return { cxIn: xIn, cyIn: yIn, i: 0, j: 0 }
  }
  let bi = 0
  let bj = 0
  let best = Infinity
  for (let i = 0; i < xsIn.length; i++) {
    for (let j = 0; j < ysIn.length; j++) {
      const d = Math.hypot(xIn - xsIn[i]!, yIn - ysIn[j]!)
      if (d < best) {
        best = d
        bi = i
        bj = j
      }
    }
  }
  return { cxIn: xsIn[bi]!, cyIn: ysIn[bj]!, i: bi, j: bj }
}

export function nearestConnectionDetailGridEdge(
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
  maxDistIn: number,
): NearestEdgeHit | null {
  const md = Math.max(0, maxDistIn)
  if (xsIn.length < 2 || ysIn.length < 2) return null
  let best: NearestEdgeHit | null = null
  for (let j = 0; j < ysIn.length; j++) {
    const y = ysIn[j]!
    for (let i = 0; i < xsIn.length - 1; i++) {
      const x0 = xsIn[i]!
      const x1 = xsIn[i + 1]!
      const dist = distPointToSegment(xIn, yIn, x0, y, x1, y)
      if (dist <= md && (!best || dist < best.distIn)) {
        best = { axis: 'h', i, j, distIn: dist }
      }
    }
  }
  for (let i = 0; i < xsIn.length; i++) {
    const x = xsIn[i]!
    for (let j = 0; j < ysIn.length - 1; j++) {
      const y0 = ysIn[j]!
      const y1 = ysIn[j + 1]!
      const dist = distPointToSegment(xIn, yIn, x, y0, x, y1)
      if (dist <= md && (!best || dist < best.distIn)) {
        best = { axis: 'v', i, j, distIn: dist }
      }
    }
  }
  return best
}

export function nodeUnderCursorConnectionDetail(
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
  maxDistIn: number,
): { i: number; j: number } | null {
  const sn = snapPlanInchesToConnectionDetailNodes(xIn, yIn, xsIn, ysIn)
  if (Math.hypot(xIn - sn.cxIn, yIn - sn.cyIn) > maxDistIn) return null
  return { i: sn.i, j: sn.j }
}

export function closerNodeOnEdgeConnectionDetail(
  key: GridEdgeKey,
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { i: number; j: number } {
  const ep = edgeEndpointsConnectionDetailInches(key, xsIn, ysIn)
  const d1 = Math.hypot(xIn - ep.x1, yIn - ep.y1)
  const d2 = Math.hypot(xIn - ep.x2, yIn - ep.y2)
  if (key.axis === 'h') {
    const j = key.j
    return d1 <= d2 ? { i: key.i, j } : { i: key.i + 1, j }
  }
  const i = key.i
  return d1 <= d2 ? { i, j: key.j } : { i, j: key.j + 1 }
}

function cellIndexAlongIrregularAxis(v: number, axis: readonly number[]): number {
  const n = axis.length
  if (n < 2) return -1
  const loB = axis[0]!
  const hiB = axis[n - 1]!
  if (v < loB - 1e-6 || v > hiB + 1e-6) return -1
  for (let i = 0; i < n - 1; i++) {
    const a = axis[i]!
    const b = axis[i + 1]!
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const last = i === n - 2
    if (v >= lo - 1e-6 && (last ? v <= hi + 1e-6 : v < hi - 1e-6)) return i
  }
  return -1
}

export function planInchesToCellConnectionDetail(
  xIn: number,
  yIn: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { i: number; j: number } | null {
  const i = cellIndexAlongIrregularAxis(xIn, xsIn)
  const j = cellIndexAlongIrregularAxis(yIn, ysIn)
  if (i < 0 || j < 0) return null
  return { i, j }
}

export function cellsIntersectingConnectionDetailPlanRect(
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  xsIn: readonly number[],
  ysIn: readonly number[],
): { i: number; j: number }[] {
  if (xsIn.length < 2 || ysIn.length < 2) return []
  const minX = Math.min(rx0, rx1)
  const maxX = Math.max(rx0, rx1)
  const minY = Math.min(ry0, ry1)
  const maxY = Math.max(ry0, ry1)
  const out: { i: number; j: number }[] = []
  for (let i = 0; i < xsIn.length - 1; i++) {
    const x0 = xsIn[i]!
    const x1 = xsIn[i + 1]!
    const cx0 = Math.min(x0, x1)
    const cx1 = Math.max(x0, x1)
    for (let j = 0; j < ysIn.length - 1; j++) {
      const y0 = ysIn[j]!
      const y1 = ysIn[j + 1]!
      const cy0 = Math.min(y0, y1)
      const cy1 = Math.max(y0, y1)
      if (cx0 <= maxX && cx1 >= minX && cy0 <= maxY && cy1 >= minY) {
        out.push({ i, j })
      }
    }
  }
  return out
}

export function gridEdgeIntersectsPlanRectConnectionDetail(
  key: GridEdgeKey,
  xsIn: readonly number[],
  ysIn: readonly number[],
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): boolean {
  const ep = edgeEndpointsConnectionDetailInches(key, xsIn, ysIn)
  return axisSegmentIntersectsPlanRect(ep.x1, ep.y1, ep.x2, ep.y2, rx0, ry0, rx1, ry1)
}

/** Total span along a chain of unit grid edges (uniform Δ, or irregular connection-detail axes). */
export function gridEdgeLengthsPlanInchesSum(
  keys: readonly GridEdgeKey[],
  deltaIn: number,
  irregular?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): number {
  if (!irregular || irregular.xsIn.length < 2 || irregular.ysIn.length < 2) {
    return keys.length * Math.max(1e-6, deltaIn)
  }
  const { xsIn, ysIn } = irregular
  let s = 0
  for (const k of keys) {
    if (k.axis === 'h') {
      const a = xsIn[k.i + 1]! - xsIn[k.i]!
      s += Math.abs(a)
    } else {
      const a = ysIn[k.j + 1]! - ysIn[k.j]!
      s += Math.abs(a)
    }
  }
  return s
}
