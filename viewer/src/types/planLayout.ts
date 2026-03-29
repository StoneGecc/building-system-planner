import type { BuildingDimensions } from './system'

export type GridAxis = 'h' | 'v'

/** Horizontal edge connects nodes (i,j) and (i+1,j). Vertical connects (i,j) and (i,j+1). */
export interface GridEdgeKey {
  i: number
  j: number
  axis: GridAxis
}

export type EdgeStrokeKind = 'wall' | 'run' | 'window' | 'door' | 'doorSwing' | 'roof' | 'stairs'

export interface PlacedGridEdge extends GridEdgeKey {
  systemId: string
  source: 'arch' | 'mep'
  kind: EdgeStrokeKind
  /** `doorSwing` only: hinge at start vs end node when placing. */
  doorHinge?: 'start' | 'end'
  /**
   * Arch plan display only: shift stroke perpendicular to the grid segment (plan inches).
   * `axis === 'h'`: +value → +plan Y; `axis === 'v'`: +value → +plan X. Ignored for MEP.
   */
  perpOffsetPlanIn?: number
}

/** Unit cell (i,j) fills the square from grid node (i,j) to (i+1,j+1) — flooring / zones. */
export interface PlacedFloorCell {
  i: number
  j: number
  systemId: string
  source: 'arch' | 'mep'
  /** Omitted or `'floor'` — floor paint; `'stairs'` — stair squares; `'roof'` — roof area fill (same grid as floor). */
  cellKind?: 'floor' | 'stairs' | 'roof'
}

/** Square column footprint in plan inches, centered at (cxIn, cyIn). */
export interface PlacedPlanColumn {
  id: string
  cxIn: number
  cyIn: number
  sizeIn: number
  systemId: string
  source: 'arch'
  /** Optional shift from snapped center in plan inches (display only). */
  offsetXPlanIn?: number
  offsetYPlanIn?: number
}

/** Point-placed MEP device/equipment/fixture on the plan canvas. */
export interface PlacedMepDevice {
  id: string
  /** Plan-inches X from site origin. */
  cxIn: number
  /** Plan-inches Y from site origin. */
  cyIn: number
  /** Fallback square diameter in plan inches (used when lengthIn/widthIn are absent). */
  sizeIn: number
  /** Equipment footprint length (long axis) in plan inches; 0 or absent = circle fallback via sizeIn. */
  lengthIn?: number
  /** Equipment footprint width (short axis) in plan inches; 0 or absent = circle fallback via sizeIn. */
  widthIn?: number
  systemId: string
  /** Discipline sub-category, e.g. 'valve', 'panel', 'diffuser', 'head'. */
  category: string
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

/** Derived view-model for a building level used in the sidebar and elevation projection. */
export type BuildingLevel = {
  id: string
  label: string
  /** Grid row on the elevation canvas (0 = bottom of canvas). */
  j: number
  /** Display order (0 = bottommost level). */
  order: number
}

export const DEFAULT_LEVEL_PRESETS: readonly string[] = [
  'Top of Footing',
  'Slab / Foundation',
  'Level 1',
  'Level 2',
  'Level 3',
  'Level 4',
  'Roof',
  'Top of Parapet',
]

/**
 * Derive ordered building levels from elevation level lines.
 *
 * All levels (including the always-present "Level 1" at id `__default_level_1`) are
 * sorted by `j` ascending: smaller j = higher on the SVG canvas = higher in the building,
 * listed first (top of the sidebar). Larger j = lower on canvas = lower levels appear
 * toward the bottom of the sidebar.
 * Level 1 is identified by its stable id `__default_level_1` throughout the app —
 * NOT by being at index 0 — so it can appear anywhere in the vertical order.
 */
export function buildingLevelsFromLines(lines: ElevationLevelLine[] | undefined): BuildingLevel[] {
  // The "Level 1" datum line (if placed) tells us its j-position for elevation projection.
  const level1Line = lines?.find((l) => l.label === 'Level 1')

  const defaultLevel1: BuildingLevel = {
    id: '__default_level_1',
    label: 'Level 1',
    j: level1Line?.j ?? 0,
    order: 0,
  }

  if (!lines || lines.length === 0) {
    return [defaultLevel1]
  }

  // Non-Level-1 datum lines each become their own floor group.
  const otherLines = lines.filter((l) => l.label !== 'Level 1')
  const otherLevels: BuildingLevel[] = otherLines.map((l) => ({
    id: l.id,
    label: l.label || 'Level',
    j: l.j,
    order: 0, // will be assigned after sorting
  }))

  // Sort ALL levels by j ascending: higher elevations (smaller j) at top of sidebar,
  // lower levels (larger j) at bottom. Tie-break: Level 1 after same-j peers by id.
  const all = [defaultLevel1, ...otherLevels]
  all.sort((a, b) => {
    const dj = a.j - b.j
    if (dj !== 0) return dj
    if (a.id === '__default_level_1') return 1
    if (b.id === '__default_level_1') return -1
    return a.id.localeCompare(b.id)
  })

  return all.map((l, idx) => ({ ...l, order: idx }))
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
  /** MEP device/equipment/fixture point placements. Omitted when empty. */
  mepDevices?: PlacedMepDevice[]
  /**
   * Grid spacing (plan inches) for connection-detail sheets only — independent of `gridSpacingIn` (floor layout).
   * Stored on the Level 1 layout sketch; omitted → same default as `CONNECTION_DETAIL_GRID_SPACING_IN` (1 in).
   */
  connectionDetailGridSpacingIn?: number
  /**
   * Extra connection-detail grid cells to pad on each side of the junction box (width/height grow by 2× this × detail Δ).
   * Stored on Level 1 layout; omitted → default 2 cells per side.
   */
  connectionDetailBoundaryCells?: number
  /**
   * Connection-detail sheets only: per-arm flip of catalog layer order in junction strips (`true` = reversed vs default).
   * Keys: plan direction `up` | `down` | `left` | `right`. Omitted directions use default ordering.
   */
  connectionDetailStripLayerFlips?: Partial<Record<'up' | 'down' | 'left' | 'right', true>>
  /**
   * Plan assembly-line mode: per stroke kind + segment (`planArchAssemblyFlipEdgeKey` / `openGhostPlanArchAssemblyFlipStorageKey`),
   * reverse CSV layer stack along thickness. Legacy keys used `placedEdgeKey` only (walls).
   */
  planArchEdgeLayerFlipped?: Record<string, true>
  /**
   * Legacy (pre–multi-drawing L): per node Ext/Int pick. Read-only migration into
   * `connectionJunctionHomogeneousLSketchIdByNode` + variant list; not written by new UI.
   */
  connectionJunctionConvexConcaveByNode?: Record<string, 'convex' | 'concave'>
  /**
   * Homogeneous L/T/X families (`L-hom|T-hom|X-hom\x1f{signature}`): ordered `tpl:…` sketch ids for connection-detail rows.
   * Omitted → inferred from `connectionSketches` keys (L: legacy `…a`/`…b` hashes) or a single default id.
   */
  connectionDetailHomogeneousLVariantIdsByFamily?: Record<string, string[]>
  /**
   * Homogeneous L/T/X: which variant sketch (`tpl:…`) applies at this grid node (`i:j`).
   * Must appear in that family’s variant list; omitted → first variant (L: legacy convex/concave → index 0/1 when inferring from old sheets).
   */
  connectionJunctionHomogeneousLSketchIdByNode?: Record<string, string>
  /**
   * Connection-detail sheets only: manual layer/MEP fills per irregular grid cell (`i:j`), bounded only by
   * hand-drawn detail lines (`annotationSectionCuts`) for the Layer fill tool.
   */
  connectionDetailLayerFillByCell?: Record<
    string,
    { source: 'arch' | 'mep'; systemId: string; layerIndex: number }
  >
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

/** Whether an arch wall and an opening occupy the **same** grid segment (collinear only — not corner / T joints). */
export function archWallAndOpeningEdgesMeet(
  w: Pick<PlacedGridEdge, 'axis' | 'i' | 'j'>,
  o: Pick<PlacedGridEdge, 'axis' | 'i' | 'j'>,
): boolean {
  return w.axis === o.axis && edgeKeyString(w) === edgeKeyString(o)
}

/** Geometry keys of arch wall edges that share a segment with a window/door/doorSwing (same grid edge only). */
export function planArchWallEdgeKeysOverlappedByOpenings(edges: readonly PlacedGridEdge[]): Set<string> {
  const openings = edges.filter(
    (e) =>
      (e.source ?? 'arch') === 'arch' &&
      (e.kind === 'window' || e.kind === 'door' || e.kind === 'doorSwing'),
  )
  const out = new Set<string>()
  for (const w of edges) {
    if ((w.source ?? 'arch') !== 'arch' || w.kind !== 'wall') continue
    if (openings.some((o) => archWallAndOpeningEdgesMeet(w, o))) {
      out.add(edgeKeyString(w))
    }
  }
  return out
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

/** Finer grid (plan inches) for hand-drawn connection-detail layouts vs typical floor layout (e.g. 12). */
export const CONNECTION_DETAIL_GRID_SPACING_IN = 1 as const
export const CONNECTION_DETAIL_DEFAULT_SITE_IN = 48 as const
/** Padded margin around the junction on connection-detail sheets, in detail-grid cell counts per edge. */
export const CONNECTION_DETAIL_DEFAULT_BOUNDARY_CELLS = 2 as const

export function resolvedConnectionDetailGridSpacingIn(sketch: PlanLayoutSketch): number {
  const g = sketch.connectionDetailGridSpacingIn
  return g != null && Number.isFinite(g) && g > 0 ? g : CONNECTION_DETAIL_GRID_SPACING_IN
}

export function resolvedConnectionDetailBoundaryCells(sketch: PlanLayoutSketch): number {
  const b = sketch.connectionDetailBoundaryCells
  if (b != null && Number.isFinite(b)) {
    const r = Math.round(b)
    if (r >= 0 && r <= 48) return r
  }
  return CONNECTION_DETAIL_DEFAULT_BOUNDARY_CELLS
}

/** True if a connection-detail sketch has anything that would be invalidated by changing detail grid spacing. */
export function connectionDetailSketchHasContent(s: PlanLayoutSketch): boolean {
  if ((s.edges?.length ?? 0) > 0) return true
  if ((s.cells?.length ?? 0) > 0) return true
  if ((s.measureRuns?.length ?? 0) > 0) return true
  if ((s.annotationGridRuns?.length ?? 0) > 0) return true
  if ((s.annotationLabels?.length ?? 0) > 0) return true
  if ((s.annotationSectionCuts?.length ?? 0) > 0) return true
  if ((s.mepDevices?.length ?? 0) > 0) return true
  if ((s.columns?.length ?? 0) > 0) return true
  if (s.roomBoundaryEdges && s.roomBoundaryEdges.length > 0) return true
  if (s.roomByCell && Object.keys(s.roomByCell).length > 0) return true
  if (s.traceOverlay) return true
  if (s.connectionDetailStripLayerFlips && Object.keys(s.connectionDetailStripLayerFlips).length > 0)
    return true
  if (s.planArchEdgeLayerFlipped && Object.keys(s.planArchEdgeLayerFlipped).length > 0) return true
  if (s.connectionDetailLayerFillByCell && Object.keys(s.connectionDetailLayerFillByCell).length > 0)
    return true
  return false
}

export function emptyConnectionDetailSketch(): PlanLayoutSketch {
  return {
    ...emptySketch(CONNECTION_DETAIL_GRID_SPACING_IN),
    siteWidthIn: CONNECTION_DETAIL_DEFAULT_SITE_IN,
    siteDepthIn: CONNECTION_DETAIL_DEFAULT_SITE_IN,
  }
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

/** Axis-aligned footprint of a square column in plan inches (includes optional plan offsets from grid center). */
export function planColumnBoundsIn(c: PlacedPlanColumn): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const h = Math.max(0, c.sizeIn) / 2
  const ox = c.offsetXPlanIn ?? 0
  const oy = c.offsetYPlanIn ?? 0
  const cx = c.cxIn + ox
  const cy = c.cyIn + oy
  return {
    minX: cx - h,
    minY: cy - h,
    maxX: cx + h,
    maxY: cy + h,
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

/** Stable key for a placed MEP device (mep + systemId + id). */
export function placedMepDeviceKey(d: PlacedMepDevice): string {
  return `mep\t${d.systemId}\t${d.id}`
}

/** Whether a placed device has real rectangular dimensions (not a circle fallback). */
export function mepDeviceHasRealDims(d: PlacedMepDevice): boolean {
  return (d.lengthIn ?? 0) > 0 && (d.widthIn ?? 0) > 0
}

/** Axis-aligned footprint of an MEP device in plan inches. */
export function mepDeviceBoundsIn(d: PlacedMepDevice): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (mepDeviceHasRealDims(d)) {
    const hl = d.lengthIn! / 2
    const hw = d.widthIn! / 2
    return {
      minX: d.cxIn - hl,
      minY: d.cyIn - hw,
      maxX: d.cxIn + hl,
      maxY: d.cyIn + hw,
    }
  }
  const h = Math.max(0, d.sizeIn) / 2
  return {
    minX: d.cxIn - h,
    minY: d.cyIn - h,
    maxX: d.cxIn + h,
    maxY: d.cyIn + h,
  }
}

export function mepDeviceIntersectsPlanRect(
  d: PlacedMepDevice,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const b = mepDeviceBoundsIn(d)
  return !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY)
}

export function planPointInsideMepDeviceFootprint(
  d: PlacedMepDevice,
  xIn: number,
  yIn: number,
): boolean {
  const b = mepDeviceBoundsIn(d)
  return xIn >= b.minX && xIn <= b.maxX && yIn >= b.minY && yIn <= b.maxY
}

/** Unique id for a placed edge (layer + grid segment). */
export function placedEdgeKey(e: PlacedGridEdge): string {
  return `${layerIdentityFromEdge(e)}\t${edgeKeyString(e)}`
}

/** Persisted assembly flip: disambiguates wall vs window vs door vs roof vs stairs on the same grid segment. */
export function planArchAssemblyFlipEdgeKey(e: PlacedGridEdge): string {
  return `${placedEdgeKey(e)}\t${e.kind ?? 'wall'}`
}

export function openGhostPlanArchAssemblyFlipStorageKey(e: PlacedGridEdge): string {
  return `open-ghost-${planArchAssemblyFlipEdgeKey(e)}`
}

/**
 * Whether assembly stack is reversed for this edge, including legacy map entries (pre–per-kind keys).
 */
export function planArchAssemblyLayerOrderFlipped(
  flipMap: Record<string, true> | undefined,
  edge: PlacedGridEdge,
  variant: 'edge' | 'openGhost',
): boolean {
  const m = flipMap ?? {}
  if (variant === 'openGhost') {
    const nk = openGhostPlanArchAssemblyFlipStorageKey(edge)
    if (m[nk]) return true
    return Boolean(m[`open-ghost-${placedEdgeKey(edge)}`])
  }
  const nk = planArchAssemblyFlipEdgeKey(edge)
  if (m[nk]) return true
  const lk = placedEdgeKey(edge)
  if ((edge.kind ?? 'wall') === 'wall' && m[lk]) return true
  return false
}

/** Normalize cell paint kind for keys and filters. */
export function cellPaintKind(c: Pick<PlacedFloorCell, 'cellKind'>): 'floor' | 'stairs' | 'roof' {
  if (c.cellKind === 'stairs') return 'stairs'
  if (c.cellKind === 'roof') return 'roof'
  return 'floor'
}

/** Arch catalog grid fills use merge rules in `mergePaintStrokeIntoCells` / this normalizer. */
export function isExclusiveArchFloorPaintCell(c: Pick<PlacedFloorCell, 'source'>): boolean {
  return c.source === 'arch'
}

/**
 * Collapse duplicate arch fills per slot: stairs occupy one slot per grid square (replaces floor/roof there);
 * floor and roof each have a separate slot per square so both can coexist.
 */
export function normalizeExclusiveArchFloorPaintCells(cells: PlacedFloorCell[]): PlacedFloorCell[] {
  const nonArch: PlacedFloorCell[] = []
  const archBySlot = new Map<string, PlacedFloorCell>()
  for (const c of cells) {
    if (!isExclusiveArchFloorPaintCell(c)) {
      nonArch.push(c)
      continue
    }
    const g = cellKeyString(c)
    const pk = cellPaintKind(c)
    const slotKey = pk === 'stairs' ? `s:${g}` : `a:${g}:${pk}`
    archBySlot.set(slotKey, c)
  }
  return [...nonArch, ...archBySlot.values()]
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
