import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BuildingDimensions, SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import type {
  PlanLayoutSketch,
  PlacedGridEdge,
  PlacedFloorCell,
  PlacedPlanColumn,
  EdgeStrokeKind,
  GridEdgeKey,
  PlanMeasureGridRun,
  PlanSketchCommitOptions,
} from '../types/planLayout'
import {
  edgeKeyString,
  cellKeyString,
  cellPaintKind,
  cellsByGeometry,
  isExclusiveArchFloorPaintCell,
  layerIdentityFromCell,
  layerIdentityFromColumn,
  layerIdentityFromEdge,
  normalizeExclusiveArchFloorPaintCells,
  placedCellKey,
  placedColumnKey,
  placedEdgeKey,
  parsePlacedCellKey,
  planColumnIntersectsPlanRect,
  planPointInsideColumnFootprint,
  resolvedSiteInches,
  parseEdgeKeyString,
} from '../types/planLayout'
import { clientToSvgPoint, planInchesToCanvasPx } from '../lib/planCoordinates'
import {
  formatSiteMeasure,
  formatPlanAreaFromSqIn,
  PLAN_SITE_UNIT_SHORT,
  type PlanSiteDisplayUnit,
} from '../lib/planDisplayUnits'
import {
  gridCounts,
  nearestGridEdge,
  edgesInNodeSpan,
  nodeUnderCursor,
  edgeEndpointsCanvasPx,
  planInchesToCell,
  closerNodeOnEdge,
  manhattanWallPathEdges,
  gridEdgeIntersectsPlanRect,
  cellsIntersectingPlanRect,
  rectangularFrameEdges,
  snapPlanInchesToGridNode,
} from '../lib/gridEdges'
import {
  planEnclosureBarrierKeys,
  computeEnclosedRoomComponents,
  findRoomComponentForCellKey,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
} from '../lib/planRooms'
import { formatThickness } from '../lib/csvParser'
import {
  planCellFill,
  planEdgeStroke,
  planEdgeStrokeDasharray,
  planPaintSwatchColor,
  type PlanColorCatalog,
  type PlanPlaceMode,
} from '../lib/planLayerColors'
import { planColumnSquareInchesFromSystem } from '../lib/planColumnSize'
import { PLAN_ROOMS_LAYER_ID, PLAN_ROOMS_LAYER_SYSTEM_ID } from '../lib/planRoomsLayerIdentity'

export type LayoutTool = 'paint' | 'rect' | 'erase' | 'select'
export type ActiveCatalog = 'arch' | 'mep'
export type FloorTool = 'paint' | 'fill' | 'erase' | 'select'
export type MeasureTool = 'line' | 'erase'
/** Room layer: Line / Rect / Erase / Select like walls; Fill applies the room name to a bounded zone. */
export type RoomTool = 'paint' | 'rect' | 'erase' | 'select' | 'fill' | 'autoFill'

export type { PlanPlaceMode }

interface PlanLayoutEditorProps {
  buildingDimensions: BuildingDimensions
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  activeCatalog: ActiveCatalog
  activeSystemId: string
  placeMode: PlanPlaceMode
  /** Room layer: Fill tool applies this name to the clicked bounded zone. */
  roomNameDraft: string
  roomTool: RoomTool
  structureTool: LayoutTool
  floorTool: FloorTool
  /** Measure layer only: draw dimension runs vs click a segment to remove a run. */
  measureTool?: MeasureTool
  mepItems: MepItem[]
  /** Arch catalog systems (for column footprint size from layer thickness). */
  orderedSystems: readonly SystemData[]
  /** Maps each catalog system id to a well-separated hue on the plan. */
  planColorCatalog: PlanColorCatalog
  /** Site dimension unit from Setup — used to label measure tool distances. */
  planSiteDisplayUnit: PlanSiteDisplayUnit
  pickTolerancePx?: number
  /** Reference image (plan inches space); drawn above floor, grid, and wall edges — pointer-events none so drawing still hits the grid. */
  traceOverlay?: {
    href: string
    visible: boolean
    opacity: number
    tx?: number
    ty?: number
    rotateDeg?: number
    scale?: number
  } | null
  /** When true, line/floor painting and selection are disabled (e.g. overlay transform UI is active). */
  suspendPlanPainting?: boolean
  /** Layers bar hover: `source\\tsystemId` — highlights that layer on the plan. */
  layersBarHoverLayerId?: string | null
  /** Increment `nonce` to select all edges/cells for this layer (parent sets active catalog + system + tools/mode). */
  layersBarSelectRequest?: { source: ActiveCatalog; systemId: string; nonce: number } | null
  /** Room Select: highlighted zone cell keys; click fill picks a zone and calls `onRoomZoneSelect`. */
  selectedRoomZoneCellKeys?: readonly string[] | null
  /** Room Select: pick or clear the named zone (parent syncs toolbar name + applies on blur). */
  onRoomZoneSelect?: (payload: { cellKeys: readonly string[]; displayName: string } | null) => void
  className?: string
}

const EMPTY_MEASURE_RUNS: PlanMeasureGridRun[] = []

const ZOOM_MIN = 0.15
const ZOOM_MAX = 6
/** Multiplicative step for +/- buttons (≈16% per click). */
const ZOOM_BUTTON_RATIO = 1.16
/** Trackpad / Ctrl+wheel sensitivity (higher = faster zoom). */
const ZOOM_WHEEL_SENS = 0.0032

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

type ZoomAnchorCommit = {
  z0: number
  ux: number
  uy: number
  brBefore: DOMRectReadOnly
  scrollBefore: { l: number; t: number }
}

const GRID_TRIM = 0.5
/** Below this size (SVG px), marquee release = single edge/cell erase (click). */
const MARQUEE_CLICK_MAX_PX = 5
/** Plan inches — below this drag distance, edge/cell move counts as a click (toggle / deselect). */
const MOVE_CLICK_MAX_PLAN_IN = (deltaIn: number) => Math.max(deltaIn * 0.12, 0.25)

/** Stroke kind for the current toolbar category (Walls vs Windows vs …); not a single layer row. */
function planToolbarEdgeKind(placeMode: PlanPlaceMode, activeCatalog: ActiveCatalog): EdgeStrokeKind {
  if (placeMode === 'window') return 'window'
  if (placeMode === 'door') return 'door'
  if (placeMode === 'roof') return 'roof'
  if (placeMode === 'mep') return 'run'
  return activeCatalog === 'mep' ? 'run' : 'wall'
}

function clampEdgeMoveDelta(
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

function clampRoomBoundaryMoveDelta(
  edges: GridEdgeKey[],
  di: number,
  dj: number,
  nx: number,
  ny: number,
): { di: number; dj: number } {
  return clampEdgeMoveDelta(edges as PlacedGridEdge[], di, dj, nx, ny)
}

function clampCellMoveDelta(
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
function pointInSelectedFloorBBox(
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
function mergePaintStrokeIntoCells(base: PlacedFloorCell[], stroke: readonly PlacedFloorCell[]): PlacedFloorCell[] {
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

function clampMarqueeSvgRect(
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

function floorCellInsetDims(
  cellPx: number,
  idx: number,
  n: number,
  cell?: Pick<PlacedFloorCell, 'cellKind'>,
): { inset: number; w: number } {
  // Stairs are authored as full grid squares; when a cell also has floor paint on another layer,
  // skip nesting so the stair fill matches the grid (floor still draws underneath).
  if (cell?.cellKind === 'stairs') return { inset: 0, w: cellPx }
  if (n <= 1) return { inset: 0, w: cellPx }
  const step = Math.min((cellPx * 0.44) / n, cellPx * 0.1)
  const inset = idx * step
  const w = Math.max(cellPx - 2 * inset, cellPx * 0.22)
  return { inset, w }
}

function strokeWidthForEdge(
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
function strokeWidthForRoomBoundaryLine(d: BuildingDimensions): number {
  return Math.max(1.15, Math.min(3.1, 1.85 * d.planScale * 0.12))
}

/** Room boundaries under floor/grid when not in Room mode — faint reference. */
function strokeWidthForRoomBoundaryUnderlay(d: BuildingDimensions): number {
  return Math.max(0.55, Math.min(1.35, 0.88 * d.planScale * 0.055))
}

/** Outer perimeter of a cell union in canvas px (for room-zone selection outline). */
function planRoomZoneOutlineSegments(
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

/** Room mode: dashed bright cyan construction / named-room ring. */
const PLAN_ROOM_BOUNDARY_CYAN = '#00e5ff'
const PLAN_ROOM_BOUNDARY_DASH = '5 5'
/** Other tools: faint dashed reference (not cyan). */
const PLAN_ROOM_BOUNDARY_MUTED_STROKE = 'hsl(220, 10%, 55%)'
const PLAN_ROOM_BOUNDARY_MUTED_DASH = '3.5 4'

const PLAN_ROOM_DETAIL_MONO = "'Courier New', Courier, monospace"

/** Room label as a small title-block style detail (matches section / composite sheet typography). */
function PlanRoomNameDetail({
  cx,
  cy,
  cellPx,
  displayName,
  fallbackIndex,
  areaSqFtLabel,
}: {
  cx: number
  cy: number
  cellPx: number
  displayName: string
  fallbackIndex: number
  /** Pre-formatted area, e.g. "128.5 sq ft" */
  areaSqFtLabel: string
}) {
  const raw = displayName.trim() || `Room ${fallbackIndex}`
  const nameUpper = raw.toUpperCase()
  const pad = Math.max(3, Math.min(9, cellPx * 0.11))
  const areaFs = Math.max(5.5, Math.min(7.5, cellPx * 0.14))
  const nameFs = Math.max(7, Math.min(11.5, cellPx * 0.22))
  const ruleSw = Math.max(0.35, 0.5)
  const charWName = nameFs * 0.56
  const charWArea = areaFs * 0.56
  const maxW = Math.min(cellPx * 16, 300, Math.max(120, cellPx * 8))
  const maxNameChars = Math.max(4, Math.floor((maxW - 2 * pad) / charWName))
  const nameLine =
    nameUpper.length <= maxNameChars
      ? nameUpper
      : `${nameUpper.slice(0, Math.max(1, maxNameChars - 1))}…`
  const maxAreaChars = Math.max(6, Math.floor((maxW - 2 * pad) / charWArea))
  const areaLine =
    areaSqFtLabel.length <= maxAreaChars
      ? areaSqFtLabel
      : `${areaSqFtLabel.slice(0, Math.max(1, maxAreaChars - 1))}…`
  const w = Math.min(
    maxW,
    Math.max(
      cellPx * 3.2,
      nameLine.length * charWName + 2 * pad,
      areaLine.length * charWArea + 2 * pad,
    ),
  )
  const nameBlock = nameFs + 3
  const areaBlock = areaFs + 3
  const h = pad + nameBlock + areaBlock + pad
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  const ruleY = y0 + pad + nameBlock - 1
  const nameBaseline = y0 + pad + nameFs * 0.88
  const areaBaseline = y0 + pad + nameBlock + areaFs * 0.88

  return (
    <g fontFamily={PLAN_ROOM_DETAIL_MONO} pointerEvents="none" aria-hidden>
      <rect x={x0} y={y0} width={w} height={h} fill="white" stroke="black" strokeWidth={ruleSw} />
      <line
        x1={x0 + pad}
        y1={ruleY}
        x2={x0 + w - pad}
        y2={ruleY}
        stroke="black"
        strokeWidth={ruleSw * 0.9}
      />
      <text
        x={cx}
        y={nameBaseline}
        textAnchor="middle"
        fontSize={nameFs}
        fontWeight="bold"
        fill="black"
        letterSpacing={0.55}
      >
        {nameLine}
      </text>
      <text
        x={cx}
        y={areaBaseline}
        textAnchor="middle"
        fontSize={areaFs}
        fill="#475569"
        letterSpacing={0.35}
      >
        {areaLine}
      </text>
    </g>
  )
}

function gridRunMeasureCaption(
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

/** Center of preview path in canvas px — for floating length label while dragging. */
function previewPathCentroidCanvas(
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

/** Grid-snapped run with dimension ticks at ends and label near path. */
function GridPathDimensionOverlay({
  d,
  delta,
  edgeKeys,
  startNode,
  endNode,
  primary,
  sub,
  dashed,
}: {
  d: BuildingDimensions
  delta: number
  edgeKeys: string[]
  startNode: { i: number; j: number }
  endNode: { i: number; j: number }
  primary: string
  sub: string
  dashed?: boolean
}) {
  const stroke = dashed ? '#1d4ed8' : '#0f172a'
  const subFill = dashed ? '#1e40af' : '#475569'
  const dash = dashed ? '5 4' : undefined
  let sx = 0
  let sy = 0
  let n = 0
  const lines = edgeKeys.map((ks) => {
    const parsed = parseEdgeKeyString(ks)
    if (!parsed) return null
    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
    sx += (x1 + x2) / 2
    sy += (y1 + y2) / 2
    n += 1
    return (
      <line
        key={`md-${ks}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={dashed ? 2.25 : 2.75}
        strokeLinecap="square"
        strokeDasharray={dash}
      />
    )
  })
  const mx = n > 0 ? sx / n : 0
  const my = n > 0 ? sy / n : 0
  const ps = planInchesToCanvasPx(d, startNode.i * delta, startNode.j * delta)
  const pe = planInchesToCanvasPx(d, endNode.i * delta, endNode.j * delta)
  const tk = 6.5
  return (
    <g pointerEvents="none">
      {lines}
      <line
        x1={ps.x - tk}
        y1={ps.y - tk}
        x2={ps.x + tk}
        y2={ps.y + tk}
        stroke={stroke}
        strokeWidth={1.15}
        strokeLinecap="square"
      />
      <line
        x1={pe.x - tk}
        y1={pe.y - tk}
        x2={pe.x + tk}
        y2={pe.y + tk}
        stroke={stroke}
        strokeWidth={1.15}
        strokeLinecap="square"
      />
      <text
        x={mx}
        y={my - 6}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={stroke}
        stroke="#fff"
        strokeWidth={2.5}
        paintOrder="stroke fill"
        style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 11 }}
      >
        {primary}
      </text>
      <text
        x={mx}
        y={my + 8}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={subFill}
        stroke="#fff"
        strokeWidth={2}
        paintOrder="stroke fill"
        style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 9 }}
      >
        {sub}
      </text>
    </g>
  )
}

export function PlanLayoutEditor({
  buildingDimensions: d,
  sketch,
  onSketchChange,
  activeCatalog,
  activeSystemId,
  placeMode,
  roomNameDraft,
  roomTool,
  structureTool,
  floorTool,
  measureTool = 'line',
  mepItems,
  orderedSystems,
  planColorCatalog,
  planSiteDisplayUnit,
  pickTolerancePx = 14,
  traceOverlay = null,
  suspendPlanPainting = false,
  layersBarHoverLayerId = null,
  layersBarSelectRequest = null,
  selectedRoomZoneCellKeys = null,
  onRoomZoneSelect,
  className,
}: PlanLayoutEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const planBoxRef = useRef<HTMLDivElement>(null)
  const zoomCommitRef = useRef<ZoomAnchorCommit | null>(null)
  const paintDragRef = useRef(false)
  const lastStrokeEdgeKeyRef = useRef<string | null>(null)
  const lastStrokeCellKeyRef = useRef<string | null>(null)
  const lastWallNodeRef = useRef<{ i: number; j: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [hoverCell, setHoverCell] = useState<{ i: number; j: number } | null>(null)
  /** Column paint: snapped footprint under cursor (same style family as wall-line dashed preview). */
  const [columnPaintPreview, setColumnPaintPreview] = useState<{
    cxIn: number
    cyIn: number
    sizeIn: number
  } | null>(null)
  /** Ephemeral floor/stair cells while dragging Paint — committed once on pointer up (keeps parent sketch updates off the hot path). */
  const [floorStrokeOverlay, setFloorStrokeOverlay] = useState<PlacedFloorCell[] | null>(null)
  const [wallLinePreviewKeys, setWallLinePreviewKeys] = useState<string[] | null>(null)
  const [eraseMarqueeSvg, setEraseMarqueeSvg] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [marqueeTone, setMarqueeTone] = useState<'erase' | 'select' | 'rect' | null>(null)
  const [selectedEdgeKeys, setSelectedEdgeKeys] = useState<Set<string>>(() => new Set())
  /** Room boundary selection — geometry keys `h:i:j` / `v:i:j`. */
  const [selectedRoomEdgeKeys, setSelectedRoomEdgeKeys] = useState<Set<string>>(() => new Set())
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(() => new Set())
  const [movePreview, setMovePreview] = useState<{ di: number; dj: number } | null>(null)
  const measureRunIdRef = useRef(0)
  const measureRuns = sketch.measureRuns?.length ? sketch.measureRuns : EMPTY_MEASURE_RUNS
  /** Live measure drag endpoints (grid nodes) for preview label — mirrors wall-line snap. */
  const [measurePreviewNodes, setMeasurePreviewNodes] = useState<{
    start: { i: number; j: number }
    end: { i: number; j: number }
  } | null>(null)
  /** Shift+chain erase drag — preview stroke uses erase coloring. */
  const [chainLineErasePreview, setChainLineErasePreview] = useState(false)
  const movePreviewDiDjRef = useRef({ di: 0, dj: 0 })
  const moveDragStartPinRef = useRef<{ xIn: number; yIn: number } | null>(null)
  const moveEdgesSnapshotRef = useRef<PlacedGridEdge[] | null>(null)
  const moveRoomEdgesSnapshotRef = useRef<GridEdgeKey[] | null>(null)
  const moveCellsSnapshotRef = useRef<PlacedFloorCell[] | null>(null)
  const moveHitEdgeKeyRef = useRef<string | null>(null)
  const moveHitCellKeyRef = useRef<string | null>(null)
  const wallLineDragStartRef = useRef<{ i: number; j: number } | null>(null)
  const dragKindRef = useRef<
    | 'wall-line'
    | 'chain-line'
    | 'measure-line'
    | 'wall-rect'
    | 'marquee'
    | 'floor-line'
    | 'floor-marquee'
    | 'column-marquee'
    | 'select-marquee'
    | 'floor-select-marquee'
    | 'move-edges'
    | 'move-cells'
    | 'room-line'
    | 'room-chain-line'
    | 'room-rect'
    | 'room-marquee'
    | 'room-select-marquee'
    | 'room-move-edges'
    | null
  >(null)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Last pointer position (for Shift chain preview when key is pressed before the next move). */
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const floorToolRef = useRef(floorTool)
  floorToolRef.current = floorTool

  const sketchRef = useRef(sketch)
  sketchRef.current = sketch
  const floorStrokeAccumRef = useRef<PlacedFloorCell[]>([])
  const floorStrokeRafRef = useRef<number | null>(null)

  const measureToolActive = placeMode === 'measure'

  const applyZoom = useCallback((targetZoom: number, anchor?: { clientX: number; clientY: number }) => {
    setZoom((z0) => {
      const z1 = clampZoom(targetZoom)
      if (Math.abs(z1 - z0) < 1e-9) {
        zoomCommitRef.current = null
        return z0
      }
      const scroll = scrollRef.current
      const box = planBoxRef.current
      if (scroll && box && anchor) {
        const br = box.getBoundingClientRect()
        const relX = anchor.clientX - br.left
        const relY = anchor.clientY - br.top
        zoomCommitRef.current = {
          z0,
          ux: relX / z0,
          uy: relY / z0,
          brBefore: br,
          scrollBefore: { l: scroll.scrollLeft, t: scroll.scrollTop },
        }
      } else {
        zoomCommitRef.current = null
      }
      return z1
    })
  }, [])

  const applyZoomRef = useRef(applyZoom)
  applyZoomRef.current = applyZoom

  useLayoutEffect(() => {
    const c = zoomCommitRef.current
    if (!c) return
    zoomCommitRef.current = null
    const scroll = scrollRef.current
    const box = planBoxRef.current
    if (!scroll || !box) return
    const brAfter = box.getBoundingClientRect()
    scroll.scrollLeft = c.scrollBefore.l + c.ux * (zoom - c.z0) + (c.brBefore.left - brAfter.left)
    scroll.scrollTop = c.scrollBefore.t + c.uy * (zoom - c.z0) + (c.brBefore.top - brAfter.top)
  }, [zoom])

  useEffect(() => {
    if (structureTool !== 'select') setSelectedEdgeKeys(new Set())
  }, [structureTool])

  useEffect(() => {
    if (placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'room' || placeMode === 'column')
      setSelectedEdgeKeys(new Set())
  }, [placeMode])

  useEffect(() => {
    if (
      placeMode !== 'column' ||
      floorTool !== 'paint' ||
      activeCatalog !== 'arch' ||
      suspendPlanPainting ||
      measureToolActive
    ) {
      setColumnPaintPreview(null)
    }
  }, [placeMode, floorTool, activeCatalog, suspendPlanPainting, measureToolActive])

  useEffect(() => {
    if (placeMode !== 'column' || floorTool !== 'paint' || activeCatalog !== 'arch') return
    const sys = orderedSystems.find((s) => s.id === activeSystemId)
    const sizeIn = planColumnSquareInchesFromSystem(sys)
    setColumnPaintPreview((p) => {
      if (!p) return p
      return Math.abs(p.sizeIn - sizeIn) > 1e-9 ? { ...p, sizeIn } : p
    })
  }, [activeSystemId, orderedSystems, placeMode, floorTool, activeCatalog])

  useEffect(() => {
    if (floorTool !== 'select') setSelectedCellKeys(new Set())
  }, [floorTool])

  useEffect(() => {
    if (roomTool !== 'select') setSelectedRoomEdgeKeys(new Set())
  }, [roomTool])

  useEffect(() => {
    if (placeMode !== 'room') setSelectedRoomEdgeKeys(new Set())
  }, [placeMode])

  const lastLayersBarSelectNonce = useRef(0)
  useEffect(() => {
    const req = layersBarSelectRequest
    if (!req?.systemId || req.nonce < 1) return
    if (req.nonce === lastLayersBarSelectNonce.current) return
    lastLayersBarSelectNonce.current = req.nonce
    if (req.systemId === PLAN_ROOMS_LAYER_SYSTEM_ID) {
      setSelectedEdgeKeys(new Set())
      setSelectedCellKeys(new Set())
      const rb = sketch.roomBoundaryEdges ?? []
      setSelectedRoomEdgeKeys(new Set(rb.map((e) => edgeKeyString(e))))
      return
    }
    const lid = `${req.source}\t${req.systemId}`
    const edgeKeys = sketch.edges.filter((e) => layerIdentityFromEdge(e) === lid).map(placedEdgeKey)
    const cellKeys = (sketch.cells ?? []).filter((c) => layerIdentityFromCell(c) === lid).map(placedCellKey)
    setSelectedEdgeKeys(new Set(edgeKeys))
    setSelectedCellKeys(new Set(cellKeys))
    setSelectedRoomEdgeKeys(new Set())
  }, [layersBarSelectRequest, sketch.edges, sketch.cells, sketch.roomBoundaryEdges])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const z0 = zoomRef.current
      const next = clampZoom(z0 * Math.exp(-e.deltaY * ZOOM_WHEEL_SENS))
      applyZoomRef.current(next, { clientX: e.clientX, clientY: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const endPaintStroke = useCallback(
    (commitFloorStroke = true) => {
      const dk = dragKindRef.current
      if (dk === 'floor-line') {
        if (floorStrokeRafRef.current != null) {
          cancelAnimationFrame(floorStrokeRafRef.current)
          floorStrokeRafRef.current = null
        }
        const stroke = floorStrokeAccumRef.current
        if (commitFloorStroke && stroke.length > 0) {
          const s = sketchRef.current
          const nextCells = mergePaintStrokeIntoCells(s.cells ?? [], stroke)
          floorStrokeAccumRef.current = []
          setFloorStrokeOverlay(null)
          onSketchChange({ ...s, cells: nextCells })
        } else {
          floorStrokeAccumRef.current = []
          setFloorStrokeOverlay(null)
        }
      }
      paintDragRef.current = false
      lastStrokeEdgeKeyRef.current = null
      lastStrokeCellKeyRef.current = null
      wallLineDragStartRef.current = null
      dragKindRef.current = null
      marqueeStartRef.current = null
      marqueeRectRef.current = null
      setWallLinePreviewKeys(null)
      setEraseMarqueeSvg(null)
      setMarqueeTone(null)
      moveDragStartPinRef.current = null
      moveEdgesSnapshotRef.current = null
      moveRoomEdgesSnapshotRef.current = null
      moveCellsSnapshotRef.current = null
      moveHitEdgeKeyRef.current = null
      moveHitCellKeyRef.current = null
      movePreviewDiDjRef.current = { di: 0, dj: 0 }
      setMovePreview(null)
      setMeasurePreviewNodes(null)
      setChainLineErasePreview(false)
    },
    [onSketchChange],
  )

  const placementKind = useCallback(
    (): EdgeStrokeKind => planToolbarEdgeKind(placeMode, activeCatalog),
    [placeMode, activeCatalog],
  )

  const isEdgeLayerMode =
    placeMode !== 'floor' &&
    placeMode !== 'stairs' &&
    placeMode !== 'column' &&
    placeMode !== 'measure' &&
    placeMode !== 'room'
  const isRoomBoundaryEdgeMode =
    placeMode === 'room' && roomTool !== 'fill' && roomTool !== 'autoFill'
  const edgePlacementSource = useMemo<ActiveCatalog>(
    () =>
      placeMode === 'window' || placeMode === 'door' || placeMode === 'roof'
        ? 'arch'
        : placeMode === 'mep'
          ? 'mep'
          : activeCatalog,
    [placeMode, activeCatalog],
  )

  const { w: siteWIn, h: siteHIn } = useMemo(() => resolvedSiteInches(sketch, d), [sketch, d])
  const cw = siteWIn * d.planScale
  const ch = siteHIn * d.planScale
  const delta = sketch.gridSpacingIn
  /** Grid counts for the full lot — walls and floor use this same grid. */
  const { nx: siteNx, ny: siteNy } = useMemo(() => gridCounts(siteWIn, siteHIn, delta), [siteWIn, siteHIn, delta])

  const mepById = useMemo(() => new Map(mepItems.map((m) => [m.id, m])), [mepItems])
  const activeLayerId = useMemo(() => `${activeCatalog}\t${activeSystemId}`, [activeCatalog, activeSystemId])
  const activeCellPaintKind: 'floor' | 'stairs' = placeMode === 'stairs' ? 'stairs' : 'floor'
  const isCellPaintMode = placeMode === 'floor' || placeMode === 'stairs'

  const displayCells = useMemo(() => {
    const base = sketch.cells ?? []
    if (!floorStrokeOverlay?.length) return base
    return mergePaintStrokeIntoCells(base, floorStrokeOverlay)
  }, [sketch.cells, floorStrokeOverlay])

  const cellsGeomMap = useMemo(() => cellsByGeometry(displayCells), [displayCells])

  const displayColumnsSorted = useMemo(() => {
    const list = sketch.columns ?? []
    return [...list].sort((a, b) => placedColumnKey(a).localeCompare(placedColumnKey(b)))
  }, [sketch.columns])
  const edgeByPlaced = useMemo(() => {
    const m = new Map<string, PlacedGridEdge>()
    for (const e of sketch.edges) m.set(placedEdgeKey(e), e)
    return m
  }, [sketch.edges])
  const cellByPlaced = useMemo(() => {
    const m = new Map<string, PlacedFloorCell>()
    for (const c of sketch.cells ?? []) m.set(placedCellKey(c), c)
    return m
  }, [sketch.cells])

  const roomBarrierKeys = useMemo(
    () => planEnclosureBarrierKeys(sketch.roomBoundaryEdges, sketch.edges),
    [sketch.roomBoundaryEdges, sketch.edges],
  )
  const { exteriorCells, rooms: enclosedRooms } = useMemo(
    () => computeEnclosedRoomComponents(siteNx, siteNy, roomBarrierKeys),
    [siteNx, siteNy, roomBarrierKeys],
  )

  useEffect(() => {
    if (placeMode !== 'room' || roomTool !== 'select') {
      onRoomZoneSelect?.(null)
    }
  }, [placeMode, roomTool, onRoomZoneSelect])

  useEffect(() => {
    if (!selectedRoomZoneCellKeys?.length || !onRoomZoneSelect) return
    const comp = findRoomComponentForCellKey(enclosedRooms, selectedRoomZoneCellKeys[0]!)
    const keysMatch =
      comp &&
      comp.cellKeys.length === selectedRoomZoneCellKeys.length &&
      selectedRoomZoneCellKeys.every((k) => comp.cellKeys.includes(k))
    if (!keysMatch) onRoomZoneSelect(null)
  }, [enclosedRooms, selectedRoomZoneCellKeys, onRoomZoneSelect])

  const maxDistIn = useMemo(() => {
    const pxToIn = 1 / Math.max(d.planScale, 1e-6)
    return pickTolerancePx * pxToIn / Math.max(zoom, 0.25)
  }, [d.planScale, pickTolerancePx, zoom])

  const cellPx = delta * d.planScale

  /** SVG paint order: thicker strokes first (under), thinner last (on top). Room boundaries merge here only while Room mode is active (otherwise drawn as thin underlay under floor/grid). */
  const planLinesPaintOrder = useMemo(() => {
    type Item = { k: 'placed'; e: PlacedGridEdge } | { k: 'roomBd'; e: GridEdgeKey }
    type PlacedItem = { k: 'placed'; e: PlacedGridEdge }
    const placedItems: PlacedItem[] = sketch.edges.map((e) => ({ k: 'placed' as const, e }))
    const sortPlaced = (items: PlacedItem[]) =>
      [...items].sort((a, b) => {
        const swA = strokeWidthForEdge(d, a.e, mepById)
        const swB = strokeWidthForEdge(d, b.e, mepById)
        const cmp = swB - swA
        if (cmp !== 0) return cmp
        return placedEdgeKey(a.e).localeCompare(placedEdgeKey(b.e))
      })
    if (placeMode !== 'room') {
      return sortPlaced(placedItems) as Item[]
    }
    const items: Item[] = [
      ...placedItems,
      ...(sketch.roomBoundaryEdges ?? []).map((e) => ({ k: 'roomBd' as const, e })),
    ]
    items.sort((a, b) => {
      const swA = a.k === 'placed' ? strokeWidthForEdge(d, a.e, mepById) : strokeWidthForRoomBoundaryLine(d)
      const swB = b.k === 'placed' ? strokeWidthForEdge(d, b.e, mepById) : strokeWidthForRoomBoundaryLine(d)
      const cmp = swB - swA
      if (cmp !== 0) return cmp
      const keyA = a.k === 'placed' ? placedEdgeKey(a.e) : `room-bd-${edgeKeyString(a.e)}`
      const keyB = b.k === 'placed' ? placedEdgeKey(b.e) : `room-bd-${edgeKeyString(b.e)}`
      return keyA.localeCompare(keyB)
    })
    return items
  }, [sketch.edges, sketch.roomBoundaryEdges, d, mepById, placeMode])

  const layersBarHoverEdges = useMemo(() => {
    if (!layersBarHoverLayerId) return [] as PlacedGridEdge[]
    const list = sketch.edges.filter((e) => layerIdentityFromEdge(e) === layersBarHoverLayerId)
    return [...list].sort((a, b) => {
      const cmp = strokeWidthForEdge(d, b, mepById) - strokeWidthForEdge(d, a, mepById)
      return cmp !== 0 ? cmp : placedEdgeKey(a).localeCompare(placedEdgeKey(b))
    })
  }, [sketch.edges, layersBarHoverLayerId, d, mepById])

  const layersBarHoverCells = useMemo(() => {
    if (!layersBarHoverLayerId) return [] as PlacedFloorCell[]
    return (sketch.cells ?? []).filter((c) => layerIdentityFromCell(c) === layersBarHoverLayerId)
  }, [sketch.cells, layersBarHoverLayerId])

  const layersBarHoverColumns = useMemo(() => {
    if (!layersBarHoverLayerId) return [] as PlacedPlanColumn[]
    return (sketch.columns ?? []).filter((c) => layerIdentityFromColumn(c) === layersBarHoverLayerId)
  }, [sketch.columns, layersBarHoverLayerId])

  const layersBarHoverRoomBoundaries = useMemo(() => {
    if (layersBarHoverLayerId !== PLAN_ROOMS_LAYER_ID) return [] as GridEdgeKey[]
    return sketch.roomBoundaryEdges ?? []
  }, [layersBarHoverLayerId, sketch.roomBoundaryEdges])

  const updateEdges = useCallback(
    (mut: (list: PlacedGridEdge[]) => PlacedGridEdge[]) => {
      const next = [...sketch.edges]
      const list = mut(next)
      onSketchChange({ ...sketch, edges: list })
    },
    [sketch, onSketchChange],
  )

  const updateCells = useCallback(
    (mut: (list: PlacedFloorCell[]) => PlacedFloorCell[]) => {
      const next = [...(sketch.cells ?? [])]
      const list = mut(next)
      onSketchChange({ ...sketch, cells: normalizeExclusiveArchFloorPaintCells(list) })
    },
    [sketch, onSketchChange],
  )

  const updateRoomBoundaries = useCallback(
    (mut: (list: GridEdgeKey[]) => GridEdgeKey[]) => {
      const next = [...(sketch.roomBoundaryEdges ?? [])]
      const list = mut(next)
      const dedup = new Map<string, GridEdgeKey>()
      for (const e of list) dedup.set(edgeKeyString(e), e)
      const out = [...dedup.values()]
      onSketchChange({
        ...sketch,
        roomBoundaryEdges: out.length > 0 ? out : undefined,
      })
    },
    [sketch, onSketchChange],
  )

  const applyRoomBoundaryStrokeKeys = useCallback(
    (keys: GridEdgeKey[]) => {
      if (keys.length === 0) return
      const valid = keys.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return
      if (roomTool === 'erase') {
        const rm = new Set(keys.map(edgeKeyString))
        updateRoomBoundaries((list) => list.filter((e) => !rm.has(edgeKeyString(e))))
        return
      }
      updateRoomBoundaries((list) => {
        const m = new Map<string, GridEdgeKey>()
        for (const e of list) m.set(edgeKeyString(e), e)
        for (const k of keys) m.set(edgeKeyString(k), k)
        return [...m.values()]
      })
    },
    [siteNx, siteNy, roomTool, updateRoomBoundaries],
  )

  const assignRoomBoundaryEdge = useCallback(
    (key: GridEdgeKey) => {
      const k = edgeKeyString(key)
      if (roomTool === 'erase') {
        updateRoomBoundaries((list) => list.filter((e) => edgeKeyString(e) !== k))
        return
      }
      updateRoomBoundaries((list) => {
        const m = new Map<string, GridEdgeKey>()
        for (const e of list) m.set(edgeKeyString(e), e)
        m.set(k, key)
        return [...m.values()]
      })
    },
    [roomTool, updateRoomBoundaries],
  )

  const applyNodeChainRoomBoundaries = useCallback(
    (i0: number, j0: number, i1: number, j1: number) => {
      const seg = edgesInNodeSpan(i0, j0, i1, j1)
      if (seg.length === 0) return false
      const valid = seg.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return false
      if (roomTool === 'erase') {
        const keys = new Set(seg.map(edgeKeyString))
        updateRoomBoundaries((list) => list.filter((e) => !keys.has(edgeKeyString(e))))
        return true
      }
      updateRoomBoundaries((list) => {
        const m = new Map<string, GridEdgeKey>()
        for (const e of list) m.set(edgeKeyString(e), e)
        for (const s of seg) m.set(edgeKeyString(s), s)
        return [...m.values()]
      })
      return true
    },
    [siteNx, siteNy, roomTool, updateRoomBoundaries],
  )

  const deleteSelectedItems = useCallback(() => {
    let edges = sketch.edges
    let cells = sketch.cells ?? []
    let nextRoomByCell: Record<string, string> | undefined = sketch.roomByCell
    let changed = false
    if (structureTool === 'select' && selectedEdgeKeys.size > 0) {
      const rm = selectedEdgeKeys
      edges = edges.filter((ed) => !rm.has(placedEdgeKey(ed)))
      setSelectedEdgeKeys(new Set())
      changed = true
    }
    if (floorTool === 'select' && selectedCellKeys.size > 0) {
      const rm = selectedCellKeys
      cells = normalizeExclusiveArchFloorPaintCells(cells.filter((c) => !rm.has(placedCellKey(c))))
      setSelectedCellKeys(new Set())
      changed = true
    }
    let roomBoundaryEdges = sketch.roomBoundaryEdges ?? []
    if (placeMode === 'room' && roomTool === 'select') {
      if (selectedRoomEdgeKeys.size > 0) {
        const rm = selectedRoomEdgeKeys
        roomBoundaryEdges = roomBoundaryEdges.filter((e) => !rm.has(edgeKeyString(e)))
        setSelectedRoomEdgeKeys(new Set())
        changed = true
      } else if (selectedRoomZoneCellKeys && selectedRoomZoneCellKeys.length > 0) {
        const prev = nextRoomByCell ?? {}
        const next = { ...prev }
        for (const k of selectedRoomZoneCellKeys) delete next[k]
        nextRoomByCell = Object.keys(next).length > 0 ? next : undefined
        onRoomZoneSelect?.(null)
        changed = true
      }
    }
    if (changed) {
      onSketchChange({
        ...sketch,
        edges,
        cells,
        roomBoundaryEdges: roomBoundaryEdges.length > 0 ? roomBoundaryEdges : undefined,
        roomByCell: nextRoomByCell,
      })
    }
  }, [
    sketch,
    placeMode,
    structureTool,
    floorTool,
    roomTool,
    selectedEdgeKeys,
    selectedCellKeys,
    selectedRoomEdgeKeys,
    selectedRoomZoneCellKeys,
    onRoomZoneSelect,
    onSketchChange,
  ])

  useEffect(() => {
    const anchorViewportCenter = (): { clientX: number; clientY: number } | undefined => {
      const s = scrollRef.current
      if (!s) return undefined
      const r = s.getBoundingClientRect()
      return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return

      if (e.key === 'Escape') {
        if (measureToolActive) {
          onSketchChange({ ...sketch, measureRuns: [] })
          setMeasurePreviewNodes(null)
          return
        }
        if (paintDragRef.current) {
          endPaintStroke(dragKindRef.current !== 'floor-line')
        }
        setSelectedEdgeKeys(new Set())
        setSelectedCellKeys(new Set())
        setSelectedRoomEdgeKeys(new Set())
        setColumnPaintPreview(null)
        onRoomZoneSelect?.(null)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canDelEdges = structureTool === 'select' && selectedEdgeKeys.size > 0
        const canDelCells = floorTool === 'select' && selectedCellKeys.size > 0
        const canDelRoom =
          placeMode === 'room' &&
          roomTool === 'select' &&
          (selectedRoomEdgeKeys.size > 0 || !!selectedRoomZoneCellKeys?.length)
        if (canDelEdges || canDelCells || canDelRoom) {
          e.preventDefault()
          deleteSelectedItems()
        }
        return
      }

      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        applyZoomRef.current(clampZoom(zoomRef.current * ZOOM_BUTTON_RATIO), anchorViewportCenter())
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        applyZoomRef.current(clampZoom(zoomRef.current / ZOOM_BUTTON_RATIO), anchorViewportCenter())
      } else if (e.key === '0') {
        e.preventDefault()
        zoomCommitRef.current = null
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    deleteSelectedItems,
    endPaintStroke,
    measureToolActive,
    onSketchChange,
    sketch,
    selectedEdgeKeys.size,
    selectedCellKeys.size,
    selectedRoomEdgeKeys.size,
    selectedRoomZoneCellKeys?.length,
    placeMode,
    roomTool,
    structureTool,
    floorTool,
    onRoomZoneSelect,
  ])

  const assignEdge = useCallback(
    (key: { i: number; j: number; axis: 'h' | 'v' }) => {
      const k = edgeKeyString(key)
      const layer = `${edgePlacementSource}\t${activeSystemId}`
      if (structureTool === 'erase') {
        updateEdges((list) =>
          list.filter((e) => !(edgeKeyString(e) === k && layerIdentityFromEdge(e) === activeLayerId)),
        )
        return
      }
      const placed: PlacedGridEdge = {
        ...key,
        systemId: activeSystemId,
        source: edgePlacementSource,
        kind: placementKind(),
      }
      updateEdges((list) => {
        const filtered = list.filter(
          (e) => !(edgeKeyString(e) === k && layerIdentityFromEdge(e) === layer),
        )
        filtered.push(placed)
        return filtered
      })
    },
    [
      structureTool,
      activeSystemId,
      edgePlacementSource,
      placementKind,
      updateEdges,
      activeLayerId,
    ],
  )

  const applyNodeChainWalls = useCallback(
    (i0: number, j0: number, i1: number, j1: number) => {
      const seg = edgesInNodeSpan(i0, j0, i1, j1)
      if (seg.length === 0) return false
      const valid = seg.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return false
      const kind = placementKind()
      const placed: PlacedGridEdge[] = seg.map((k) => ({
        ...k,
        systemId: activeSystemId,
        source: edgePlacementSource,
        kind,
      }))
      updateEdges((list) => {
        let next = [...list]
        for (const p of placed) {
          const ek = edgeKeyString(p)
          const lid = layerIdentityFromEdge(p)
          next = next.filter((e) => !(edgeKeyString(e) === ek && layerIdentityFromEdge(e) === lid))
        }
        next = next.concat(placed)
        return next
      })
      return true
    },
    [siteNx, siteNy, activeSystemId, edgePlacementSource, placementKind, updateEdges],
  )

  const removeNodeChainWalls = useCallback(
    (i0: number, j0: number, i1: number, j1: number) => {
      const seg = edgesInNodeSpan(i0, j0, i1, j1)
      if (seg.length === 0) return false
      const valid = seg.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return false
      const keys = new Set(seg.map((k) => edgeKeyString(k)))
      updateEdges((list) =>
        list.filter((e) => !(keys.has(edgeKeyString(e)) && layerIdentityFromEdge(e) === activeLayerId)),
      )
      return true
    },
    [siteNx, siteNy, updateEdges, activeLayerId],
  )

  const applyWallStrokeKeys = useCallback(
    (keys: GridEdgeKey[]) => {
      if (keys.length === 0) return
      const valid = keys.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return
      if (structureTool === 'erase') {
        const rm = new Set(keys.map(edgeKeyString))
        updateEdges((list) =>
          list.filter(
            (e) => !(rm.has(edgeKeyString(e)) && layerIdentityFromEdge(e) === activeLayerId),
          ),
        )
        return
      }
      const kind = placementKind()
      const placed: PlacedGridEdge[] = keys.map((k) => ({
        ...k,
        systemId: activeSystemId,
        source: edgePlacementSource,
        kind,
      }))
      updateEdges((list) => {
        let next = [...list]
        for (const p of placed) {
          const ek = edgeKeyString(p)
          const lid = layerIdentityFromEdge(p)
          next = next.filter((e) => !(edgeKeyString(e) === ek && layerIdentityFromEdge(e) === lid))
          next.push(p)
        }
        return next
      })
    },
    [
      siteNx,
      siteNy,
      structureTool,
      placementKind,
      activeSystemId,
      edgePlacementSource,
      updateEdges,
      activeLayerId,
    ],
  )

  const pointerToPlanInches = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return null
      const p = clientToSvgPoint(svg, clientX, clientY)
      if (!p) return null
      if (p.x < 0 || p.y < 0 || p.x > cw || p.y > ch) return null
      return { xIn: p.x / d.planScale, yIn: p.y / d.planScale }
    },
    [cw, ch, d.planScale],
  )

  /** Shift chain: preview from last node to cursor (straight run). Returns true if preview is shown. */
  const updateShiftChainHoverPreview = useCallback(
    (clientX: number, clientY: number): boolean => {
      if (paintDragRef.current) return false
      const clear = () => {
        setWallLinePreviewKeys(null)
        setMeasurePreviewNodes(null)
        setChainLineErasePreview(false)
      }
      const shiftChainStructure =
        isEdgeLayerMode && (structureTool === 'paint' || structureTool === 'erase')
      const shiftChainRoom =
        placeMode === 'room' && (roomTool === 'paint' || roomTool === 'erase')
      if (measureToolActive || suspendPlanPainting || (!shiftChainStructure && !shiftChainRoom)) {
        clear()
        return false
      }
      const pin = pointerToPlanInches(clientX, clientY)
      if (!pin) {
        clear()
        return false
      }
      const inside =
        pin.xIn >= 0 && pin.yIn >= 0 && pin.xIn <= siteWIn && pin.yIn <= siteHIn
      if (!inside) {
        clear()
        return false
      }
      const last = lastWallNodeRef.current
      if (!last) {
        clear()
        return false
      }
      const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
      if (!endNode) {
        clear()
        return false
      }
      const keys = edgesInNodeSpan(last.i, last.j, endNode.i, endNode.j)
      const valid =
        keys.length > 0 &&
        keys.every((k) => {
          if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
          return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
        })
      if (valid) {
        setWallLinePreviewKeys(keys.map(edgeKeyString))
        setMeasurePreviewNodes({ start: last, end: endNode })
        setChainLineErasePreview(
          shiftChainStructure ? structureTool === 'erase' : roomTool === 'erase',
        )
        return true
      }
      clear()
      return false
    },
    [
      measureToolActive,
      isEdgeLayerMode,
      placeMode,
      roomTool,
      suspendPlanPainting,
      structureTool,
      pointerToPlanInches,
      siteWIn,
      siteHIn,
      delta,
      siteNx,
      siteNy,
      maxDistIn,
    ],
  )

  useEffect(() => {
    const formTarget = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement

    const onShiftDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Shift' || ev.repeat) return
      if (formTarget(ev.target)) return
      const lc = lastPointerClientRef.current
      if (!lc) return
      requestAnimationFrame(() => {
        updateShiftChainHoverPreview(lc.clientX, lc.clientY)
      })
    }
    const onShiftUp = (ev: KeyboardEvent) => {
      if (ev.key !== 'Shift') return
      if (!paintDragRef.current) {
        setWallLinePreviewKeys(null)
        setMeasurePreviewNodes(null)
        setChainLineErasePreview(false)
      }
    }
    window.addEventListener('keydown', onShiftDown)
    window.addEventListener('keyup', onShiftUp)
    return () => {
      window.removeEventListener('keydown', onShiftDown)
      window.removeEventListener('keyup', onShiftUp)
    }
  }, [updateShiftChainHoverPreview])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      lastPointerClientRef.current = { clientX: e.clientX, clientY: e.clientY }
      if (paintDragRef.current) {
        setColumnPaintPreview(null)
        const dk = dragKindRef.current
        if (
          dk === 'marquee' ||
          dk === 'wall-rect' ||
          dk === 'room-marquee' ||
          dk === 'room-rect' ||
          dk === 'floor-marquee' ||
          dk === 'column-marquee' ||
          dk === 'select-marquee' ||
          dk === 'room-select-marquee' ||
          dk === 'floor-select-marquee'
        ) {
          const svg = svgRef.current
          const start = marqueeStartRef.current
          if (svg && start) {
            const p = clientToSvgPoint(svg, e.clientX, e.clientY)
            if (p) {
              const r = clampMarqueeSvgRect(start.x, start.y, p.x, p.y, cw, ch)
              marqueeRectRef.current = r
              setEraseMarqueeSvg(r)
            }
          }
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }
        if (dk === 'move-edges') {
          const start = moveDragStartPinRef.current
          const snap = moveEdgesSnapshotRef.current
          const pin = pointerToPlanInches(e.clientX, e.clientY)
          if (start && snap && snap.length > 0 && pin) {
            let di = Math.round((pin.xIn - start.xIn) / delta)
            let dj = Math.round((pin.yIn - start.yIn) / delta)
            const c = clampEdgeMoveDelta(snap, di, dj, siteNx, siteNy)
            di = c.di
            dj = c.dj
            movePreviewDiDjRef.current = { di, dj }
            setMovePreview({ di, dj })
          }
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }
        if (dk === 'room-move-edges') {
          const start = moveDragStartPinRef.current
          const snap = moveRoomEdgesSnapshotRef.current
          const pin = pointerToPlanInches(e.clientX, e.clientY)
          if (start && snap && snap.length > 0 && pin) {
            let di = Math.round((pin.xIn - start.xIn) / delta)
            let dj = Math.round((pin.yIn - start.yIn) / delta)
            const c = clampRoomBoundaryMoveDelta(snap, di, dj, siteNx, siteNy)
            di = c.di
            dj = c.dj
            movePreviewDiDjRef.current = { di, dj }
            setMovePreview({ di, dj })
          }
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }
        if (dk === 'move-cells') {
          const start = moveDragStartPinRef.current
          const snap = moveCellsSnapshotRef.current
          const pin = pointerToPlanInches(e.clientX, e.clientY)
          if (start && snap && snap.length > 0 && pin) {
            let di = Math.round((pin.xIn - start.xIn) / delta)
            let dj = Math.round((pin.yIn - start.yIn) / delta)
            const c = clampCellMoveDelta(snap, di, dj, siteNx, siteNy)
            di = c.di
            dj = c.dj
            movePreviewDiDjRef.current = { di, dj }
            setMovePreview({ di, dj })
          }
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }
      }

      const pin = pointerToPlanInches(e.clientX, e.clientY)
      if (!pin) {
        if (!paintDragRef.current) {
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setChainLineErasePreview(false)
          setColumnPaintPreview(null)
        }
        return
      }

      const inside =
        pin.xIn >= 0 && pin.yIn >= 0 && pin.xIn <= siteWIn && pin.yIn <= siteHIn

      const dkLine = dragKindRef.current
      if (
        paintDragRef.current &&
        inside &&
        ((dkLine === 'wall-line' && isEdgeLayerMode) ||
          (dkLine === 'chain-line' && isEdgeLayerMode) ||
          (dkLine === 'room-line' && isRoomBoundaryEdgeMode) ||
          (dkLine === 'room-chain-line' && isRoomBoundaryEdgeMode) ||
          (dkLine === 'measure-line' && measureToolActive && measureTool === 'line'))
      ) {
        const start = wallLineDragStartRef.current
        if (!start) {
          setHoverEdge(null)
          setHoverCell(null)
          return
        }
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
        if (!endNode) {
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setHoverEdge(null)
          setHoverCell(null)
          return
        }
        const keys =
          dkLine === 'chain-line' || dkLine === 'room-chain-line'
            ? edgesInNodeSpan(start.i, start.j, endNode.i, endNode.j)
            : manhattanWallPathEdges(
                start.i,
                start.j,
                endNode.i,
                endNode.j,
                e.shiftKey,
                pin.xIn,
                pin.yIn,
                delta,
              )
        const valid = keys.every((k) => {
          if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
          return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
        })
        if (valid && keys.length > 0) {
          setWallLinePreviewKeys(keys.map(edgeKeyString))
          if (
            dkLine === 'measure-line' ||
            dkLine === 'wall-line' ||
            dkLine === 'chain-line' ||
            dkLine === 'room-line' ||
            dkLine === 'room-chain-line'
          ) {
            const st = wallLineDragStartRef.current
            if (st) setMeasurePreviewNodes({ start: st, end: endNode })
          }
          setHoverEdge(null)
        } else {
          setWallLinePreviewKeys(null)
          if (
            dkLine === 'measure-line' ||
            dkLine === 'wall-line' ||
            dkLine === 'chain-line' ||
            dkLine === 'room-line' ||
            dkLine === 'room-chain-line'
          ) {
            setMeasurePreviewNodes(null)
          }
          setHoverEdge(null)
        }
        setHoverCell(null)
        return
      }

      if (paintDragRef.current && isCellPaintMode && inside && dragKindRef.current === 'floor-line') {
        const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
        if (cell) {
          const ck = cellKeyString(cell)
          if (ck !== lastStrokeCellKeyRef.current) {
            const placed: PlacedFloorCell = {
              i: cell.i,
              j: cell.j,
              systemId: activeSystemId,
              source: activeCatalog,
              ...(activeCellPaintKind === 'stairs' ? { cellKind: 'stairs' as const } : {}),
            }
            floorStrokeAccumRef.current.push(placed)
            lastStrokeCellKeyRef.current = ck
            if (floorStrokeRafRef.current == null) {
              floorStrokeRafRef.current = requestAnimationFrame(() => {
                floorStrokeRafRef.current = null
                const acc = floorStrokeAccumRef.current
                if (acc.length > 0) setFloorStrokeOverlay([...acc])
              })
            }
          }
          setHoverCell((prev) => (prev && prev.i === cell.i && prev.j === cell.j ? prev : cell))
        }
        setHoverEdge(null)
        return
      }

      if (!inside) {
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
        if (!paintDragRef.current) {
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setChainLineErasePreview(false)
        }
        return
      }

      const shiftChainEligible =
        !paintDragRef.current &&
        e.shiftKey &&
        !suspendPlanPainting &&
        !measureToolActive &&
        ((isEdgeLayerMode && (structureTool === 'paint' || structureTool === 'erase')) ||
          (isRoomBoundaryEdgeMode && (roomTool === 'paint' || roomTool === 'erase')))

      if (shiftChainEligible) {
        const locked = updateShiftChainHoverPreview(e.clientX, e.clientY)
        if (locked) {
          setHoverEdge(null)
          setHoverCell(null)
          setColumnPaintPreview(null)
          return
        }
      } else if (!paintDragRef.current) {
        setWallLinePreviewKeys(null)
        setMeasurePreviewNodes(null)
        setChainLineErasePreview(false)
        setColumnPaintPreview(null)
      }

      if (isEdgeLayerMode) {
        setHoverCell(null)
        const hit = nearestGridEdge(
          pin.xIn,
          pin.yIn,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
        )
        const hk = hit ? edgeKeyString(hit) : null
        setHoverEdge((prev) => (prev === hk ? prev : hk))
      } else if (isRoomBoundaryEdgeMode) {
        setHoverCell(null)
        const hit = nearestGridEdge(
          pin.xIn,
          pin.yIn,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
        )
        const hk = hit ? edgeKeyString(hit) : null
        setHoverEdge((prev) => (prev === hk ? prev : hk))
      } else if (placeMode === 'column') {
        setHoverEdge(null)
        setHoverCell(null)
        if (
          floorTool === 'paint' &&
          activeCatalog === 'arch' &&
          !suspendPlanPainting &&
          !measureToolActive
        ) {
          const snapped = snapPlanInchesToGridNode(pin.xIn, pin.yIn, delta, siteNx, siteNy)
          const sys = orderedSystems.find((s) => s.id === activeSystemId)
          const sizeIn = planColumnSquareInchesFromSystem(sys)
          setColumnPaintPreview((prev) =>
            prev &&
            prev.cxIn === snapped.cxIn &&
            prev.cyIn === snapped.cyIn &&
            Math.abs(prev.sizeIn - sizeIn) < 1e-9
              ? prev
              : { cxIn: snapped.cxIn, cyIn: snapped.cyIn, sizeIn },
          )
        } else {
          setColumnPaintPreview(null)
        }
      } else if (isCellPaintMode || placeMode === 'room') {
        setHoverEdge(null)
        setColumnPaintPreview(null)
        const c = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
        setHoverCell((prev) => {
          if (!c) return prev === null ? prev : null
          if (prev && prev.i === c.i && prev.j === c.j) return prev
          return c
        })
      } else {
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
      }
    },
    [
      pointerToPlanInches,
      placeMode,
      isCellPaintMode,
      activeCellPaintKind,
      isEdgeLayerMode,
      isRoomBoundaryEdgeMode,
      roomTool,
      siteWIn,
      siteHIn,
      delta,
      maxDistIn,
      siteNx,
      siteNy,
      activeSystemId,
      activeCatalog,
      activeLayerId,
      cw,
      ch,
      measureToolActive,
      suspendPlanPainting,
      updateShiftChainHoverPreview,
      structureTool,
      floorTool,
      orderedSystems,
    ],
  )

  const insideSite = useCallback(
    (xIn: number, yIn: number) =>
      xIn >= 0 && yIn >= 0 && xIn <= siteWIn && yIn <= siteHIn,
    [siteWIn, siteHIn],
  )

  const onPointerLeave = useCallback(() => {
    endPaintStroke()
    setHoverEdge(null)
    setHoverCell(null)
    setColumnPaintPreview(null)
  }, [endPaintStroke])

  const onPointerUpOrCancel = useCallback(
    (e: React.PointerEvent) => {
      const el = e.currentTarget as SVGSVGElement
      const release = () => {
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          /* not captured */
        }
      }

      const kind = dragKindRef.current
      const pin = pointerToPlanInches(e.clientX, e.clientY)

      if (kind === 'move-edges') {
        const start = moveDragStartPinRef.current
        const snap = moveEdgesSnapshotRef.current
        const hitKey = moveHitEdgeKeyRef.current
        const pinF = pin ?? start
        const thr = MOVE_CLICK_MAX_PLAN_IN(delta)
        if (snap && start && pinF) {
          const movedFar =
            Math.abs(pinF.xIn - start.xIn) >= thr || Math.abs(pinF.yIn - start.yIn) >= thr
          if (!movedFar && hitKey) {
            setSelectedEdgeKeys((prev) => {
              const n = new Set(prev)
              n.delete(hitKey)
              return n
            })
          } else {
            const { di, dj } = movePreviewDiDjRef.current
            if ((di !== 0 || dj !== 0) && snap.length > 0) {
              const movePlaced = new Set(snap.map(placedEdgeKey))
              let merged = sketch.edges.filter((ed) => !movePlaced.has(placedEdgeKey(ed)))
              for (const edge of snap) {
                const ne = { ...edge, i: edge.i + di, j: edge.j + dj }
                const gk = edgeKeyString(ne)
                const lid = layerIdentityFromEdge(ne)
                merged = merged.filter((ed) => !(edgeKeyString(ed) === gk && layerIdentityFromEdge(ed) === lid))
                merged.push(ne)
              }
              onSketchChange({ ...sketch, edges: merged })
              setSelectedEdgeKeys(new Set(snap.map((ed) => placedEdgeKey({ ...ed, i: ed.i + di, j: ed.j + dj }))))
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'room-move-edges') {
        const start = moveDragStartPinRef.current
        const snap = moveRoomEdgesSnapshotRef.current
        const hitKey = moveHitEdgeKeyRef.current
        const pinF = pin ?? start
        const thr = MOVE_CLICK_MAX_PLAN_IN(delta)
        if (snap && start && pinF) {
          const movedFar =
            Math.abs(pinF.xIn - start.xIn) >= thr || Math.abs(pinF.yIn - start.yIn) >= thr
          if (!movedFar && hitKey) {
            setSelectedRoomEdgeKeys((prev) => {
              const n = new Set(prev)
              n.delete(hitKey)
              return n
            })
          } else {
            const { di, dj } = movePreviewDiDjRef.current
            if ((di !== 0 || dj !== 0) && snap.length > 0) {
              const movePlaced = new Set(snap.map(edgeKeyString))
              let merged = (sketch.roomBoundaryEdges ?? []).filter((ed) => !movePlaced.has(edgeKeyString(ed)))
              for (const edge of snap) {
                const ne = { ...edge, i: edge.i + di, j: edge.j + dj }
                const gk = edgeKeyString(ne)
                merged = merged.filter((ed) => edgeKeyString(ed) !== gk)
                merged.push(ne)
              }
              const dedup = new Map<string, GridEdgeKey>()
              for (const e of merged) dedup.set(edgeKeyString(e), e)
              const out = [...dedup.values()]
              onSketchChange({
                ...sketch,
                roomBoundaryEdges: out.length > 0 ? out : undefined,
              })
              setSelectedRoomEdgeKeys(
                new Set(snap.map((ed) => edgeKeyString({ ...ed, i: ed.i + di, j: ed.j + dj }))),
              )
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'move-cells') {
        const start = moveDragStartPinRef.current
        const snap = moveCellsSnapshotRef.current
        const hitKey = moveHitCellKeyRef.current
        const pinF = pin ?? start
        const thr = MOVE_CLICK_MAX_PLAN_IN(delta)
        if (snap && start && pinF) {
          const movedFar =
            Math.abs(pinF.xIn - start.xIn) >= thr || Math.abs(pinF.yIn - start.yIn) >= thr
          if (!movedFar) {
            if (hitKey) {
              setSelectedCellKeys((prev) => {
                const n = new Set(prev)
                for (const pk of [...n]) {
                  const p = parsePlacedCellKey(pk)
                  if (p && cellKeyString(p) === hitKey) n.delete(pk)
                }
                return n
              })
            } else if (snap.length > 0) {
              setSelectedCellKeys(new Set())
            }
          } else {
            const { di, dj } = movePreviewDiDjRef.current
            if ((di !== 0 || dj !== 0) && snap.length > 0) {
              const movePlaced = new Set(snap.map(placedCellKey))
              let merged = (sketch.cells ?? []).filter((c) => !movePlaced.has(placedCellKey(c)))
              for (const cell of snap) {
                const nc = { ...cell, i: cell.i + di, j: cell.j + dj }
                const gk = cellKeyString(nc)
                if (isExclusiveArchFloorPaintCell(nc)) {
                  merged = merged.filter((c) => cellKeyString(c) !== gk || !isExclusiveArchFloorPaintCell(c))
                } else {
                  const lid = layerIdentityFromCell(nc)
                  const pk = cellPaintKind(nc)
                  merged = merged.filter(
                    (c) =>
                      !(
                        cellKeyString(c) === gk &&
                        layerIdentityFromCell(c) === lid &&
                        cellPaintKind(c) === pk
                      ),
                  )
                }
                merged.push(nc)
              }
              merged = normalizeExclusiveArchFloorPaintCells(merged)
              onSketchChange({ ...sketch, cells: merged })
              setSelectedCellKeys(
                new Set(snap.map((c) => placedCellKey({ ...c, i: c.i + di, j: c.j + dj }))),
              )
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'select-marquee' && isEdgeLayerMode) {
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = nearestGridEdge(
                pin.xIn,
                pin.yIn,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
              )
              if (hit) {
                const gk = edgeKeyString(hit)
                const at = sketch.edges.filter((ed) => edgeKeyString(ed) === gk)
                const wantKind = planToolbarEdgeKind(placeMode, activeCatalog)
                const pref =
                  at.find((ed) => ed.kind === wantKind && layerIdentityFromEdge(ed) === activeLayerId) ??
                  at.find((ed) => ed.kind === wantKind)
                if (pref) {
                  const pk = placedEdgeKey(pref)
                  setSelectedEdgeKeys((prev) => {
                    if (shift) {
                      const n = new Set(prev)
                      if (n.has(pk)) n.delete(pk)
                      else n.add(pk)
                      return n
                    }
                    return new Set([pk])
                  })
                } else if (!shift) {
                  setSelectedEdgeKeys(new Set())
                }
              } else if (!shift) {
                setSelectedEdgeKeys(new Set())
              }
            } else if (!shift) {
              setSelectedEdgeKeys(new Set())
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const wantKind = planToolbarEdgeKind(placeMode, activeCatalog)
            const picked = sketch.edges
              .filter(
                (ed) =>
                  ed.kind === wantKind &&
                  gridEdgeIntersectsPlanRect(ed, delta, minX, minY, maxX, maxY),
              )
              .map(placedEdgeKey)
            if (picked.length > 0) {
              setSelectedEdgeKeys((prev) => {
                if (shift) return new Set([...prev, ...picked])
                return new Set(picked)
              })
            } else if (!shift) {
              setSelectedEdgeKeys(new Set())
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'room-select-marquee' && placeMode === 'room') {
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        const rb = sketch.roomBoundaryEdges ?? []
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = nearestGridEdge(
                pin.xIn,
                pin.yIn,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
              )
              if (hit) {
                const gk = edgeKeyString(hit)
                if (rb.some((ed) => edgeKeyString(ed) === gk)) {
                  setSelectedRoomEdgeKeys((prev) => {
                    if (shift) {
                      const n = new Set(prev)
                      if (n.has(gk)) n.delete(gk)
                      else n.add(gk)
                      return n
                    }
                    return new Set([gk])
                  })
                } else if (!shift) {
                  setSelectedRoomEdgeKeys(new Set())
                }
              } else if (!shift) {
                setSelectedRoomEdgeKeys(new Set())
              }
            } else if (!shift) {
              setSelectedRoomEdgeKeys(new Set())
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const picked = rb
              .filter((ed) => gridEdgeIntersectsPlanRect(ed, delta, minX, minY, maxX, maxY))
              .map(edgeKeyString)
            if (picked.length > 0) {
              setSelectedRoomEdgeKeys((prev) => {
                if (shift) return new Set([...prev, ...picked])
                return new Set(picked)
              })
            } else if (!shift) {
              setSelectedRoomEdgeKeys(new Set())
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'floor-select-marquee' && isCellPaintMode) {
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
              if (cell) {
                const ck = cellKeyString(cell)
                const at = cellsGeomMap.get(ck)
                if (at?.length) {
                  const pref = at.find(
                    (c) =>
                      layerIdentityFromCell(c) === activeLayerId &&
                      cellPaintKind(c) === activeCellPaintKind,
                  )
                  const pick = pref ?? at[0]!
                  const pk = placedCellKey(pick)
                  setSelectedCellKeys((prev) => {
                    if (shift) {
                      const n = new Set(prev)
                      if (n.has(pk)) n.delete(pk)
                      else n.add(pk)
                      return n
                    }
                    return new Set([pk])
                  })
                } else if (!shift) {
                  setSelectedCellKeys(new Set())
                }
              } else if (!shift) {
                setSelectedCellKeys(new Set())
              }
            } else if (!shift) {
              setSelectedCellKeys(new Set())
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const inBox = cellsIntersectingPlanRect(minX, minY, maxX, maxY, delta, siteNx, siteNy)
            const picked: string[] = []
            for (const c of inBox) {
              const arr = cellsGeomMap.get(cellKeyString(c))
              if (arr) for (const x of arr) picked.push(placedCellKey(x))
            }
            if (picked.length > 0) {
              setSelectedCellKeys((prev) => {
                if (shift) return new Set([...prev, ...picked])
                return new Set(picked)
              })
            } else if (!shift) {
              setSelectedCellKeys(new Set())
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'marquee' && isEdgeLayerMode) {
        const mr = marqueeRectRef.current
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = nearestGridEdge(
                pin.xIn,
                pin.yIn,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
              )
              if (hit) {
                const hk = edgeKeyString(hit)
                updateEdges((list) =>
                  list.filter(
                    (ed) => !(edgeKeyString(ed) === hk && layerIdentityFromEdge(ed) === activeLayerId),
                  ),
                )
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            updateEdges((list) =>
              list.filter(
                (ed) =>
                  !gridEdgeIntersectsPlanRect(ed, delta, minX, minY, maxX, maxY) ||
                  layerIdentityFromEdge(ed) !== activeLayerId,
              ),
            )
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'room-marquee' && placeMode === 'room') {
        const mr = marqueeRectRef.current
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = nearestGridEdge(
                pin.xIn,
                pin.yIn,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
              )
              if (hit) {
                const hk = edgeKeyString(hit)
                updateRoomBoundaries((list) => list.filter((ed) => edgeKeyString(ed) !== hk))
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            updateRoomBoundaries((list) =>
              list.filter((ed) => !gridEdgeIntersectsPlanRect(ed, delta, minX, minY, maxX, maxY)),
            )
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'floor-marquee' && isCellPaintMode) {
        const mr = marqueeRectRef.current
        const isFill = floorToolRef.current === 'fill'
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
              if (cell) {
                if (isFill) {
                  const placed: PlacedFloorCell = {
                    i: cell.i,
                    j: cell.j,
                    systemId: activeSystemId,
                    source: activeCatalog,
                    ...(activeCellPaintKind === 'stairs' ? { cellKind: 'stairs' as const } : {}),
                  }
                  updateCells((list) => mergePaintStrokeIntoCells(list, [placed]))
                } else {
                  updateCells((list) =>
                    list.filter((c) => {
                      if (c.i !== cell.i || c.j !== cell.j) return true
                      if (activeCatalog === 'arch' && isExclusiveArchFloorPaintCell(c)) return false
                      return !(
                        layerIdentityFromCell(c) === activeLayerId &&
                        cellPaintKind(c) === activeCellPaintKind
                      )
                    }),
                  )
                }
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const touched = cellsIntersectingPlanRect(minX, minY, maxX, maxY, delta, siteNx, siteNy)
            if (isFill) {
              const stroke: PlacedFloorCell[] = touched.map((pos) => ({
                i: pos.i,
                j: pos.j,
                systemId: activeSystemId,
                source: activeCatalog,
                ...(activeCellPaintKind === 'stairs' ? { cellKind: 'stairs' as const } : {}),
              }))
              updateCells((list) => mergePaintStrokeIntoCells(list, stroke))
            } else {
              const rm = new Set(touched.map((c) => cellKeyString(c)))
              updateCells((list) =>
                list.filter((c) => {
                  if (!rm.has(cellKeyString(c))) return true
                  if (activeCatalog === 'arch' && isExclusiveArchFloorPaintCell(c)) return false
                  return (
                    layerIdentityFromCell(c) !== activeLayerId ||
                    cellPaintKind(c) !== activeCellPaintKind
                  )
                }),
              )
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'column-marquee' && placeMode === 'column') {
        const mr = marqueeRectRef.current
        const cols = sketch.columns ?? []
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = cols.find(
                (c) =>
                  layerIdentityFromColumn(c) === activeLayerId &&
                  planPointInsideColumnFootprint(c, pin.xIn, pin.yIn),
              )
              if (hit) {
                onSketchChange({
                  ...sketch,
                  columns: cols.filter((c) => c.id !== hit.id),
                })
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            onSketchChange({
              ...sketch,
              columns: cols.filter(
                (c) =>
                  layerIdentityFromColumn(c) !== activeLayerId ||
                  !planColumnIntersectsPlanRect(c, minX, minY, maxX, maxY),
              ),
            })
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'wall-rect' && isEdgeLayerMode) {
        const mr = marqueeRectRef.current
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (!tiny && mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const ni = (x: number) => Math.max(0, Math.min(siteNx, Math.round(x / delta)))
            const nj = (y: number) => Math.max(0, Math.min(siteNy, Math.round(y / delta)))
            const i0 = ni(minX)
            const j0 = nj(minY)
            const i1 = ni(maxX)
            const j1 = nj(maxY)
            const keys = rectangularFrameEdges(i0, j0, i1, j1)
            const valid =
              keys.length > 0 &&
              keys.every((k) => {
                if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
                return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
              })
            if (valid) applyWallStrokeKeys(keys)
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'room-rect' && placeMode === 'room') {
        const mr = marqueeRectRef.current
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (!tiny && mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const ni = (x: number) => Math.max(0, Math.min(siteNx, Math.round(x / delta)))
            const nj = (y: number) => Math.max(0, Math.min(siteNy, Math.round(y / delta)))
            const i0 = ni(minX)
            const j0 = nj(minY)
            const i1 = ni(maxX)
            const j1 = nj(maxY)
            const keys = rectangularFrameEdges(i0, j0, i1, j1)
            const valid =
              keys.length > 0 &&
              keys.every((k) => {
                if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
                return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
              })
            if (valid) applyRoomBoundaryStrokeKeys(keys)
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'measure-line') {
        if (measureTool !== 'line') {
          endPaintStroke()
          release()
          return
        }
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
          const keys = endNode
            ? manhattanWallPathEdges(
                startSnap.i,
                startSnap.j,
                endNode.i,
                endNode.j,
                e.shiftKey,
                pin.xIn,
                pin.yIn,
                delta,
              )
            : []
          const valid =
            keys.length > 0 &&
            keys.every((k) => {
              if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
              return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
            })
          if (valid) {
            const id = `m-${++measureRunIdRef.current}`
            const run: PlanMeasureGridRun = {
              id,
              edgeKeys: keys.map(edgeKeyString),
              totalPlanIn: keys.length * delta,
              startNode: { i: startSnap.i, j: startSnap.j },
              endNode: { i: endNode!.i, j: endNode!.j },
            }
            onSketchChange({
              ...sketch,
              measureRuns: [...(sketch.measureRuns ?? []), run],
            })
            lastWallNodeRef.current = endNode
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'chain-line' && isEdgeLayerMode) {
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
          const keys = endNode
            ? edgesInNodeSpan(startSnap.i, startSnap.j, endNode.i, endNode.j)
            : []
          const valid =
            keys.length > 0 &&
            keys.every((k) => {
              if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
              return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
            })
          if (valid && endNode) {
            const ok =
              structureTool === 'paint'
                ? applyNodeChainWalls(startSnap.i, startSnap.j, endNode.i, endNode.j)
                : removeNodeChainWalls(startSnap.i, startSnap.j, endNode.i, endNode.j)
            if (ok) lastWallNodeRef.current = endNode
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'room-chain-line' && isRoomBoundaryEdgeMode) {
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
          if (endNode) {
            const ok = applyNodeChainRoomBoundaries(startSnap.i, startSnap.j, endNode.i, endNode.j)
            if (ok) lastWallNodeRef.current = endNode
          }
        }
        endPaintStroke()
        release()
        return
      }

      const wasStructureWallDrag =
        paintDragRef.current && isEdgeLayerMode && kind === 'wall-line'
      const wasRoomLineDrag =
        paintDragRef.current && isRoomBoundaryEdgeMode && kind === 'room-line'
      const startSnap = wallLineDragStartRef.current

      if (wasRoomLineDrag && startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
        const keys = endNode
          ? manhattanWallPathEdges(
              startSnap.i,
              startSnap.j,
              endNode.i,
              endNode.j,
              e.shiftKey,
              pin.xIn,
              pin.yIn,
              delta,
            )
          : []
        const valid =
          keys.length > 0 &&
          keys.every((k) => {
            if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
            return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
          })
        if (valid) {
          applyRoomBoundaryStrokeKeys(keys)
          lastWallNodeRef.current = endNode
        } else {
          const hit = nearestGridEdge(
            pin.xIn,
            pin.yIn,
            siteWIn,
            siteHIn,
            delta,
            maxDistIn,
          )
          if (hit) {
            assignRoomBoundaryEdge(hit)
            lastWallNodeRef.current = closerNodeOnEdge(hit, pin.xIn, pin.yIn, delta)
          }
        }
      }

      if (wasStructureWallDrag && startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, maxDistIn * 1.2)
        const keys = endNode
          ? manhattanWallPathEdges(
              startSnap.i,
              startSnap.j,
              endNode.i,
              endNode.j,
              e.shiftKey,
              pin.xIn,
              pin.yIn,
              delta,
            )
          : []
        const valid =
          keys.length > 0 &&
          keys.every((k) => {
            if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
            return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
          })
        if (valid) {
          applyWallStrokeKeys(keys)
          lastWallNodeRef.current = endNode
        } else {
          const hit = nearestGridEdge(
            pin.xIn,
            pin.yIn,
            siteWIn,
            siteHIn,
            delta,
            maxDistIn,
          )
          if (hit) {
            assignEdge(hit)
            lastWallNodeRef.current = closerNodeOnEdge(hit, pin.xIn, pin.yIn, delta)
          }
        }
      }

      endPaintStroke()
      release()
    },
    [
      endPaintStroke,
      pointerToPlanInches,
      placeMode,
      isCellPaintMode,
      activeCellPaintKind,
      isEdgeLayerMode,
      insideSite,
      delta,
      siteNx,
      siteNy,
      maxDistIn,
      siteWIn,
      siteHIn,
      applyWallStrokeKeys,
      applyNodeChainWalls,
      removeNodeChainWalls,
      assignEdge,
      structureTool,
      updateEdges,
      updateCells,
      d.planScale,
      sketch,
      onSketchChange,
      cellsGeomMap,
      activeLayerId,
      activeCatalog,
      measureTool,
      isRoomBoundaryEdgeMode,
      applyRoomBoundaryStrokeKeys,
      assignRoomBoundaryEdge,
      applyNodeChainRoomBoundaries,
      updateRoomBoundaries,
    ],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (suspendPlanPainting) return
      const svg = e.currentTarget as SVGSVGElement

      if (measureToolActive) {
        const pinM = pointerToPlanInches(e.clientX, e.clientY)
        if (!pinM || !insideSite(pinM.xIn, pinM.yIn)) return

        if (measureTool === 'erase') {
          const hitE = nearestGridEdge(
            pinM.xIn,
            pinM.yIn,
            siteWIn,
            siteHIn,
            delta,
            maxDistIn,
          )
          if (!hitE) return
          const k = edgeKeyString(hitE)
          const runs = sketch.measureRuns ?? []
          const nextRuns = runs.filter((r) => !r.edgeKeys.includes(k))
          if (nextRuns.length < runs.length) {
            onSketchChange({ ...sketch, measureRuns: nextRuns })
          }
          return
        }

        const tryCaptureM = () => {
          try {
            svg.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }

        if (e.shiftKey && lastWallNodeRef.current) {
          tryCaptureM()
          paintDragRef.current = true
          dragKindRef.current = 'measure-line'
          wallLineDragStartRef.current = lastWallNodeRef.current
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }

        const hitM = nearestGridEdge(
          pinM.xIn,
          pinM.yIn,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
        )
        if (!hitM) return

        tryCaptureM()
        paintDragRef.current = true
        dragKindRef.current = 'measure-line'
        const sn = closerNodeOnEdge(hitM, pinM.xIn, pinM.yIn, delta)
        wallLineDragStartRef.current = sn
        setWallLinePreviewKeys(null)
        setMeasurePreviewNodes(null)
        return
      }

      if (placeMode === 'room' && roomTool === 'fill') {
        const pinR = pointerToPlanInches(e.clientX, e.clientY)
        if (!pinR || !insideSite(pinR.xIn, pinR.yIn)) return
        const cell = planInchesToCell(pinR.xIn, pinR.yIn, delta, siteNx, siteNy)
        if (!cell) return
        const ck = cellKeyString(cell)
        if (exteriorCells.has(ck)) return
        const comp = findRoomComponentForCellKey(enclosedRooms, ck)
        if (!comp) return
        const prev = sketch.roomByCell ?? {}
        const next: Record<string, string> = { ...prev }
        const label = roomNameDraft.trim()
        if (label) {
          for (const k of comp.cellKeys) next[k] = label
        } else {
          for (const k of comp.cellKeys) delete next[k]
        }
        onSketchChange({
          ...sketch,
          roomByCell: Object.keys(next).length > 0 ? next : undefined,
        })
        return
      }

      if (placeMode === 'room' && roomTool === 'autoFill') return

      const pSvg = clientToSvgPoint(svg, e.clientX, e.clientY)
      const onPlanSvg =
        pSvg && pSvg.x >= 0 && pSvg.y >= 0 && pSvg.x <= cw && pSvg.y <= ch
      const pin = pointerToPlanInches(e.clientX, e.clientY)

      const tryCapture = () => {
        try {
          svg.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
      }

      if (isRoomBoundaryEdgeMode) {
        if (e.shiftKey && (roomTool === 'paint' || roomTool === 'erase')) {
          if (!pin || !insideSite(pin.xIn, pin.yIn)) return
          const last = lastWallNodeRef.current
          if (!last) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'room-chain-line'
          wallLineDragStartRef.current = last
          setChainLineErasePreview(roomTool === 'erase')
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }

        if (roomTool === 'erase' && !e.shiftKey) {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'room-marquee'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('erase')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (roomTool === 'select') {
          const rb = sketch.roomBoundaryEdges ?? []
          if (pin && insideSite(pin.xIn, pin.yIn)) {
            const hit = nearestGridEdge(
              pin.xIn,
              pin.yIn,
              siteWIn,
              siteHIn,
              delta,
              maxDistIn,
            )
            const gk = hit ? edgeKeyString(hit) : null
            if (gk && rb.some((ed) => edgeKeyString(ed) === gk) && selectedRoomEdgeKeys.has(gk)) {
              tryCapture()
              paintDragRef.current = true
              dragKindRef.current = 'room-move-edges'
              moveDragStartPinRef.current = { xIn: pin.xIn, yIn: pin.yIn }
              moveRoomEdgesSnapshotRef.current = rb.filter((ed) => selectedRoomEdgeKeys.has(edgeKeyString(ed)))
              moveHitEdgeKeyRef.current = gk
              movePreviewDiDjRef.current = { di: 0, dj: 0 }
              setMovePreview({ di: 0, dj: 0 })
              return
            }
            const onRoomBoundary = Boolean(gk && rb.some((ed) => edgeKeyString(ed) === gk))
            if (!onRoomBoundary && onRoomZoneSelect) {
              const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
              if (cell) {
                const ckHit = cellKeyString(cell)
                if (!exteriorCells.has(ckHit)) {
                  const comp = findRoomComponentForCellKey(enclosedRooms, ckHit)
                  if (
                    comp &&
                    roomZoneHasAssignedName(comp.cellKeys, sketch.roomByCell)
                  ) {
                    setSelectedRoomEdgeKeys(new Set())
                    const zIdx =
                      enclosedRooms.findIndex(
                        (r) =>
                          r.cellKeys.length === comp.cellKeys.length &&
                          r.cellKeys.every((k, i) => k === comp.cellKeys[i]!),
                      ) + 1
                    const displayName = resolveRoomDisplayName(
                      comp.cellKeys,
                      sketch.roomByCell,
                      zIdx || 1,
                    )
                    onRoomZoneSelect({ cellKeys: comp.cellKeys, displayName })
                    return
                  }
                }
              }
            }
          }
          if (!onPlanSvg || !pSvg) return
          if (selectedRoomZoneCellKeys?.length && onRoomZoneSelect) {
            onRoomZoneSelect(null)
          }
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'room-select-marquee'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('select')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (roomTool === 'rect') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'room-rect'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('rect')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (roomTool !== 'paint') return
        if (!pin || !insideSite(pin.xIn, pin.yIn)) return

        tryCapture()
        paintDragRef.current = true
        dragKindRef.current = 'room-line'
        lastStrokeEdgeKeyRef.current = null

        const hit = nearestGridEdge(
          pin.xIn,
          pin.yIn,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
        )
        if (!hit) {
          paintDragRef.current = false
          dragKindRef.current = null
          return
        }
        wallLineDragStartRef.current = closerNodeOnEdge(hit, pin.xIn, pin.yIn, delta)
        setWallLinePreviewKeys(null)
        return
      }

      if (isEdgeLayerMode) {
        if (e.shiftKey && (structureTool === 'paint' || structureTool === 'erase')) {
          if (!pin || !insideSite(pin.xIn, pin.yIn)) return
          const last = lastWallNodeRef.current
          if (!last) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'chain-line'
          wallLineDragStartRef.current = last
          setChainLineErasePreview(structureTool === 'erase')
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          return
        }

        if (structureTool === 'erase' && !e.shiftKey) {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'marquee'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('erase')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (structureTool === 'select') {
          if (pin && insideSite(pin.xIn, pin.yIn)) {
            const hit = nearestGridEdge(
              pin.xIn,
              pin.yIn,
              siteWIn,
              siteHIn,
              delta,
              maxDistIn,
            )
            const gk = hit ? edgeKeyString(hit) : null
            const atGeom = gk ? sketch.edges.filter((ed) => edgeKeyString(ed) === gk) : []
            const wantKind = planToolbarEdgeKind(placeMode, activeCatalog)
            const pref =
              atGeom.find((ed) => ed.kind === wantKind && layerIdentityFromEdge(ed) === activeLayerId) ??
              atGeom.find((ed) => ed.kind === wantKind)
            const pk = pref ? placedEdgeKey(pref) : null
            if (pk && selectedEdgeKeys.has(pk)) {
              tryCapture()
              paintDragRef.current = true
              dragKindRef.current = 'move-edges'
              moveDragStartPinRef.current = { xIn: pin.xIn, yIn: pin.yIn }
              moveEdgesSnapshotRef.current = sketch.edges.filter((ed) =>
                selectedEdgeKeys.has(placedEdgeKey(ed)),
              )
              moveHitEdgeKeyRef.current = pk
              movePreviewDiDjRef.current = { di: 0, dj: 0 }
              setMovePreview({ di: 0, dj: 0 })
              return
            }
          }
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'select-marquee'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('select')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (structureTool === 'rect') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'wall-rect'
          lastStrokeEdgeKeyRef.current = null
          wallLineDragStartRef.current = null
          setWallLinePreviewKeys(null)
          setMarqueeTone('rect')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (structureTool !== 'paint') return
        if (!pin || !insideSite(pin.xIn, pin.yIn)) return

        tryCapture()
        paintDragRef.current = true
        dragKindRef.current = 'wall-line'
        lastStrokeEdgeKeyRef.current = null

        const hit = nearestGridEdge(
          pin.xIn,
          pin.yIn,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
        )
        if (!hit) {
          paintDragRef.current = false
          dragKindRef.current = null
          return
        }
        wallLineDragStartRef.current = closerNodeOnEdge(hit, pin.xIn, pin.yIn, delta)
        setWallLinePreviewKeys(null)
        return
      }

      if (placeMode === 'column' && activeCatalog === 'arch') {
        if (floorTool === 'erase') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'column-marquee'
          setMarqueeTone('erase')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }
        if (floorTool === 'paint') {
          if (!pin || !insideSite(pin.xIn, pin.yIn)) return
          const snapped = snapPlanInchesToGridNode(pin.xIn, pin.yIn, delta, siteNx, siteNy)
          const sys = orderedSystems.find((s) => s.id === activeSystemId)
          const sizeIn = planColumnSquareInchesFromSystem(sys)
          const col: PlacedPlanColumn = {
            id: crypto.randomUUID(),
            cxIn: snapped.cxIn,
            cyIn: snapped.cyIn,
            sizeIn,
            systemId: activeSystemId,
            source: 'arch',
          }
          const prev = sketch.columns ?? []
          onSketchChange({ ...sketch, columns: [...prev, col] })
          return
        }
        return
      }

      if (isCellPaintMode) {
        if (floorTool === 'erase' || floorTool === 'fill') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'floor-marquee'
          lastStrokeCellKeyRef.current = null
          setMarqueeTone(floorTool === 'fill' ? 'rect' : 'erase')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (floorTool === 'select') {
          if (pin && insideSite(pin.xIn, pin.yIn) && selectedCellKeys.size > 0) {
            const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
            const ck = cell ? cellKeyString(cell) : null
            const onPaintedSelected = !!(
              ck &&
              (cellsGeomMap.get(ck)?.some((c) => selectedCellKeys.has(placedCellKey(c))) ?? false)
            )
            const inSelectionBBox = pointInSelectedFloorBBox(pin.xIn, pin.yIn, selectedCellKeys, delta)
            if (onPaintedSelected || inSelectionBBox) {
              tryCapture()
              paintDragRef.current = true
              dragKindRef.current = 'move-cells'
              moveDragStartPinRef.current = { xIn: pin.xIn, yIn: pin.yIn }
              moveCellsSnapshotRef.current = (sketch.cells ?? []).filter((c) =>
                selectedCellKeys.has(placedCellKey(c)),
              )
              moveHitCellKeyRef.current = onPaintedSelected ? ck! : null
              movePreviewDiDjRef.current = { di: 0, dj: 0 }
              setMovePreview({ di: 0, dj: 0 })
              return
            }
          }
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'floor-select-marquee'
          lastStrokeCellKeyRef.current = null
          setMarqueeTone('select')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (floorTool !== 'paint') return
        if (!pin || !insideSite(pin.xIn, pin.yIn)) return

        tryCapture()
        if (floorStrokeRafRef.current != null) {
          cancelAnimationFrame(floorStrokeRafRef.current)
          floorStrokeRafRef.current = null
        }
        paintDragRef.current = true
        dragKindRef.current = 'floor-line'
        lastStrokeCellKeyRef.current = null

        const cell = planInchesToCell(pin.xIn, pin.yIn, delta, siteNx, siteNy)
        if (!cell) {
          paintDragRef.current = false
          dragKindRef.current = null
          return
        }
        const ck = cellKeyString(cell)
        const placed: PlacedFloorCell = {
          i: cell.i,
          j: cell.j,
          systemId: activeSystemId,
          source: activeCatalog,
          ...(activeCellPaintKind === 'stairs' ? { cellKind: 'stairs' as const } : {}),
        }
        floorStrokeAccumRef.current = [placed]
        setFloorStrokeOverlay([placed])
        lastStrokeCellKeyRef.current = ck
      }
    },
    [
      pointerToPlanInches,
      insideSite,
      placeMode,
      isCellPaintMode,
      activeCellPaintKind,
      isEdgeLayerMode,
      floorTool,
      structureTool,
      siteNx,
      siteNy,
      siteWIn,
      siteHIn,
      delta,
      maxDistIn,
      activeSystemId,
      activeCatalog,
      cw,
      ch,
      cellsGeomMap,
      activeLayerId,
      selectedEdgeKeys,
      selectedCellKeys,
      sketch,
      sketch.edges,
      sketch.cells,
      suspendPlanPainting,
      measureToolActive,
      measureTool,
      onSketchChange,
      exteriorCells,
      enclosedRooms,
      roomNameDraft,
      isRoomBoundaryEdgeMode,
      roomTool,
      selectedRoomEdgeKeys,
      selectedRoomZoneCellKeys,
      onRoomZoneSelect,
      sketch.roomByCell,
      orderedSystems,
    ],
  )

  /** Visible node markers — fixed r≈0.5px was effectively invisible at typical plan scales. */
  const gridDotR = useMemo(
    () => Math.max(1.2, Math.min(cellPx * 0.06, 3.5)),
    [cellPx],
  )

  /** Stable ids for SVG pattern refs (dense grids: patterns replace O(n²) line/circle nodes). */
  const patternUid = useId().replace(/[^a-zA-Z0-9_-]/g, '_')
  const patGridH = `${patternUid}-gh`
  const patGridV = `${patternUid}-gv`
  const patGridDots = `${patternUid}-gd`

  const hoverLengthIn = hoverEdge ? delta : 0

  const statusLine = useMemo(() => {
      if (suspendPlanPainting) {
      return 'Overlay adjust — plan drawing paused · Done in toolbar returns to Line / Rect / Erase / Select'
    }
    if (measureToolActive) {
      if (measureTool === 'erase') {
        const n = measureRuns.length
        if (n > 0) {
          return `${n} dimension run${n === 1 ? '' : 's'} · Click a segment of a run to remove it · Esc clears all`
        }
        return 'Erase — click a grid segment that belongs to a dimension run to remove that run · Esc clears all'
      }
      if (wallLinePreviewKeys?.length) {
        const tot = wallLinePreviewKeys.length * delta
        const su = PLAN_SITE_UNIT_SHORT[planSiteDisplayUnit]
        return `${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} · ${wallLinePreviewKeys.length} grid Δ — release to add · Esc clears all`
      }
      if (measureRuns.length > 0) {
        const last = measureRuns[measureRuns.length - 1]!
        const lastLen = last.edgeKeys.length * delta
        const { primary, sub } = gridRunMeasureCaption(
          lastLen,
          last.startNode,
          last.endNode,
          last.edgeKeys.length,
          planSiteDisplayUnit,
        )
        const n = measureRuns.length
        return `${n} dimension run${n === 1 ? '' : 's'} · Last: ${primary} — ${sub} · Drag to add another · Esc clears all`
      }
      return 'Line — drag along grid edges like wall Line · Hold Shift while dragging for straight H/V leg · Shift+click continues from last end · Esc clears all'
    }
    if (placeMode === 'room') {
      if (roomTool === 'fill') {
        const n = enclosedRooms.length
        const hint = roomNameDraft.trim()
          ? `Click inside a bounded cell to name zone "${roomNameDraft.trim()}"`
          : 'Click inside a bounded cell to clear that zone name'
        const extHint =
          hoverCell && exteriorCells.has(cellKeyString(hoverCell))
            ? ' · Pointer is in yard / exterior (not nameable)'
            : ''
        return n > 0
          ? `${n} enclosed zone${n === 1 ? '' : 's'} · ${hint}${extHint}`
          : `Draw room boundaries (Line / Rect), then Fill · ${hint}`
      }
      if (roomTool === 'autoFill') {
        const n = enclosedRooms.length
        const p = roomNameDraft.trim() || 'Room'
        return n > 0
          ? `${n} enclosed zone${n === 1 ? '' : 's'} · Use the toolbar button to assign "${p} 1" … "${p} ${n}"`
          : 'No enclosed zones yet — draw walls or room boundaries, then use Auto-fill'
      }
      if (roomTool === 'paint') {
        return 'Room boundary — Line: drag along grid edges · Shift+drag straight chain · Shift+hover previews from last node'
      }
      if (roomTool === 'rect') {
        return 'Room boundary — drag a rectangle to place a closed frame on the grid'
      }
      if (roomTool === 'erase') {
        return 'Room boundary — drag box to erase segments · tiny drag = one segment · Shift+drag straight chain erase'
      }
      const zonePick =
        selectedRoomZoneCellKeys && selectedRoomZoneCellKeys.length > 0
          ? 'Zone selected — edit name in toolbar (blur or Enter to apply) · Delete / ⌫ clears this room name · '
          : 'Click inside a filled room (not on a room boundary line) to select it · '
      return `${zonePick}Boundary: ${selectedRoomEdgeKeys.size} segment(s) · drag box on lines · drag selection to move · Del removes zone name or boundary segments · Esc clears`
    }
    if (placeMode === 'column') {
      const parts: string[] = []
      if (eraseMarqueeSvg && (eraseMarqueeSvg.w > 0 || eraseMarqueeSvg.h > 0)) {
        parts.push(
          marqueeTone === 'erase'
            ? 'Erase box — release to clear column footprints for the current layer'
            : '—',
        )
      } else {
        parts.push('—')
      }
      if (floorTool === 'paint') {
        parts.push(
          'Dashed square follows the pointer — click to place at the nearest grid intersection (size from max CONCRETE layer thickness in CSV)',
        )
      } else if (floorTool === 'erase') {
        parts.push(
          'Drag a box to erase columns on the active layer · tiny drag removes one column under the pointer',
        )
      } else {
        parts.push('Use Paint or Erase in the toolbar')
      }
      return parts.join(' · ')
    }
    if (isEdgeLayerMode) {
      const parts: string[] = []
      if (eraseMarqueeSvg && (eraseMarqueeSvg.w > 0 || eraseMarqueeSvg.h > 0)) {
        parts.push(
          marqueeTone === 'select'
            ? 'Selection box — release to choose plan edges'
            : marqueeTone === 'rect'
              ? 'Rectangle — release to place frame on grid'
              : 'Erase box — release to clear edges inside',
        )
      } else if (wallLinePreviewKeys?.length) {
        const tot = wallLinePreviewKeys.length * delta
        const su = PLAN_SITE_UNIT_SHORT[planSiteDisplayUnit]
        const chainHint = chainLineErasePreview ? 'Shift+drag to erase' : 'Shift+drag to place'
        parts.push(
          `${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} · ${wallLinePreviewKeys.length} grid Δ — ${chainHint}`,
        )
      } else if (movePreview && (movePreview.di !== 0 || movePreview.dj !== 0)) {
        parts.push(`Move Δ ${movePreview.di},${movePreview.dj} cells`)
      } else if (structureTool === 'select') {
        parts.push(`${selectedEdgeKeys.size} edge(s) selected`)
      } else if (hoverEdge) {
        parts.push(`Edge ${formatThickness(hoverLengthIn)}`)
      } else {
        parts.push('—')
      }
      if (structureTool === 'paint') {
        parts.push(
          'Drag line from click · Shift while dragging = straight H/V leg · Hold Shift = chain preview from last node + length · Shift+drag to commit chain',
        )
      } else if (structureTool === 'rect') {
        parts.push('Drag a box to place a rectangular frame on the grid')
      } else if (structureTool === 'erase') {
        parts.push(
          'Drag box to erase walls · tiny drag = one edge · Hold Shift = chain erase preview from last node · Shift+drag to commit',
        )
      } else {
        parts.push(
          'Drag box to select · Shift adds · Drag selection to move · Del or ⌫ removes selected edges · Esc clears selection',
        )
      }
      return parts.join(' · ')
    }
    const cellKindLabel = placeMode === 'stairs' ? 'stair' : 'floor'
    const parts: string[] = []
    if (eraseMarqueeSvg && (eraseMarqueeSvg.w > 0 || eraseMarqueeSvg.h > 0)) {
      parts.push(
        marqueeTone === 'select'
          ? `Selection box — release to choose ${cellKindLabel} cells`
          : marqueeTone === 'rect' && floorTool === 'fill'
            ? `Fill box — release to paint all ${cellKindLabel} cells inside`
            : `Erase box — release to clear ${cellKindLabel} inside`,
      )
    } else if (movePreview && (movePreview.di !== 0 || movePreview.dj !== 0)) {
      parts.push(`Move Δ ${movePreview.di},${movePreview.dj} cells`)
    } else if (floorTool === 'select') {
      parts.push(`${selectedCellKeys.size} ${cellKindLabel} cell(s) selected`)
    } else if (hoverCell) {
      parts.push(`Cell ${hoverCell.i},${hoverCell.j}`)
    } else {
      parts.push('—')
    }
    if (floorTool === 'paint') {
      parts.push(`Drag to paint ${cellKindLabel}`)
    } else if (floorTool === 'fill') {
      parts.push(
        `Drag a box to fill ${cellKindLabel} cells with the current layer (tiny drag = one cell)`,
      )
    } else if (floorTool === 'erase') {
      parts.push(`Drag a box to erase ${cellKindLabel} (tiny drag = one cell)`)
    } else {
      parts.push(
        'Drag box to select cells · Shift adds · Drag to move · Del or ⌫ removes selected cells · Esc clears selection',
      )
    }
    return parts.join(' · ')
  }, [
    placeMode,
    isEdgeLayerMode,
    hoverEdge,
    hoverLengthIn,
    hoverCell,
    floorTool,
    structureTool,
    wallLinePreviewKeys,
    eraseMarqueeSvg,
    marqueeTone,
    movePreview,
    selectedEdgeKeys.size,
    selectedCellKeys.size,
    suspendPlanPainting,
    measureToolActive,
    measureTool,
    measureRuns,
    measurePreviewNodes,
    chainLineErasePreview,
    planSiteDisplayUnit,
    delta,
    enclosedRooms,
    exteriorCells,
    roomNameDraft,
    roomTool,
    selectedRoomEdgeKeys.size,
    selectedRoomZoneCellKeys,
  ])

  const canDeleteSelection =
    !suspendPlanPainting &&
    ((structureTool === 'select' && selectedEdgeKeys.size > 0) ||
      (floorTool === 'select' && selectedCellKeys.size > 0) ||
      (placeMode === 'room' &&
        roomTool === 'select' &&
        (selectedRoomEdgeKeys.size > 0 || !!selectedRoomZoneCellKeys?.length)))

  return (
    <div className={className ?? 'flex flex-col flex-1 min-h-0 overflow-hidden bg-[#f0ede8]'}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-white shrink-0">
        <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">Zoom</span>
        <button
          type="button"
          onClick={() => {
            const s = scrollRef.current
            const a =
              s &&
              (() => {
                const r = s.getBoundingClientRect()
                return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
              })()
            applyZoom(clampZoom(zoom / ZOOM_BUTTON_RATIO), a ?? undefined)
          }}
          className="font-mono text-[10px] px-2 py-0.5 border border-border hover:bg-muted min-w-[1.75rem]"
          title="Zoom out (⌘−)"
        >
          −
        </button>
        <span className="font-mono text-[10px] w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => {
            const s = scrollRef.current
            const a =
              s &&
              (() => {
                const r = s.getBoundingClientRect()
                return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
              })()
            applyZoom(clampZoom(zoom * ZOOM_BUTTON_RATIO), a ?? undefined)
          }}
          className="font-mono text-[10px] px-2 py-0.5 border border-border hover:bg-muted min-w-[1.75rem]"
          title="Zoom in (⌘+)"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            zoomCommitRef.current = null
            setZoom(1)
          }}
          className="font-mono text-[9px] px-2 py-0.5 border border-border hover:bg-muted uppercase tracking-wide"
          title="100% (⌘0)"
        >
          Reset
        </button>
        <span className="font-mono text-[8px] text-muted-foreground tracking-wide hidden sm:inline max-w-[9rem] leading-tight">
          Ctrl/⌘ + scroll
        </span>
        <div className="w-px h-4 bg-border/60 mx-1" />
        <button
          type="button"
          disabled={!canDeleteSelection}
          onClick={() => deleteSelectedItems()}
          className="font-mono text-[9px] px-2 py-0.5 border border-border hover:bg-muted shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          title="Remove selection: walls/MEP edges, floor cells, room boundary segments, or selected room zone name (Delete or Backspace)"
        >
          Delete
        </button>
        <div className="w-px h-4 bg-border/60 mx-1 hidden sm:block" />
        <span className="font-mono text-[9px] text-muted-foreground tracking-wide truncate min-w-0 flex-1">
          {statusLine}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col overflow-auto pt-28 pl-28 pr-14 pb-20 min-h-0"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="mx-auto my-auto w-max min-w-min shrink-0">
          <div
            ref={planBoxRef}
            className="shadow-xl bg-[#faf9f7]"
            style={{
              display: 'inline-block',
              width: cw * zoom,
              height: ch * zoom,
              verticalAlign: 'top',
            }}
          >
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: cw,
                height: ch,
              }}
            >
              <svg
                ref={svgRef}
                width={cw}
                height={ch}
                viewBox={`0 0 ${cw} ${ch}`}
                className={`block touch-none select-none overflow-visible${
                  measureToolActive
                    ? measureTool === 'erase'
                      ? ' cursor-pointer'
                      : ' cursor-crosshair'
                    : placeMode === 'room' && roomTool !== 'autoFill'
                      ? ' cursor-pointer'
                      : ''
                }`}
                style={{ overflow: 'visible' }}
                onPointerMove={onPointerMove}
                onPointerLeave={onPointerLeave}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUpOrCancel}
                onPointerCancel={onPointerUpOrCancel}
              >
                <rect width={cw} height={ch} fill="#faf9f7" />

                {placeMode !== 'room' && (sketch.roomBoundaryEdges?.length ?? 0) > 0 && (
                  <g aria-hidden pointerEvents="none">
                    {(sketch.roomBoundaryEdges ?? []).map((e) => {
                      const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
                      const swU = strokeWidthForRoomBoundaryUnderlay(d)
                      return (
                        <line
                          key={`room-bd-underlay-${edgeKeyString(e)}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={PLAN_ROOM_BOUNDARY_MUTED_STROKE}
                          strokeOpacity={0.4}
                          strokeWidth={swU}
                          strokeLinecap="round"
                          strokeDasharray={PLAN_ROOM_BOUNDARY_MUTED_DASH}
                        />
                      )
                    })}
                  </g>
                )}

                {Array.from(cellsGeomMap.values()).flatMap((arr) =>
                  arr.map((c, idx) => {
                    const { inset, w } = floorCellInsetDims(cellPx, idx, arr.length, c)
                    return (
                      <rect
                        key={placedCellKey(c)}
                        x={c.i * cellPx + inset}
                        y={c.j * cellPx + inset}
                        width={w}
                        height={w}
                        fill={planCellFill(c, planColorCatalog)}
                        stroke="rgba(0,0,0,0.12)"
                        strokeWidth={0.45}
                        pointerEvents="none"
                      />
                    )
                  }),
                )}

                {displayColumnsSorted.map((col) => {
                  const half = col.sizeIn / 2
                  const { x, y } = planInchesToCanvasPx(d, col.cxIn - half, col.cyIn - half)
                  const sPx = col.sizeIn * d.planScale
                  return (
                    <rect
                      key={placedColumnKey(col)}
                      x={x}
                      y={y}
                      width={sPx}
                      height={sPx}
                      fill={planPaintSwatchColor('arch', col.systemId, 'column', planColorCatalog)}
                      stroke="rgba(0,0,0,0.22)"
                      strokeWidth={0.55}
                      pointerEvents="none"
                    />
                  )
                })}

                <defs>
                  <pattern
                    id={patGridH}
                    width={cw}
                    height={cellPx}
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1={GRID_TRIM}
                      y1={0}
                      x2={cw - GRID_TRIM}
                      y2={0}
                      stroke="#ddd"
                      strokeWidth={0.35}
                    />
                  </pattern>
                  <pattern
                    id={patGridV}
                    width={cellPx}
                    height={ch}
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1={0}
                      y1={GRID_TRIM}
                      x2={0}
                      y2={ch - GRID_TRIM}
                      stroke="#ddd"
                      strokeWidth={0.35}
                    />
                  </pattern>
                  <pattern
                    id={patGridDots}
                    width={cellPx}
                    height={cellPx}
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx={0} cy={0} r={gridDotR} fill="#6a635a" />
                  </pattern>
                </defs>
                <rect width={cw} height={ch} fill={`url(#${patGridH})`} pointerEvents="none" />
                <rect width={cw} height={ch} fill={`url(#${patGridV})`} pointerEvents="none" />
                <rect width={cw} height={ch} fill={`url(#${patGridDots})`} pointerEvents="none" />

                {planLinesPaintOrder.map((item) => {
                  if (item.k === 'placed') {
                    const e = item.e
                    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
                    const sw = strokeWidthForEdge(d, e, mepById)
                    const dash = planEdgeStrokeDasharray(e.kind ?? 'wall')
                    return (
                      <line
                        key={placedEdgeKey(e)}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={planEdgeStroke(e, planColorCatalog)}
                        strokeWidth={sw}
                        strokeLinecap="square"
                        strokeDasharray={dash}
                      />
                    )
                  }
                  const e = item.e
                  const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
                  const sw = strokeWidthForRoomBoundaryLine(d)
                  return (
                    <line
                      key={`room-bd-${edgeKeyString(e)}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={PLAN_ROOM_BOUNDARY_CYAN}
                      strokeOpacity={1}
                      strokeWidth={sw}
                      strokeLinecap="round"
                      strokeDasharray={PLAN_ROOM_BOUNDARY_DASH}
                      pointerEvents="none"
                    />
                  )
                })}

                {enclosedRooms.length > 0 && (
                  <g aria-hidden pointerEvents="none">
                    {enclosedRooms.map((room, ri) => {
                      if (!roomZoneHasAssignedName(room.cellKeys, sketch.roomByCell)) return null
                      const displayName = resolveRoomDisplayName(
                        room.cellKeys,
                        sketch.roomByCell,
                        ri + 1,
                      )
                      const sqIn = room.cellKeys.length * delta * delta
                      const areaSqFtLabel = formatPlanAreaFromSqIn(sqIn, 'ft')
                      const cx = room.centroid.x * cellPx
                      const cy = room.centroid.y * cellPx
                      const outlineSegs = planRoomZoneOutlineSegments(room.cellKeys, cellPx)
                      const vividRoom = placeMode === 'room'
                      const swOut = vividRoom
                        ? Math.max(1.65, strokeWidthForRoomBoundaryLine(d) * 1.5)
                        : Math.max(0.6, strokeWidthForRoomBoundaryUnderlay(d) * 1.1)
                      return (
                        <g key={`room-anno-${room.cellKeys[0] ?? ri}`}>
                          {outlineSegs.map((seg, si) => (
                            <line
                              key={`room-bd-${room.cellKeys[0] ?? ri}-${si}`}
                              x1={seg.x1}
                              y1={seg.y1}
                              x2={seg.x2}
                              y2={seg.y2}
                              stroke={vividRoom ? PLAN_ROOM_BOUNDARY_CYAN : PLAN_ROOM_BOUNDARY_MUTED_STROKE}
                              strokeOpacity={vividRoom ? 1 : 0.4}
                              strokeWidth={swOut}
                              strokeLinecap="round"
                              strokeDasharray={vividRoom ? PLAN_ROOM_BOUNDARY_DASH : PLAN_ROOM_BOUNDARY_MUTED_DASH}
                            />
                          ))}
                          <PlanRoomNameDetail
                            cx={cx}
                            cy={cy}
                            cellPx={cellPx}
                            displayName={displayName}
                            fallbackIndex={ri + 1}
                            areaSqFtLabel={areaSqFtLabel}
                          />
                        </g>
                      )
                    })}
                  </g>
                )}

                {traceOverlay?.href &&
                  traceOverlay.visible &&
                  traceOverlay.opacity > 0 && (
                    <g
                      transform={(() => {
                        const tx = traceOverlay.tx ?? 0
                        const ty = traceOverlay.ty ?? 0
                        const r = traceOverlay.rotateDeg ?? 0
                        const s = Math.max(0.02, traceOverlay.scale ?? 1)
                        const cx = cw / 2
                        const cy = ch / 2
                        return `translate(${tx} ${ty}) translate(${cx} ${cy}) rotate(${r}) scale(${s}) translate(${-cx} ${-cy})`
                      })()}
                    >
                      <image
                        href={traceOverlay.href}
                        x={0}
                        y={0}
                        width={cw}
                        height={ch}
                        preserveAspectRatio="xMidYMid meet"
                        opacity={traceOverlay.opacity}
                        pointerEvents="none"
                      />
                    </g>
                  )}

                {layersBarHoverLayerId && layersBarHoverCells.length > 0 && (
                  <g pointerEvents="none" aria-hidden>
                    {layersBarHoverCells.map((c) => {
                      const arr = cellsGeomMap.get(cellKeyString(c)) ?? [c]
                      const idx = Math.max(
                        0,
                        arr.findIndex((x) => placedCellKey(x) === placedCellKey(c)),
                      )
                      const { inset, w } = floorCellInsetDims(cellPx, idx, arr.length, c)
                      return (
                        <rect
                          key={`layers-bar-hover-cell-${placedCellKey(c)}`}
                          x={c.i * cellPx + inset}
                          y={c.j * cellPx + inset}
                          width={w}
                          height={w}
                          fill="rgba(245, 158, 11, 0.2)"
                          stroke="#d97706"
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />
                      )
                    })}
                  </g>
                )}

                {layersBarHoverLayerId && layersBarHoverColumns.length > 0 && (
                  <g pointerEvents="none" aria-hidden>
                    {layersBarHoverColumns.map((col) => {
                      const half = col.sizeIn / 2
                      const { x, y } = planInchesToCanvasPx(d, col.cxIn - half, col.cyIn - half)
                      const sPx = col.sizeIn * d.planScale
                      return (
                        <rect
                          key={`layers-bar-hover-col-${placedColumnKey(col)}`}
                          x={x}
                          y={y}
                          width={sPx}
                          height={sPx}
                          fill="rgba(245, 158, 11, 0.2)"
                          stroke="#d97706"
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />
                      )
                    })}
                  </g>
                )}

                {layersBarHoverLayerId && layersBarHoverEdges.length > 0 && (
                  <g pointerEvents="none" aria-hidden>
                    {layersBarHoverEdges.map((e) => {
                      const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
                      return (
                        <line
                          key={`layers-bar-hover-edge-${placedEdgeKey(e)}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#d97706"
                          strokeWidth={Math.max(3.5, strokeWidthForEdge(d, e, mepById) + 2.5)}
                          strokeLinecap="square"
                          opacity={0.92}
                        />
                      )
                    })}
                  </g>
                )}

                {layersBarHoverLayerId && layersBarHoverRoomBoundaries.length > 0 && (
                  <g pointerEvents="none" aria-hidden>
                    {layersBarHoverRoomBoundaries.map((e) => {
                      const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
                      const sw = strokeWidthForRoomBoundaryLine(d)
                      return (
                        <line
                          key={`layers-bar-hover-room-bd-${edgeKeyString(e)}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#d97706"
                          strokeWidth={Math.max(3, sw + 2)}
                          strokeLinecap="round"
                          opacity={0.9}
                        />
                      )
                    })}
                  </g>
                )}

                {columnPaintPreview && placeMode === 'column' && floorTool === 'paint' && (
                  <g pointerEvents="none" aria-hidden>
                    {(() => {
                      const half = columnPaintPreview.sizeIn / 2
                      const { x, y } = planInchesToCanvasPx(
                        d,
                        columnPaintPreview.cxIn - half,
                        columnPaintPreview.cyIn - half,
                      )
                      const sPx = columnPaintPreview.sizeIn * d.planScale
                      const fill = planPaintSwatchColor(
                        'arch',
                        activeSystemId,
                        'column',
                        planColorCatalog,
                      )
                      return (
                        <rect
                          x={x}
                          y={y}
                          width={sPx}
                          height={sPx}
                          fill={fill}
                          fillOpacity={0.42}
                          stroke="#c62828"
                          strokeWidth={2.5}
                          strokeDasharray="5 4"
                          strokeOpacity={0.88}
                        />
                      )
                    })()}
                  </g>
                )}

                {wallLinePreviewKeys && wallLinePreviewKeys.length > 0 && (
                  <g pointerEvents="none">
                    {wallLinePreviewKeys.map((ks) => {
                      const parsed = parseEdgeKeyString(ks)
                      if (!parsed) return null
                      const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                      const pvStroke =
                        placeMode === 'measure'
                          ? '#1d4ed8'
                          : placeMode === 'room'
                            ? chainLineErasePreview
                              ? '#e65100'
                              : '#7c3aed'
                            : chainLineErasePreview
                              ? '#e65100'
                              : '#c62828'
                      return (
                        <line
                          key={`pv-${ks}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={pvStroke}
                          strokeWidth={2.5}
                          strokeLinecap="square"
                          strokeDasharray="5 4"
                          opacity={0.88}
                        />
                      )
                    })}
                    {measurePreviewNodes &&
                      (() => {
                        const pos = previewPathCentroidCanvas(wallLinePreviewKeys, d, delta)
                        if (!pos) return null
                        const label = gridRunMeasureCaption(
                          wallLinePreviewKeys.length * delta,
                          measurePreviewNodes.start,
                          measurePreviewNodes.end,
                          wallLinePreviewKeys.length,
                          planSiteDisplayUnit,
                        ).primary
                        const fill =
                          placeMode === 'measure'
                            ? '#1d4ed8'
                            : placeMode === 'room'
                              ? chainLineErasePreview
                                ? '#e65100'
                                : '#5b21b6'
                              : chainLineErasePreview
                                ? '#e65100'
                                : '#0f172a'
                        const labelLiftPx = 12
                        return (
                          <text
                            x={pos.x}
                            y={pos.y - labelLiftPx}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill={fill}
                            stroke="#fff"
                            strokeWidth={2.25}
                            paintOrder="stroke fill"
                            style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 12 }}
                          >
                            {label}
                          </text>
                        )
                      })()}
                  </g>
                )}

                {eraseMarqueeSvg && (eraseMarqueeSvg.w > 0 || eraseMarqueeSvg.h > 0) && (
                  <rect
                    x={eraseMarqueeSvg.x}
                    y={eraseMarqueeSvg.y}
                    width={eraseMarqueeSvg.w}
                    height={eraseMarqueeSvg.h}
                    fill={
                      marqueeTone === 'select'
                        ? 'rgba(25, 118, 210, 0.12)'
                        : marqueeTone === 'rect'
                          ? 'rgba(46, 125, 50, 0.12)'
                          : 'rgba(198, 40, 40, 0.14)'
                    }
                    stroke={
                      marqueeTone === 'select' ? '#1976d2' : marqueeTone === 'rect' ? '#2e7d32' : '#c62828'
                    }
                    strokeWidth={1}
                    strokeDasharray="5 4"
                    pointerEvents="none"
                  />
                )}

                {Array.from(selectedCellKeys).map((pk) => {
                  const c = cellByPlaced.get(pk)
                  if (!c) return null
                  const arr = cellsGeomMap.get(cellKeyString(c)) ?? [c]
                  const idx = Math.max(
                    0,
                    arr.findIndex((x) => placedCellKey(x) === pk),
                  )
                  const { inset, w } = floorCellInsetDims(cellPx, idx, arr.length, c)
                  return (
                    <rect
                      key={`sel-cell-${pk}`}
                      x={c.i * cellPx + inset}
                      y={c.j * cellPx + inset}
                      width={w}
                      height={w}
                      fill="none"
                      stroke="#1976d2"
                      strokeWidth={2.5}
                      strokeDasharray="6 4"
                      pointerEvents="none"
                    />
                  )
                })}

                {Array.from(selectedEdgeKeys)
                  .map((pk) => edgeByPlaced.get(pk))
                  .filter((ed): ed is PlacedGridEdge => ed != null)
                  .sort((a, b) => {
                    const cmp = strokeWidthForEdge(d, b, mepById) - strokeWidthForEdge(d, a, mepById)
                    return cmp !== 0 ? cmp : placedEdgeKey(a).localeCompare(placedEdgeKey(b))
                  })
                  .map((ed) => {
                    const pk = placedEdgeKey(ed)
                    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, ed, delta)
                    return (
                      <line
                        key={`sel-edge-${pk}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#1976d2"
                        strokeWidth={Math.max(3, strokeWidthForEdge(d, ed, mepById) + 2)}
                        strokeLinecap="square"
                        opacity={0.85}
                        pointerEvents="none"
                      />
                    )
                  })}

                {Array.from(selectedRoomEdgeKeys).map((gk) => {
                  const parsed = parseEdgeKeyString(gk)
                  if (!parsed) return null
                  const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                  return (
                    <line
                      key={`sel-room-edge-${gk}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={PLAN_ROOM_BOUNDARY_CYAN}
                      strokeWidth={Math.max(2.85, strokeWidthForRoomBoundaryLine(d) + 1.65)}
                      strokeLinecap="round"
                      strokeDasharray={PLAN_ROOM_BOUNDARY_DASH}
                      opacity={1}
                      pointerEvents="none"
                    />
                  )
                })}

                {placeMode === 'room' &&
                  roomTool === 'select' &&
                  selectedRoomZoneCellKeys &&
                  selectedRoomZoneCellKeys.length > 0 && (
                    <g pointerEvents="none" aria-hidden>
                      {planRoomZoneOutlineSegments(selectedRoomZoneCellKeys, cellPx).map((seg) => (
                        <line
                          key={`sel-room-zone-${seg.x1}-${seg.y1}-${seg.x2}-${seg.y2}`}
                          x1={seg.x1}
                          y1={seg.y1}
                          x2={seg.x2}
                          y2={seg.y2}
                          stroke="#1976d2"
                          strokeWidth={Math.max(2.5, strokeWidthForRoomBoundaryLine(d) + 1.75)}
                          strokeLinecap="square"
                          opacity={0.88}
                        />
                      ))}
                    </g>
                  )}

                {movePreview &&
                  (movePreview.di !== 0 || movePreview.dj !== 0) &&
                  [...(moveEdgesSnapshotRef.current ?? [])]
                    .sort((a, b) => {
                      const cmp = strokeWidthForEdge(d, b, mepById) - strokeWidthForEdge(d, a, mepById)
                      return cmp !== 0 ? cmp : placedEdgeKey(a).localeCompare(placedEdgeKey(b))
                    })
                    .map((e) => {
                      const ne = { ...e, i: e.i + movePreview.di, j: e.j + movePreview.dj }
                      const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, ne, delta)
                      return (
                        <line
                          key={`mv-edge-${edgeKeyString(e)}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#1565c0"
                          strokeWidth={Math.max(2, strokeWidthForEdge(d, e, mepById))}
                          strokeLinecap="square"
                          strokeDasharray="4 4"
                          opacity={0.75}
                          pointerEvents="none"
                        />
                      )
                    })}

                {movePreview &&
                  (movePreview.di !== 0 || movePreview.dj !== 0) &&
                  (moveRoomEdgesSnapshotRef.current ?? []).map((e) => {
                    const ne = { ...e, i: e.i + movePreview!.di, j: e.j + movePreview!.dj }
                    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, ne, delta)
                    const sw = Math.max(2.4, Math.min(5.5, 3.6 * d.planScale * 0.14))
                    return (
                      <line
                        key={`mv-room-edge-${edgeKeyString(e)}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={PLAN_ROOM_BOUNDARY_CYAN}
                        strokeWidth={sw}
                        strokeLinecap="round"
                        strokeDasharray={PLAN_ROOM_BOUNDARY_DASH}
                        opacity={0.9}
                        pointerEvents="none"
                      />
                    )
                  })}

                {movePreview &&
                  (movePreview.di !== 0 || movePreview.dj !== 0) &&
                  (moveCellsSnapshotRef.current ?? []).map((c) => {
                    const nc = { ...c, i: c.i + movePreview.di, j: c.j + movePreview.dj }
                    return (
                      <rect
                        key={`mv-cell-${cellKeyString(c)}`}
                        x={nc.i * cellPx}
                        y={nc.j * cellPx}
                        width={cellPx}
                        height={cellPx}
                        fill="rgba(21, 101, 192, 0.22)"
                        stroke="#1565c0"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        pointerEvents="none"
                      />
                    )
                  })}

                {hoverEdge &&
                  (() => {
                    const parts = hoverEdge.split(':')
                    const axis = parts[0] as 'h' | 'v'
                    const i = Number(parts[1])
                    const j = Number(parts[2])
                    if (axis !== 'h' && axis !== 'v') return null
                    const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, { axis, i, j }, delta)
                    return (
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#c62828"
                        strokeWidth={3}
                        strokeLinecap="square"
                        opacity={0.85}
                        pointerEvents="none"
                      />
                    )
                  })()}

                {(isCellPaintMode || (placeMode === 'room' && roomTool !== 'autoFill')) && hoverCell && (
                  <rect
                    x={hoverCell.i * cellPx}
                    y={hoverCell.j * cellPx}
                    width={cellPx}
                    height={cellPx}
                    fill="none"
                    stroke={
                      placeMode === 'room' && exteriorCells.has(cellKeyString(hoverCell))
                        ? '#64748b'
                        : '#c62828'
                    }
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    opacity={0.9}
                    pointerEvents="none"
                  />
                )}

                {measureRuns.map((run) => (
                  <GridPathDimensionOverlay
                    key={run.id}
                    d={d}
                    delta={delta}
                    edgeKeys={run.edgeKeys}
                    startNode={run.startNode}
                    endNode={run.endNode}
                    primary={
                      gridRunMeasureCaption(
                        run.edgeKeys.length * delta,
                        run.startNode,
                        run.endNode,
                        run.edgeKeys.length,
                        planSiteDisplayUnit,
                      ).primary
                    }
                    sub={
                      gridRunMeasureCaption(
                        run.edgeKeys.length * delta,
                        run.startNode,
                        run.endNode,
                        run.edgeKeys.length,
                        planSiteDisplayUnit,
                      ).sub
                    }
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
