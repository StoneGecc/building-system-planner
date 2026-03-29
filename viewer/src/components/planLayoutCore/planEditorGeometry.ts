import type { BuildingDimensions } from '../../types/system'
import type { MepItem } from '../../types/mep'
import type {
  EdgeStrokeKind,
  GridEdgeKey,
  PlacedFloorCell,
  PlacedGridEdge,
  PlanAnnotationGridRun,
  PlanAnnotationSectionCut,
  PlanMeasureGridRun,
  PlanLayoutSketch,
} from '../../types/planLayout'
import {
  cellKeyString,
  cellPaintKind,
  edgeKeyString,
  layerIdentityFromEdge,
  isExclusiveArchFloorPaintCell,
  layerIdentityFromCell,
  normalizeExclusiveArchFloorPaintCells,
  placedEdgeKey,
  parsePlacedCellKey,
  parseEdgeKeyString,
} from '../../types/planLayout'
import { formatSiteMeasure, PLAN_SITE_UNIT_SHORT, type PlanSiteDisplayUnit } from '../../lib/planDisplayUnits'
import {
  edgeEndpointsCanvasPx,
  edgeEndpointsConnectionDetailCanvasPx,
  edgeEndpointsConnectionDetailInches,
  edgeEndpointsInches,
  edgesInNodeSpan,
  gridCounts,
  gridEdgeIntersectsPlanRect,
  gridEdgeIntersectsPlanRectConnectionDetail,
  gridUnitEdgesCrossedByConnectionDetailSegment,
  gridUnitEdgesCrossedByStraightNodeSegment,
  nearestGridEdge,
} from '../../lib/gridEdges'
import type { PlanPlaceMode } from '../../lib/planLayerColors'
import { isMepRunMode } from '../../types/planPlaceMode'
import { ZOOM_MAX, ZOOM_MIN } from './constants'
import type { ActiveCatalog } from './types'

export function clampZoom(z: number, max: number = ZOOM_MAX): number {
  return Math.min(max, Math.max(ZOOM_MIN, z))
}

/** Plan inches — below this drag distance, edge/cell move counts as a click (toggle / deselect). */
export function moveClickMaxPlanIn(deltaIn: number): number {
  return Math.max(deltaIn * 0.12, 0.25)
}

/** Stroke kind for the current toolbar category (Walls vs Windows vs …); not a single layer row. */
export function planToolbarEdgeKind(placeMode: PlanPlaceMode, activeCatalog: ActiveCatalog): EdgeStrokeKind {
  if (placeMode === 'window') return 'window'
  if (placeMode === 'door') return 'door'
  if (placeMode === 'roof') return 'roof'
  if (isMepRunMode(placeMode)) return 'run'
  return activeCatalog === 'mep' ? 'run' : 'wall'
}

/**
 * Whether this edge is removed when the user erases on its grid segment, for the active
 * toolbar (walls vs windows vs MEP runs, etc.). Matches `planToolbarEdgeKind`.
 */
export function edgeMatchesToolbarEraseKind(
  e: PlacedGridEdge,
  placeMode: PlanPlaceMode,
  activeCatalog: ActiveCatalog,
): boolean {
  const target = planToolbarEdgeKind(placeMode, activeCatalog)
  const k = e.kind ?? 'wall'
  if (target === 'door') return k === 'door' || k === 'doorSwing'
  if (target === 'run') return k === 'run' && (e.source ?? 'arch') === 'mep'
  return k === target
}

/** Assembly flip targets only the active toolbar stroke family (walls vs windows vs doors vs roof). */
export function edgeMatchesToolbarAssemblyFlipKind(
  e: PlacedGridEdge,
  placeMode: PlanPlaceMode,
  activeCatalog: ActiveCatalog,
): boolean {
  if (edgeMatchesToolbarEraseKind(e, placeMode, activeCatalog)) return true
  const target = planToolbarEdgeKind(placeMode, activeCatalog)
  const k = e.kind ?? 'wall'
  if (target === 'wall' && (e.source ?? 'arch') === 'arch' && k === 'stairs') return true
  return false
}

export function clampEdgeMoveDelta(
  edges: PlacedGridEdge[],
  di: number,
  dj: number,
  nx: number,
  ny: number,
): { di: number; dj: number } {
  if (edges.length === 0) return { di: 0, dj: 0 }
  let loDi = -Infinity
  let hiDi = Infinity
  let loDj = -Infinity
  let hiDj = Infinity
  for (const e of edges) {
    if (e.axis === 'h') {
      loDi = Math.max(loDi, -e.i)
      hiDi = Math.min(hiDi, nx - 1 - e.i)
      loDj = Math.max(loDj, -e.j)
      hiDj = Math.min(hiDj, ny - e.j)
    } else {
      loDi = Math.max(loDi, -e.i)
      hiDi = Math.min(hiDi, nx - e.i)
      loDj = Math.max(loDj, -e.j)
      hiDj = Math.min(hiDj, ny - 1 - e.j)
    }
  }
  if (!Number.isFinite(loDi) || !Number.isFinite(hiDi)) return { di: 0, dj: 0 }
  return {
    di: Math.max(loDi, Math.min(hiDi, di)),
    dj: Math.max(loDj, Math.min(hiDj, dj)),
  }
}

export function clampRoomBoundaryMoveDelta(
  edges: GridEdgeKey[],
  di: number,
  dj: number,
  nx: number,
  ny: number,
): { di: number; dj: number } {
  return clampEdgeMoveDelta(edges as PlacedGridEdge[], di, dj, nx, ny)
}

export function clampCellMoveDelta(
  cells: PlacedFloorCell[],
  di: number,
  dj: number,
  nx: number,
  ny: number,
): { di: number; dj: number } {
  if (cells.length === 0) return { di: 0, dj: 0 }
  const maxI = nx - 1
  const maxJ = ny - 1
  if (maxI < 0 || maxJ < 0) return { di: 0, dj: 0 }
  let loDi = -Infinity
  let hiDi = Infinity
  let loDj = -Infinity
  let hiDj = Infinity
  for (const c of cells) {
    loDi = Math.max(loDi, -c.i)
    hiDi = Math.min(hiDi, maxI - c.i)
    loDj = Math.max(loDj, -c.j)
    hiDj = Math.min(hiDj, maxJ - c.j)
  }
  return {
    di: Math.max(loDi, Math.min(hiDi, di)),
    dj: Math.max(loDj, Math.min(hiDj, dj)),
  }
}

/** True if plan point lies inside the axis-aligned bbox of all selected floor cells (handles gaps inside L-shaped selections). */
export function pointInSelectedFloorBBox(
  xIn: number,
  yIn: number,
  selectedPlacedKeys: Set<string>,
  deltaIn: number,
): boolean {
  const d = Math.max(1e-6, deltaIn)
  let minI = Infinity
  let maxI = -Infinity
  let minJ = Infinity
  let maxJ = -Infinity
  for (const pk of selectedPlacedKeys) {
    const p = parsePlacedCellKey(pk)
    if (!p) continue
    minI = Math.min(minI, p.i)
    maxI = Math.max(maxI, p.i)
    minJ = Math.min(minJ, p.j)
    maxJ = Math.max(maxJ, p.j)
  }
  if (!Number.isFinite(minI)) return false
  const x0 = minI * d
  const x1 = (maxI + 1) * d
  const y0 = minJ * d
  const y1 = (maxJ + 1) * d
  return xIn >= x0 && xIn <= x1 && yIn >= y0 && yIn <= y1
}

/** Merge floor/roof/stair paint stroke into cell list (arch: see `normalizeExclusiveArchFloorPaintCells`). */
export function mergePaintStrokeIntoCells(
  base: PlacedFloorCell[],
  stroke: readonly PlacedFloorCell[],
): PlacedFloorCell[] {
  let next = [...base]
  for (const placed of stroke) {
    const ck = cellKeyString(placed)
    const lid = layerIdentityFromCell(placed)
    const pk = cellPaintKind(placed)
    if (isExclusiveArchFloorPaintCell(placed)) {
      if (pk === 'stairs') {
        next = next.filter((c) => cellKeyString(c) !== ck || !isExclusiveArchFloorPaintCell(c))
      } else {
        next = next.filter(
          (c) =>
            !(
              cellKeyString(c) === ck &&
              isExclusiveArchFloorPaintCell(c) &&
              cellPaintKind(c) === pk
            ),
        )
      }
    } else {
      next = next.filter(
        (c) => !(cellKeyString(c) === ck && layerIdentityFromCell(c) === lid && cellPaintKind(c) === pk),
      )
    }
    next.push(placed)
  }
  return normalizeExclusiveArchFloorPaintCells(next)
}

export function clampMarqueeSvgRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cw: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  const x1 = Math.max(0, Math.min(cw, Math.min(ax, bx)))
  const x2 = Math.max(0, Math.min(cw, Math.max(ax, bx)))
  const y1 = Math.max(0, Math.min(ch, Math.min(ay, by)))
  const y2 = Math.max(0, Math.min(ch, Math.max(ay, by)))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function floorCellInsetDims(
  cellPx: number,
  idx: number,
  n: number,
  cell?: Pick<PlacedFloorCell, 'cellKind'>,
): { inset: number; w: number } {
  if (cell?.cellKind === 'stairs') return { inset: 0, w: cellPx }
  if (n <= 1) return { inset: 0, w: cellPx }
  const step = Math.min((cellPx * 0.44) / n, cellPx * 0.1)
  const inset = idx * step
  const w = Math.max(cellPx - 2 * inset, cellPx * 0.22)
  return { inset, w }
}

export function strokeWidthForEdge(
  d: BuildingDimensions,
  e: PlacedGridEdge,
  mepById: ReadonlyMap<string, MepItem>,
): number {
  const source = e.source ?? 'arch'
  const kind = e.kind ?? 'run'
  if (kind === 'wall' && source === 'arch') {
    const th = d.thicknessBySystem[e.systemId] ?? 6
    return Math.max(1, Math.min(th * d.planScale, 48))
  }
  if (kind === 'window' && source === 'arch') {
    const th = d.thicknessBySystem[e.systemId] ?? 6
    return Math.max(1, Math.min(th * d.planScale * 0.22, 14))
  }
  if (kind === 'door' && source === 'arch') {
    const th = d.thicknessBySystem[e.systemId] ?? 6
    return Math.max(1.5, Math.min(th * d.planScale * 0.28, 18))
  }
  if (kind === 'roof' && source === 'arch') {
    const th = d.thicknessBySystem[e.systemId] ?? 6
    return Math.max(1.5, Math.min(th * d.planScale * 0.85, 40))
  }
  if (kind === 'stairs' && source === 'arch') {
    const th = d.thicknessBySystem[e.systemId] ?? 6
    return Math.max(1.5, Math.min(th * d.planScale * 0.72, 36))
  }
  if (source === 'mep') {
    const m = mepById.get(e.systemId)
    const w = m?.planWidthIn ?? 0
    if (w > 0) return Math.max(1, Math.min(w * d.planScale, 40))
    return kind === 'wall' ? 4 : 2
  }
  return kind === 'wall' ? Math.max(2, 6 * d.planScale * 0.15) : 2
}

/** Room boundary segments (Room mode, in plan stroke order). */
export function strokeWidthForRoomBoundaryLine(d: BuildingDimensions): number {
  return Math.max(1.15, Math.min(3.1, 1.85 * d.planScale * 0.12))
}

/** Room boundaries under floor/grid when not in Room mode — faint reference. */
export function strokeWidthForRoomBoundaryUnderlay(d: BuildingDimensions): number {
  return Math.max(0.55, Math.min(1.35, 0.88 * d.planScale * 0.055))
}

/** Outer perimeter of a cell union in canvas px (for room-zone selection outline). */
export function planRoomZoneOutlineSegments(
  cellKeys: readonly string[],
  cellPx: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const set = new Set(cellKeys)
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const k of cellKeys) {
    const parts = k.split(':')
    const si = Number(parts[0])
    const sj = Number(parts[1])
    if (!Number.isFinite(si) || !Number.isFinite(sj)) continue
    const x0 = si * cellPx
    const y0 = sj * cellPx
    const xr = (si + 1) * cellPx
    const yb = (sj + 1) * cellPx
    if (!set.has(cellKeyString({ i: si, j: sj - 1 }))) {
      segs.push({ x1: x0, y1: y0, x2: xr, y2: y0 })
    }
    if (!set.has(cellKeyString({ i: si, j: sj + 1 }))) {
      segs.push({ x1: x0, y1: yb, x2: xr, y2: yb })
    }
    if (!set.has(cellKeyString({ i: si - 1, j: sj }))) {
      segs.push({ x1: x0, y1: y0, x2: x0, y2: yb })
    }
    if (!set.has(cellKeyString({ i: si + 1, j: sj }))) {
      segs.push({ x1: xr, y1: y0, x2: xr, y2: yb })
    }
  }
  return segs
}

export function gridRunMeasureCaption(
  totalPlanIn: number,
  start: { i: number; j: number },
  end: { i: number; j: number },
  edgeCount: number,
  unit: PlanSiteDisplayUnit,
): { primary: string; sub: string; status: string } {
  const su = PLAN_SITE_UNIT_SHORT[unit]
  const primary = `${formatSiteMeasure(totalPlanIn, unit)} ${su}`
  const di = Math.abs(end.i - start.i)
  const dj = Math.abs(end.j - start.j)
  const sub = `${edgeCount} grid Δ · |Δi|=${di} · |Δj|=${dj} (nodes)`
  return { primary, sub, status: `${primary} — ${sub}` }
}

/**
 * Single polyline through consecutive grid-edge segments (canvas px). Returns null if segments
 * do not chain tip-to-tail — caller should fall back to per-segment lines.
 */
export function wallPreviewPolylinePointsCanvas(
  edgeKeyStrs: string[],
  bd: BuildingDimensions,
  gridDelta: number,
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): string | null {
  if (edgeKeyStrs.length === 0) return null
  const connectTol = 0.75
  const pts: Array<{ x: number; y: number }> = []
  const pushPt = (x: number, y: number) => {
    const last = pts[pts.length - 1]
    if (last && Math.hypot(last.x - x, last.y - y) < 1e-6) return
    pts.push({ x, y })
  }
  for (let idx = 0; idx < edgeKeyStrs.length; idx++) {
    const parsed = parseEdgeKeyString(edgeKeyStrs[idx]!)
    if (!parsed) return null
    const { x1, y1, x2, y2 } =
      nodeAxesIn && nodeAxesIn.xsIn.length >= 2 && nodeAxesIn.ysIn.length >= 2
        ? edgeEndpointsConnectionDetailCanvasPx(bd, parsed, nodeAxesIn.xsIn, nodeAxesIn.ysIn)
        : edgeEndpointsCanvasPx(bd, parsed, gridDelta)
    if (idx === 0) {
      pushPt(x1, y1)
      pushPt(x2, y2)
      continue
    }
    const last = pts[pts.length - 1]!
    const d11 = Math.hypot(last.x - x1, last.y - y1)
    const d12 = Math.hypot(last.x - x2, last.y - y2)
    if (d11 <= connectTol) {
      pushPt(x2, y2)
    } else if (d12 <= connectTol) {
      pushPt(x1, y1)
    } else {
      return null
    }
  }
  if (pts.length < 2) return null
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Center of preview path in canvas px — for floating length label while dragging. */
export function previewPathCentroidCanvas(
  edgeKeyStrs: string[],
  bd: BuildingDimensions,
  gridDelta: number,
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { x: number; y: number } | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (const ks of edgeKeyStrs) {
    const parsed = parseEdgeKeyString(ks)
    if (!parsed) continue
    const { x1, y1, x2, y2 } =
      nodeAxesIn && nodeAxesIn.xsIn.length >= 2 && nodeAxesIn.ysIn.length >= 2
        ? edgeEndpointsConnectionDetailCanvasPx(bd, parsed, nodeAxesIn.xsIn, nodeAxesIn.ysIn)
        : edgeEndpointsCanvasPx(bd, parsed, gridDelta)
    sx += (x1 + x2) / 2
    sy += (y1 + y2) / 2
    n += 1
  }
  if (n === 0) return null
  return { x: sx / n, y: sy / n }
}

export function distSqPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-18) {
    const ex = px - x1
    const ey = py - y1
    return ex * ex + ey * ey
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const nx = x1 + t * dx
  const ny = y1 + t * dy
  const ex = px - nx
  const ey = py - ny
  return ex * ex + ey * ey
}

/** Any segment vs closed plan-inch rectangle (inclusive); supports diagonals (e.g. section cuts). */
export function segmentIntersectsClosedPlanRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): boolean {
  const xmin = Math.min(rx0, rx1)
  const xmax = Math.max(rx0, rx1)
  const ymin = Math.min(ry0, ry1)
  const ymax = Math.max(ry0, ry1)
  const dx = x1 - x0
  const dy = y1 - y0
  let u1 = 0
  let u2 = 1
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-15) return q >= -1e-12
    const r = q / p
    if (p < 0) {
      if (r > u2) return false
      if (r > u1) u1 = r
    } else {
      if (r < u1) return false
      if (r < u2) u2 = r
    }
    return true
  }
  if (!clip(-dx, x0 - xmin)) return false
  if (!clip(dx, xmax - x0)) return false
  if (!clip(-dy, y0 - ymin)) return false
  if (!clip(dy, ymax - y0)) return false
  return u2 > u1 + 1e-12
}

function splitRunEdgeKeys(edgeKeys: readonly string[], remove: Set<string>): string[][] {
  const runs: string[][] = []
  let cur: string[] = []
  for (const ek of edgeKeys) {
    if (remove.has(ek)) {
      if (cur.length) {
        runs.push(cur)
        cur = []
      }
    } else {
      cur.push(ek)
    }
  }
  if (cur.length) runs.push(cur)
  return runs
}

const vertKey = (n: { i: number; j: number }) => `${n.i}:${n.j}`

function vertsOfGridEdge(e: GridEdgeKey): [{ i: number; j: number }, { i: number; j: number }] {
  return e.axis === 'h'
    ? [
        { i: e.i, j: e.j },
        { i: e.i + 1, j: e.j },
      ]
    : [
        { i: e.i, j: e.j },
        { i: e.i, j: e.j + 1 },
      ]
}

function startEndNodesFromEdgeKeyPath(edgeKeys: string[]): {
  startNode: { i: number; j: number }
  endNode: { i: number; j: number }
} | null {
  if (edgeKeys.length === 0) return null
  const edges = edgeKeys
    .map((k) => parseEdgeKeyString(k))
    .filter((p): p is GridEdgeKey => p != null)
  if (edges.length !== edgeKeys.length) return null
  const [a, b] = vertsOfGridEdge(edges[0]!)
  const chain: { i: number; j: number }[] = [a, b]
  for (let idx = 1; idx < edges.length; idx++) {
    const e = edges[idx]!
    const [c, d] = vertsOfGridEdge(e)
    const last = chain[chain.length - 1]!
    if (vertKey(last) === vertKey(c)) chain.push(d)
    else if (vertKey(last) === vertKey(d)) chain.push(c)
    else return null
  }
  return { startNode: chain[0]!, endNode: chain[chain.length - 1]! }
}

function sectionCutIsOrthogonal(c: PlanAnnotationSectionCut): boolean {
  const a = c.startNode
  const b = c.endNode
  return a.i === b.i || a.j === b.j
}

function stepAcrossGridEdge(
  cur: { i: number; j: number },
  e: GridEdgeKey,
): { i: number; j: number } | null {
  if (e.axis === 'h') {
    if (cur.i === e.i && cur.j === e.j) return { i: e.i + 1, j: e.j }
    if (cur.i === e.i + 1 && cur.j === e.j) return { i: e.i, j: e.j }
    return null
  }
  if (cur.i === e.i && cur.j === e.j) return { i: e.i, j: e.j + 1 }
  if (cur.i === e.i && cur.j === e.j + 1) return { i: e.i, j: e.j }
  return null
}

function nodesAlongSectionCutEdges(
  start: { i: number; j: number },
  end: { i: number; j: number },
  path: GridEdgeKey[],
): { i: number; j: number }[] | null {
  if (path.length === 0) {
    return start.i === end.i && start.j === end.j ? [start] : null
  }
  const verts: { i: number; j: number }[] = [{ ...start }]
  let cur = { ...start }
  for (const e of path) {
    const nxt = stepAcrossGridEdge(cur, e)
    if (!nxt) return null
    verts.push(nxt)
    cur = nxt
  }
  if (cur.i !== end.i || cur.j !== end.j) return null
  return verts
}

function orderedSectionCutGridEdges(
  cut: PlanAnnotationSectionCut,
  delta: number,
  nx: number,
  ny: number,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): GridEdgeKey[] | null {
  const i0 = cut.startNode.i
  const j0 = cut.startNode.j
  const i1 = cut.endNode.i
  const j1 = cut.endNode.j
  const span = edgesInNodeSpan(i0, j0, i1, j1)
  const path =
    span.length > 0
      ? span
      : irregularAxes &&
          irregularAxes.xsIn.length >= 2 &&
          irregularAxes.ysIn.length >= 2
        ? gridUnitEdgesCrossedByConnectionDetailSegment(
            i0,
            j0,
            i1,
            j1,
            irregularAxes.xsIn,
            irregularAxes.ysIn,
          )
        : gridUnitEdgesCrossedByStraightNodeSegment(i0, j0, i1, j1, delta, nx, ny)
  if (path.length === 0) {
    return i0 === i1 && j0 === j1 ? [] : null
  }
  if (nodesAlongSectionCutEdges(cut.startNode, cut.endNode, path)) return path
  const rev = [...path].reverse()
  return nodesAlongSectionCutEdges(cut.startNode, cut.endNode, rev) ? rev : null
}

/** True distance² to dim/grid runs on an irregular connection-detail grid (not only the single nearest edge). */
function bestConnectionDetailDimOrGridAtomicHit(
  pin: { xIn: number; yIn: number },
  sketch: PlanLayoutSketch,
  tolSq: number,
  irregularAxes: { xsIn: readonly number[]; ysIn: readonly number[] },
): { key: string; cmpDsq: number } | null {
  let best: { key: string; cmpDsq: number } | null = null
  const xs = irregularAxes.xsIn
  const ys = irregularAxes.ysIn
  if (xs.length < 2 || ys.length < 2) return null

  const consider = (prefix: 'dim' | 'grid', runId: string, ek: string) => {
    const parsed = parseEdgeKeyString(ek)
    if (!parsed) return
    const ep = edgeEndpointsConnectionDetailInches(parsed, xs, ys)
    const dsq = distSqPointToSegment(pin.xIn, pin.yIn, ep.x1, ep.y1, ep.x2, ep.y2)
    if (dsq <= tolSq && (!best || dsq < best.cmpDsq)) {
      best = { key: `${prefix === 'dim' ? 'dim' : 'grid'}:${runId}|${ek}`, cmpDsq: dsq }
    }
  }

  for (const r of sketch.measureRuns ?? []) {
    for (const ek of r.edgeKeys) consider('dim', r.id, ek)
  }
  for (const r of sketch.annotationGridRuns ?? []) {
    for (const ek of r.edgeKeys) consider('grid', r.id, ek)
  }
  return best
}

/** Annotation keys whose geometry intersects the closed plan-inch rectangle. */
export function annotationKeysIntersectingPlanRect(
  sketch: PlanLayoutSketch,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  delta: number,
  includeElevationDatumLines: boolean,
  /**
   * Connection-detail: when `atomicAnnotationEdges`, dimensions / grid refs use `dim:id|ek` / `grid:id|ek` per edge.
   * Orthogonal section cuts use `sed:id|ek` per grid segment; diagonal cuts use whole-line `sec:id` (chord).
   */
  connectionDetailPick?: {
    siteWIn: number
    siteHIn: number
    atomicAnnotationEdges?: boolean
    irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] }
  },
  /** Expands the test rect (plan inches) so edges just outside a thin marquee still count. */
  planRectPadIn = 0,
): string[] {
  const pad = Math.max(0, planRectPadIn)
  const minx = Math.min(minX, maxX) - pad
  const maxx = Math.max(minX, maxX) + pad
  const miny = Math.min(minY, maxY) - pad
  const maxy = Math.max(minY, maxY) + pad
  const out: string[] = []
  const atomic = Boolean(connectionDetailPick?.atomicAnnotationEdges)
  const irr = connectionDetailPick?.irregularAxes
  const edgeHitsRect = (parsed: GridEdgeKey) =>
    irr && irr.xsIn.length >= 2 && irr.ysIn.length >= 2
      ? gridEdgeIntersectsPlanRectConnectionDetail(parsed, irr.xsIn, irr.ysIn, minx, miny, maxx, maxy)
      : gridEdgeIntersectsPlanRect(parsed, delta, minx, miny, maxx, maxy)
  for (const r of sketch.measureRuns ?? []) {
    if (atomic) {
      for (const ks of r.edgeKeys) {
        const parsed = parseEdgeKeyString(ks)
        if (parsed && edgeHitsRect(parsed)) {
          out.push(`dim:${r.id}|${ks}`)
        }
      }
    } else {
      let hit = false
      for (const ks of r.edgeKeys) {
        const parsed = parseEdgeKeyString(ks)
        if (parsed && edgeHitsRect(parsed)) {
          hit = true
          break
        }
      }
      if (hit) out.push(`dim:${r.id}`)
    }
  }
  for (const r of sketch.annotationGridRuns ?? []) {
    if (atomic) {
      for (const ks of r.edgeKeys) {
        const parsed = parseEdgeKeyString(ks)
        if (parsed && edgeHitsRect(parsed)) {
          out.push(`grid:${r.id}|${ks}`)
        }
      }
    } else {
      let hit = false
      for (const ks of r.edgeKeys) {
        const parsed = parseEdgeKeyString(ks)
        if (parsed && edgeHitsRect(parsed)) {
          hit = true
          break
        }
      }
      if (hit) out.push(`grid:${r.id}`)
    }
  }
  if (connectionDetailPick?.atomicAnnotationEdges) {
    const { nx, ny } = gridCounts(connectionDetailPick.siteWIn, connectionDetailPick.siteHIn, delta)
    const nodeXY = (i: number, j: number) => {
      if (irr && irr.xsIn.length > i && irr.ysIn.length > j) {
        return { x: irr.xsIn[i]!, y: irr.ysIn[j]! }
      }
      return { x: i * delta, y: j * delta }
    }
    for (const c of sketch.annotationSectionCuts ?? []) {
      if (sectionCutIsOrthogonal(c)) {
        const path = orderedSectionCutGridEdges(c, delta, nx, ny, irr)
        if (!path?.length) continue
        for (const e of path) {
          if (edgeHitsRect(e)) {
            out.push(`sed:${c.id}|${edgeKeyString(e)}`)
          }
        }
      } else {
        const p0 = nodeXY(c.startNode.i, c.startNode.j)
        const p1 = nodeXY(c.endNode.i, c.endNode.j)
        if (
          segmentIntersectsClosedPlanRect(p0.x, p0.y, p1.x, p1.y, minx, miny, maxx, maxy)
        ) {
          out.push(`sec:${c.id}`)
        }
      }
    }
  } else {
    const nodeXY = (i: number, j: number) => {
      if (irr && irr.xsIn.length > i && irr.ysIn.length > j) {
        return { x: irr.xsIn[i]!, y: irr.ysIn[j]! }
      }
      return { x: i * delta, y: j * delta }
    }
    for (const c of sketch.annotationSectionCuts ?? []) {
      const p0 = nodeXY(c.startNode.i, c.startNode.j)
      const p1 = nodeXY(c.endNode.i, c.endNode.j)
      if (segmentIntersectsClosedPlanRect(p0.x, p0.y, p1.x, p1.y, minx, miny, maxx, maxy)) {
        out.push(`sec:${c.id}`)
      }
    }
  }
  for (const L of sketch.annotationLabels ?? []) {
    if (L.xIn >= minx && L.xIn <= maxx && L.yIn >= miny && L.yIn <= maxy) {
      out.push(`lbl:${L.id}`)
    }
  }
  if (includeElevationDatumLines) {
    for (const lv of sketch.elevationLevelLines ?? []) {
      const y = lv.j * delta
      if (y >= miny && y <= maxy) {
        out.push(`lvl:${lv.id}`)
      }
    }
  }
  return out
}

/** Apply removals for `dim:` / `grid:` / `sec:` / `lbl:` / `lvl:` keys; returns null if nothing removed. */
export function nextSketchAfterRemovingAnnotationKeys(
  sketch: PlanLayoutSketch,
  keys: readonly string[],
  /** Required when keys include `dim:id|edge` or `grid:id|edge` (grid spacing inches). */
  gridDeltaIn?: number,
): PlanLayoutSketch | null {
  if (keys.length === 0) return null
  const dimWhole = new Set<string>()
  const gridWhole = new Set<string>()
  const dimEdgeRm = new Map<string, Set<string>>()
  const gridEdgeRm = new Map<string, Set<string>>()
  const secIds = new Set<string>()
  const lblIds = new Set<string>()
  const lvlIds = new Set<string>()
  for (const key of keys) {
    if (key.startsWith('dim:')) {
      const rest = key.slice(4)
      const pipe = rest.indexOf('|')
      if (pipe < 0) dimWhole.add(rest)
      else {
        const id = rest.slice(0, pipe)
        const ek = rest.slice(pipe + 1)
        let s = dimEdgeRm.get(id)
        if (!s) {
          s = new Set()
          dimEdgeRm.set(id, s)
        }
        s.add(ek)
      }
    } else if (key.startsWith('grid:')) {
      const rest = key.slice(5)
      const pipe = rest.indexOf('|')
      if (pipe < 0) gridWhole.add(rest)
      else {
        const id = rest.slice(0, pipe)
        const ek = rest.slice(pipe + 1)
        let s = gridEdgeRm.get(id)
        if (!s) {
          s = new Set()
          gridEdgeRm.set(id, s)
        }
        s.add(ek)
      }
    } else if (key.startsWith('sec:')) secIds.add(key.slice(4))
    else if (key.startsWith('lbl:')) lblIds.add(key.slice(4))
    else if (key.startsWith('lvl:')) lvlIds.add(key.slice(4))
  }

  let measureRuns = sketch.measureRuns
  let annotationGridRuns = sketch.annotationGridRuns
  let annotationSectionCuts = sketch.annotationSectionCuts
  let annotationLabels = sketch.annotationLabels
  let elevationLevelLines = sketch.elevationLevelLines
  let changed = false

  const deltaM = gridDeltaIn ?? sketch.gridSpacingIn

  if (
    (dimWhole.size > 0 || dimEdgeRm.size > 0) &&
    measureRuns?.length &&
    Number.isFinite(deltaM) &&
    deltaM > 0
  ) {
    let mid = 0
    const newMeasureId = () => `m-${Date.now()}-${++mid}`
    let list = measureRuns.filter((r) => !dimWhole.has(r.id))
    if (dimEdgeRm.size > 0) {
      const next: PlanMeasureGridRun[] = []
      for (const r of list) {
        const rm = dimEdgeRm.get(r.id)
        if (!rm || rm.size === 0) {
          next.push(r)
          continue
        }
        const pieces = splitRunEdgeKeys(r.edgeKeys, rm)
        for (const chain of pieces) {
          const se = startEndNodesFromEdgeKeyPath(chain)
          if (!se || chain.length === 0) continue
          next.push({
            id: newMeasureId(),
            edgeKeys: [...chain],
            totalPlanIn: chain.length * deltaM,
            startNode: se.startNode,
            endNode: se.endNode,
          })
        }
      }
      list = next
    }
    if (list.length !== measureRuns.length || dimEdgeRm.size > 0 || dimWhole.size > 0) {
      changed = true
      measureRuns = list.length > 0 ? list : undefined
    }
  } else if (dimWhole.size > 0 && measureRuns?.length) {
    const filtered = measureRuns.filter((r) => !dimWhole.has(r.id))
    if (filtered.length !== measureRuns.length) {
      changed = true
      measureRuns = filtered.length > 0 ? filtered : undefined
    }
  }

  if ((gridWhole.size > 0 || gridEdgeRm.size > 0) && annotationGridRuns?.length) {
    let gid = 0
    const newGridId = () => `g-${Date.now()}-${++gid}`
    let list = annotationGridRuns.filter((r) => !gridWhole.has(r.id))
    if (gridEdgeRm.size > 0) {
      const next: PlanAnnotationGridRun[] = []
      for (const r of list) {
        const rm = gridEdgeRm.get(r.id)
        if (!rm || rm.size === 0) {
          next.push(r)
          continue
        }
        const pieces = splitRunEdgeKeys(r.edgeKeys, rm)
        for (const chain of pieces) {
          if (chain.length === 0) continue
          next.push({ id: newGridId(), edgeKeys: [...chain] })
        }
      }
      list = next
    }
    if (list.length !== annotationGridRuns.length || gridEdgeRm.size > 0 || gridWhole.size > 0) {
      changed = true
      annotationGridRuns = list.length > 0 ? list : undefined
    }
  } else if (gridWhole.size > 0 && annotationGridRuns?.length) {
    const filtered = annotationGridRuns.filter((r) => !gridWhole.has(r.id))
    if (filtered.length !== annotationGridRuns.length) {
      changed = true
      annotationGridRuns = filtered.length > 0 ? filtered : undefined
    }
  }
  if (secIds.size > 0 && annotationSectionCuts?.length) {
    const filtered = annotationSectionCuts.filter((c) => !secIds.has(c.id))
    if (filtered.length !== annotationSectionCuts.length) {
      changed = true
      annotationSectionCuts = filtered.length > 0 ? filtered : undefined
    }
  }
  if (lblIds.size > 0 && annotationLabels?.length) {
    const filtered = annotationLabels.filter((l) => !lblIds.has(l.id))
    if (filtered.length !== annotationLabels.length) {
      changed = true
      annotationLabels = filtered.length > 0 ? filtered : undefined
    }
  }
  if (lvlIds.size > 0 && elevationLevelLines?.length) {
    const filtered = elevationLevelLines.filter((l) => !lvlIds.has(l.id))
    if (filtered.length !== elevationLevelLines.length) {
      changed = true
      elevationLevelLines = filtered.length > 0 ? filtered : undefined
    }
  }

  if (!changed) return null
  return {
    ...sketch,
    measureRuns,
    annotationGridRuns,
    annotationSectionCuts,
    annotationLabels,
    elevationLevelLines,
  }
}

/** Section cuts: straight chord from start→end node (same geometry as `SectionCutGraphic` detailLine). */
function pickBestSecChordHit(
  pin: { xIn: number; yIn: number },
  sketch: PlanLayoutSketch,
  delta: number,
  tolSq: number,
): { key: string; cmpDsq: number } | null {
  const cuts = sketch.annotationSectionCuts ?? []
  let bestCut = -1
  let bestCutD = Infinity
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i]!
    const x1 = c.startNode.i * delta
    const y1 = c.startNode.j * delta
    const x2 = c.endNode.i * delta
    const y2 = c.endNode.j * delta
    const dsq = distSqPointToSegment(pin.xIn, pin.yIn, x1, y1, x2, y2)
    if (dsq < bestCutD && dsq <= tolSq) {
      bestCutD = dsq
      bestCut = i
    }
  }
  if (bestCut < 0) return null
  return { key: `sec:${cuts[bestCut]!.id}`, cmpDsq: bestCutD }
}

/** Non-orthogonal (diagonal) cuts only — whole line `sec:` by chord distance. */
function pickBestDiagonalSecChordHit(
  pin: { xIn: number; yIn: number },
  sketch: PlanLayoutSketch,
  delta: number,
  tolSq: number,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { key: string; cmpDsq: number } | null {
  const cuts = sketch.annotationSectionCuts ?? []
  let bestCut = -1
  let bestCutD = Infinity
  const nodeXY = (i: number, j: number) => {
    if (irregularAxes && irregularAxes.xsIn.length > i && irregularAxes.ysIn.length > j) {
      return { x: irregularAxes.xsIn[i]!, y: irregularAxes.ysIn[j]! }
    }
    return { x: i * delta, y: j * delta }
  }
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i]!
    if (sectionCutIsOrthogonal(c)) continue
    const p0 = nodeXY(c.startNode.i, c.startNode.j)
    const p1 = nodeXY(c.endNode.i, c.endNode.j)
    const x1 = p0.x
    const y1 = p0.y
    const x2 = p1.x
    const y2 = p1.y
    const dsq = distSqPointToSegment(pin.xIn, pin.yIn, x1, y1, x2, y2)
    if (dsq < bestCutD && dsq <= tolSq) {
      bestCutD = dsq
      bestCut = i
    }
  }
  if (bestCut < 0) return null
  return { key: `sec:${cuts[bestCut]!.id}`, cmpDsq: bestCutD }
}

/** Orthogonal section cuts: closest grid segment `sed:` (matches drawn H/V polyline). */
function pickBestOrthogonalSedHit(
  pin: { xIn: number; yIn: number },
  sketch: PlanLayoutSketch,
  delta: number,
  siteWIn: number,
  siteHIn: number,
  tolSq: number,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { key: string; cmpDsq: number } | null {
  const { nx, ny } = gridCounts(siteWIn, siteHIn, delta)
  let best: { key: string; cmpDsq: number } | null = null
  for (const c of sketch.annotationSectionCuts ?? []) {
    if (!sectionCutIsOrthogonal(c)) continue
    const path = orderedSectionCutGridEdges(c, delta, nx, ny, irregularAxes)
    if (!path?.length) continue
    for (const e of path) {
      const ep =
        irregularAxes && irregularAxes.xsIn.length >= 2 && irregularAxes.ysIn.length >= 2
          ? edgeEndpointsConnectionDetailInches(e, irregularAxes.xsIn, irregularAxes.ysIn)
          : edgeEndpointsInches(e, delta)
      const dsq = distSqPointToSegment(pin.xIn, pin.yIn, ep.x1, ep.y1, ep.x2, ep.y2)
      if (dsq <= tolSq && (!best || dsq < best.cmpDsq)) {
        best = { key: `sed:${c.id}|${edgeKeyString(e)}`, cmpDsq: dsq }
      }
    }
  }
  return best
}

/**
 * Pick one annotation under the pointer; keys: `dim:id`, `grid:id`, `sec:id`, `lvl:id`, `lbl:id`.
 * On connection-detail canvases pass `connectionDetailAtomicEdges` so dimensions / grid refs use
 * `dim:id|edge` / `grid:id|edge`; orthogonal section cuts use `sed:id|edge`; diagonal cuts use whole `sec:id`.
 * Level lines are only tested when `pickElevationDatumLines` is true (elevation canvas).
 */
export function annotationHitKeyAtPlanInches(
  pin: { xIn: number; yIn: number },
  sketch: PlanLayoutSketch,
  siteWIn: number,
  siteHIn: number,
  delta: number,
  maxDistIn: number,
  pickElevationDatumLines: boolean,
  connectionDetailAtomicEdges = false,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): string | null {
  const tol = maxDistIn * (connectionDetailAtomicEdges ? 1.95 : 1.35)
  const tolSq = tol * tol

  // In elevation mode, level lines are the primary structural datums and take
  // highest priority so they can always be clicked even when dimension lines
  // happen to run along the same grid row.
  if (pickElevationDatumLines) {
    const levels = sketch.elevationLevelLines ?? []
    let bestLvl = -1
    let bestLvlD = Infinity
    for (let i = 0; i < levels.length; i++) {
      const L = levels[i]!
      const yLine = L.j * delta
      const dist = Math.abs(pin.yIn - yLine)
      if (dist < bestLvlD && dist <= tol) {
        bestLvlD = dist
        bestLvl = i
      }
    }
    if (bestLvl >= 0) return `lvl:${levels[bestLvl]!.id}`
  }

  const secPick = connectionDetailAtomicEdges
    ? null
    : pickBestSecChordHit(pin, sketch, delta, tolSq)

  let sectionPick: { key: string; cmpDsq: number } | null = null
  if (connectionDetailAtomicEdges) {
    const ortho = pickBestOrthogonalSedHit(
      pin,
      sketch,
      delta,
      siteWIn,
      siteHIn,
      tolSq,
      irregularAxes,
    )
    const diag = pickBestDiagonalSecChordHit(pin, sketch, delta, tolSq, irregularAxes)
    if (ortho && diag) sectionPick = ortho.cmpDsq <= diag.cmpDsq ? ortho : diag
    else sectionPick = ortho ?? diag
  }

  let dimGridKey: string | null = null
  let dimGridCmp = Infinity
  const useIrregularDetail =
    connectionDetailAtomicEdges &&
    irregularAxes &&
    irregularAxes.xsIn.length >= 2 &&
    irregularAxes.ysIn.length >= 2

  if (useIrregularDetail && irregularAxes) {
    const atomicHit = bestConnectionDetailDimOrGridAtomicHit(pin, sketch, tolSq, irregularAxes)
    if (atomicHit) {
      dimGridKey = atomicHit.key
      dimGridCmp = atomicHit.cmpDsq
    }
  } else {
    const hitE = nearestGridEdge(pin.xIn, pin.yIn, siteWIn, siteHIn, delta, maxDistIn)
    if (hitE) {
      const k = edgeKeyString(hitE)
      const dG = hitE.distIn * hitE.distIn
      for (const r of sketch.measureRuns ?? []) {
        if (r.edgeKeys.includes(k)) {
          dimGridKey = connectionDetailAtomicEdges ? `dim:${r.id}|${k}` : `dim:${r.id}`
          dimGridCmp = dG
          break
        }
      }
      if (dimGridKey === null) {
        for (const r of sketch.annotationGridRuns ?? []) {
          if (r.edgeKeys.includes(k)) {
            dimGridKey = connectionDetailAtomicEdges ? `grid:${r.id}|${k}` : `grid:${r.id}`
            dimGridCmp = dG
            break
          }
        }
      }
    }
  }

  if (connectionDetailAtomicEdges) {
    const labels = sketch.annotationLabels ?? []
    let bestLab: { key: string; cmpDsq: number } | null = null
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i]!
      const dx = L.xIn - pin.xIn
      const dy = L.yIn - pin.yIn
      const dsq = dx * dx + dy * dy
      if (dsq <= tolSq && (!bestLab || dsq < bestLab.cmpDsq)) {
        bestLab = { key: `lbl:${L.id}`, cmpDsq: dsq }
      }
    }
    const candidates: { key: string; cmpDsq: number }[] = []
    if (sectionPick) candidates.push(sectionPick)
    if (dimGridKey != null && Number.isFinite(dimGridCmp)) {
      candidates.push({ key: dimGridKey, cmpDsq: dimGridCmp })
    }
    if (bestLab) candidates.push(bestLab)
    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.cmpDsq - b.cmpDsq)
    return candidates[0]!.key
  }

  if (dimGridKey) return dimGridKey
  if (secPick) return secPick.key

  const labels = sketch.annotationLabels ?? []
  let bestLab = -1
  let bestLabD = Infinity
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i]!
    const dx = L.xIn - pin.xIn
    const dy = L.yIn - pin.yIn
    const dsq = dx * dx + dy * dy
    if (dsq < bestLabD && dsq <= tolSq) {
      bestLabD = dsq
      bestLab = i
    }
  }
  if (bestLab >= 0) return `lbl:${labels[bestLab]!.id}`
  return null
}

/** All per-edge keys for connection-detail select-all; orthogonal detail lines per `sed:`, diagonal per `sec:`. */
export function allConnectionDetailAtomicAnnotationKeys(
  sketch: PlanLayoutSketch,
  delta: number,
  siteWIn: number,
  siteHIn: number,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): string[] {
  const keys: string[] = []
  for (const r of sketch.measureRuns ?? []) {
    for (const ek of r.edgeKeys) keys.push(`dim:${r.id}|${ek}`)
  }
  for (const r of sketch.annotationGridRuns ?? []) {
    for (const ek of r.edgeKeys) keys.push(`grid:${r.id}|${ek}`)
  }
  const { nx, ny } = gridCounts(siteWIn, siteHIn, delta)
  for (const c of sketch.annotationSectionCuts ?? []) {
    if (sectionCutIsOrthogonal(c)) {
      const path = orderedSectionCutGridEdges(c, delta, nx, ny, irregularAxes)
      if (!path) continue
      for (const e of path) keys.push(`sed:${c.id}|${edgeKeyString(e)}`)
    } else {
      keys.push(`sec:${c.id}`)
    }
  }
  return keys
}

/**
 * Remove orthogonal detail-line grid segments (`sed:`) in one update; may split one cut into several.
 */
export function nextSketchAfterRemovingDetailSectionCutSedKeys(
  sketch: PlanLayoutSketch,
  sedKeys: readonly string[],
  delta: number,
  siteWIn: number,
  siteHIn: number,
  newId: () => string,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): PlanLayoutSketch | null {
  if (sedKeys.length === 0) return null
  const byCut = new Map<string, Set<string>>()
  for (const key of sedKeys) {
    if (!key.startsWith('sed:')) continue
    const rest = key.slice(4)
    const pipe = rest.indexOf('|')
    if (pipe < 0) continue
    const cutId = rest.slice(0, pipe)
    const ek = rest.slice(pipe + 1)
    let s = byCut.get(cutId)
    if (!s) {
      s = new Set()
      byCut.set(cutId, s)
    }
    s.add(ek)
  }
  if (byCut.size === 0) return null

  const { nx, ny } = gridCounts(siteWIn, siteHIn, delta)
  const cuts = sketch.annotationSectionCuts ?? []
  const nextCuts: PlanAnnotationSectionCut[] = []
  let changed = false

  for (const c of cuts) {
    const removeEk = byCut.get(c.id)
    if (!removeEk) {
      nextCuts.push(c)
      continue
    }
    if (!sectionCutIsOrthogonal(c)) {
      nextCuts.push(c)
      continue
    }
    const path = orderedSectionCutGridEdges(c, delta, nx, ny, irregularAxes)
    if (!path) {
      nextCuts.push(c)
      continue
    }
    const verts = nodesAlongSectionCutEdges(c.startNode, c.endNode, path)
    if (!verts || verts.length !== path.length + 1) {
      nextCuts.push(c)
      continue
    }
    const m = path.length
    let i = 0
    while (i < m) {
      while (i < m && removeEk.has(edgeKeyString(path[i]!))) i++
      if (i >= m) break
      const i0 = i
      while (i < m && !removeEk.has(edgeKeyString(path[i]!))) i++
      const i1 = i - 1
      nextCuts.push({
        id: newId(),
        startNode: { ...verts[i0]! },
        endNode: { ...verts[i1 + 1]! },
      })
    }
    changed = true
  }

  if (!changed) return null
  return {
    ...sketch,
    annotationSectionCuts: nextCuts.length > 0 ? nextCuts : undefined,
  }
}

export function nextSketchAfterRemovingDetailSectionCutGridEdgeKey(
  sketch: PlanLayoutSketch,
  sedKey: string,
  delta: number,
  siteWIn: number,
  siteHIn: number,
  newId: () => string,
  irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): PlanLayoutSketch | null {
  if (!sedKey.startsWith('sed:')) return null
  return nextSketchAfterRemovingDetailSectionCutSedKeys(
    sketch,
    [sedKey],
    delta,
    siteWIn,
    siteHIn,
    newId,
    irregularAxes,
  )
}

const MEP_RUN_GAP_PX = 1

/**
 * For MEP run edges that share a grid segment, compute a perpendicular pixel
 * offset so parallel runs fan out side-by-side instead of overlapping.
 * Returns a Map from `placedEdgeKey` to `{ dx, dy }` in canvas pixels.
 */
export function computeMepRunOffsets(
  edges: readonly PlacedGridEdge[],
  d: BuildingDimensions,
  mepById: Map<string, MepItem>,
): Map<string, { dx: number; dy: number }> {
  const result = new Map<string, { dx: number; dy: number }>()

  const bySegment = new Map<string, PlacedGridEdge[]>()
  for (const e of edges) {
    if (e.source !== 'mep' || e.kind !== 'run') continue
    const gk = edgeKeyString(e)
    let arr = bySegment.get(gk)
    if (!arr) { arr = []; bySegment.set(gk, arr) }
    arr.push(e)
  }

  for (const [gk, group] of bySegment) {
    if (group.length < 2) continue
    group.sort((a, b) => layerIdentityFromEdge(a).localeCompare(layerIdentityFromEdge(b)))

    const widths = group.map((e) => strokeWidthForEdge(d, e, mepById))
    const totalBand = widths.reduce((s, w) => s + w, 0) + (group.length - 1) * MEP_RUN_GAP_PX
    const isHorizontal = gk.startsWith('h')

    let cursor = -totalBand / 2
    for (let idx = 0; idx < group.length; idx++) {
      const sw = widths[idx]!
      const center = cursor + sw / 2
      cursor += sw + MEP_RUN_GAP_PX
      const pk = placedEdgeKey(group[idx]!)
      if (isHorizontal) {
        result.set(pk, { dx: 0, dy: center })
      } else {
        result.set(pk, { dx: center, dy: 0 })
      }
    }
  }

  return result
}
