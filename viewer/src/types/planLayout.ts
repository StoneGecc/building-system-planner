import type { BuildingDimensions } from './system'

export type GridAxis = 'h' | 'v'

/** Horizontal edge connects nodes (i,j) and (i+1,j). Vertical connects (i,j) and (i,j+1). */
export interface GridEdgeKey {
  i: number
  j: number
  axis: GridAxis
}

export type EdgeStrokeKind = 'wall' | 'run' | 'window' | 'door' | 'roof' | 'stairs'

export interface PlacedGridEdge extends GridEdgeKey {
  systemId: string
  source: 'arch' | 'mep'
  kind: EdgeStrokeKind
}

/** Unit cell (i,j) fills the square from grid node (i,j) to (i+1,j+1) — flooring / zones. */
export interface PlacedFloorCell {
  i: number
  j: number
  systemId: string
  source: 'arch' | 'mep'
  /** Omitted or `'floor'` — normal floor paint; `'stairs'` — stair tool (full cell squares). */
  cellKind?: 'floor' | 'stairs'
}

/** Square column footprint in plan inches, centered at (cxIn, cyIn). */
export interface PlacedPlanColumn {
  id: string
  cxIn: number
  cyIn: number
  sizeIn: number
  systemId: string
  source: 'arch'
}

export const PLAN_LAYOUT_VERSION = 1 as const

/** Grid-snapped dimension run (Annotation · Measure line); optional in stored JSON. */
export interface PlanMeasureGridRun {
  id: string
  edgeKeys: string[]
  totalPlanIn: number
  startNode: { i: number; j: number }
  endNode: { i: number; j: number }
}

/** Grid-snapped reference polyline (Annotation · Grid line); no dimension text. */
export interface PlanAnnotationGridRun {
  id: string
  edgeKeys: string[]
}

/** Free text on plan (Annotation · Text); plan inches from site origin. */
export interface PlanAnnotationLabel {
  id: string
  xIn: number
  yIn: number
  text: string
}

/** Straight section cut indicator between two grid nodes. */
export interface PlanAnnotationSectionCut {
  id: string
  startNode: { i: number; j: number }
  endNode: { i: number; j: number }
}

/** JPEG/PNG trace image under the grid; stored as a data URL with transform. */
export interface PlanTraceOverlay {
  imageDataUrl: string
  visible: boolean
  /** 5–100, UI fade slider */
  opacityPct: number
  tx: number
  ty: number
  rotateDeg: number
  scale: number
}

/** Optional flags when updating the implementation plan from the app shell. */
export type PlanSketchCommitOptions = { skipUndo?: boolean }

/** One shared level / datum line on elevation canvases (layout sketch). */
export type ElevationLevelLine = {
  id: string
  /** Grid row 0…siteNy (same convention as ground line). */
  j: number
  /** Optional tag (e.g. FF, L2). */
  label?: string
}

export interface PlanLayoutSketch {
  version: typeof PLAN_LAYOUT_VERSION
  gridSpacingIn: number
  edges: PlacedGridEdge[]
  /** Filled grid cells (optional in stored JSON for backward compatibility). */
  cells: PlacedFloorCell[]
  /** Saved grid dimension lines; persist across layer changes and export. */
  measureRuns?: PlanMeasureGridRun[]
  /** Annotation: dashed grid-reference polylines (no labels). */
  annotationGridRuns?: PlanAnnotationGridRun[]
  /** Annotation: text labels at plan coordinates. */
  annotationLabels?: PlanAnnotationLabel[]
  /** Annotation: section cut lines (straight, node to node). */
  annotationSectionCuts?: PlanAnnotationSectionCut[]
  /**
   * Building height in plan inches (elevations, Setup “Building area”).
   * Omitted → use `BuildingDimensions.floorToFloor` in UI.
   */
  buildingHeightIn?: number
  /**
   * Site / lot size in plan inches (lower-left aligned with building origin).
   * Omitted or invalid → use building footprint only (no yard).
   */
  siteWidthIn?: number
  siteDepthIn?: number
  /** Optional floor-plan trace image; persisted with the sketch. */
  traceOverlay?: PlanTraceOverlay
  /**
   * Room layer: boundary segments drawn in Room mode (Line / Rect); used with Fill to name enclosed zones.
   * Omitted when empty.
   */
  roomBoundaryEdges?: GridEdgeKey[]
  /**
   * Room layer: display name per unit cell (`i:j`), applied with the Fill tool to the zone bounded by `roomBoundaryEdges`.
   * Omitted when empty.
   */
  roomByCell?: Record<string, string>
  /** Column tool: square footprints in plan inches. Omitted when empty. */
  columns?: PlacedPlanColumn[]
  /**
   * All elevation sheets share this: horizontal grid row index (0…siteNy) for a full-width grade / ground line.
   * Stored on the floor-1 layout sketch (not per cardinal elevation). Aligns with horizontal grid edges.
   */
  elevationGroundPlaneJ?: number
  /**
   * Shared datum lines for all elevations (e.g. floor levels): full-width horizontals at grid rows.
   * Stored on the layout sketch. Erase / Select use keys `lvl:{id}`.
   */
  elevationLevelLines?: ElevationLevelLine[]
}

/** Site dimensions for canvas; always ≥ building footprint. Lot size comes from Setup only. */
export function resolvedSiteInches(sketch: PlanLayoutSketch, d: BuildingDimensions): { w: number; h: number } {
  const fw = d.footprintWidth
  const fd = d.footprintDepth
  const sw0 = sketch.siteWidthIn
  const sh0 = sketch.siteDepthIn
  const sw =
    sw0 != null && Number.isFinite(sw0) && sw0 > 0 ? Math.max(sw0, fw) : fw
  const sh =
    sh0 != null && Number.isFinite(sh0) && sh0 > 0 ? Math.max(sh0, fd) : fd
  return { w: sw, h: sh }
}

export function edgeKeyString(e: GridEdgeKey): string {
  return `${e.axis}:${e.i}:${e.j}`
}

export function parseEdgeKeyString(s: string): GridEdgeKey | null {
  const m = /^([hv]):(\d+):(\d+)$/.exec(s)
  if (!m) return null
  const axis = m[1] === 'h' ? 'h' : 'v'
  return { axis, i: Number(m[2]), j: Number(m[3]) }
}

export function footprintStorageKey(d: BuildingDimensions): string {
  return `${d.footprintWidth}|${d.footprintDepth}|${d.planScale}`
}

export function emptySketch(gridSpacingIn: number): PlanLayoutSketch {
  return { version: PLAN_LAYOUT_VERSION, gridSpacingIn, edges: [], cells: [] }
}

export function cellKeyString(c: Pick<PlacedFloorCell, 'i' | 'j'>): string {
  return `${c.i}:${c.j}`
}

/** Catalog layer identity — only one stroke/fill per layer may occupy the same grid segment or cell. */
export function layerIdentityFromEdge(e: Pick<PlacedGridEdge, 'source' | 'systemId'>): string {
  return `${e.source ?? 'arch'}\t${e.systemId}`
}

/** Arch wall / stair edges share one visual slot per grid segment (any system). */
export function isExclusiveArchWallSegmentStroke(e: Pick<PlacedGridEdge, 'source' | 'kind'>): boolean {
  if ((e.source ?? 'arch') !== 'arch') return false
  return e.kind === 'wall' || e.kind === 'stairs'
}

export function layerIdentityFromCell(c: Pick<PlacedFloorCell, 'source' | 'systemId'>): string {
  return `${c.source}\t${c.systemId}`
}

export function layerIdentityFromColumn(c: Pick<PlacedPlanColumn, 'source' | 'systemId'>): string {
  return `${c.source}\t${c.systemId}`
}

/** Stable key for a placed column (layer + id). */
export function placedColumnKey(c: PlacedPlanColumn): string {
  return `${layerIdentityFromColumn(c)}\t${c.id}`
}

/** Axis-aligned footprint of a square column in plan inches. */
export function planColumnBoundsIn(c: PlacedPlanColumn): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const h = Math.max(0, c.sizeIn) / 2
  return {
    minX: c.cxIn - h,
    minY: c.cyIn - h,
    maxX: c.cxIn + h,
    maxY: c.cyIn + h,
  }
}

export function planColumnIntersectsPlanRect(
  c: PlacedPlanColumn,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const b = planColumnBoundsIn(c)
  return !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY)
}

export function planPointInsideColumnFootprint(
  c: PlacedPlanColumn,
  xIn: number,
  yIn: number,
): boolean {
  const b = planColumnBoundsIn(c)
  return xIn >= b.minX && xIn <= b.maxX && yIn >= b.minY && yIn <= b.maxY
}

/** Unique id for a placed edge (layer + grid segment). */
export function placedEdgeKey(e: PlacedGridEdge): string {
  return `${layerIdentityFromEdge(e)}\t${edgeKeyString(e)}`
}

/** Normalize cell paint kind for keys and filters. */
export function cellPaintKind(c: Pick<PlacedFloorCell, 'cellKind'>): 'floor' | 'stairs' {
  return c.cellKind === 'stairs' ? 'stairs' : 'floor'
}

/** Floor + stair grid fills (arch catalog) share one slot per unit cell — at most one paint per square. */
export function isExclusiveArchFloorPaintCell(c: Pick<PlacedFloorCell, 'source'>): boolean {
  return c.source === 'arch'
}

/** Collapse duplicate arch fills on the same grid square (last in array order wins). */
export function normalizeExclusiveArchFloorPaintCells(cells: PlacedFloorCell[]): PlacedFloorCell[] {
  const nonArch: PlacedFloorCell[] = []
  const archByGeom = new Map<string, PlacedFloorCell>()
  for (const c of cells) {
    if (!isExclusiveArchFloorPaintCell(c)) {
      nonArch.push(c)
      continue
    }
    archByGeom.set(cellKeyString(c), c)
  }
  return [...nonArch, ...archByGeom.values()]
}

/** Unique id for a placed floor cell (layer + paint kind + grid cell). */
export function placedCellKey(c: PlacedFloorCell): string {
  return `${layerIdentityFromCell(c)}\t${cellPaintKind(c)}\t${cellKeyString(c)}`
}

export function parsePlacedCellKey(s: string): Pick<PlacedFloorCell, 'i' | 'j'> | null {
  const parts = s.split('\t')
  const last = parts[parts.length - 1] ?? ''
  const m = /^(\d+):(\d+)$/.exec(last)
  if (!m) return null
  return { i: Number(m[1]), j: Number(m[2]) }
}

export function cellsToMap(cells: PlacedFloorCell[]): Map<string, PlacedFloorCell> {
  const m = new Map<string, PlacedFloorCell>()
  for (const c of cells) {
    m.set(cellKeyString(c), c)
  }
  return m
}

/** All floor cells at the same grid square (arch: at most one exclusive fill per square after normalize). */
export function cellsByGeometry(cells: PlacedFloorCell[]): Map<string, PlacedFloorCell[]> {
  const m = new Map<string, PlacedFloorCell[]>()
  for (const c of cells) {
    const g = cellKeyString(c)
    let a = m.get(g)
    if (!a) {
      a = []
      m.set(g, a)
    }
    a.push(c)
  }
  for (const a of m.values()) {
    a.sort((x, y) => {
      const ax = `${layerIdentityFromCell(x)}\t${cellPaintKind(x)}`
      const ay = `${layerIdentityFromCell(y)}\t${cellPaintKind(y)}`
      return ax.localeCompare(ay)
    })
  }
  return m
}

/** Build map for last-write-wins rendering */
export function edgesToMap(edges: PlacedGridEdge[]): Map<string, PlacedGridEdge> {
  const m = new Map<string, PlacedGridEdge>()
  for (const e of edges) {
    m.set(edgeKeyString(e), e)
  }
  return m
}

/** All edges on the same grid segment (multiple catalog layers). Groups sorted for stable draw order. */
export function edgesByGeometry(edges: PlacedGridEdge[]): Map<string, PlacedGridEdge[]> {
  const m = new Map<string, PlacedGridEdge[]>()
  for (const e of edges) {
    const g = edgeKeyString(e)
    let a = m.get(g)
    if (!a) {
      a = []
      m.set(g, a)
    }
    a.push(e)
  }
  for (const a of m.values()) {
    a.sort((x, y) => layerIdentityFromEdge(x).localeCompare(layerIdentityFromEdge(y)))
  }
  return m
}
