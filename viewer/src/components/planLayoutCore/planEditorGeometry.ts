import type { BuildingDimensions } from '../../types/system'
import type { MepItem } from '../../types/mep'
import type {
  EdgeStrokeKind,
  GridEdgeKey,
  PlacedFloorCell,
  PlacedGridEdge,
  PlanLayoutSketch,
} from '../../types/planLayout'
import {
  cellKeyString,
  cellPaintKind,
  edgeKeyString,
  isExclusiveArchFloorPaintCell,
  layerIdentityFromCell,
  normalizeExclusiveArchFloorPaintCells,
  parsePlacedCellKey,
  parseEdgeKeyString,
} from '../../types/planLayout'
import { formatSiteMeasure, PLAN_SITE_UNIT_SHORT, type PlanSiteDisplayUnit } from '../../lib/planDisplayUnits'
import { edgeEndpointsCanvasPx, nearestGridEdge, gridEdgeIntersectsPlanRect } from '../../lib/gridEdges'
import type { PlanPlaceMode } from '../../lib/planLayerColors'
import { ZOOM_MAX, ZOOM_MIN } from './constants'
import type { ActiveCatalog } from './types'

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
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
  if (placeMode === 'mep') return 'run'
  return activeCatalog === 'mep' ? 'run' : 'wall'
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

/** Merge floor/stair paint stroke into cell list (arch: one fill per grid square; new stroke wins). */
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
      next = next.filter((c) => cellKeyString(c) !== ck || !isExclusiveArchFloorPaintCell(c))
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
  mepById: Map<string, MepItem>,
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
    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(bd, parsed, gridDelta)
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
): { x: number; y: number } | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (const ks of edgeKeyStrs) {
    const parsed = parseEdgeKeyString(ks)
    if (!parsed) continue
    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(bd, parsed, gridDelta)
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

/** Annotation keys whose geometry intersects the closed plan-inch rectangle. */
export function annotationKeysIntersectingPlanRect(
  sketch: PlanLayoutSketch,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  delta: number,
  includeElevationDatumLines: boolean,
): string[] {
  const minx = Math.min(minX, maxX)
  const maxx = Math.max(minX, maxX)
  const miny = Math.min(minY, maxY)
  const maxy = Math.max(minY, maxY)
  const out: string[] = []
  for (const r of sketch.measureRuns ?? []) {
    let hit = false
    for (const ks of r.edgeKeys) {
      const parsed = parseEdgeKeyString(ks)
      if (parsed && gridEdgeIntersectsPlanRect(parsed, delta, minx, miny, maxx, maxy)) {
        hit = true
        break
      }
    }
    if (hit) out.push(`dim:${r.id}`)
  }
  for (const r of sketch.annotationGridRuns ?? []) {
    let hit = false
    for (const ks of r.edgeKeys) {
      const parsed = parseEdgeKeyString(ks)
      if (parsed && gridEdgeIntersectsPlanRect(parsed, delta, minx, miny, maxx, maxy)) {
        hit = true
        break
      }
    }
    if (hit) out.push(`grid:${r.id}`)
  }
  for (const c of sketch.annotationSectionCuts ?? []) {
    const x1 = c.startNode.i * delta
    const y1 = c.startNode.j * delta
    const x2 = c.endNode.i * delta
    const y2 = c.endNode.j * delta
    if (segmentIntersectsClosedPlanRect(x1, y1, x2, y2, minx, miny, maxx, maxy)) {
      out.push(`sec:${c.id}`)
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
): PlanLayoutSketch | null {
  if (keys.length === 0) return null
  const dimIds = new Set<string>()
  const gridIds = new Set<string>()
  const secIds = new Set<string>()
  const lblIds = new Set<string>()
  const lvlIds = new Set<string>()
  for (const key of keys) {
    if (key.startsWith('dim:')) dimIds.add(key.slice(4))
    else if (key.startsWith('grid:')) gridIds.add(key.slice(5))
    else if (key.startsWith('sec:')) secIds.add(key.slice(4))
    else if (key.startsWith('lbl:')) lblIds.add(key.slice(4))
    else if (key.startsWith('lvl:')) lvlIds.add(key.slice(4))
  }

  let measureRuns = sketch.measureRuns
  let annotationGridRuns = sketch.annotationGridRuns
  let annotationSectionCuts = sketch.annotationSectionCuts
  let annotationLabels = sketch.annotationLabels
  let elevationLevelLines = sketch.elevationLevelLines
  let changed = false

  if (dimIds.size > 0 && measureRuns?.length) {
    const filtered = measureRuns.filter((r) => !dimIds.has(r.id))
    if (filtered.length !== measureRuns.length) {
      changed = true
      measureRuns = filtered.length > 0 ? filtered : undefined
    }
  }
  if (gridIds.size > 0 && annotationGridRuns?.length) {
    const filtered = annotationGridRuns.filter((r) => !gridIds.has(r.id))
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

/**
 * Pick one annotation under the pointer; keys: `dim:id`, `grid:id`, `sec:id`, `lvl:id`, `lbl:id`.
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
): string | null {
  const tol = maxDistIn * 1.35
  const tolSq = tol * tol
  const hitE = nearestGridEdge(pin.xIn, pin.yIn, siteWIn, siteHIn, delta, maxDistIn)
  if (hitE) {
    const k = edgeKeyString(hitE)
    for (const r of sketch.measureRuns ?? []) {
      if (r.edgeKeys.includes(k)) return `dim:${r.id}`
    }
    for (const r of sketch.annotationGridRuns ?? []) {
      if (r.edgeKeys.includes(k)) return `grid:${r.id}`
    }
  }
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
  if (bestCut >= 0) return `sec:${cuts[bestCut]!.id}`
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
