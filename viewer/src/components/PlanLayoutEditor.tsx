import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  PlanAnnotationGridRun,
  PlanAnnotationSectionCut,
  PlanSketchCommitOptions,
} from '../types/planLayout'
import {
  edgeKeyString,
  cellKeyString,
  cellPaintKind,
  cellsByGeometry,
  isExclusiveArchFloorPaintCell,
  isExclusiveArchWallSegmentStroke,
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
  wallLineDragEndSnapDistIn,
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
  buildPlanRoomCellKeyIndex,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
} from '../lib/planRooms'
import {
  planCellFill,
  planEdgeStroke,
  planEdgeStrokeDasharray,
  planPaintSwatchColor,
  planPlacedEdgeOpacity,
  planCellColumnOpacity,
  type PlanColorCatalog,
  type PlanPlaceMode,
  type PlanVisualProfile,
} from '../lib/planLayerColors'
import { planColumnSquareInchesFromSystem } from '../lib/planColumnSize'
import { PLAN_ROOMS_LAYER_ID, PLAN_ROOMS_LAYER_SYSTEM_ID } from '../lib/planRoomsLayerIdentity'
import type { ActiveCatalog } from './planLayoutCore/types'
import { usePlanEditorZoom } from './planLayoutCore/usePlanEditorZoom'
export type { ActiveCatalog } from './planLayoutCore/types'
import {
  EMPTY_ANNOTATION_GRID,
  EMPTY_ANNOTATION_LABELS,
  EMPTY_ELEVATION_LEVEL_LINES,
  EMPTY_MEASURE_RUNS,
  EMPTY_SECTION_CUTS,
  GRID_TRIM,
  MARQUEE_CLICK_MAX_PX,
  PLAN_ROOM_BOUNDARY_CYAN,
  PLAN_ROOM_BOUNDARY_DASH,
  PLAN_ROOM_BOUNDARY_MUTED_DASH,
  PLAN_ROOM_BOUNDARY_MUTED_STROKE,
  ZOOM_BUTTON_RATIO,
  ZOOM_MAX,
  ZOOM_WHEEL_SENS,
} from './planLayoutCore/constants'
import {
  annotationHitKeyAtPlanInches,
  annotationKeysIntersectingPlanRect,
  clampCellMoveDelta,
  clampEdgeMoveDelta,
  clampMarqueeSvgRect,
  clampRoomBoundaryMoveDelta,
  clampZoom,
  floorCellInsetDims,
  gridRunMeasureCaption,
  mergePaintStrokeIntoCells,
  moveClickMaxPlanIn,
  nextSketchAfterRemovingAnnotationKeys,
  planRoomZoneOutlineSegments,
  planToolbarEdgeKind,
  pointInSelectedFloorBBox,
  previewPathCentroidCanvas,
  wallPreviewPolylinePointsCanvas,
  strokeWidthForEdge,
  strokeWidthForRoomBoundaryLine,
  strokeWidthForRoomBoundaryUnderlay,
} from './planLayoutCore/planEditorGeometry'
import {
  AnnotationKeyHighlightOverlay,
  GridPathDimensionOverlay,
  GridReferencePathOverlay,
  PlanRoomNameDetail,
  SectionCutGraphic,
} from './planLayoutCore/overlays'

export type LayoutTool = 'paint' | 'rect' | 'erase' | 'select'
export type FloorTool = 'paint' | 'fill' | 'erase' | 'select'
/** Annotation place mode sub-tools (implementation plan). */
export type AnnotationTool =
  | 'measureLine'
  | 'gridLine'
  | 'textLabel'
  | 'sectionCut'
  | 'select'
  | 'erase'
  /** Elevation sheets only: full-width horizontal grade line (`elevationGroundPlaneJ`). */
  | 'groundLine'
  /** Elevation sheets only: shared datum / level lines (`elevationLevelLines`). */
  | 'levelLine'
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
  /** Annotation mode: dimension / grid ref / text / section / erase. */
  annotationTool?: AnnotationTool
  /** Text tool: string placed at click (plan inches). */
  annotationLabelDraft?: string
  /** Elevation · Level line tool: optional tag shown at the left of the line. */
  levelLineLabelDraft?: string
  /** Fired when annotation Select tool selection changes (`dim:…`, `grid:…`, `sec:…`, `lbl:…`). */
  onSelectedAnnotationKeysChange?: (keys: readonly string[]) => void
  mepItems: MepItem[]
  /** Arch catalog systems (for column footprint size from layer thickness). */
  orderedSystems: readonly SystemData[]
  /** Maps each catalog system id to a well-separated hue on the plan. */
  planColorCatalog: PlanColorCatalog
  /** Site dimension unit from Setup — used to label measure tool distances. */
  planSiteDisplayUnit: PlanSiteDisplayUnit
  /**
   * When set, drawing grid uses this rectangle (plan inches) instead of resolved site/footprint from the sketch.
   * Used for elevation sheets (horizontal span = footprint width or depth by face; vertical = building height).
   */
  canvasExtentsIn?: { widthIn: number; heightIn: number } | null
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
  /** When false, MEP run placement/edits are blocked (e.g. Layout sheet). */
  allowMepEditing?: boolean
  /** Dim/highlight geometry by Floor 1 sheet context. */
  planVisualProfile?: PlanVisualProfile | null
  /** Layers bar hover: `source\\tsystemId` — highlights that layer on the plan. */
  layersBarHoverLayerId?: string | null
  /** Increment `nonce` to select all edges/cells for this layer (parent sets active catalog + system + tools/mode). */
  layersBarSelectRequest?: { source: ActiveCatalog; systemId: string; nonce: number } | null
  /** Increment to select everything on the current layer tool group (walls / floor / rooms / …). */
  globalSelectAllNonce?: number
  /** Room Select: highlighted zone cell keys; click fill picks a zone and calls `onRoomZoneSelect`. */
  selectedRoomZoneCellKeys?: readonly string[] | null
  /** Room Select: pick or clear the named zone (parent syncs toolbar name + applies on blur). */
  onRoomZoneSelect?: (payload: { cellKeys: readonly string[]; displayName: string } | null) => void
  /**
   * Bump `nonce` when the parent wants the viewport to frame these grid cells (e.g. room picked from toolbar).
   * Uses the same SVG cell coordinates as the plan grid.
   */
  roomZoneCameraRequest?: { nonce: number; cellKeys: readonly string[] } | null
  className?: string
}

function wallPreviewRubberPlanInFrom(
  endNode: { i: number; j: number },
  pin: { xIn: number; yIn: number },
  gridDeltaIn: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = endNode.i * gridDeltaIn
  const y0 = endNode.j * gridDeltaIn
  const x1 = pin.xIn
  const y1 = pin.yIn
  if (Math.hypot(x1 - x0, y1 - y0) < gridDeltaIn * 0.06) return null
  return { x0, y0, x1, y1 }
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
  annotationTool = 'measureLine',
  annotationLabelDraft = '',
  levelLineLabelDraft = '',
  onSelectedAnnotationKeysChange,
  mepItems,
  orderedSystems,
  planColorCatalog,
  planSiteDisplayUnit,
  canvasExtentsIn = null,
  pickTolerancePx = 14,
  traceOverlay = null,
  suspendPlanPainting = false,
  allowMepEditing = true,
  planVisualProfile = null,
  layersBarHoverLayerId = null,
  layersBarSelectRequest = null,
  globalSelectAllNonce = 0,
  selectedRoomZoneCellKeys = null,
  onRoomZoneSelect,
  roomZoneCameraRequest = null,
  className,
}: PlanLayoutEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const planBoxRef = useRef<HTMLDivElement>(null)
  const { zoom, setZoom, zoomRef, applyZoom, applyZoomRef, zoomCommitRef } = usePlanEditorZoom(
    scrollRef,
    planBoxRef,
  )
  const paintDragRef = useRef(false)
  const lastStrokeEdgeKeyRef = useRef<string | null>(null)
  const lastStrokeCellKeyRef = useRef<string | null>(null)
  const lastWallNodeRef = useRef<{ i: number; j: number } | null>(null)
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
  /** Short dashed segment from snapped path end to live cursor (plan inches). */
  const [wallLinePreviewRubberPlanIn, setWallLinePreviewRubberPlanIn] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
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
  /** Columns tool — `placedColumnKey` values (floor Select sub-tool). */
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(() => new Set())
  /** Annotation Select — keys `dim:id`, `grid:id`, `sec:id`, `lbl:id`. */
  const [selectedAnnotationKeys, setSelectedAnnotationKeys] = useState<Set<string>>(() => new Set())
  /** Hover highlight for annotation Select tool (under-cursor preview). */
  const [hoverAnnotationSelectKey, setHoverAnnotationSelectKey] = useState<string | null>(null)
  /** Hover highlight for annotation Erase tool (under-cursor preview). */
  const [hoverAnnotationEraseKey, setHoverAnnotationEraseKey] = useState<string | null>(null)
  /** While dragging an annotation erase box, keys that intersect the marquee (preview). */
  const [eraseMarqueeAnnotationPreviewKeys, setEraseMarqueeAnnotationPreviewKeys] = useState<string[] | null>(
    null,
  )
  const [movePreview, setMovePreview] = useState<{ di: number; dj: number } | null>(null)
  const measureRunIdRef = useRef(0)
  const annotationGridRunIdRef = useRef(0)
  const sectionCutIdRef = useRef(0)
  const annotationLabelIdRef = useRef(0)
  const levelLineIdRef = useRef(0)
  const measureRuns = sketch.measureRuns?.length ? sketch.measureRuns : EMPTY_MEASURE_RUNS
  const annotationGridRuns = sketch.annotationGridRuns?.length
    ? sketch.annotationGridRuns
    : EMPTY_ANNOTATION_GRID
  const annotationLabels = sketch.annotationLabels?.length
    ? sketch.annotationLabels
    : EMPTY_ANNOTATION_LABELS
  const annotationSectionCuts = sketch.annotationSectionCuts?.length
    ? sketch.annotationSectionCuts
    : EMPTY_SECTION_CUTS
  const elevationLevelLines = sketch.elevationLevelLines?.length
    ? sketch.elevationLevelLines
    : EMPTY_ELEVATION_LEVEL_LINES
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
    | 'annotation-grid-line'
    | 'section-cut-line'
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
    | 'annotation-select-marquee'
    | 'annotation-erase-marquee'
    | null
  >(null)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Last pointer position (for Shift chain preview when key is pressed before the next move). */
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const floorToolRef = useRef(floorTool)
  floorToolRef.current = floorTool

  const sketchRef = useRef(sketch)
  sketchRef.current = sketch
  const floorStrokeAccumRef = useRef<PlacedFloorCell[]>([])
  const floorStrokeRafRef = useRef<number | null>(null)

  const annotationToolActive = placeMode === 'annotate'

  useLayoutEffect(() => {
    if (!wallLinePreviewKeys?.length) setWallLinePreviewRubberPlanIn(null)
  }, [wallLinePreviewKeys])

  useEffect(() => {
    if (!annotationToolActive || annotationTool !== 'select') setHoverAnnotationSelectKey(null)
  }, [annotationToolActive, annotationTool])

  useEffect(() => {
    if (!annotationToolActive || annotationTool !== 'erase') {
      setHoverAnnotationEraseKey(null)
      setEraseMarqueeAnnotationPreviewKeys(null)
    }
  }, [annotationToolActive, annotationTool])

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
      annotationToolActive
    ) {
      setColumnPaintPreview(null)
    }
  }, [placeMode, floorTool, activeCatalog, suspendPlanPainting, annotationToolActive])

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
    if (placeMode !== 'column' || floorTool !== 'select') setSelectedColumnKeys(new Set())
  }, [placeMode, floorTool])

  useEffect(() => {
    if (roomTool !== 'select') setSelectedRoomEdgeKeys(new Set())
  }, [roomTool])

  useEffect(() => {
    if (placeMode !== 'room') setSelectedRoomEdgeKeys(new Set())
  }, [placeMode])

  useEffect(() => {
    if (!annotationToolActive || annotationTool !== 'select') {
      setSelectedAnnotationKeys(new Set())
    }
  }, [annotationToolActive, annotationTool])

  useEffect(() => {
    onSelectedAnnotationKeysChange?.(Array.from(selectedAnnotationKeys))
  }, [selectedAnnotationKeys, onSelectedAnnotationKeysChange])

  const lastLayersBarSelectNonce = useRef(0)
  useEffect(() => {
    const req = layersBarSelectRequest
    if (!req?.systemId || req.nonce < 1) return
    if (req.nonce === lastLayersBarSelectNonce.current) return
    lastLayersBarSelectNonce.current = req.nonce
    setSelectedAnnotationKeys(new Set())
    setSelectedColumnKeys(new Set())
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
      setEraseMarqueeAnnotationPreviewKeys(null)
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
    placeMode !== 'annotate' &&
    placeMode !== 'room'

  const lastGlobalSelectAllNonce = useRef(0)
  useEffect(() => {
    const n = globalSelectAllNonce ?? 0
    if (n < 1 || n === lastGlobalSelectAllNonce.current) return
    lastGlobalSelectAllNonce.current = n
    setSelectedEdgeKeys(new Set())
    setSelectedCellKeys(new Set())
    setSelectedRoomEdgeKeys(new Set())
    setSelectedColumnKeys(new Set())
    setSelectedAnnotationKeys(new Set())
    onRoomZoneSelect?.(null)

    if (placeMode === 'annotate') {
      const keys: string[] = []
      for (const r of sketch.measureRuns ?? []) keys.push(`dim:${r.id}`)
      for (const r of sketch.annotationGridRuns ?? []) keys.push(`grid:${r.id}`)
      for (const c of sketch.annotationSectionCuts ?? []) keys.push(`sec:${c.id}`)
      for (const l of sketch.annotationLabels ?? []) keys.push(`lbl:${l.id}`)
      for (const l of sketch.elevationLevelLines ?? []) keys.push(`lvl:${l.id}`)
      setSelectedAnnotationKeys(new Set(keys))
      return
    }
    if (placeMode === 'room') {
      const rb = sketch.roomBoundaryEdges ?? []
      setSelectedRoomEdgeKeys(new Set(rb.map((e) => edgeKeyString(e))))
      return
    }
    if (placeMode === 'floor' || placeMode === 'stairs') {
      const want = placeMode === 'stairs' ? ('stairs' as const) : ('floor' as const)
      const picked = (sketch.cells ?? []).filter((c) => cellPaintKind(c) === want).map(placedCellKey)
      setSelectedCellKeys(new Set(picked))
      return
    }
    if (placeMode === 'column') {
      const picked = (sketch.columns ?? []).map(placedColumnKey)
      setSelectedColumnKeys(new Set(picked))
      return
    }
    if (isEdgeLayerMode) {
      const wantKind = planToolbarEdgeKind(placeMode, activeCatalog)
      const edgeKeys = sketch.edges
        .filter((e) => (e.kind ?? 'wall') === wantKind)
        .map(placedEdgeKey)
      setSelectedEdgeKeys(new Set(edgeKeys))
    }
  }, [
    globalSelectAllNonce,
    placeMode,
    activeCatalog,
    isEdgeLayerMode,
    sketch.edges,
    sketch.cells,
    sketch.columns,
    sketch.roomBoundaryEdges,
    sketch.measureRuns,
    sketch.annotationGridRuns,
    sketch.annotationSectionCuts,
    sketch.annotationLabels,
    sketch.elevationLevelLines,
    onRoomZoneSelect,
  ])

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

  const { w: siteWIn, h: siteHIn } = useMemo(() => {
    if (
      canvasExtentsIn &&
      Number.isFinite(canvasExtentsIn.widthIn) &&
      Number.isFinite(canvasExtentsIn.heightIn) &&
      canvasExtentsIn.widthIn > 0 &&
      canvasExtentsIn.heightIn > 0
    ) {
      return { w: canvasExtentsIn.widthIn, h: canvasExtentsIn.heightIn }
    }
    return resolvedSiteInches(sketch, d)
  }, [canvasExtentsIn, sketch, d])
  const isElevationCanvas = Boolean(
    canvasExtentsIn &&
      Number.isFinite(canvasExtentsIn.widthIn) &&
      Number.isFinite(canvasExtentsIn.heightIn) &&
      canvasExtentsIn.widthIn > 0 &&
      canvasExtentsIn.heightIn > 0,
  )
  const cw = siteWIn * d.planScale
  const ch = siteHIn * d.planScale
  const delta = sketch.gridSpacingIn
  /** Grid counts for the full lot — walls and floor use this same grid. */
  const { nx: siteNx, ny: siteNy } = useMemo(() => gridCounts(siteWIn, siteHIn, delta), [siteWIn, siteHIn, delta])

  const mepById = useMemo(() => new Map(mepItems.map((m) => [m.id, m])), [mepItems])
  const blockMepMutations = !allowMepEditing && (placeMode === 'mep' || activeCatalog === 'mep')
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
  const roomCellKeyIndex = useMemo(() => buildPlanRoomCellKeyIndex(enclosedRooms), [enclosedRooms])

  useEffect(() => {
    if (placeMode !== 'room' || roomTool !== 'select') {
      onRoomZoneSelect?.(null)
    }
  }, [placeMode, roomTool, onRoomZoneSelect])

  useEffect(() => {
    if (!selectedRoomZoneCellKeys?.length || !onRoomZoneSelect) return
    const entry = roomCellKeyIndex.get(selectedRoomZoneCellKeys[0]!)
    const comp = entry?.room
    if (!comp) {
      onRoomZoneSelect(null)
      return
    }
    if (comp.cellKeys.length !== selectedRoomZoneCellKeys.length) {
      onRoomZoneSelect(null)
      return
    }
    const inComp = new Set(comp.cellKeys)
    for (let i = 0; i < selectedRoomZoneCellKeys.length; i++) {
      if (!inComp.has(selectedRoomZoneCellKeys[i]!)) {
        onRoomZoneSelect(null)
        return
      }
    }
  }, [roomCellKeyIndex, selectedRoomZoneCellKeys, onRoomZoneSelect])

  const maxDistIn = useMemo(() => {
    const pxToIn = 1 / Math.max(d.planScale, 1e-6)
    return pickTolerancePx * pxToIn / Math.max(zoom, 0.25)
  }, [d.planScale, pickTolerancePx, zoom])

  const cellPx = delta * d.planScale

  const selectedRoomZoneOutlineSegs = useMemo(() => {
    if (!selectedRoomZoneCellKeys?.length) return null
    return planRoomZoneOutlineSegments(selectedRoomZoneCellKeys, cellPx)
  }, [selectedRoomZoneCellKeys, cellPx])

  useLayoutEffect(() => {
    const req = roomZoneCameraRequest
    if (!req?.cellKeys.length) return
    let minI = Infinity
    let maxI = -Infinity
    let minJ = Infinity
    let maxJ = -Infinity
    for (const k of req.cellKeys) {
      const parts = k.split(':')
      if (parts.length !== 2) continue
      const i = Number(parts[0])
      const j = Number(parts[1])
      if (!Number.isFinite(i) || !Number.isFinite(j)) continue
      minI = Math.min(minI, i)
      maxI = Math.max(maxI, i)
      minJ = Math.min(minJ, j)
      maxJ = Math.max(maxJ, j)
    }
    if (!Number.isFinite(minI)) return

    const scroll = scrollRef.current
    const plan = planBoxRef.current
    if (!scroll || !plan) return
    const vpW = scroll.clientWidth
    const vpH = scroll.clientHeight
    if (vpW <= 1 || vpH <= 1) return

    const pad = cellPx * 0.35
    const bw = Math.max((maxI - minI + 1) * cellPx + 2 * pad, cellPx)
    const bh = Math.max((maxJ - minJ + 1) * cellPx + 2 * pad, cellPx)
    const cx = ((minI + maxI + 1) / 2) * cellPx
    const cy = ((minJ + maxJ + 1) / 2) * cellPx

    const margin = 0.88
    const z1 = clampZoom(Math.min((vpW * margin) / bw, (vpH * margin) / bh, ZOOM_MAX))

    zoomCommitRef.current = null
    flushSync(() => {
      setZoom(z1)
    })

    const sr = scroll.getBoundingClientRect()
    const pr = plan.getBoundingClientRect()
    const z = z1
    scroll.scrollLeft += pr.left + cx * z - sr.left - sr.width / 2
    scroll.scrollTop += pr.top + cy * z - sr.top - sr.height / 2

    const maxL = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
    const maxT = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    scroll.scrollLeft = Math.max(0, Math.min(maxL, scroll.scrollLeft))
    scroll.scrollTop = Math.max(0, Math.min(maxT, scroll.scrollTop))
  }, [roomZoneCameraRequest, cellPx, setZoom])

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
    if (
      isElevationCanvas &&
      annotationTool === 'groundLine' &&
      sketch.elevationGroundPlaneJ != null
    ) {
      onSketchChange({ ...sketch, elevationGroundPlaneJ: undefined })
      return
    }
    let edges = sketch.edges
    let cells = sketch.cells ?? []
    let nextRoomByCell: Record<string, string> | undefined = sketch.roomByCell
    let changed = false
    if (annotationToolActive && annotationTool === 'select' && selectedAnnotationKeys.size > 0) {
      const dimIds = new Set<string>()
      const gridIds = new Set<string>()
      const secIds = new Set<string>()
      const lblIds = new Set<string>()
      const lvlIds = new Set<string>()
      for (const key of selectedAnnotationKeys) {
        if (key.startsWith('dim:')) dimIds.add(key.slice(4))
        else if (key.startsWith('grid:')) gridIds.add(key.slice(5))
        else if (key.startsWith('sec:')) secIds.add(key.slice(4))
        else if (key.startsWith('lbl:')) lblIds.add(key.slice(4))
        else if (key.startsWith('lvl:')) lvlIds.add(key.slice(4))
      }
      const nextMeasure = (sketch.measureRuns ?? []).filter((r) => !dimIds.has(r.id))
      const nextGrid = (sketch.annotationGridRuns ?? []).filter((r) => !gridIds.has(r.id))
      const nextSec = (sketch.annotationSectionCuts ?? []).filter((c) => !secIds.has(c.id))
      const nextLab = (sketch.annotationLabels ?? []).filter((l) => !lblIds.has(l.id))
      const nextLvl = (sketch.elevationLevelLines ?? []).filter((l) => !lvlIds.has(l.id))
      setSelectedAnnotationKeys(new Set())
      onSketchChange({
        ...sketch,
        measureRuns: nextMeasure.length > 0 ? nextMeasure : undefined,
        annotationGridRuns: nextGrid.length > 0 ? nextGrid : undefined,
        annotationSectionCuts: nextSec.length > 0 ? nextSec : undefined,
        annotationLabels: nextLab.length > 0 ? nextLab : undefined,
        elevationLevelLines: nextLvl.length > 0 ? nextLvl : undefined,
      })
      return
    }
    if (placeMode === 'column' && floorTool === 'select' && selectedColumnKeys.size > 0) {
      const rm = selectedColumnKeys
      const nextCols = (sketch.columns ?? []).filter((c) => !rm.has(placedColumnKey(c)))
      setSelectedColumnKeys(new Set())
      onSketchChange({
        ...sketch,
        columns: nextCols.length > 0 ? nextCols : undefined,
      })
      return
    }
    if (structureTool === 'select' && selectedEdgeKeys.size > 0) {
      const rm = selectedEdgeKeys
      edges = edges.filter((ed) => {
        if (!rm.has(placedEdgeKey(ed))) return true
        if (!allowMepEditing && (ed.source ?? 'arch') === 'mep') return true
        return false
      })
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
    selectedColumnKeys,
    onRoomZoneSelect,
    onSketchChange,
    annotationToolActive,
    annotationTool,
    selectedAnnotationKeys.size,
    allowMepEditing,
    isElevationCanvas,
    sketch.elevationGroundPlaneJ,
    annotationTool,
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
        if (annotationToolActive && annotationTool === 'measureLine') {
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
        setSelectedAnnotationKeys(new Set())
        setSelectedColumnKeys(new Set())
        setColumnPaintPreview(null)
        onRoomZoneSelect?.(null)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          isElevationCanvas &&
          annotationTool === 'groundLine' &&
          sketch.elevationGroundPlaneJ != null
        ) {
          e.preventDefault()
          onSketchChange({ ...sketch, elevationGroundPlaneJ: undefined })
          return
        }
        const canDelAnnotations =
          annotationToolActive && annotationTool === 'select' && selectedAnnotationKeys.size > 0
        const canDelEdges = structureTool === 'select' && selectedEdgeKeys.size > 0
        const canDelCells = floorTool === 'select' && selectedCellKeys.size > 0
        const canDelColumns =
          placeMode === 'column' && floorTool === 'select' && selectedColumnKeys.size > 0
        const canDelRoom =
          placeMode === 'room' &&
          roomTool === 'select' &&
          (selectedRoomEdgeKeys.size > 0 || !!selectedRoomZoneCellKeys?.length)
        if (canDelAnnotations || canDelEdges || canDelCells || canDelColumns || canDelRoom) {
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
    annotationToolActive,
    annotationTool,
    onSketchChange,
    sketch,
    selectedEdgeKeys.size,
    selectedCellKeys.size,
    selectedRoomEdgeKeys.size,
    selectedRoomZoneCellKeys?.length,
    selectedColumnKeys.size,
    placeMode,
    roomTool,
    structureTool,
    floorTool,
    onRoomZoneSelect,
    selectedAnnotationKeys.size,
    annotationTool,
    annotationToolActive,
    isElevationCanvas,
    sketch.elevationGroundPlaneJ,
    annotationTool,
  ])

  const assignEdge = useCallback(
    (key: { i: number; j: number; axis: 'h' | 'v' }) => {
      if (blockMepMutations) return
      const k = edgeKeyString(key)
      const layer = `${edgePlacementSource}\t${activeSystemId}`
      if (structureTool === 'erase') {
        updateEdges((list) =>
          list.filter((e) => {
            if (edgeKeyString(e) !== k) return true
            if (placementKind() === 'wall' && isExclusiveArchWallSegmentStroke(e)) return false
            return layerIdentityFromEdge(e) !== activeLayerId
          }),
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
        const filtered = list.filter((e) => {
          if (edgeKeyString(e) !== k) return true
          if (layerIdentityFromEdge(e) === layer) return false
          if (isExclusiveArchWallSegmentStroke(placed) && isExclusiveArchWallSegmentStroke(e)) return false
          return true
        })
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
      blockMepMutations,
    ],
  )

  const applyNodeChainWalls = useCallback(
    (i0: number, j0: number, i1: number, j1: number) => {
      if (blockMepMutations) return false
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
          next = next.filter((e) => {
            if (edgeKeyString(e) !== ek) return true
            if (layerIdentityFromEdge(e) === lid) return false
            if (isExclusiveArchWallSegmentStroke(p) && isExclusiveArchWallSegmentStroke(e)) return false
            return true
          })
        }
        next = next.concat(placed)
        return next
      })
      return true
    },
    [siteNx, siteNy, activeSystemId, edgePlacementSource, placementKind, updateEdges, blockMepMutations],
  )

  const removeNodeChainWalls = useCallback(
    (i0: number, j0: number, i1: number, j1: number) => {
      if (blockMepMutations) return false
      const seg = edgesInNodeSpan(i0, j0, i1, j1)
      if (seg.length === 0) return false
      const valid = seg.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return false
      const keys = new Set(seg.map((k) => edgeKeyString(k)))
      updateEdges((list) =>
        list.filter((e) => {
          if (!keys.has(edgeKeyString(e))) return true
          if (placementKind() === 'wall' && isExclusiveArchWallSegmentStroke(e)) return false
          return layerIdentityFromEdge(e) !== activeLayerId
        }),
      )
      return true
    },
    [siteNx, siteNy, updateEdges, activeLayerId, placementKind, blockMepMutations],
  )

  const applyWallStrokeKeys = useCallback(
    (keys: GridEdgeKey[]) => {
      if (blockMepMutations) return
      if (keys.length === 0) return
      const valid = keys.every((k) => {
        if (k.axis === 'h') return k.i >= 0 && k.i < siteNx && k.j >= 0 && k.j <= siteNy
        return k.i >= 0 && k.i <= siteNx && k.j >= 0 && k.j < siteNy
      })
      if (!valid) return
      if (structureTool === 'erase') {
        const rm = new Set(keys.map(edgeKeyString))
        updateEdges((list) =>
          list.filter((e) => {
            if (!rm.has(edgeKeyString(e))) return true
            if (placementKind() === 'wall' && isExclusiveArchWallSegmentStroke(e)) return false
            return layerIdentityFromEdge(e) !== activeLayerId
          }),
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
          next = next.filter((e) => {
            if (edgeKeyString(e) !== ek) return true
            if (layerIdentityFromEdge(e) === lid) return false
            if (isExclusiveArchWallSegmentStroke(p) && isExclusiveArchWallSegmentStroke(e)) return false
            return true
          })
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
      blockMepMutations,
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
      if (annotationToolActive || suspendPlanPainting || (!shiftChainStructure && !shiftChainRoom)) {
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
      const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
        setWallLinePreviewRubberPlanIn(wallPreviewRubberPlanInFrom(endNode, pin, delta))
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
      annotationToolActive,
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
          dk === 'floor-select-marquee' ||
          dk === 'annotation-select-marquee' ||
          dk === 'annotation-erase-marquee'
        ) {
          const svg = svgRef.current
          const start = marqueeStartRef.current
          if (svg && start) {
            const p = clientToSvgPoint(svg, e.clientX, e.clientY)
            if (p) {
              const r = clampMarqueeSvgRect(start.x, start.y, p.x, p.y, cw, ch)
              marqueeRectRef.current = r
              setEraseMarqueeSvg(r)
              if (dk === 'annotation-erase-marquee' && r.w > 0 && r.h > 0) {
                const ps = d.planScale
                const minX = r.x / ps
                const minY = r.y / ps
                const maxX = (r.x + r.w) / ps
                const maxY = (r.y + r.h) / ps
                const picked = annotationKeysIntersectingPlanRect(
                  sketchRef.current,
                  minX,
                  minY,
                  maxX,
                  maxY,
                  delta,
                  isElevationCanvas,
                ).sort()
                setEraseMarqueeAnnotationPreviewKeys((prev) =>
                  prev &&
                  prev.length === picked.length &&
                  picked.every((k, i) => k === prev[i]!)
                    ? prev
                    : picked,
                )
              } else if (dk === 'annotation-erase-marquee') {
                setEraseMarqueeAnnotationPreviewKeys(null)
              }
            }
          }
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setHoverAnnotationSelectKey(null)
          setHoverAnnotationEraseKey(null)
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
          setHoverAnnotationSelectKey(null)
        }
        return
      }

      const inside =
        pin.xIn >= 0 && pin.yIn >= 0 && pin.xIn <= siteWIn && pin.yIn <= siteHIn

      const dkLine = dragKindRef.current
      if (paintDragRef.current && inside && dkLine === 'section-cut-line' && annotationToolActive) {
        const start = wallLineDragStartRef.current
        if (!start) {
          setHoverEdge(null)
          setHoverCell(null)
          return
        }
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
        setWallLinePreviewKeys(null)
        if (
          endNode &&
          (endNode.i !== start.i || endNode.j !== start.j) &&
          endNode.i >= 0 &&
          endNode.j >= 0 &&
          endNode.i <= siteNx &&
          endNode.j <= siteNy
        ) {
          setMeasurePreviewNodes({ start, end: endNode })
        } else {
          setMeasurePreviewNodes(null)
        }
        setHoverEdge(null)
        setHoverCell(null)
        return
      }

      if (
        paintDragRef.current &&
        inside &&
        ((dkLine === 'wall-line' && isEdgeLayerMode) ||
          (dkLine === 'chain-line' && isEdgeLayerMode) ||
          (dkLine === 'room-line' && isRoomBoundaryEdgeMode) ||
          (dkLine === 'room-chain-line' && isRoomBoundaryEdgeMode) ||
          ((dkLine === 'measure-line' && annotationToolActive && annotationTool === 'measureLine') ||
            (dkLine === 'annotation-grid-line' && annotationToolActive && annotationTool === 'gridLine')))
      ) {
        const start = wallLineDragStartRef.current
        if (!start) {
          setHoverEdge(null)
          setHoverCell(null)
          return
        }
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
          const nextPv = keys.map(edgeKeyString)
          setWallLinePreviewKeys((prev) => {
            if (prev && prev.length === nextPv.length) {
              let same = true
              for (let i = 0; i < prev.length; i++) {
                if (prev[i] !== nextPv[i]) {
                  same = false
                  break
                }
              }
              if (same) return prev
            }
            return nextPv
          })
          setWallLinePreviewRubberPlanIn(wallPreviewRubberPlanInFrom(endNode, pin, delta))
          if (
            dkLine === 'measure-line' ||
            dkLine === 'annotation-grid-line' ||
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
            dkLine === 'annotation-grid-line' ||
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
          setHoverAnnotationSelectKey(null)
          setHoverAnnotationEraseKey(null)
        }
        return
      }

      if (!paintDragRef.current && annotationToolActive && annotationTool === 'erase' && inside) {
        const h = annotationHitKeyAtPlanInches(
          pin,
          sketch,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
          isElevationCanvas,
        )
        setHoverAnnotationEraseKey((prev) => (prev === h ? prev : h))
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
        return
      }

      if (
        !paintDragRef.current &&
        annotationToolActive &&
        annotationTool === 'select'
      ) {
        const h = annotationHitKeyAtPlanInches(
          pin,
          sketch,
          siteWIn,
          siteHIn,
          delta,
          maxDistIn,
          isElevationCanvas,
        )
        setHoverAnnotationSelectKey((prev) => (prev === h ? prev : h))
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
        return
      }

      const shiftChainEligible =
        !paintDragRef.current &&
        e.shiftKey &&
        !suspendPlanPainting &&
        !annotationToolActive &&
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
          !annotationToolActive
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
      annotationToolActive,
      annotationTool,
      suspendPlanPainting,
      updateShiftChainHoverPreview,
      structureTool,
      floorTool,
      orderedSystems,
      sketch,
      d.planScale,
      delta,
      isElevationCanvas,
    ],
  )

  const insideSite = useCallback(
    (xIn: number, yIn: number) =>
      xIn >= 0 && yIn >= 0 && xIn <= siteWIn && yIn <= siteHIn,
    [siteWIn, siteHIn],
  )

  const onPointerLeave = useCallback(() => {
    // Active drags use pointer capture; leaving the SVG bbox still fires leave on the
    // element. Do not reset drag state here or marquee erase / box tools never commit.
    if (paintDragRef.current) {
      setHoverEdge(null)
      setHoverCell(null)
      setColumnPaintPreview(null)
      setHoverAnnotationSelectKey(null)
      setHoverAnnotationEraseKey(null)
      return
    }
    endPaintStroke()
    setHoverEdge(null)
    setHoverCell(null)
    setColumnPaintPreview(null)
    setHoverAnnotationSelectKey(null)
    setHoverAnnotationEraseKey(null)
    setEraseMarqueeAnnotationPreviewKeys(null)
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
        const thr = moveClickMaxPlanIn(delta)
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
              if (!allowMepEditing && snap.some((ed) => (ed.source ?? 'arch') === 'mep')) {
                endPaintStroke()
                release()
                return
              }
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
        const thr = moveClickMaxPlanIn(delta)
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
        const thr = moveClickMaxPlanIn(delta)
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

      if (kind === 'annotation-select-marquee') {
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = annotationHitKeyAtPlanInches(
                pin,
                sketch,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
                isElevationCanvas,
              )
              if (hit) {
                setSelectedAnnotationKeys((prev) => {
                  if (shift) {
                    const n = new Set(prev)
                    if (n.has(hit)) n.delete(hit)
                    else n.add(hit)
                    return n
                  }
                  return new Set([hit])
                })
              } else if (!shift) {
                setSelectedAnnotationKeys(new Set())
              }
            } else if (!shift) {
              setSelectedAnnotationKeys(new Set())
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const picked = annotationKeysIntersectingPlanRect(
              sketch,
              minX,
              minY,
              maxX,
              maxY,
              delta,
              isElevationCanvas,
            )
            if (picked.length > 0) {
              setSelectedAnnotationKeys((prev) => {
                if (shift) return new Set([...prev, ...picked])
                return new Set(picked)
              })
            } else if (!shift) {
              setSelectedAnnotationKeys(new Set())
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'annotation-erase-marquee') {
        const mr = marqueeRectRef.current
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            if (pin && insideSite(pin.xIn, pin.yIn)) {
              const hit = annotationHitKeyAtPlanInches(
                pin,
                sketch,
                siteWIn,
                siteHIn,
                delta,
                maxDistIn,
                isElevationCanvas,
              )
              if (hit) {
                const next = nextSketchAfterRemovingAnnotationKeys(sketch, [hit])
                if (next) onSketchChange(next)
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const picked = annotationKeysIntersectingPlanRect(
              sketch,
              minX,
              minY,
              maxX,
              maxY,
              delta,
              isElevationCanvas,
            )
            if (picked.length > 0) {
              const next = nextSketchAfterRemovingAnnotationKeys(sketch, picked)
              if (next) onSketchChange(next)
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
                  list.filter((ed) => {
                    if (edgeKeyString(ed) !== hk) return true
                    if (placementKind() === 'wall' && isExclusiveArchWallSegmentStroke(ed)) return false
                    return layerIdentityFromEdge(ed) !== activeLayerId
                  }),
                )
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            updateEdges((list) =>
              list.filter((ed) => {
                if (!gridEdgeIntersectsPlanRect(ed, delta, minX, minY, maxX, maxY)) return true
                if (placementKind() === 'wall' && isExclusiveArchWallSegmentStroke(ed)) return false
                return layerIdentityFromEdge(ed) !== activeLayerId
              }),
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
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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

      if (kind === 'annotation-grid-line') {
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
            const id = `g-${++annotationGridRunIdRef.current}`
            const run: PlanAnnotationGridRun = {
              id,
              edgeKeys: keys.map(edgeKeyString),
            }
            onSketchChange({
              ...sketch,
              annotationGridRuns: [...(sketch.annotationGridRuns ?? []), run],
            })
            lastWallNodeRef.current = endNode
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'section-cut-line') {
        const startSnap = wallLineDragStartRef.current
        if (startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
          if (
            endNode &&
            (endNode.i !== startSnap.i || endNode.j !== startSnap.j) &&
            endNode.i >= 0 &&
            endNode.j >= 0 &&
            endNode.i <= siteNx &&
            endNode.j <= siteNy
          ) {
            const id = `sc-${++sectionCutIdRef.current}`
            const cut: PlanAnnotationSectionCut = {
              id,
              startNode: { i: startSnap.i, j: startSnap.j },
              endNode: { i: endNode.i, j: endNode.j },
            }
            onSketchChange({
              ...sketch,
              annotationSectionCuts: [...(sketch.annotationSectionCuts ?? []), cut],
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
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
          const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
        const endNode = nodeUnderCursor(pin.xIn, pin.yIn, delta, siteNx, siteNy, wallLineDragEndSnapDistIn(maxDistIn, delta))
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
      isRoomBoundaryEdgeMode,
      applyRoomBoundaryStrokeKeys,
      assignRoomBoundaryEdge,
      applyNodeChainRoomBoundaries,
      updateRoomBoundaries,
      isElevationCanvas,
      placementKind,
    ],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (suspendPlanPainting) return
      const svg = e.currentTarget as SVGSVGElement

      if (isElevationCanvas && !annotationToolActive) return

      if (annotationToolActive) {
        if (isElevationCanvas && annotationTool === 'groundLine') {
          const pinM = pointerToPlanInches(e.clientX, e.clientY)
          if (!pinM || !insideSite(pinM.xIn, pinM.yIn)) return
          const jRaw = Math.round(pinM.yIn / delta)
          const jClamped = Math.max(0, Math.min(siteNy, jRaw))
          onSketchChange({ ...sketch, elevationGroundPlaneJ: jClamped })
          return
        }

        if (isElevationCanvas && annotationTool === 'levelLine') {
          const pinM = pointerToPlanInches(e.clientX, e.clientY)
          if (!pinM || !insideSite(pinM.xIn, pinM.yIn)) return
          const jRaw = Math.round(pinM.yIn / delta)
          const jClamped = Math.max(0, Math.min(siteNy, jRaw))
          const existing = (sketch.elevationLevelLines ?? []).filter((l) => l.j === jClamped)
          if (existing.length > 0) {
            const rm = new Set(existing.map((l) => l.id))
            const next = (sketch.elevationLevelLines ?? []).filter((l) => !rm.has(l.id))
            onSketchChange({
              ...sketch,
              elevationLevelLines: next.length > 0 ? next : undefined,
            })
          } else {
            const id = `ll-${++levelLineIdRef.current}`
            const labelRaw = levelLineLabelDraft.trim()
            const label = labelRaw.length > 0 ? labelRaw : undefined
            onSketchChange({
              ...sketch,
              elevationLevelLines: [...(sketch.elevationLevelLines ?? []), { id, j: jClamped, label }],
            })
          }
          return
        }

        const pSvgAnn = clientToSvgPoint(svg, e.clientX, e.clientY)
        const onPlanSvgAnn =
          Boolean(pSvgAnn && pSvgAnn.x >= 0 && pSvgAnn.y >= 0 && pSvgAnn.x <= cw && pSvgAnn.y <= ch)

        const tryCaptureM = () => {
          try {
            svg.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }

        if (annotationTool === 'select') {
          if (!onPlanSvgAnn || !pSvgAnn) return
          tryCaptureM()
          paintDragRef.current = true
          dragKindRef.current = 'annotation-select-marquee'
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setMarqueeTone('select')
          const sx = Math.max(0, Math.min(cw, pSvgAnn.x))
          const sy = Math.max(0, Math.min(ch, pSvgAnn.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        if (annotationTool === 'erase') {
          if (!onPlanSvgAnn || !pSvgAnn) return
          tryCaptureM()
          paintDragRef.current = true
          dragKindRef.current = 'annotation-erase-marquee'
          setWallLinePreviewKeys(null)
          setMeasurePreviewNodes(null)
          setMarqueeTone('erase')
          setEraseMarqueeAnnotationPreviewKeys(null)
          const sx = Math.max(0, Math.min(cw, pSvgAnn.x))
          const sy = Math.max(0, Math.min(ch, pSvgAnn.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }

        const pinM = pointerToPlanInches(e.clientX, e.clientY)
        if (!pinM || !insideSite(pinM.xIn, pinM.yIn)) return

        if (annotationTool === 'textLabel') {
          const t = annotationLabelDraft.trim()
          if (!t) return
          const id = `t-${++annotationLabelIdRef.current}`
          onSketchChange({
            ...sketch,
            annotationLabels: [...(sketch.annotationLabels ?? []), { id, xIn: pinM.xIn, yIn: pinM.yIn, text: t }],
          })
          return
        }

        const lineDragKind: 'measure-line' | 'annotation-grid-line' | 'section-cut-line' | null =
          annotationTool === 'measureLine'
            ? 'measure-line'
            : annotationTool === 'gridLine'
              ? 'annotation-grid-line'
              : annotationTool === 'sectionCut'
                ? 'section-cut-line'
                : null
        if (!lineDragKind) return

        if (e.shiftKey && lastWallNodeRef.current) {
          tryCaptureM()
          paintDragRef.current = true
          dragKindRef.current = lineDragKind
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
        dragKindRef.current = lineDragKind
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
        const comp = roomCellKeyIndex.get(ck)?.room
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
                  const zoneHit = roomCellKeyIndex.get(ckHit)
                  const comp = zoneHit?.room
                  if (
                    comp &&
                    roomZoneHasAssignedName(comp.cellKeys, sketch.roomByCell)
                  ) {
                    setSelectedRoomEdgeKeys(new Set())
                    const zIdx = zoneHit.index + 1
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
      annotationToolActive,
      annotationTool,
      annotationLabelDraft,
      onSketchChange,
      exteriorCells,
      roomCellKeyIndex,
      roomNameDraft,
      isRoomBoundaryEdgeMode,
      roomTool,
      selectedRoomEdgeKeys,
      selectedRoomZoneCellKeys,
      onRoomZoneSelect,
      sketch.roomByCell,
      orderedSystems,
      isElevationCanvas,
      levelLineLabelDraft,
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

  const statusLine = useMemo(() => {
      if (suspendPlanPainting) {
      return 'Overlay adjust — plan drawing paused · Done in toolbar returns to Line / Rect / Erase / Select'
    }
    if (annotationToolActive) {
      if (annotationTool === 'groundLine') {
        const j = sketch.elevationGroundPlaneJ
        return j != null
          ? `Ground line at grid row j=${j} — click to move · Delete clears`
          : 'Ground line — click the grid to place a horizontal grade (full canvas width)'
      }
      if (annotationTool === 'levelLine') {
        const n = elevationLevelLines.length
        const tag = levelLineLabelDraft.trim() || '(no tag)'
        return n > 0
          ? `Level lines — ${n} on layout · click a row to toggle · new lines use tag “${tag.length > 28 ? `${tag.slice(0, 28)}…` : tag}” from the bar`
          : `Level line — click grid rows to add full-width datums · tag “${tag.length > 28 ? `${tag.slice(0, 28)}…` : tag}” · click again on a row to remove`
      }
      if (annotationTool === 'select') {
        const n = selectedAnnotationKeys.size
        const elevPick = isElevationCanvas ? '; level: horizontal datum' : ''
        return n > 0
          ? `${n} selected · Shift+click add/remove · drag box to add more · Del removes · Esc clears${
              n === 1 && Array.from(selectedAnnotationKeys)[0]?.startsWith('lbl:')
                ? ' · edit label text in the top bar'
                : ''
            }`
          : `Select — hover highlights · click or drag a box · Shift adds/removes · dimensions & grid: edge; section: line${elevPick}; label: anchor · one label selected: edit in top bar`
      }
      if (annotationTool === 'erase') {
        const nd = measureRuns.length
        const ng = annotationGridRuns.length
        const ns = annotationSectionCuts.length
        const nl = annotationLabels.length
        const nlv = isElevationCanvas ? elevationLevelLines.length : 0
        const hint = isElevationCanvas
          ? 'Hover highlights target · click or tiny drag removes one item · drag a box to clear every annotation that intersects (priority: dimension segment → grid ref → section line → level line → label)'
          : 'Hover highlights target · click or tiny drag removes one item · drag a box to clear every annotation that intersects (priority: dimension segment → grid ref → section line → label)'
        if (nd + ng + ns + nl + nlv === 0) {
          return `Erase — ${hint} · Nothing to erase yet`
        }
        return [
          hint,
          nd ? `${nd} dimension run(s)` : null,
          ng ? `${ng} grid ref` : null,
          ns ? `${ns} section cut(s)` : null,
          nlv ? `${nlv} level line(s)` : null,
          nl ? `${nl} label(s)` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      }
      if (annotationTool === 'textLabel') {
        const t = annotationLabelDraft.trim()
        return t
          ? `Text — click plan to place “${t.length > 36 ? `${t.slice(0, 36)}…` : t}”`
          : 'Text — enter label text in the toolbar, then click the plan'
      }
      if (
        annotationTool === 'sectionCut' &&
        measurePreviewNodes &&
        !(wallLinePreviewKeys?.length)
      ) {
        return 'Section — drag to second grid node · straight cut line with markers · Shift+click continues from last node'
      }
      if (wallLinePreviewKeys?.length) {
        const tot = wallLinePreviewKeys.length * delta
        const su = PLAN_SITE_UNIT_SHORT[planSiteDisplayUnit]
        if (annotationTool === 'gridLine') {
          return `Grid line — ${wallLinePreviewKeys.length} segment(s) · ${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} along path · release to add`
        }
        return `${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} · ${wallLinePreviewKeys.length} grid Δ — release to add dimension · Esc clears dimensions only`
      }
      if (annotationTool === 'measureLine' && measureRuns.length > 0) {
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
        return `${n} dimension run${n === 1 ? '' : 's'} · Last: ${primary} — ${sub} · Drag to add · Esc clears all dimensions`
      }
      if (annotationTool === 'measureLine') {
        return 'Measure line — drag along grid edges · Shift while dragging = straight H/V leg · Shift+click from last end · Esc clears all dimensions'
      }
      if (annotationTool === 'gridLine') {
        return 'Grid line — dashed reference along grid edges (no size label) · Shift+drag and Shift+click same as measure line'
      }
      if (annotationTool === 'sectionCut') {
        return 'Section — pick start on a grid edge, drag to end node · straight line with opposing triangles at center'
      }
      return 'Annotation tool'
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
      } else if (floorTool === 'select') {
        parts.push(
          `${selectedColumnKeys.size} column(s) selected · Delete / ⌫ removes · header “Select all” selects every column`,
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
        parts.push(
          `${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} · ${wallLinePreviewKeys.length} segments`,
        )
      } else if (movePreview && (movePreview.di !== 0 || movePreview.dj !== 0)) {
        parts.push(`Move Δ ${movePreview.di},${movePreview.dj} cells`)
      } else if (structureTool === 'select') {
        parts.push(`${selectedEdgeKeys.size} edge(s) selected`)
      }
      if (structureTool === 'paint') {
        parts.push('Drag along the grid to draw')
      } else if (structureTool === 'rect') {
        parts.push('Drag a box for a wall frame')
      } else if (structureTool === 'erase') {
        parts.push('Drag to erase walls')
      } else {
        parts.push('Drag box to select walls')
      }
      return parts.filter(Boolean).join(' · ')
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
    annotationToolActive,
    annotationTool,
    annotationLabelDraft,
    measureRuns,
    annotationGridRuns,
    annotationSectionCuts,
    annotationLabels,
    elevationLevelLines,
    measurePreviewNodes,
    planSiteDisplayUnit,
    delta,
    enclosedRooms,
    exteriorCells,
    roomNameDraft,
    roomTool,
    selectedRoomEdgeKeys.size,
    selectedRoomZoneCellKeys,
    selectedAnnotationKeys,
    selectedColumnKeys.size,
    sketch.elevationGroundPlaneJ,
    isElevationCanvas,
    levelLineLabelDraft,
  ])

  const canDeleteSelection =
    !suspendPlanPainting &&
    ((isElevationCanvas &&
      annotationTool === 'groundLine' &&
      sketch.elevationGroundPlaneJ != null) ||
      (annotationToolActive && annotationTool === 'select' && selectedAnnotationKeys.size > 0) ||
      (structureTool === 'select' && selectedEdgeKeys.size > 0) ||
      (floorTool === 'select' && selectedCellKeys.size > 0) ||
      (placeMode === 'column' && floorTool === 'select' && selectedColumnKeys.size > 0) ||
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
          title="Remove selection or elevation ground line (Delete or Backspace)"
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
                  annotationToolActive
                    ? annotationTool === 'erase' ||
                        annotationTool === 'textLabel' ||
                        annotationTool === 'select'
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
                        fillOpacity={planCellColumnOpacity(c, planVisualProfile ?? undefined, mepById)}
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
                      fillOpacity={planCellColumnOpacity(col, planVisualProfile ?? undefined, mepById)}
                      stroke="rgba(0,0,0,0.22)"
                      strokeWidth={0.55}
                      pointerEvents="none"
                    />
                  )
                })}

                {Array.from(selectedColumnKeys)
                  .map((pk) => displayColumnsSorted.find((c) => placedColumnKey(c) === pk))
                  .filter((col): col is PlacedPlanColumn => col != null)
                  .map((col) => {
                    const half = col.sizeIn / 2
                    const { x, y } = planInchesToCanvasPx(d, col.cxIn - half, col.cyIn - half)
                    const sPx = col.sizeIn * d.planScale
                    return (
                      <rect
                        key={`sel-col-${placedColumnKey(col)}`}
                        x={x}
                        y={y}
                        width={sPx}
                        height={sPx}
                        fill="none"
                        stroke="#1976d2"
                        strokeWidth={2.5}
                        strokeDasharray="6 4"
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

                {isElevationCanvas &&
                  sketch.elevationGroundPlaneJ != null &&
                  sketch.elevationGroundPlaneJ >= 0 &&
                  sketch.elevationGroundPlaneJ <= siteNy && (
                    <line
                      x1={GRID_TRIM}
                      y1={sketch.elevationGroundPlaneJ * cellPx}
                      x2={cw - GRID_TRIM}
                      y2={sketch.elevationGroundPlaneJ * cellPx}
                      stroke="#2d6a4f"
                      strokeWidth={Math.max(1.25, cellPx * 0.04)}
                      strokeDasharray="6 4"
                      strokeLinecap="round"
                      pointerEvents="none"
                      opacity={0.92}
                    />
                  )}

                {isElevationCanvas &&
                  elevationLevelLines.map((lv) => {
                  if (lv.j < 0 || lv.j > siteNy) return null
                  const y = lv.j * cellPx
                  const lw = Math.max(1.1, cellPx * 0.035)
                  const lab = lv.label?.trim()
                  return (
                    <g key={lv.id} pointerEvents="none">
                      <line
                        x1={GRID_TRIM}
                        y1={y}
                        x2={cw - GRID_TRIM}
                        y2={y}
                        stroke="#2563eb"
                        strokeWidth={lw}
                        strokeDasharray="5 4"
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                      {lab ? (
                        <text
                          x={GRID_TRIM + 4}
                          y={y}
                          textAnchor="start"
                          dominantBaseline="middle"
                          fill="#1e3a8a"
                          stroke="#fff"
                          strokeWidth={2.5}
                          paintOrder="stroke fill"
                          style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 11 }}
                        >
                          {lab}
                        </text>
                      ) : null}
                    </g>
                  )
                  })}

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
                        strokeOpacity={planPlacedEdgeOpacity(e, planVisualProfile ?? undefined, mepById)}
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
                    {(() => {
                      const pvStroke =
                        placeMode === 'annotate' && annotationTool === 'measureLine'
                          ? '#1d4ed8'
                          : placeMode === 'annotate' && annotationTool === 'gridLine'
                            ? '#64748b'
                            : placeMode === 'room'
                              ? chainLineErasePreview
                                ? '#e65100'
                                : '#7c3aed'
                              : chainLineErasePreview
                                ? '#e65100'
                                : '#c62828'
                      const polyPts = wallPreviewPolylinePointsCanvas(wallLinePreviewKeys, d, delta)
                      const main = polyPts ? (
                        <polyline
                          points={polyPts}
                          fill="none"
                          stroke={pvStroke}
                          strokeWidth={2.5}
                          strokeLinecap="square"
                          strokeLinejoin="miter"
                          strokeDasharray="5 4"
                          opacity={0.88}
                        />
                      ) : (
                        wallLinePreviewKeys.map((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return null
                          const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
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
                        })
                      )
                      const rubber =
                        wallLinePreviewRubberPlanIn &&
                        (() => {
                          const p0 = planInchesToCanvasPx(
                            d,
                            wallLinePreviewRubberPlanIn.x0,
                            wallLinePreviewRubberPlanIn.y0,
                          )
                          const p1 = planInchesToCanvasPx(
                            d,
                            wallLinePreviewRubberPlanIn.x1,
                            wallLinePreviewRubberPlanIn.y1,
                          )
                          return (
                            <line
                              x1={p0.x}
                              y1={p0.y}
                              x2={p1.x}
                              y2={p1.y}
                              stroke={pvStroke}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeDasharray="3 4"
                              opacity={0.58}
                            />
                          )
                        })()
                      return (
                        <>
                          {main}
                          {rubber}
                        </>
                      )
                    })()}
                    {measurePreviewNodes &&
                      placeMode === 'annotate' &&
                      annotationTool === 'measureLine' &&
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
                        const fill = '#1d4ed8'
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

                {measurePreviewNodes &&
                  placeMode === 'annotate' &&
                  annotationTool === 'sectionCut' &&
                  !(wallLinePreviewKeys?.length) &&
                  (measurePreviewNodes.start.i !== measurePreviewNodes.end.i ||
                    measurePreviewNodes.start.j !== measurePreviewNodes.end.j) && (
                    <SectionCutGraphic
                      d={d}
                      delta={delta}
                      cut={{
                        id: 'preview-sc',
                        startNode: measurePreviewNodes.start,
                        endNode: measurePreviewNodes.end,
                      }}
                    />
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
                  selectedRoomZoneOutlineSegs &&
                  selectedRoomZoneOutlineSegs.length > 0 && (
                    <g pointerEvents="none" aria-hidden>
                      {selectedRoomZoneOutlineSegs.map((seg) => (
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

                {annotationGridRuns.map((run) => (
                  <GridReferencePathOverlay key={run.id} d={d} delta={delta} edgeKeys={run.edgeKeys} />
                ))}
                {annotationSectionCuts.map((cut) => (
                  <SectionCutGraphic key={cut.id} d={d} delta={delta} cut={cut} />
                ))}
                {annotationLabels.map((L) => {
                  const { x, y } = planInchesToCanvasPx(d, L.xIn, L.yIn)
                  return (
                    <text
                      key={L.id}
                      x={x}
                      y={y}
                      textAnchor="start"
                      dominantBaseline="hanging"
                      fill="#0f172a"
                      stroke="#fff"
                      strokeWidth={2}
                      paintOrder="stroke fill"
                      style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 11 }}
                    >
                      {L.text}
                    </text>
                  )
                })}

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

                {annotationTool === 'erase' &&
                  eraseMarqueeAnnotationPreviewKeys &&
                  eraseMarqueeAnnotationPreviewKeys.length > 0 && (
                    <AnnotationKeyHighlightOverlay
                      keys={eraseMarqueeAnnotationPreviewKeys}
                      stroke="#dc2626"
                      strokeOpacity={0.5}
                      reactKeyPrefix="ann-ers-pre"
                      d={d}
                      delta={delta}
                      measureRuns={measureRuns}
                      annotationGridRuns={annotationGridRuns}
                      annotationSectionCuts={annotationSectionCuts}
                      annotationLabels={annotationLabels}
                      elevationLevelLines={elevationLevelLines}
                      canvasW={cw}
                      cellPx={cellPx}
                    />
                  )}

                {annotationTool === 'erase' && hoverAnnotationEraseKey && (
                  <AnnotationKeyHighlightOverlay
                    keys={[hoverAnnotationEraseKey]}
                    stroke="#b91c1c"
                    strokeOpacity={0.95}
                    reactKeyPrefix="ann-ers-hov"
                    d={d}
                    delta={delta}
                    measureRuns={measureRuns}
                    annotationGridRuns={annotationGridRuns}
                    annotationSectionCuts={annotationSectionCuts}
                    annotationLabels={annotationLabels}
                    elevationLevelLines={elevationLevelLines}
                    canvasW={cw}
                    cellPx={cellPx}
                  />
                )}

                {annotationTool === 'select' &&
                  hoverAnnotationSelectKey &&
                  !selectedAnnotationKeys.has(hoverAnnotationSelectKey) && (
                  <g pointerEvents="none" aria-hidden>
                    {Array.from([hoverAnnotationSelectKey]).flatMap((key) => {
                      const hi = '#ea580c'
                      const sw = Math.max(3.2, 2.2 * d.planScale * 0.12)
                      if (key.startsWith('dim:')) {
                        const id = key.slice(4)
                        const run = measureRuns.find((r) => r.id === id)
                        if (!run) return []
                        return run.edgeKeys.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                          return [
                            <line
                              key={`ann-hov-dim-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw}
                              strokeLinecap="square"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('grid:')) {
                        const id = key.slice(5)
                        const run = annotationGridRuns.find((r) => r.id === id)
                        if (!run) return []
                        return run.edgeKeys.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                          return [
                            <line
                              key={`ann-hov-grid-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw * 0.9}
                              strokeLinecap="square"
                              strokeDasharray="5 4"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('sec:')) {
                        const id = key.slice(4)
                        const cut = annotationSectionCuts.find((c) => c.id === id)
                        if (!cut) return []
                        const x1 = cut.startNode.i * delta
                        const y1 = cut.startNode.j * delta
                        const x2 = cut.endNode.i * delta
                        const y2 = cut.endNode.j * delta
                        const p1 = planInchesToCanvasPx(d, x1, y1)
                        const p2 = planInchesToCanvasPx(d, x2, y2)
                        return [
                          <line
                            key={`ann-hov-sec-${id}-ln`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={hi}
                            strokeWidth={sw + 1.5}
                            strokeLinecap="square"
                            strokeDasharray="10 5"
                            opacity={0.88}
                          />,
                        ]
                      }
                      if (key.startsWith('lvl:')) {
                        const id = key.slice(4)
                        const L = elevationLevelLines.find((l) => l.id === id)
                        if (!L) return []
                        const yy = L.j * cellPx
                        return [
                          <line
                            key={`ann-hov-lvl-${id}`}
                            x1={GRID_TRIM}
                            y1={yy}
                            x2={cw - GRID_TRIM}
                            y2={yy}
                            stroke={hi}
                            strokeWidth={sw * 1.1}
                            strokeLinecap="round"
                            strokeDasharray="4 3"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('lbl:')) {
                        const id = key.slice(4)
                        const L = annotationLabels.find((l) => l.id === id)
                        if (!L) return []
                        const { x, y } = planInchesToCanvasPx(d, L.xIn, L.yIn)
                        const tw = Math.max(28, L.text.length * 6.8)
                        const th = 14
                        return [
                          <rect
                            key={`ann-hov-lbl-${id}`}
                            x={x - 3}
                            y={y - 2}
                            width={tw}
                            height={th}
                            fill="none"
                            stroke={hi}
                            strokeWidth={2}
                            strokeDasharray="5 3"
                            rx={2}
                            opacity={0.95}
                          />,
                        ]
                      }
                      return []
                    })}
                  </g>
                )}

                {annotationTool === 'select' && selectedAnnotationKeys.size > 0 && (
                  <g pointerEvents="none" aria-hidden>
                    {Array.from(selectedAnnotationKeys).flatMap((key) => {
                      const hi = '#1976d2'
                      const sw = Math.max(3.2, 2.2 * d.planScale * 0.12)
                      if (key.startsWith('dim:')) {
                        const id = key.slice(4)
                        const run = measureRuns.find((r) => r.id === id)
                        if (!run) return []
                        return run.edgeKeys.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                          return [
                            <line
                              key={`ann-sel-dim-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw}
                              strokeLinecap="square"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('grid:')) {
                        const id = key.slice(5)
                        const run = annotationGridRuns.find((r) => r.id === id)
                        if (!run) return []
                        return run.edgeKeys.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, parsed, delta)
                          return [
                            <line
                              key={`ann-sel-grid-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw * 0.9}
                              strokeLinecap="square"
                              strokeDasharray="5 4"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('sec:')) {
                        const id = key.slice(4)
                        const cut = annotationSectionCuts.find((c) => c.id === id)
                        if (!cut) return []
                        const x1 = cut.startNode.i * delta
                        const y1 = cut.startNode.j * delta
                        const x2 = cut.endNode.i * delta
                        const y2 = cut.endNode.j * delta
                        const p1 = planInchesToCanvasPx(d, x1, y1)
                        const p2 = planInchesToCanvasPx(d, x2, y2)
                        return [
                          <line
                            key={`ann-sel-sec-${id}-ln`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={hi}
                            strokeWidth={sw + 1.5}
                            strokeLinecap="square"
                            strokeDasharray="10 5"
                            opacity={0.88}
                          />,
                        ]
                      }
                      if (key.startsWith('lvl:')) {
                        const id = key.slice(4)
                        const L = elevationLevelLines.find((l) => l.id === id)
                        if (!L) return []
                        const yy = L.j * cellPx
                        return [
                          <line
                            key={`ann-sel-lvl-${id}`}
                            x1={GRID_TRIM}
                            y1={yy}
                            x2={cw - GRID_TRIM}
                            y2={yy}
                            stroke={hi}
                            strokeWidth={sw * 1.1}
                            strokeLinecap="round"
                            strokeDasharray="4 3"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('lbl:')) {
                        const id = key.slice(4)
                        const L = annotationLabels.find((l) => l.id === id)
                        if (!L) return []
                        const { x, y } = planInchesToCanvasPx(d, L.xIn, L.yIn)
                        const tw = Math.max(28, L.text.length * 6.8)
                        const th = 14
                        return [
                          <rect
                            key={`ann-sel-lbl-${id}`}
                            x={x - 3}
                            y={y - 2}
                            width={tw}
                            height={th}
                            fill="none"
                            stroke={hi}
                            strokeWidth={2}
                            strokeDasharray="5 3"
                            rx={2}
                            opacity={0.95}
                          />,
                        ]
                      }
                      return []
                    })}
                  </g>
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
