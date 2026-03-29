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
  BuildingLevel,
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
  planArchWallEdgeKeysOverlappedByOpenings,
  openGhostPlanArchAssemblyFlipStorageKey,
  planArchAssemblyFlipEdgeKey,
  planArchAssemblyLayerOrderFlipped,
  resolvedConnectionDetailGridSpacingIn,
} from '../types/planLayout'
import {
  connectionDetailJunctionCenterCanvasPx,
  connectionDetailPlanOverlayClipRectCanvasPx,
  connectionDetailOverlayIrregularAxesPlanInches,
  connectionDetailPlanOverlayAlignment,
  connectionDetailSketchHasPlanOverlayContent,
  planGridNodeCenterCanvasPx,
} from '../lib/connectionDetailOnPlan'
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
  archWallBandRectCanvasPxForPlacedEdge,
  edgeEndpointsCanvasPx,
  placedArchEdgeEndpointsCanvasPx,
  planInchesToCell,
  closerNodeOnEdge,
  manhattanWallPathEdges,
  manhattanWallPathEdgesConnectionDetail,
  gridEdgeIntersectsPlanRect,
  cellsIntersectingPlanRect,
  rectangularFrameEdges,
  snapPlanInchesToGridNode,
  snapPlanInchesToConnectionDetailNodes,
  nearestConnectionDetailGridEdge,
  nodeUnderCursorConnectionDetail,
  edgeEndpointsConnectionDetailCanvasPx,
  closerNodeOnEdgeConnectionDetail,
  planInchesToCellConnectionDetail,
  cellsIntersectingConnectionDetailPlanRect,
  gridEdgeIntersectsPlanRectConnectionDetail,
  gridEdgeLengthsPlanInchesSum,
} from '../lib/gridEdges'
import {
  planEnclosureBarrierKeys,
  computeEnclosedRoomComponents,
  buildPlanRoomCellKeyIndex,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
  type PlanRoomComponent,
} from '../lib/planRooms'
import {
  planCellFill,
  planEdgeStroke,
  planEdgeStrokeDasharray,
  planPaintSwatchColor,
  planPlacedEdgeOpacity,
  planCellColumnOpacity,
  PLAN_ARCH_WALL_OPACITY_WITH_OPENING,
  PLAN_ARCH_WALL_GHOST_UNDER_OPENING,
  type PlanColorCatalog,
  type PlanPlaceMode,
  type PlanVisualProfile,
} from '../lib/planLayerColors'
import { planColumnSquareInchesFromSystem } from '../lib/planColumnSize'
import { PLAN_ROOMS_LAYER_ID, PLAN_ROOMS_LAYER_SYSTEM_ID } from '../lib/planRoomsLayerIdentity'
import type { ActiveCatalog } from './planLayoutCore/types'
import { usePlanEditorZoom } from './planLayoutCore/usePlanEditorZoom'
export type { ActiveCatalog } from './planLayoutCore/types'
import { isMepRunMode, isMepPointMode, isMepDisciplineMode } from '../types/planPlaceMode'
import {
  placedMepDeviceKey,
  planPointInsideMepDeviceFootprint,
  mepDeviceIntersectsPlanRect,
  mepDeviceHasRealDims,
  type PlacedMepDevice,
} from '../types/planLayout'
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
  allConnectionDetailAtomicAnnotationKeys,
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
  nextSketchAfterRemovingDetailSectionCutGridEdgeKey,
  nextSketchAfterRemovingDetailSectionCutSedKeys,
  planRoomZoneOutlineSegments,
  planToolbarEdgeKind,
  pointInSelectedFloorBBox,
  previewPathCentroidCanvas,
  wallPreviewPolylinePointsCanvas,
  strokeWidthForEdge,
  strokeWidthForRoomBoundaryLine,
  strokeWidthForRoomBoundaryUnderlay,
  computeMepRunOffsets,
  edgeMatchesToolbarAssemblyFlipKind,
  edgeMatchesToolbarEraseKind,
} from './planLayoutCore/planEditorGeometry'
import { buildMepJoinedDrawModel } from './planLayoutCore/mepRunPathJoin'
import {
  AnnotationKeyHighlightOverlay,
  GridPathDimensionOverlay,
  GridReferencePathOverlay,
  PlanRoomNameDetail,
  SectionCutGraphic,
} from './planLayoutCore/overlays'
import { ConnectionDetailPlanStrips } from './ConnectionDetailPlanStrips'
import { PlanSketchLayerPreview } from './planLayoutCore/PlanSketchLayerPreview'
import { downloadPlanLayoutPdf, downloadPlanLayoutSvg } from '../lib/planLayoutVectorExport'
import {
  archEdgeSupportsPlanAssemblyStack,
  computePlanArchColumnLayerStack,
  computePlanArchEdgeLayerStack,
  planArchEdgeLayerSliceStrokePx,
  planArchEdgeSeamStrokePx,
  planAssemblyColumnFlipKey,
  thinStrokeBandCanvasPx,
} from '../lib/planArchEdgeLayerStack'
import {
  connectionDetailAssemblyWorldRectsPx,
  connectionDetailDrawingAxesPlanInches,
  connectionDetailLayerOnlyGridLinesPx,
  minCellSpanFromDrawingAxes,
} from '../lib/connectionDetailAssemblyGridLines'
import {
  applyConnectionDetailManualLayerFill,
  connectionDetailFillCellKeyFromInteractionKey,
  connectionDetailFillInteractionKey,
  connectionDetailFilledCellHitAtPlanInches,
  connectionDetailFilledCellKeysIntersectingPlanRect,
  connectionDetailManualFillPreviewCellKeys,
  connectionDetailManualFillSvgColor,
  removeConnectionDetailFillsAtCellKeys,
  type ConnectionDetailLayerFillPick,
} from '../lib/connectionDetailManualFill'
import {
  connectionDetailFilledRegionSvgPathD,
  connectionDetailLayerFillConnectedComponents,
} from '../lib/connectionDetailFillMergedPaths'
import {
  buildConnectionDetailSheets,
  buildPlanConnections,
  connectionDetailNewHomogeneousLVariantSketchId,
  connectionDetailStripDescriptorsFromPlan,
  cornerConnectionPlanStrokeSortPx,
  connectionDetailSheetBadge,
  connectionDetailSheetNavSubtitle,
  connectionJunctionCapCenterCanvasPx,
  connectionJunctionHighlightPlanInches,
  getOrInferHomogeneousLVariantIds,
  connectionDetailRowSupportsConnectionVariants,
  resolvedConnectionDetailTemplateKey,
  formatConnectionParticipantsFull,
  findPlacedEdgeForJunctionArm,
  placedGridEdgeForJunctionArm,
  type ConnectionDetailStripDescriptor,
  type PlanConnection,
} from '../lib/planConnections'

/** Marquee select/erase on connection-detail sheets: include filled layer cells (`cdf:` keys). */
function mergeAnnotationAndConnectionFillKeysInPlanRect(
  sketchArg: PlanLayoutSketch,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  delta: number,
  includeElevationDatumLines: boolean,
  connectionDetailPick:
    | {
        siteWIn: number
        siteHIn: number
        atomicAnnotationEdges?: boolean
        irregularAxes?: { xsIn: readonly number[]; ysIn: readonly number[] }
      }
    | undefined,
  planRectPadIn: number,
): string[] {
  const ann = annotationKeysIntersectingPlanRect(
    sketchArg,
    minX,
    minY,
    maxX,
    maxY,
    delta,
    includeElevationDatumLines,
    connectionDetailPick,
    planRectPadIn,
  )
  const irr = connectionDetailPick?.irregularAxes
  const fills = sketchArg.connectionDetailLayerFillByCell
  if (
    connectionDetailPick?.atomicAnnotationEdges &&
    irr &&
    irr.xsIn.length >= 2 &&
    irr.ysIn.length >= 2 &&
    fills &&
    Object.keys(fills).length > 0
  ) {
    const fk = connectionDetailFilledCellKeysIntersectingPlanRect(
      fills,
      irr.xsIn,
      irr.ysIn,
      minX,
      minY,
      maxX,
      maxY,
    ).map(connectionDetailFillInteractionKey)
    return [...new Set([...ann, ...fk])]
  }
  return ann
}

export type LayoutTool = 'paint' | 'rect' | 'erase' | 'select' | 'flipAssembly'
export type FloorTool = 'paint' | 'fill' | 'erase' | 'select' | 'flipAssembly'
/** Annotation place mode sub-tools (implementation plan). */
export type AnnotationTool =
  | 'measureLine'
  | 'gridLine'
  | 'textLabel'
  | 'sectionCut'
  /** Connection-detail: click a junction wall strip to toggle layer order for that arm. */
  | 'flipConnectionStripLayers'
  /** Connection-detail: pick a layer in the toolbar, then click a closed zone (detail lines + wall outline). */
  | 'connectionDetailLayerFill'
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
  /** Edge/column Select tool: mirror selection to the floating toolbar (e.g. per-segment offset). */
  onToolbarPlanSelectionChange?: (p: { edgeKeys: string[]; columnKeys: string[] }) => void
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
  /**
   * Connection-detail only: junction core in plan inches, inset from canvas origin so boundary padding surrounds it evenly.
   */
  connectionDetailJunctionOutlineIn?: {
    widthIn: number
    heightIn: number
    insetPlanIn: number
  } | null
  /** Active junction on connection-detail sheets — drives arm directions and strip geometry. */
  connectionDetailForCanvas?: PlanConnection | null
  /**
   * Connection-detail Layer fill tool: arch/MEP layer (or clear) chosen in the floating toolbar.
   * Omitted → clicks are ignored for that tool.
   */
  connectionDetailLayerFillPick?: ConnectionDetailLayerFillPick | 'clear' | null
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
  /** Base filename (no extension) for vector export from the toolbar (SVG / PDF). */
  vectorExportBasename?: string
  /** Per-level sketches for elevation projection (keyed by level id; level 0 uses layoutSketchForProjection). */
  levelSketches?: Record<string, PlanLayoutSketch>
  /** Derived building levels from elevation level lines. */
  buildingLevels?: BuildingLevel[]
  /** The primary/Level-1 layout sketch (used for wall bbox projection onto elevations). */
  layoutSketchForProjection?: PlanLayoutSketch
  /** Elevation face (N/E/S/W) when rendering an elevation canvas; determines projection axis. */
  elevationFace?: 'N' | 'E' | 'S' | 'W'
  /** Ghost overlays from other building levels (see `levelOverlaysBelowPlanContent` for stacking). */
  levelOverlays?: readonly LevelOverlayEntry[]
  /** 0–1 opacity for level ghost overlays (default 0.25). */
  levelOverlayOpacity?: number
  /**
   * When true, level ghosts draw under grid and plan content (e.g. MEP trade sheets).
   * When false (default), ghosts draw above most plan ink (layout / reference on top).
   */
  levelOverlaysBelowPlanContent?: boolean
  /** When true, show junction-type text and grey dashed corner outlines (fills stay visible either way). */
  showCornerConditions?: boolean
  /**
   * When true, arch wall / window / door / roof / stair **edges** subdivide along thickness into CSV layer slices.
   * Floor / stairs / roof **cells** and columns stay flat fills.
   */
  planLineAssemblyLayers?: boolean
  /**
   * Connection-detail templates keyed by merged sheet row id (`buildConnectionDetailSheets`): when assembly
   * layers are on, annotation linework from each sketch is drawn at matching floor-plan junctions.
   */
  connectionSketches?: Record<string, PlanLayoutSketch> | null
  /** Connection-detail / annotation-only: skip room flood-fill and plan-connection work when there is no structural geometry. */
  annotationsOnly?: boolean
  /** Connection-detail sheets: render section-cut annotations as a simple dashed line (no section triangles). */
  sectionCutGraphicVariant?: 'section' | 'detailLine'
  className?: string
}

export type LevelOverlayEntry = {
  levelId: string
  label: string
  sketch: PlanLayoutSketch
  color: string
  /** Per-overlay visual profile (e.g. full layout underlay beneath a trade sheet). */
  previewVisualProfile?: PlanVisualProfile | null
}

function sketchHasStructuralPlanContent(sk: PlanLayoutSketch): boolean {
  return (
    (sk.edges?.length ?? 0) > 0 ||
    (sk.cells?.length ?? 0) > 0 ||
    (sk.columns?.length ?? 0) > 0 ||
    (sk.mepDevices?.length ?? 0) > 0 ||
    (sk.roomBoundaryEdges?.length ?? 0) > 0 ||
    !!(sk.roomByCell && Object.keys(sk.roomByCell).length > 0)
  )
}

function wallPreviewRubberPlanInFrom(
  endNode: { i: number; j: number },
  pin: { xIn: number; yIn: number },
  gridDeltaIn: number,
  axes?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 =
    axes && axes.xsIn[endNode.i] != null ? axes.xsIn[endNode.i]! : endNode.i * gridDeltaIn
  const y0 =
    axes && axes.ysIn[endNode.j] != null ? axes.ysIn[endNode.j]! : endNode.j * gridDeltaIn
  const x1 = pin.xIn
  const y1 = pin.yIn
  const eps =
    axes && axes.xsIn.length >= 2 && axes.ysIn.length >= 2
      ? (minCellSpanFromDrawingAxes(axes.xsIn, axes.ysIn) ?? gridDeltaIn) * 0.06
      : gridDeltaIn * 0.06
  if (Math.hypot(x1 - x0, y1 - y0) < eps) return null
  return { x0, y0, x1, y1 }
}

/** Corner detail chips: white fill, toolbar-like type; selected = strong border (no black fill). */
const PLAN_CORNER_VARIANT_BTN_BASE =
  'font-mono text-[8px] px-2.5 py-1 min-h-[24px] min-w-[3.25rem] border-2 uppercase tracking-wide transition-colors shrink-0 inline-flex items-center justify-center bg-white text-foreground box-border leading-none'
const PLAN_CORNER_VARIANT_BTN_IDLE = `${PLAN_CORNER_VARIANT_BTN_BASE} border-border hover:bg-muted`
const PLAN_CORNER_VARIANT_BTN_ON = `${PLAN_CORNER_VARIANT_BTN_BASE} border-foreground font-medium shadow-sm`

type AssemblyFlipEdgeTarget = {
  pk: string
  axis: 'h' | 'v'
  bandRect: { x: number; y: number; width: number; height: number }
  segmentKey: string
  edge: PlacedGridEdge
}

type AssemblyFlipColumnTarget = {
  pk: string
  bandRect: { x: number; y: number; width: number; height: number }
  col: PlacedPlanColumn
}

/** Skip plan paint / marquee when interacting with homogeneous L/T/X corner detail UI (SVG + foreignObject). */
function planPointerTargetIsCornerConnectionUi(target: EventTarget | null): boolean {
  let n: Node | null = target as Node | null
  while (n) {
    if (n instanceof Element) {
      if (n.getAttribute('data-corner-connection-ui') != null) return true
      if (n.getAttribute('data-corner-connection-hit') != null) return true
    }
    n = n.parentNode
  }
  return false
}

/** Under cursor (not `e.target` — pointer capture can retarget to the SVG while over the toolbar). */
function planPointerEventIsOverCornerConnectionUi(e: React.PointerEvent): boolean {
  if (typeof document === 'undefined') return planPointerTargetIsCornerConnectionUi(e.target)
  const top = document.elementFromPoint(e.clientX, e.clientY)
  if (planPointerTargetIsCornerConnectionUi(top)) return true
  return planPointerTargetIsCornerConnectionUi(e.target)
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
  onToolbarPlanSelectionChange,
  mepItems,
  orderedSystems,
  planColorCatalog,
  planSiteDisplayUnit,
  canvasExtentsIn = null,
  connectionDetailJunctionOutlineIn = null,
  connectionDetailForCanvas = null,
  connectionDetailLayerFillPick = null,
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
  vectorExportBasename = 'plan-layout',
  levelSketches,
  buildingLevels,
  layoutSketchForProjection,
  elevationFace,
  levelOverlays,
  levelOverlayOpacity = 0.25,
  levelOverlaysBelowPlanContent = false,
  showCornerConditions = false,
  planLineAssemblyLayers = false,
  connectionSketches = null,
  annotationsOnly = false,
  sectionCutGraphicVariant = 'section',
  className,
}: PlanLayoutEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const planBoxRef = useRef<HTMLDivElement>(null)

  const planSiteDims = useMemo(() => {
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

  const hasFixedPlanCanvasExtents = Boolean(
    canvasExtentsIn &&
      Number.isFinite(canvasExtentsIn.widthIn) &&
      Number.isFinite(canvasExtentsIn.heightIn) &&
      canvasExtentsIn.widthIn > 0 &&
      canvasExtentsIn.heightIn > 0,
  )

  /** Connection-detail canvases are tiny in SVG px; allow much higher zoom so the junction is usable. */
  const zoomMax = useMemo(() => {
    if (!hasFixedPlanCanvasExtents || elevationFace) return ZOOM_MAX
    const cwPx = planSiteDims.w * d.planScale
    const chPx = planSiteDims.h * d.planScale
    const maxEdgePx = Math.max(cwPx, chPx)
    const targetLongEdgePx = 560
    const computed = targetLongEdgePx / Math.max(maxEdgePx, 8)
    return Math.min(80, Math.max(ZOOM_MAX, computed))
  }, [hasFixedPlanCanvasExtents, elevationFace, planSiteDims.w, planSiteDims.h, d.planScale])

  const { zoom, setZoom, zoomRef, applyZoom, applyZoomRef, zoomCommitRef } = usePlanEditorZoom(
    scrollRef,
    planBoxRef,
    zoomMax,
  )

  useEffect(() => {
    setZoom((z) => clampZoom(z, zoomMax))
  }, [zoomMax, setZoom])

  /** Plan scroll area width (CSS px) — corner toolbar scales with viewport, not plan zoom. */
  const [planScrollViewportW, setPlanScrollViewportW] = useState(1024)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const read = () => setPlanScrollViewportW(el.clientWidth)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cornerToolbarCssW = useMemo(
    () =>
      Math.min(220, Math.max(104, Math.round(planScrollViewportW * 0.175))),
    [planScrollViewportW],
  )
  const cornerToolbarCssH = useMemo(
    () => Math.min(42, Math.max(30, Math.round(planScrollViewportW * 0.032))),
    [planScrollViewportW],
  )
  const connectionSketchKeySet = useMemo(
    () => new Set(Object.keys(connectionSketches ?? {})),
    [connectionSketches],
  )
  const zoomSafeForUi = Math.max(zoom, 0.08)

  const paintDragRef = useRef(false)
  const lastStrokeEdgeKeyRef = useRef<string | null>(null)
  const lastStrokeCellKeyRef = useRef<string | null>(null)
  const lastWallNodeRef = useRef<{ i: number; j: number } | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [hoverCell, setHoverCell] = useState<{ i: number; j: number } | null>(null)
  /** Layer fill tool: irregular cell keys that would be painted/cleared on click (detail-line-bounded only). */
  const [connectionDetailFillPreviewCellKeys, setConnectionDetailFillPreviewCellKeys] = useState<
    string[] | null
  >(null)
  /** Column paint: snapped footprint under cursor (same style family as wall-line dashed preview). */
  const [columnPaintPreview, setColumnPaintPreview] = useState<{
    cxIn: number
    cyIn: number
    sizeIn: number
  } | null>(null)
  /** MEP device paint: snapped footprint under cursor. */
  const [mepDevicePaintPreview, setMepDevicePaintPreview] = useState<{
    cxIn: number
    cyIn: number
    sizeIn: number
    lengthIn?: number
    widthIn?: number
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
  /** MEP devices — `placedMepDeviceKey` values (point-mode Select sub-tool). */
  const [selectedMepDeviceKeys, setSelectedMepDeviceKeys] = useState<Set<string>>(() => new Set())
  /** Annotation Select — keys `dim:id`, `grid:id`, `sec:id`, `lbl:id`. */
  const [selectedAnnotationKeys, setSelectedAnnotationKeys] = useState<Set<string>>(() => new Set())
  /** Hover highlight for annotation Select tool (under-cursor preview). */
  const [hoverAnnotationSelectKey, setHoverAnnotationSelectKey] = useState<string | null>(null)
  /** Hover highlight for annotation Erase tool (under-cursor preview). */
  const [hoverAnnotationEraseKey, setHoverAnnotationEraseKey] = useState<string | null>(null)
  /** Homogeneous L corner: hover key `i:j` for Ext. L / Int. L sheet picker when corner labels are on. */
  const [homogeneousCornerHoverKey, setHomogeneousCornerHoverKey] = useState<string | null>(null)
  /** Flip assembly tool: `placedEdgeKey`, `open-ghost-…`, or `assemblyColumn:…` keys. */
  const [selectedAssemblyFlipKeys, setSelectedAssemblyFlipKeys] = useState<Set<string>>(() => new Set())

  const onToolbarPlanSelectionChangeRef = useRef(onToolbarPlanSelectionChange)
  onToolbarPlanSelectionChangeRef.current = onToolbarPlanSelectionChange
  useEffect(() => {
    onToolbarPlanSelectionChangeRef.current?.({
      edgeKeys: [...selectedEdgeKeys],
      columnKeys: [...selectedColumnKeys],
    })
  }, [selectedEdgeKeys, selectedColumnKeys])

  /** While dragging an annotation erase box, keys that intersect the marquee (preview). */
  const [eraseMarqueeAnnotationPreviewKeys, setEraseMarqueeAnnotationPreviewKeys] = useState<string[] | null>(
    null,
  )
  const [movePreview, setMovePreview] = useState<{ di: number; dj: number } | null>(null)
  // Initialize each ID counter from the highest existing ID already stored in the sketch,
  // so that remounts (e.g. navigating to a system page and back) never reuse IDs.
  const measureRunIdRef = useRef(
    Math.max(0, ...(sketch.measureRuns ?? []).map(r => parseInt(r.id.replace(/^m-/, '')) || 0)),
  )
  const annotationGridRunIdRef = useRef(
    Math.max(0, ...(sketch.annotationGridRuns ?? []).map(r => parseInt(r.id.replace(/^g-/, '')) || 0)),
  )
  const sectionCutIdRef = useRef(
    Math.max(0, ...(sketch.annotationSectionCuts ?? []).map(r => parseInt(r.id.replace(/^sc-/, '')) || 0)),
  )
  const annotationLabelIdRef = useRef(
    Math.max(0, ...(sketch.annotationLabels ?? []).map(r => parseInt(r.id.replace(/^t-/, '')) || 0)),
  )
  // Level line IDs are used as dictionary keys for levelSketches — duplicate IDs corrupt
  // which sketch is shown for which level, so initialization here is especially critical.
  const levelLineIdRef = useRef(
    Math.max(0, ...(sketch.elevationLevelLines ?? []).map(l => parseInt(l.id.replace(/^ll-/, '')) || 0)),
  )
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
    | 'assembly-flip-marquee'
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
    | 'mep-select-marquee'
    | 'mep-erase-marquee'
    | 'level-line-drag'
    | null
  >(null)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const levelLineDragIdsRef = useRef<string[] | null>(null)
  const levelLineDragStartYRef = useRef<number>(0)
  /** Last pointer position (for Shift chain preview when key is pressed before the next move). */
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const annotatePointerMoveRafRef = useRef<number | null>(null)
  const annotatePointerMovePendingRef = useRef<React.PointerEvent | null>(null)
  const processPointerMoveRef = useRef<(e: React.PointerEvent) => void>(() => {})
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
    if (!annotationToolActive || annotationTool !== 'connectionDetailLayerFill') {
      setConnectionDetailFillPreviewCellKeys(null)
    }
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
    if (
      placeMode === 'floor' ||
      placeMode === 'stairs' ||
      placeMode === 'roof' ||
      placeMode === 'room' ||
      placeMode === 'column' ||
      isMepPointMode(placeMode)
    )
      setSelectedEdgeKeys(new Set())
  }, [placeMode])

  useEffect(() => {
    if (!isMepPointMode(placeMode) || floorTool !== 'select')
      setSelectedMepDeviceKeys(new Set())
  }, [placeMode, floorTool])

  useEffect(() => {
    if (!isMepPointMode(placeMode))
      setMepDevicePaintPreview(null)
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
      applyZoomRef.current(z0 * Math.exp(-e.deltaY * ZOOM_WHEEL_SENS), { clientX: e.clientX, clientY: e.clientY })
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
    placeMode !== 'roof' &&
    placeMode !== 'column' &&
    placeMode !== 'annotate' &&
    placeMode !== 'room' &&
    !isMepPointMode(placeMode)

  const isRoomBoundaryEdgeMode =
    placeMode === 'room' && roomTool !== 'fill' && roomTool !== 'autoFill'
  const edgePlacementSource = useMemo<ActiveCatalog>(
    () =>
      placeMode === 'window' || placeMode === 'door' || placeMode === 'roof'
        ? 'arch'
        : isMepRunMode(placeMode)
          ? 'mep'
          : activeCatalog,
    [placeMode, activeCatalog],
  )

  const siteWIn = planSiteDims.w
  const siteHIn = planSiteDims.h
  /** Elevation sheets use fixed extents too; require `elevationFace` so connection-detail canvases are not treated as elevations. */
  const isElevationCanvas = Boolean(
    elevationFace &&
      canvasExtentsIn &&
      Number.isFinite(canvasExtentsIn.widthIn) &&
      Number.isFinite(canvasExtentsIn.heightIn) &&
      canvasExtentsIn.widthIn > 0 &&
      canvasExtentsIn.heightIn > 0,
  )
  const cw = siteWIn * d.planScale
  const ch = siteHIn * d.planScale

  /** Connection / small fixed floor canvas: avoid thick grid after high auto-fit zoom; draw grid to canvas edges. */
  const gridHairlineFixedCanvas = hasFixedPlanCanvasExtents && !elevationFace
  const gridPatternStrokeW = useMemo(() => {
    if (!gridHairlineFixedCanvas) return 0.35
    const hairlineCssPx = 1.08
    return Math.max(0.04, Math.min(0.42, hairlineCssPx / Math.max(zoom, 0.25)))
  }, [gridHairlineFixedCanvas, zoom])
  const gridPatternEdgeInset = gridHairlineFixedCanvas ? 0 : GRID_TRIM

  /** Connection (and any fixed-extent floor canvas): start zoomed to fill the scroll viewport. */
  const autoFitFixedPlanCanvas = gridHairlineFixedCanvas
  useLayoutEffect(() => {
    if (!autoFitFixedPlanCanvas || cw < 1 || ch < 1) return
    const margin = 0.9
    const run = () => {
      const scroll = scrollRef.current
      if (!scroll) return
      const vpW = scroll.clientWidth
      const vpH = scroll.clientHeight
      if (vpW <= 8 || vpH <= 8) return
      const zFit = Math.min((vpW * margin) / cw, (vpH * margin) / ch)
      const z1 = clampZoom(zFit, zoomMax)
      zoomCommitRef.current = null
      setZoom(z1)
      requestAnimationFrame(() => {
        const s = scrollRef.current
        if (!s) return
        const sx = Math.max(0, s.scrollWidth - s.clientWidth)
        const sy = Math.max(0, s.scrollHeight - s.clientHeight)
        s.scrollLeft = sx / 2
        s.scrollTop = sy / 2
      })
    }
    run()
    const id = requestAnimationFrame(run)
    return () => cancelAnimationFrame(id)
  }, [autoFitFixedPlanCanvas, cw, ch, zoomMax, setZoom])

  const delta = sketch.gridSpacingIn
  /** Grid counts for the full lot — walls and floor use this same grid. */
  const { nx: siteNx, ny: siteNy } = useMemo(() => gridCounts(siteWIn, siteHIn, delta), [siteWIn, siteHIn, delta])

  const connectionDetailIrregularAxesRef = useRef<{
    xsIn: readonly number[]
    ysIn: readonly number[]
  } | null>(null)

  const lastGlobalSelectAllNonce = useRef(0)
  useEffect(() => {
    const n = globalSelectAllNonce ?? 0
    if (n < 1 || n === lastGlobalSelectAllNonce.current) return
    lastGlobalSelectAllNonce.current = n
    setSelectedEdgeKeys(new Set())
    setSelectedCellKeys(new Set())
    setSelectedRoomEdgeKeys(new Set())
    setSelectedColumnKeys(new Set())
    setSelectedMepDeviceKeys(new Set())
    setSelectedAnnotationKeys(new Set())
    onRoomZoneSelect?.(null)

    if (isMepPointMode(placeMode)) {
      const picked = (sketch.mepDevices ?? []).map(placedMepDeviceKey)
      setSelectedMepDeviceKeys(new Set(picked))
      return
    }
    if (placeMode === 'annotate') {
      const keys: string[] = []
      for (const r of sketch.measureRuns ?? []) keys.push(`dim:${r.id}`)
      for (const r of sketch.annotationGridRuns ?? []) keys.push(`grid:${r.id}`)
      if (sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas) {
        keys.push(
          ...allConnectionDetailAtomicAnnotationKeys(
            sketch,
            delta,
            siteWIn,
            siteHIn,
            connectionDetailIrregularAxesRef.current,
          ),
        )
      } else {
        for (const c of sketch.annotationSectionCuts ?? []) keys.push(`sec:${c.id}`)
      }
      for (const l of sketch.annotationLabels ?? []) keys.push(`lbl:${l.id}`)
      for (const l of sketch.elevationLevelLines ?? []) keys.push(`lvl:${l.id}`)
      if (sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas) {
        for (const ck of Object.keys(sketch.connectionDetailLayerFillByCell ?? {})) {
          keys.push(connectionDetailFillInteractionKey(ck))
        }
      }
      setSelectedAnnotationKeys(new Set(keys))
      return
    }
    if (placeMode === 'room') {
      const rb = sketch.roomBoundaryEdges ?? []
      setSelectedRoomEdgeKeys(new Set(rb.map((e) => edgeKeyString(e))))
      return
    }
    if (placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'roof') {
      const want =
        placeMode === 'stairs' ? ('stairs' as const) : placeMode === 'roof' ? ('roof' as const) : ('floor' as const)
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
    sketch.connectionDetailLayerFillByCell,
    sketch.elevationLevelLines,
    sketch.mepDevices,
    onRoomZoneSelect,
    sectionCutGraphicVariant,
    isElevationCanvas,
    delta,
    siteWIn,
    siteHIn,
  ])

  const mepById = useMemo(() => new Map(mepItems.map((m) => [m.id, m])), [mepItems])

  const renderLevelOverlaysGroup = useCallback(
    (domId: string) => {
      if (!levelOverlays || levelOverlays.length === 0 || isElevationCanvas) return null
      return (
        <g id={domId} pointerEvents="none" aria-hidden>
          <title>Level overlays</title>
          {levelOverlays.map((ol) => (
            <g key={`lvl-overlay-${ol.levelId}`} opacity={levelOverlayOpacity}>
              <PlanSketchLayerPreview
                sketch={ol.sketch}
                buildingDimensions={d}
                siteWIn={siteWIn}
                siteHIn={siteHIn}
                planColorCatalog={planColorCatalog}
                mepById={mepById}
                mepItems={mepItems}
                orderedSystems={orderedSystems}
                annotationsOnly={annotationsOnly}
                planVisualProfile={ol.previewVisualProfile ?? planVisualProfile}
                planLineAssemblyLayers={planLineAssemblyLayers}
                reactKeyPrefix={`lvl-${ol.levelId}`}
                overlayLabel={ol.label}
              />
            </g>
          ))}
        </g>
      )
    },
    [
      levelOverlays,
      levelOverlayOpacity,
      isElevationCanvas,
      d,
      siteWIn,
      siteHIn,
      planColorCatalog,
      mepById,
      mepItems,
      orderedSystems,
      annotationsOnly,
      planVisualProfile,
      planLineAssemblyLayers,
    ],
  )

  const blockMepMutations = !allowMepEditing && (isMepDisciplineMode(placeMode) || activeCatalog === 'mep')
  const activeLayerId = useMemo(() => `${activeCatalog}\t${activeSystemId}`, [activeCatalog, activeSystemId])
  const activeCellPaintKind: 'floor' | 'stairs' | 'roof' =
    placeMode === 'stairs' ? 'stairs' : placeMode === 'roof' ? 'roof' : 'floor'
  const isCellPaintMode = placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'roof'

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

  const skipRoomEnclosureForAnnotations = annotationsOnly && !sketchHasStructuralPlanContent(sketch)
  const roomBarrierKeys = useMemo(
    () => planEnclosureBarrierKeys(sketch.roomBoundaryEdges, sketch.edges),
    [sketch.roomBoundaryEdges, sketch.edges],
  )
  const { exteriorCells, rooms: enclosedRooms } = useMemo(() => {
    if (skipRoomEnclosureForAnnotations) {
      return { exteriorCells: new Set<string>(), rooms: [] as PlanRoomComponent[] }
    }
    return computeEnclosedRoomComponents(siteNx, siteNy, roomBarrierKeys)
  }, [skipRoomEnclosureForAnnotations, siteNx, siteNy, roomBarrierKeys])
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

  /** Connection-detail: slightly wider hit slop + marquee padding (dense irregular grid). */
  const connectionDetailAnnotationHitPickDistIn = useMemo(
    () =>
      sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas
        ? maxDistIn * 1.15
        : maxDistIn,
    [sectionCutGraphicVariant, isElevationCanvas, maxDistIn],
  )
  const connectionDetailMarqueeRectPadIn = useMemo(
    () =>
      sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas ? maxDistIn * 0.6 : 0,
    [sectionCutGraphicVariant, isElevationCanvas, maxDistIn],
  )
  const annotationMarqueeClickMaxPx = useMemo(
    () =>
      sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas
        ? Math.max(MARQUEE_CLICK_MAX_PX, 10)
        : MARQUEE_CLICK_MAX_PX,
    [sectionCutGraphicVariant, isElevationCanvas],
  )

  const cellPx = delta * d.planScale

  /** Connection-detail: finer grid → thinner grid lines and annotation chrome. */
  const REF_PLAN_GRID_DELTA_IN = 12
  const connectionDetailVisualScale = useMemo(() => {
    if (sectionCutGraphicVariant !== 'detailLine') return 1
    const r = delta / REF_PLAN_GRID_DELTA_IN
    return Math.max(0.12, Math.min(1, Math.sqrt(r)))
  }, [sectionCutGraphicVariant, delta])

  const gridPatternStrokeWSvg = useMemo(
    () => gridPatternStrokeW * connectionDetailVisualScale,
    [gridPatternStrokeW, connectionDetailVisualScale],
  )

  /** Matches AnnotationKeyHighlightOverlay: cap width on small connection-detail cells. */
  const annotationHighlightStroke = useMemo(() => {
    const swPlan = Math.max(3.2, 2.2 * d.planScale * 0.12) * connectionDetailVisualScale
    const swCap = Math.max(0.12, cellPx * 0.06)
    const sw =
      connectionDetailVisualScale < 1 ? Math.min(swPlan, swCap) : swPlan
    return {
      sw,
      secExtra:
        connectionDetailVisualScale < 1
          ? 0.85 * connectionDetailVisualScale
          : 1.5,
    }
  }, [d.planScale, connectionDetailVisualScale, cellPx])

  /** Select/erase marquee dashed rect: keep hairline on connection-detail (default 1px felt heavy). */
  const connectionDetailMarqueeRectStrokeW = useMemo(() => {
    if (sectionCutGraphicVariant !== 'detailLine') return 1
    return Math.max(0.1, Math.min(0.36, 0.3 * connectionDetailVisualScale))
  }, [sectionCutGraphicVariant, connectionDetailVisualScale])

  /** Junction core in SVG px for connection-detail wall strips (matches dashed rect or full fixed canvas). */
  const connectionDetailCorePx = useMemo(() => {
    if (sectionCutGraphicVariant !== 'detailLine' || !connectionDetailForCanvas) return null
    if (
      connectionDetailJunctionOutlineIn &&
      connectionDetailJunctionOutlineIn.widthIn > 0 &&
      connectionDetailJunctionOutlineIn.heightIn > 0
    ) {
      return {
        x0: connectionDetailJunctionOutlineIn.insetPlanIn * d.planScale,
        y0: connectionDetailJunctionOutlineIn.insetPlanIn * d.planScale,
        rw: connectionDetailJunctionOutlineIn.widthIn * d.planScale,
        rh: connectionDetailJunctionOutlineIn.heightIn * d.planScale,
      }
    }
    if (
      hasFixedPlanCanvasExtents &&
      !elevationFace &&
      Number.isFinite(cw) &&
      Number.isFinite(ch) &&
      cw > 0 &&
      ch > 0
    ) {
      return { x0: 0, y0: 0, rw: cw, rh: ch }
    }
    return null
  }, [
    sectionCutGraphicVariant,
    connectionDetailForCanvas,
    connectionDetailJunctionOutlineIn,
    d.planScale,
    hasFixedPlanCanvasExtents,
    elevationFace,
    cw,
    ch,
  ])

  /** Layout segment flips XOR connection-detail strip toggles — matches floor junction rendering. */
  const connectionDetailStripFlipsMerged = useMemo((): Partial<
    Record<ConnectionDetailStripDescriptor['dir'], true>
  > | undefined => {
    if (sectionCutGraphicVariant !== 'detailLine' || !connectionDetailForCanvas) return undefined
    const layoutForFlips = layoutSketchForProjection ?? sketch
    const layoutFlipMap = layoutForFlips.planArchEdgeLayerFlipped ?? {}
    const detailFlips = sketch.connectionDetailStripLayerFlips ?? {}
    const edges = layoutForFlips.edges ?? []
    const c = connectionDetailForCanvas
    const descriptors = connectionDetailStripDescriptorsFromPlan(c, d.layoutRefs)
    const out: Partial<Record<ConnectionDetailStripDescriptor['dir'], true>> = {}
    for (const desc of descriptors) {
      const e =
        findPlacedEdgeForJunctionArm(edges, c.nodeI, c.nodeJ, desc) ??
        placedGridEdgeForJunctionArm(c.nodeI, c.nodeJ, desc)
      if (
        planArchAssemblyLayerOrderFlipped(layoutFlipMap, e, 'edge') !==
        Boolean(detailFlips[desc.dir])
      ) {
        out[desc.dir] = true
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }, [
    sectionCutGraphicVariant,
    connectionDetailForCanvas,
    layoutSketchForProjection,
    sketch.connectionDetailStripLayerFlips,
    sketch,
    d.layoutRefs,
  ])

  /** Connection-detail sheet: drawing grid = assembly/MEP layer edges only (no uniform Δ). */
  const connectionDetailLayerGrid = useMemo(() => {
    if (
      sectionCutGraphicVariant !== 'detailLine' ||
      !connectionDetailForCanvas ||
      !connectionDetailCorePx ||
      cw < 1 ||
      ch < 1
    ) {
      return null
    }
    const rects = connectionDetailAssemblyWorldRectsPx({
      connection: connectionDetailForCanvas,
      d,
      orderedSystems,
      mepById,
      core: connectionDetailCorePx,
      stripLayerFlips: connectionDetailStripFlipsMerged,
      stripDepthOverridePxByDir: undefined,
      stripCanvasNudgePxByDir: undefined,
    })
    const axesIn = connectionDetailDrawingAxesPlanInches({
      core: connectionDetailCorePx,
      layerRects: rects,
      siteWIn,
      siteHIn,
      planScale: d.planScale,
    })
    if (axesIn.xsIn.length < 2 || axesIn.ysIn.length < 2) return null
    const linesPx = connectionDetailLayerOnlyGridLinesPx({
      core: connectionDetailCorePx,
      layerRects: rects,
    })
    const minCellSpan = minCellSpanFromDrawingAxes(axesIn.xsIn, axesIn.ysIn) ?? delta
    return { rects, axesIn, linesPx, minCellSpan }
  }, [
    sectionCutGraphicVariant,
    connectionDetailForCanvas,
    connectionDetailCorePx,
    cw,
    ch,
    d,
    orderedSystems,
    mepById,
    connectionDetailStripFlipsMerged,
    siteWIn,
    siteHIn,
    delta,
  ])

  connectionDetailIrregularAxesRef.current = connectionDetailLayerGrid?.axesIn ?? null

  const connectionDetailAnnotationPick = useMemo(() => {
    if (sectionCutGraphicVariant !== 'detailLine' || isElevationCanvas) return undefined
    const irr = connectionDetailLayerGrid?.axesIn
    const base = { siteWIn, siteHIn, atomicAnnotationEdges: true as const }
    if (irr && irr.xsIn.length >= 2 && irr.ysIn.length >= 2) return { ...base, irregularAxes: irr }
    return base
  }, [sectionCutGraphicVariant, isElevationCanvas, siteWIn, siteHIn, connectionDetailLayerGrid])

  /** Annotation under cursor, or connection-detail layer fill cell (`cdf:`) when click is inside painted fill. */
  const resolveAnnotOrConnectionFillHit = useCallback(
    (pin: { xIn: number; yIn: number }, sketchArg: PlanLayoutSketch) => {
      const hAnn = annotationHitKeyAtPlanInches(
        pin,
        sketchArg,
        siteWIn,
        siteHIn,
        delta,
        connectionDetailAnnotationHitPickDistIn,
        isElevationCanvas,
        sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas,
        connectionDetailLayerGrid?.axesIn,
      )
      if (hAnn) return hAnn
      if (sectionCutGraphicVariant !== 'detailLine' || isElevationCanvas) return null
      const ax = connectionDetailLayerGrid?.axesIn
      const fills = sketchArg.connectionDetailLayerFillByCell
      if (!ax || !fills || Object.keys(fills).length === 0) return null
      const ck = connectionDetailFilledCellHitAtPlanInches(pin, fills, ax.xsIn, ax.ysIn)
      return ck ? connectionDetailFillInteractionKey(ck) : null
    },
    [
      siteWIn,
      siteHIn,
      delta,
      connectionDetailAnnotationHitPickDistIn,
      isElevationCanvas,
      sectionCutGraphicVariant,
      connectionDetailLayerGrid?.axesIn,
    ],
  )

  const planGridFns = useMemo(() => {
    const irr = connectionDetailLayerGrid?.axesIn
    const useIrr =
      sectionCutGraphicVariant === 'detailLine' &&
      !isElevationCanvas &&
      irr &&
      irr.xsIn.length >= 2 &&
      irr.ysIn.length >= 2
    if (useIrr && irr) {
      const { xsIn, ysIn } = irr
      return {
        useIrregular: true as const,
        axesIn: irr,
        nodeMax: { nx: xsIn.length - 1, ny: ysIn.length - 1 },
        snap: (xIn: number, yIn: number) => snapPlanInchesToConnectionDetailNodes(xIn, yIn, xsIn, ysIn),
        nearestEdge: (xIn: number, yIn: number, md: number) =>
          nearestConnectionDetailGridEdge(xIn, yIn, xsIn, ysIn, md),
        nodeUnderCursor: (xIn: number, yIn: number, snapDist: number) =>
          nodeUnderCursorConnectionDetail(xIn, yIn, xsIn, ysIn, snapDist),
        edgeEndpointsCanvas: (key: GridEdgeKey) => edgeEndpointsConnectionDetailCanvasPx(d, key, xsIn, ysIn),
        closerNodeOnEdge: (key: GridEdgeKey, xIn: number, yIn: number) =>
          closerNodeOnEdgeConnectionDetail(key, xIn, yIn, xsIn, ysIn),
        planInchesToCell: (xIn: number, yIn: number) => planInchesToCellConnectionDetail(xIn, yIn, xsIn, ysIn),
        cellsIntersectingPlanRect: (minX: number, minY: number, maxX: number, maxY: number) =>
          cellsIntersectingConnectionDetailPlanRect(minX, minY, maxX, maxY, xsIn, ysIn),
        gridEdgeIntersectsPlanRect: (key: GridEdgeKey, minX: number, minY: number, maxX: number, maxY: number) =>
          gridEdgeIntersectsPlanRectConnectionDetail(key, xsIn, ysIn, minX, minY, maxX, maxY),
        manhattanWallPath: (
          i0: number,
          j0: number,
          i1: number,
          j1: number,
          shiftStraight: boolean,
          xIn: number,
          yIn: number,
        ) => manhattanWallPathEdgesConnectionDetail(i0, j0, i1, j1, shiftStraight, xIn, yIn, xsIn, ysIn),
      }
    }
    return {
      useIrregular: false as const,
      axesIn: null as { xsIn: readonly number[]; ysIn: readonly number[] } | null,
      nodeMax: { nx: siteNx, ny: siteNy },
      snap: (xIn: number, yIn: number) => snapPlanInchesToGridNode(xIn, yIn, delta, siteNx, siteNy),
      nearestEdge: (xIn: number, yIn: number, md: number) =>
        nearestGridEdge(xIn, yIn, siteWIn, siteHIn, delta, md),
      nodeUnderCursor: (xIn: number, yIn: number, snapDist: number) =>
        nodeUnderCursor(xIn, yIn, delta, siteNx, siteNy, snapDist),
      edgeEndpointsCanvas: (key: GridEdgeKey) => edgeEndpointsCanvasPx(d, key, delta),
      closerNodeOnEdge: (key: GridEdgeKey, xIn: number, yIn: number) => closerNodeOnEdge(key, xIn, yIn, delta),
      planInchesToCell: (xIn: number, yIn: number) => planInchesToCell(xIn, yIn, delta, siteNx, siteNy),
      cellsIntersectingPlanRect: (minX: number, minY: number, maxX: number, maxY: number) =>
        cellsIntersectingPlanRect(minX, minY, maxX, maxY, delta, siteNx, siteNy),
      gridEdgeIntersectsPlanRect: (key: GridEdgeKey, minX: number, minY: number, maxX: number, maxY: number) =>
        gridEdgeIntersectsPlanRect(key, delta, minX, minY, maxX, maxY),
      manhattanWallPath: (
        i0: number,
        j0: number,
        i1: number,
        j1: number,
        shiftStraight: boolean,
        xIn: number,
        yIn: number,
      ) => manhattanWallPathEdges(i0, j0, i1, j1, shiftStraight, xIn, yIn, delta),
    }
  }, [
    connectionDetailLayerGrid,
    sectionCutGraphicVariant,
    isElevationCanvas,
    d,
    delta,
    siteNx,
    siteNy,
    siteWIn,
    siteHIn,
  ])

  const wallDragSnapDist = useCallback(
    (maxDistPickIn: number) => wallLineDragEndSnapDistIn(maxDistPickIn, connectionDetailLayerGrid?.minCellSpan ?? delta),
    [connectionDetailLayerGrid, delta],
  )

  const connectionDetailNodeAxes =
    sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas
      ? (connectionDetailLayerGrid?.axesIn ?? null)
      : null

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
    const z1 = clampZoom(Math.min((vpW * margin) / bw, (vpH * margin) / bh, zoomMax), zoomMax)

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
  }, [roomZoneCameraRequest, cellPx, setZoom, zoomMax])

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

  const mepRunOffsets = useMemo(
    () => computeMepRunOffsets(sketch.edges, d, mepById),
    [sketch.edges, d, mepById],
  )

  const mepJoinedDrawModel = useMemo(() => {
    if (planVisualProfile?.mode !== 'trade_mep') {
      return {
        joinedPlacedEdgeKeys: new Set<string>(),
        pathLayers: [] as import('./planLayoutCore/mepRunPathJoin').MepJoinedPathLayer[],
        pathDByPlacedKey: new Map<string, string>(),
      }
    }
    return buildMepJoinedDrawModel(
      sketch.edges,
      d,
      delta,
      mepById,
      planColorCatalog,
      planVisualProfile ?? undefined,
    )
  }, [sketch.edges, d, delta, mepById, planColorCatalog, planVisualProfile])

  /** Trade sheets: draw only MEP on the live canvas; full layout comes from level underlay. */
  const hideLayoutDrawingOnTrade =
    planVisualProfile?.mode === 'trade_mep' && !isElevationCanvas

  useEffect(() => {
    const edgeFlip =
      planLineAssemblyLayers &&
      !hideLayoutDrawingOnTrade &&
      isEdgeLayerMode &&
      !isMepRunMode(placeMode) &&
      structureTool === 'flipAssembly'
    const colFlip =
      planLineAssemblyLayers &&
      !hideLayoutDrawingOnTrade &&
      placeMode === 'column' &&
      floorTool === 'flipAssembly'
    if (!edgeFlip && !colFlip) setSelectedAssemblyFlipKeys(new Set())
  }, [
    planLineAssemblyLayers,
    hideLayoutDrawingOnTrade,
    isEdgeLayerMode,
    placeMode,
    structureTool,
    floorTool,
  ])

  const planConnections: PlanConnection[] = useMemo(() => {
    if (annotationsOnly && !sketchHasStructuralPlanContent(sketch)) return []
    return buildPlanConnections(
      sketch,
      orderedSystems,
      mepItems,
      d.layoutRefs,
      d.thicknessBySystem,
    )
  }, [annotationsOnly, sketch, orderedSystems, mepItems, d.layoutRefs, d.thicknessBySystem])

  /** Level-1 (or active) layout: connection-detail grid/boundary settings (`connectionDetailGridSpacingIn`). */
  const layoutForConnectionDetails = layoutSketchForProjection ?? sketch

  const connectionDetailMergedSheets = useMemo(
    () =>
      buildConnectionDetailSheets(
        planConnections,
        orderedSystems,
        mepItems,
        d.thicknessBySystem,
        sketch,
        connectionSketchKeySet,
      ),
    [planConnections, orderedSystems, mepItems, d.thicknessBySystem, sketch, connectionSketchKeySet],
  )

  const connectionDetailRowByTemplateKey = useMemo(() => {
    const m = new Map<string, PlanConnection>()
    for (const row of connectionDetailMergedSheets) {
      m.set(row.templateKey, row)
    }
    return m
  }, [connectionDetailMergedSheets])

  const mergedPlanStructurePaint = useMemo(() => {
    type PlacedPaint = { k: 'placed'; e: PlacedGridEdge }
    type RoomBdPaint = { k: 'roomBd'; e: GridEdgeKey }
    type MepPathRow = {
      k: 'mepPath'
      sw: number
      tie: string
      stroke: string
      dash: string | undefined
      opacity: number
      d: string
      reactKey: string
    }
    type Row =
      | MepPathRow
      | { k: 'placedLine'; sw: number; tie: string; item: PlacedPaint }
      | { k: 'roomBd'; sw: number; tie: string; item: RoomBdPaint }
      | { k: 'cornerCap'; sw: number; tie: string; cc: PlanConnection }
    const out: Row[] = []
    for (const layer of mepJoinedDrawModel.pathLayers) {
      layer.paths.forEach((p, pi) => {
        out.push({
          k: 'mepPath',
          sw: layer.strokeWidth,
          tie: p.edgeKeys.slice().sort().join('|') || `p${pi}`,
          stroke: layer.stroke,
          dash: layer.dash,
          opacity: layer.opacity,
          d: p.d,
          reactKey: `mep-join-${p.edgeKeys[0] ?? 'x'}-${pi}`,
        })
      })
    }
    for (const item of planLinesPaintOrder) {
      if (item.k === 'placed') {
        const pk = placedEdgeKey(item.e)
        if (
          (item.e.source ?? 'arch') === 'mep' &&
          item.e.kind === 'run' &&
          mepJoinedDrawModel.joinedPlacedEdgeKeys.has(pk)
        ) {
          continue
        }
        out.push({
          k: 'placedLine',
          sw: strokeWidthForEdge(d, item.e, mepById),
          tie: pk,
          item,
        })
      } else {
        out.push({
          k: 'roomBd',
          sw: strokeWidthForRoomBoundaryLine(d),
          tie: `room-bd-${edgeKeyString(item.e)}`,
          item,
        })
      }
    }
    for (const cc of planConnections) {
      out.push({
        k: 'cornerCap',
        sw: cornerConnectionPlanStrokeSortPx(cc, d, mepById),
        tie: `cc-${cc.nodeI}:${cc.nodeJ}`,
        cc,
      })
    }
    out.sort((a, b) => {
      const c = b.sw - a.sw
      return c !== 0 ? c : a.tie.localeCompare(b.tie)
    })
    const afterFilter =
      planVisualProfile?.mode === 'trade_mep' && !isElevationCanvas
        ? out.filter((row) => {
            if (row.k === 'mepPath') return true
            if (row.k === 'cornerCap') return false
            if (row.k === 'roomBd') return false
            if (row.k === 'placedLine') return (row.item.e.source ?? 'arch') === 'mep'
            return true
          })
        : out
    /** Corner caps last so junction fills/strips aren’t covered by wall strokes (sort is thickest-first). */
    const caps = afterFilter.filter((row): row is Extract<typeof row, { k: 'cornerCap' }> => row.k === 'cornerCap')
    const beneathCaps = afterFilter.filter((row) => row.k !== 'cornerCap')
    return [...beneathCaps, ...caps]
  }, [
    planLinesPaintOrder,
    mepJoinedDrawModel,
    planConnections,
    d,
    mepById,
    planVisualProfile,
    isElevationCanvas,
  ])

  /** Grid segments that have an arch wall stroke (for opening underlay / dimming). */
  const planSegmentArchWallKeys = useMemo(() => {
    const s = new Set<string>()
    for (const e of sketch.edges) {
      if ((e.source ?? 'arch') === 'arch' && e.kind === 'wall') s.add(edgeKeyString(e))
    }
    return s
  }, [sketch.edges])

  /** Arch wall edges that share a grid segment with an opening (collinear only). */
  const archWallKeysWithOpeningOverlap = useMemo(
    () => planArchWallEdgeKeysOverlappedByOpenings(sketch.edges),
    [sketch.edges],
  )

  /** Opening-only segments: synthetic wall band drawn **under** all strokes so it does not tint perpendicular walls. */
  const archOpeningGhostEdges = useMemo(() => {
    return sketch.edges.filter((e) => {
      if ((e.source ?? 'arch') !== 'arch') return false
      const k = e.kind ?? 'wall'
      if (k !== 'window' && k !== 'door' && k !== 'doorSwing') return false
      return !planSegmentArchWallKeys.has(edgeKeyString(e))
    })
  }, [sketch.edges, planSegmentArchWallKeys])

  const assemblyFlipTargetsEdge = useMemo((): AssemblyFlipEdgeTarget[] => {
    if (!planLineAssemblyLayers || hideLayoutDrawingOnTrade) return []
    const list: AssemblyFlipEdgeTarget[] = []
    const flipMap = sketch.planArchEdgeLayerFlipped ?? {}

    for (const e of sketch.edges) {
      if (!archEdgeSupportsPlanAssemblyStack(e)) continue
      if (!edgeMatchesToolbarAssemblyFlipKind(e, placeMode, activeCatalog)) continue
      const pk = planArchAssemblyFlipEdgeKey(e)
      const offPk = placedEdgeKey(e)
      const base =
        (e.source ?? 'arch') === 'arch'
          ? placedArchEdgeEndpointsCanvasPx(d, e, delta)
          : edgeEndpointsCanvasPx(d, e, delta)
      const off = mepRunOffsets.get(offPk)
      const x1 = base.x1 + (off?.dx ?? 0)
      const y1 = base.y1 + (off?.dy ?? 0)
      const x2 = base.x2 + (off?.dx ?? 0)
      const y2 = base.y2 + (off?.dy ?? 0)
      const sw = strokeWidthForEdge(d, e, mepById)
      const k = edgeKeyString(e)
      const kind = e.kind ?? 'wall'
      const wallUsesBand =
        (e.source ?? 'arch') === 'arch' && kind === 'wall' && archWallKeysWithOpeningOverlap.has(k)
      const bandRect = wallUsesBand
        ? archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
        : thinStrokeBandCanvasPx(e.axis, x1, y1, x2, y2, sw)
      const stack = computePlanArchEdgeLayerStack({
        edge: e,
        d,
        orderedSystems,
        bandRect,
        axis: e.axis,
        placedKey: pk,
        layerOrderFlipped: planArchAssemblyLayerOrderFlipped(flipMap, e, 'edge'),
      })
      if (stack && stack.slices.length > 1) {
        list.push({ pk, axis: e.axis, bandRect, segmentKey: k, edge: e })
      }
    }

    for (const e of archOpeningGhostEdges) {
      if (!edgeMatchesToolbarAssemblyFlipKind(e, placeMode, activeCatalog)) continue
      const wallAsWall: PlacedGridEdge = { ...e, kind: 'wall' }
      const pk = openGhostPlanArchAssemblyFlipStorageKey(e)
      const bandRect = archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
      const stack = computePlanArchEdgeLayerStack({
        edge: wallAsWall,
        d,
        orderedSystems,
        bandRect,
        axis: e.axis,
        placedKey: pk,
        layerOrderFlipped: planArchAssemblyLayerOrderFlipped(flipMap, e, 'openGhost'),
      })
      if (stack && stack.slices.length > 1) {
        list.push({ pk, axis: e.axis, bandRect, segmentKey: edgeKeyString(e), edge: wallAsWall })
      }
    }

    return list
  }, [
    planLineAssemblyLayers,
    hideLayoutDrawingOnTrade,
    sketch.edges,
    sketch.planArchEdgeLayerFlipped,
    d,
    delta,
    mepRunOffsets,
    mepById,
    orderedSystems,
    archWallKeysWithOpeningOverlap,
    archOpeningGhostEdges,
    placeMode,
    activeCatalog,
  ])

  const assemblyFlipTargetsColumn = useMemo((): AssemblyFlipColumnTarget[] => {
    if (!planLineAssemblyLayers || hideLayoutDrawingOnTrade) return []
    const flipMap = sketch.planArchEdgeLayerFlipped ?? {}
    const list: AssemblyFlipColumnTarget[] = []
    for (const col of sketch.columns ?? []) {
      const pk = planAssemblyColumnFlipKey(col)
      const half = col.sizeIn / 2
      const ox = col.offsetXPlanIn ?? 0
      const oy = col.offsetYPlanIn ?? 0
      const { x, y } = planInchesToCanvasPx(d, col.cxIn - half + ox, col.cyIn - half + oy)
      const sPx = col.sizeIn * d.planScale
      const bandRect = { x, y, width: sPx, height: sPx }
      const stack = computePlanArchColumnLayerStack({
        col,
        d,
        orderedSystems,
        bandRect,
        placedKey: pk,
        layerOrderFlipped: Boolean(flipMap[pk]),
      })
      if (stack && stack.slices.length > 1) {
        list.push({ pk, bandRect, col })
      }
    }
    return list
  }, [
    planLineAssemblyLayers,
    hideLayoutDrawingOnTrade,
    sketch.columns,
    sketch.planArchEdgeLayerFlipped,
    d,
    orderedSystems,
  ])

  /** Template → sheet badge + nav subtitle for tooltips (same order as `buildConnectionDetailSheets` in App). */
  const connectionSheetCornerLabelByTemplateKey = useMemo(() => {
    const sheets = buildConnectionDetailSheets(
      planConnections,
      orderedSystems,
      mepItems,
      d.thicknessBySystem,
      sketch,
      connectionSketchKeySet,
    )
    const m = new Map<string, { badge: string; subtitle: string }>()
    for (let i = 0; i < sheets.length; i++) {
      const row = sheets[i]!
      m.set(row.templateKey, {
        badge: connectionDetailSheetBadge(i),
        subtitle: connectionDetailSheetNavSubtitle(row),
      })
    }
    return m
  }, [planConnections, orderedSystems, mepItems, d.thicknessBySystem, sketch, connectionSketchKeySet])

  const cornerVariantLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearCornerVariantLeaveTimer = useCallback(() => {
    if (cornerVariantLeaveTimerRef.current != null) {
      clearTimeout(cornerVariantLeaveTimerRef.current)
      cornerVariantLeaveTimerRef.current = null
    }
  }, [])
  useEffect(() => () => clearCornerVariantLeaveTimer(), [clearCornerVariantLeaveTimer])

  const scheduleCornerVariantBarClose = useCallback(() => {
    clearCornerVariantLeaveTimer()
    cornerVariantLeaveTimerRef.current = window.setTimeout(() => {
      setHomogeneousCornerHoverKey(null)
      cornerVariantLeaveTimerRef.current = null
    }, 220)
  }, [clearCornerVariantLeaveTimer])

  const openCornerVariantBar = useCallback(
    (nodeKey: string) => {
      clearCornerVariantLeaveTimer()
      setHomogeneousCornerHoverKey(nodeKey)
    },
    [clearCornerVariantLeaveTimer],
  )

  useEffect(() => {
    if (!showCornerConditions) {
      clearCornerVariantLeaveTimer()
      setHomogeneousCornerHoverKey(null)
    }
  }, [showCornerConditions, clearCornerVariantLeaveTimer])

  const setHomogeneousLSketchIdForNode = useCallback(
    (nodeKey: string, tplId: string) => {
      onSketchChange({
        ...sketch,
        connectionJunctionHomogeneousLSketchIdByNode: {
          ...(sketch.connectionJunctionHomogeneousLSketchIdByNode ?? {}),
          [nodeKey]: tplId,
        },
      })
    },
    [sketch, onSketchChange],
  )

  const addHomogeneousLConnectionDrawing = useCallback(
    (familyKey: string, nodeKey: string) => {
      const variantIds = getOrInferHomogeneousLVariantIds(
        familyKey,
        sketch,
        connectionSketchKeySet,
      )
      const explicit = sketch.connectionDetailHomogeneousLVariantIdsByFamily?.[familyKey]
      const baseList =
        explicit && explicit.length > 0 ? [...explicit] : [...variantIds]
      const newId = connectionDetailNewHomogeneousLVariantSketchId(
        familyKey,
        `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      )
      const nextVariants = [...baseList, newId]
      onSketchChange({
        ...sketch,
        connectionDetailHomogeneousLVariantIdsByFamily: {
          ...(sketch.connectionDetailHomogeneousLVariantIdsByFamily ?? {}),
          [familyKey]: nextVariants,
        },
        connectionJunctionHomogeneousLSketchIdByNode: {
          ...(sketch.connectionJunctionHomogeneousLSketchIdByNode ?? {}),
          [nodeKey]: newId,
        },
      })
    },
    [sketch, onSketchChange, connectionSketchKeySet],
  )

  /** Toggle schematic interior/exterior stack per segment or column (click or marquee). */
  const togglePlanArchAssemblyFlipToKeys = useCallback(
    (keys: readonly string[]) => {
      const s = sketchRef.current
      const nextFlip: Record<string, true> = { ...(s.planArchEdgeLayerFlipped ?? {}) }
      for (const pk of keys) {
        if (nextFlip[pk]) delete nextFlip[pk]
        else nextFlip[pk] = true
      }
      const out: PlanLayoutSketch = { ...s }
      if (Object.keys(nextFlip).length > 0) {
        out.planArchEdgeLayerFlipped = nextFlip
      } else {
        delete out.planArchEdgeLayerFlipped
      }
      onSketchChange(out)
    },
    [onSketchChange],
  )

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

  /** Returns true if deletion should proceed (no data, or user confirmed). */
  const confirmLevelLineDeletion = useCallback(
    (keysToRemove: readonly string[]): boolean => {
      if (!buildingLevels) return true
      const lvlLineIds = keysToRemove
        .filter((k) => k.startsWith('lvl:'))
        .map((k) => k.slice(4))
      if (lvlLineIds.length === 0) return true

      // Map each level line ID → its matching BuildingLevel and sketch.
      // Level 1 is special: its datum line is in sketch.elevationLevelLines with label
      // 'Level 1', but the BuildingLevel has the synthetic id '__default_level_1' and
      // its sketch is layoutSketchForProjection (implSketch), not levelSketches.
      const levelsWithData: BuildingLevel[] = []
      for (const lineId of lvlLineIds) {
        const line = sketch.elevationLevelLines?.find((l) => l.id === lineId)
        if (!line) continue
        // Find the matching BuildingLevel: Level 1 is matched by label; others by id.
        const bl =
          line.label === 'Level 1'
            ? buildingLevels.find((b) => b.id === '__default_level_1')
            : buildingLevels.find((b) => b.id === lineId)
        if (!bl) continue
        // Pick the correct sketch for this level.
        const s = bl.id === '__default_level_1' ? layoutSketchForProjection : levelSketches?.[bl.id]
        if (!s) continue
        const hasData =
          (s.edges?.length ?? 0) > 0 ||
          (s.cells?.length ?? 0) > 0 ||
          (s.columns?.length ?? 0) > 0 ||
          (s.measureRuns?.length ?? 0) > 0 ||
          (s.annotationLabels?.length ?? 0) > 0
        if (hasData) levelsWithData.push(bl)
      }
      if (levelsWithData.length === 0) return true
      const names = levelsWithData.map((l) => `"${l.label}"`).join(', ')
      return window.confirm(
        `The level ${names} has drawings on it. Deleting this level line will remove the level from the sidebar. Are you sure?`,
      )
    },
    [levelSketches, buildingLevels, sketch.elevationLevelLines, layoutSketchForProjection],
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
      const keysArr = Array.from(selectedAnnotationKeys)
      const sedKeys = keysArr.filter((k) => k.startsWith('sed:'))
      const cdfKeysFromSelection = keysArr
        .map((k) => connectionDetailFillCellKeyFromInteractionKey(k))
        .filter((k): k is string => k != null)
      const otherKeys = keysArr.filter((k) => !k.startsWith('sed:') && !k.startsWith('cdf:'))
      // If any level lines being deleted have drawings on them, require confirmation.
      if (!confirmLevelLineDeletion(keysArr)) return

      let nextSketchState: PlanLayoutSketch = sketch
      let annChanged = false
      if (sedKeys.length > 0) {
        const n = nextSketchAfterRemovingDetailSectionCutSedKeys(
          nextSketchState,
          sedKeys,
          delta,
          siteWIn,
          siteHIn,
          () => `sc-${++sectionCutIdRef.current}`,
          connectionDetailLayerGrid?.axesIn,
        )
        if (n) {
          nextSketchState = n
          annChanged = true
        }
      }
      if (cdfKeysFromSelection.length > 0) {
        const n = removeConnectionDetailFillsAtCellKeys(nextSketchState, cdfKeysFromSelection)
        if (n) {
          nextSketchState = n
          annChanged = true
        }
      }
      if (otherKeys.length > 0) {
        const n = nextSketchAfterRemovingAnnotationKeys(nextSketchState, otherKeys, delta)
        if (n) {
          nextSketchState = n
          annChanged = true
        }
      }
      if (!annChanged) return
      setSelectedAnnotationKeys(new Set())
      onSketchChange(nextSketchState)
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
    if (isMepPointMode(placeMode) && floorTool === 'select' && selectedMepDeviceKeys.size > 0) {
      const rm = selectedMepDeviceKeys
      const nextDevs = (sketch.mepDevices ?? []).filter((d) => !rm.has(placedMepDeviceKey(d)))
      setSelectedMepDeviceKeys(new Set())
      onSketchChange({
        ...sketch,
        mepDevices: nextDevs.length > 0 ? nextDevs : undefined,
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
    confirmLevelLineDeletion,
    delta,
    siteWIn,
    siteHIn,
    connectionDetailLayerGrid,
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
        setSelectedAssemblyFlipKeys(new Set())
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
        const canDelMepDevices =
          isMepPointMode(placeMode) && floorTool === 'select' && selectedMepDeviceKeys.size > 0
        const canDelRoom =
          placeMode === 'room' &&
          roomTool === 'select' &&
          (selectedRoomEdgeKeys.size > 0 || !!selectedRoomZoneCellKeys?.length)
        if (canDelAnnotations || canDelEdges || canDelCells || canDelColumns || canDelMepDevices || canDelRoom) {
          e.preventDefault()
          deleteSelectedItems()
        }
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 5 : 1
        const adi = (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) * step
        const adj = (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) * step

        if (annotationToolActive && annotationTool === 'select' && selectedAnnotationKeys.size > 0) {
          e.preventDefault()
          let s = { ...sketch }
          for (const key of selectedAnnotationKeys) {
            if (key.startsWith('lbl:')) {
              const id = key.slice(4)
              s = {
                ...s,
                annotationLabels: (s.annotationLabels ?? []).map((l) =>
                  l.id === id ? { ...l, xIn: l.xIn + adi * delta, yIn: l.yIn + adj * delta } : l,
                ),
              }
            } else if (key.startsWith('lvl:')) {
              const id = key.slice(4)
              s = {
                ...s,
                elevationLevelLines: (s.elevationLevelLines ?? []).map((l) =>
                  l.id !== id ? l : { ...l, j: Math.max(0, Math.min(siteNy, l.j + adj)) },
                ),
              }
            } else if (key.startsWith('dim:')) {
              const restD = key.slice(4)
              const pd = restD.indexOf('|')
              const id = pd >= 0 ? restD.slice(0, pd) : restD
              s = {
                ...s,
                measureRuns: (s.measureRuns ?? []).map((r) => {
                  if (r.id !== id) return r
                  return {
                    ...r,
                    edgeKeys: r.edgeKeys.map((ek) => {
                      const p = parseEdgeKeyString(ek)
                      return p ? edgeKeyString({ ...p, i: p.i + adi, j: p.j + adj }) : ek
                    }),
                    startNode: { i: r.startNode.i + adi, j: r.startNode.j + adj },
                    endNode: { i: r.endNode.i + adi, j: r.endNode.j + adj },
                  }
                }),
              }
            } else if (key.startsWith('grid:')) {
              const restG = key.slice(5)
              const pg = restG.indexOf('|')
              const id = pg >= 0 ? restG.slice(0, pg) : restG
              s = {
                ...s,
                annotationGridRuns: (s.annotationGridRuns ?? []).map((r) => {
                  if (r.id !== id) return r
                  return {
                    ...r,
                    edgeKeys: r.edgeKeys.map((ek) => {
                      const p = parseEdgeKeyString(ek)
                      return p ? edgeKeyString({ ...p, i: p.i + adi, j: p.j + adj }) : ek
                    }),
                  }
                }),
              }
            } else if (key.startsWith('sec:')) {
              const id = key.slice(4)
              s = {
                ...s,
                annotationSectionCuts: (s.annotationSectionCuts ?? []).map((c) => {
                  if (c.id !== id) return c
                  return {
                    ...c,
                    startNode: { i: c.startNode.i + adi, j: c.startNode.j + adj },
                    endNode: { i: c.endNode.i + adi, j: c.endNode.j + adj },
                  }
                }),
              }
            }
          }
          onSketchChange(s)
          return
        }

        if (placeMode === 'column' && floorTool === 'select' && selectedColumnKeys.size > 0) {
          e.preventDefault()
          const cols = sketch.columns ?? []
          const snap = cols.filter((c) => selectedColumnKeys.has(placedColumnKey(c)))
          if (snap.length > 0) {
            const dxIn = adi * delta
            const dyIn = adj * delta
            if (snap.some((c) => c.cxIn + dxIn < 0 || c.cxIn + dxIn > siteWIn || c.cyIn + dyIn < 0 || c.cyIn + dyIn > siteHIn)) return
            const moveIds = new Set(snap.map((c) => c.id))
            const nextCols = cols.map((c) =>
              moveIds.has(c.id) ? { ...c, cxIn: c.cxIn + dxIn, cyIn: c.cyIn + dyIn } : c,
            )
            onSketchChange({ ...sketch, columns: nextCols })
            setSelectedColumnKeys(
              new Set(snap.map((c) => placedColumnKey({ ...c, cxIn: c.cxIn + dxIn, cyIn: c.cyIn + dyIn }))),
            )
          }
          return
        }

        if (structureTool === 'select' && selectedEdgeKeys.size > 0) {
          e.preventDefault()
          const snap = sketch.edges.filter((ed) => selectedEdgeKeys.has(placedEdgeKey(ed)))
          if (snap.length > 0) {
            if (!allowMepEditing && snap.some((ed) => (ed.source ?? 'arch') === 'mep')) return
            const { di: cdi, dj: cdj } = clampEdgeMoveDelta(snap, adi, adj, siteNx, siteNy)
            if (cdi !== 0 || cdj !== 0) {
              const movePlaced = new Set(snap.map(placedEdgeKey))
              let merged = sketch.edges.filter((ed) => !movePlaced.has(placedEdgeKey(ed)))
              for (const edge of snap) {
                const ne = { ...edge, i: edge.i + cdi, j: edge.j + cdj }
                const gk = edgeKeyString(ne)
                const lid = layerIdentityFromEdge(ne)
                merged = merged.filter((ed) => !(edgeKeyString(ed) === gk && layerIdentityFromEdge(ed) === lid))
                merged.push(ne)
              }
              onSketchChange({ ...sketch, edges: merged })
              setSelectedEdgeKeys(
                new Set(snap.map((ed) => placedEdgeKey({ ...ed, i: ed.i + cdi, j: ed.j + cdj }))),
              )
            }
          }
          return
        }

        if (floorTool === 'select' && selectedCellKeys.size > 0) {
          e.preventDefault()
          const snap = (sketch.cells ?? []).filter((c) => selectedCellKeys.has(placedCellKey(c)))
          if (snap.length > 0) {
            const { di: cdi, dj: cdj } = clampCellMoveDelta(snap, adi, adj, siteNx, siteNy)
            if (cdi !== 0 || cdj !== 0) {
              const movePlaced = new Set(snap.map(placedCellKey))
              let merged = (sketch.cells ?? []).filter((c) => !movePlaced.has(placedCellKey(c)))
              for (const cell of snap) {
                const nc = { ...cell, i: cell.i + cdi, j: cell.j + cdj }
                const gk = cellKeyString(nc)
                if (isExclusiveArchFloorPaintCell(nc)) {
                  const nPk = cellPaintKind(nc)
                  if (nPk === 'stairs') {
                    merged = merged.filter((c) => cellKeyString(c) !== gk || !isExclusiveArchFloorPaintCell(c))
                  } else {
                    merged = merged.filter(
                      (c) =>
                        !(
                          cellKeyString(c) === gk &&
                          isExclusiveArchFloorPaintCell(c) &&
                          cellPaintKind(c) === nPk
                        ),
                    )
                  }
                } else {
                  const lid = layerIdentityFromCell(nc)
                  const pk = cellPaintKind(nc)
                  merged = merged.filter(
                    (c) => !(cellKeyString(c) === gk && layerIdentityFromCell(c) === lid && cellPaintKind(c) === pk),
                  )
                }
                merged.push(nc)
              }
              merged = normalizeExclusiveArchFloorPaintCells(merged)
              onSketchChange({ ...sketch, cells: merged })
              setSelectedCellKeys(
                new Set(snap.map((c) => placedCellKey({ ...c, i: c.i + cdi, j: c.j + cdj }))),
              )
            }
          }
          return
        }

        if (placeMode === 'room' && roomTool === 'select' && selectedRoomEdgeKeys.size > 0) {
          e.preventDefault()
          const rb = sketch.roomBoundaryEdges ?? []
          const snap = rb.filter((ed) => selectedRoomEdgeKeys.has(edgeKeyString(ed)))
          if (snap.length > 0) {
            const { di: cdi, dj: cdj } = clampRoomBoundaryMoveDelta(snap, adi, adj, siteNx, siteNy)
            if (cdi !== 0 || cdj !== 0) {
              const movePlaced = new Set(snap.map(edgeKeyString))
              let merged = rb.filter((ed) => !movePlaced.has(edgeKeyString(ed)))
              for (const edge of snap) {
                const ne: GridEdgeKey = { axis: edge.axis, i: edge.i + cdi, j: edge.j + cdj }
                merged = merged.filter((ed) => edgeKeyString(ed) !== edgeKeyString(ne))
                merged.push(ne)
              }
              const dedup = new Map<string, GridEdgeKey>()
              for (const me of merged) dedup.set(edgeKeyString(me), me)
              const out = [...dedup.values()]
              onSketchChange({ ...sketch, roomBoundaryEdges: out.length > 0 ? out : undefined })
              setSelectedRoomEdgeKeys(
                new Set(snap.map((ed) => edgeKeyString({ axis: ed.axis, i: ed.i + cdi, j: ed.j + cdj }))),
              )
            }
          }
          return
        }
      }

      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        applyZoomRef.current(zoomRef.current * ZOOM_BUTTON_RATIO, anchorViewportCenter())
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        applyZoomRef.current(zoomRef.current / ZOOM_BUTTON_RATIO, anchorViewportCenter())
      } else if (e.key === '0') {
        e.preventDefault()
        zoomCommitRef.current = null
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    deleteSelectedItems,
    endPaintStroke,
    annotationToolActive,
    annotationTool,
    onSketchChange,
    sketch,
    selectedEdgeKeys,
    selectedCellKeys,
    selectedRoomEdgeKeys,
    selectedRoomZoneCellKeys?.length,
    selectedColumnKeys,
    selectedAnnotationKeys,
    placeMode,
    roomTool,
    structureTool,
    floorTool,
    onRoomZoneSelect,
    isElevationCanvas,
    sketch.elevationGroundPlaneJ,
    delta,
    siteNx,
    siteNy,
    siteWIn,
    siteHIn,
    allowMepEditing,
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
            return !edgeMatchesToolbarEraseKind(e, placeMode, activeCatalog)
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
      placeMode,
      activeCatalog,
      activeSystemId,
      edgePlacementSource,
      placementKind,
      updateEdges,
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
          return !edgeMatchesToolbarEraseKind(e, placeMode, activeCatalog)
        }),
      )
      return true
    },
    [siteNx, siteNy, placeMode, activeCatalog, updateEdges, blockMepMutations],
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
            return !edgeMatchesToolbarEraseKind(e, placeMode, activeCatalog)
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
      placeMode,
      placementKind,
      activeSystemId,
      edgePlacementSource,
      updateEdges,
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
      const top =
        typeof document !== 'undefined' ? document.elementFromPoint(clientX, clientY) : null
      if (planPointerTargetIsCornerConnectionUi(top)) {
        clear()
        return false
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
      const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
      if (!endNode) {
        clear()
        return false
      }
      const keys = edgesInNodeSpan(last.i, last.j, endNode.i, endNode.j)
      const { nx: nMx, ny: nMy } = planGridFns.nodeMax
      const valid =
        keys.length > 0 &&
        keys.every((k) => {
          if (k.axis === 'h') return k.i >= 0 && k.i < nMx && k.j >= 0 && k.j <= nMy
          return k.i >= 0 && k.i <= nMx && k.j >= 0 && k.j < nMy
        })
      if (valid) {
        setWallLinePreviewKeys(keys.map(edgeKeyString))
        setWallLinePreviewRubberPlanIn(
          wallPreviewRubberPlanInFrom(endNode, pin, delta, planGridFns.axesIn),
        )
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
      planGridFns,
      wallDragSnapDist,
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

  const processPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (paintDragRef.current) {
        setColumnPaintPreview(null)
        setConnectionDetailFillPreviewCellKeys(null)
        const dk = dragKindRef.current
        if (
          dk === 'marquee' ||
          dk === 'wall-rect' ||
          dk === 'room-marquee' ||
          dk === 'room-rect' ||
          dk === 'floor-marquee' ||
          dk === 'column-marquee' ||
          dk === 'select-marquee' ||
          dk === 'assembly-flip-marquee' ||
          dk === 'room-select-marquee' ||
          dk === 'floor-select-marquee' ||
          dk === 'annotation-select-marquee' ||
          dk === 'annotation-erase-marquee' ||
          dk === 'mep-select-marquee' ||
          dk === 'mep-erase-marquee'
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
                const picked = mergeAnnotationAndConnectionFillKeysInPlanRect(
                  sketchRef.current,
                  minX,
                  minY,
                  maxX,
                  maxY,
                  delta,
                  isElevationCanvas,
                  connectionDetailAnnotationPick,
                  connectionDetailMarqueeRectPadIn,
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
        if (dk === 'level-line-drag') {
          const pin2 = pointerToPlanInches(e.clientX, e.clientY)
          if (pin2) {
            const dj = Math.round((pin2.yIn - levelLineDragStartYRef.current) / delta)
            movePreviewDiDjRef.current = { di: 0, dj }
            setMovePreview({ di: 0, dj })
          }
          return
        }
      }

      const pin = pointerToPlanInches(e.clientX, e.clientY)
      if (!pin) {
        if (!paintDragRef.current) {
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setWallLinePreviewRubberPlanIn(null)
          setMeasurePreviewNodes(null)
          setChainLineErasePreview(false)
          setColumnPaintPreview(null)
          setHoverAnnotationSelectKey(null)
          setConnectionDetailFillPreviewCellKeys(null)
        }
        return
      }

      const overCornerConnectionUi = planPointerEventIsOverCornerConnectionUi(e)
      if (overCornerConnectionUi) {
        if (!paintDragRef.current) {
          setHoverEdge(null)
          setHoverCell(null)
          setWallLinePreviewKeys(null)
          setWallLinePreviewRubberPlanIn(null)
          setMeasurePreviewNodes(null)
          setChainLineErasePreview(false)
          setColumnPaintPreview(null)
          setMepDevicePaintPreview(null)
          setHoverAnnotationSelectKey(null)
          setHoverAnnotationEraseKey(null)
          setConnectionDetailFillPreviewCellKeys(null)
          return
        }
        const dkLine = dragKindRef.current
        const suppressCanvasPreview =
          dkLine === 'wall-line' ||
          dkLine === 'chain-line' ||
          dkLine === 'room-line' ||
          dkLine === 'room-chain-line' ||
          (dkLine === 'measure-line' &&
            annotationToolActive &&
            annotationTool === 'measureLine') ||
          (dkLine === 'annotation-grid-line' &&
            annotationToolActive &&
            annotationTool === 'gridLine') ||
          (dkLine === 'section-cut-line' && annotationToolActive) ||
          (dkLine === 'floor-line' && isCellPaintMode)
        if (suppressCanvasPreview) {
          setWallLinePreviewKeys(null)
          setWallLinePreviewRubberPlanIn(null)
          setMeasurePreviewNodes(null)
          setHoverEdge(null)
          setHoverCell(null)
          return
        }
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
        const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
        setWallLinePreviewKeys(null)
        const { nx: nMx, ny: nMy } = planGridFns.nodeMax
        if (
          endNode &&
          (endNode.i !== start.i || endNode.j !== start.j) &&
          endNode.i >= 0 &&
          endNode.j >= 0 &&
          endNode.i <= nMx &&
          endNode.j <= nMy
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
        const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
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
            : planGridFns.manhattanWallPath(
                start.i,
                start.j,
                endNode.i,
                endNode.j,
                e.shiftKey,
                pin.xIn,
                pin.yIn,
              )
        const { nx: nMx2, ny: nMy2 } = planGridFns.nodeMax
        const valid = keys.every((k) => {
          if (k.axis === 'h') return k.i >= 0 && k.i < nMx2 && k.j >= 0 && k.j <= nMy2
          return k.i >= 0 && k.i <= nMx2 && k.j >= 0 && k.j < nMy2
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
          setWallLinePreviewRubberPlanIn(
            wallPreviewRubberPlanInFrom(endNode, pin, delta, planGridFns.axesIn),
          )
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
        const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
        if (cell) {
          const ck = cellKeyString(cell)
          if (ck !== lastStrokeCellKeyRef.current) {
            const placed: PlacedFloorCell = {
              i: cell.i,
              j: cell.j,
              systemId: activeSystemId,
              source: activeCatalog,
              ...(activeCellPaintKind === 'stairs'
                ? { cellKind: 'stairs' as const }
                : activeCellPaintKind === 'roof'
                  ? { cellKind: 'roof' as const }
                  : {}),
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
        const h = resolveAnnotOrConnectionFillHit(pin, sketch)
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
        const h = resolveAnnotOrConnectionFillHit(pin, sketch)
        setHoverAnnotationSelectKey((prev) => (prev === h ? prev : h))
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
        return
      }

      if (
        !paintDragRef.current &&
        annotationToolActive &&
        annotationTool === 'connectionDetailLayerFill' &&
        sectionCutGraphicVariant === 'detailLine' &&
        !isElevationCanvas
      ) {
        if (inside && connectionDetailLayerGrid?.axesIn && connectionDetailLayerFillPick != null) {
          const keys = connectionDetailManualFillPreviewCellKeys({
            sketch: sketchRef.current,
            xIn: pin.xIn,
            yIn: pin.yIn,
            xsIn: connectionDetailLayerGrid.axesIn.xsIn,
            ysIn: connectionDetailLayerGrid.axesIn.ysIn,
          })
          setConnectionDetailFillPreviewCellKeys((prev) =>
            prev &&
            keys &&
            prev.length === keys.length &&
            prev.every((k, i) => k === keys[i]!)
              ? prev
              : keys,
          )
        } else {
          setConnectionDetailFillPreviewCellKeys(null)
        }
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
        const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
        const hk = hit ? edgeKeyString(hit) : null
        setHoverEdge((prev) => (prev === hk ? prev : hk))
      } else if (isRoomBoundaryEdgeMode) {
        setHoverCell(null)
        const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
        const hk = hit ? edgeKeyString(hit) : null
        setHoverEdge((prev) => (prev === hk ? prev : hk))
      } else if (placeMode === 'column') {
        setHoverEdge(null)
        setHoverCell(null)
        setMepDevicePaintPreview(null)
        if (
          floorTool === 'paint' &&
          activeCatalog === 'arch' &&
          !suspendPlanPainting &&
          !annotationToolActive
        ) {
          const snapped = planGridFns.snap(pin.xIn, pin.yIn)
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
      } else if (isMepPointMode(placeMode)) {
        setHoverEdge(null)
        setHoverCell(null)
        setColumnPaintPreview(null)
        if (
          floorTool === 'paint' &&
          !suspendPlanPainting &&
          !annotationToolActive
        ) {
          const snapped = planGridFns.snap(pin.xIn, pin.yIn)
          const item = mepById.get(activeSystemId)
          const hasReal = item && item.planEquipLengthIn > 0 && item.planEquipWidthIn > 0
          const lengthIn = hasReal ? item.planEquipLengthIn : 0
          const widthIn = hasReal ? item.planEquipWidthIn : 0
          const sizeIn = hasReal ? Math.max(lengthIn, widthIn) : delta * 0.6
          setMepDevicePaintPreview((prev) =>
            prev &&
            prev.cxIn === snapped.cxIn &&
            prev.cyIn === snapped.cyIn &&
            Math.abs(prev.sizeIn - sizeIn) < 1e-9
              ? prev
              : { cxIn: snapped.cxIn, cyIn: snapped.cyIn, sizeIn, ...(hasReal ? { lengthIn, widthIn } : {}) },
          )
        } else {
          setMepDevicePaintPreview(null)
        }
      } else if (isCellPaintMode || placeMode === 'room') {
        setHoverEdge(null)
        setColumnPaintPreview(null)
        const c = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
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
      isElevationCanvas,
      sectionCutGraphicVariant,
      planGridFns,
      wallDragSnapDist,
      connectionDetailAnnotationHitPickDistIn,
      connectionDetailMarqueeRectPadIn,
      connectionDetailAnnotationPick,
      connectionDetailLayerGrid,
      connectionDetailLayerFillPick,
      resolveAnnotOrConnectionFillHit,
      mepById,
    ],
  )

  processPointerMoveRef.current = processPointerMove

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      lastPointerClientRef.current = { clientX: e.clientX, clientY: e.clientY }
      const coalesce =
        annotationsOnly && placeMode === 'annotate' && !paintDragRef.current
      if (coalesce) {
        annotatePointerMovePendingRef.current = e
        if (annotatePointerMoveRafRef.current == null) {
          annotatePointerMoveRafRef.current = requestAnimationFrame(() => {
            annotatePointerMoveRafRef.current = null
            const ev = annotatePointerMovePendingRef.current
            annotatePointerMovePendingRef.current = null
            if (ev) {
              lastPointerClientRef.current = { clientX: ev.clientX, clientY: ev.clientY }
              processPointerMoveRef.current(ev)
            }
          })
        }
        return
      }
      if (annotatePointerMoveRafRef.current != null) {
        cancelAnimationFrame(annotatePointerMoveRafRef.current)
        annotatePointerMoveRafRef.current = null
        annotatePointerMovePendingRef.current = null
      }
      processPointerMove(e)
    },
    [annotationsOnly, placeMode, processPointerMove],
  )

  useEffect(() => {
    return () => {
      if (annotatePointerMoveRafRef.current != null) {
        cancelAnimationFrame(annotatePointerMoveRafRef.current)
      }
    }
  }, [])

  const insideSite = useCallback(
    (xIn: number, yIn: number) =>
      xIn >= 0 && yIn >= 0 && xIn <= siteWIn && yIn <= siteHIn,
    [siteWIn, siteHIn],
  )

  const onPointerLeave = useCallback(() => {
    if (annotatePointerMoveRafRef.current != null) {
      cancelAnimationFrame(annotatePointerMoveRafRef.current)
      annotatePointerMoveRafRef.current = null
      annotatePointerMovePendingRef.current = null
    }
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
    setConnectionDetailFillPreviewCellKeys(null)
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
                  const nPk = cellPaintKind(nc)
                  if (nPk === 'stairs') {
                    merged = merged.filter((c) => cellKeyString(c) !== gk || !isExclusiveArchFloorPaintCell(c))
                  } else {
                    merged = merged.filter(
                      (c) =>
                        !(
                          cellKeyString(c) === gk &&
                          isExclusiveArchFloorPaintCell(c) &&
                          cellPaintKind(c) === nPk
                        ),
                    )
                  }
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
              const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
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
                  planGridFns.gridEdgeIntersectsPlanRect(ed, minX, minY, maxX, maxY),
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

      if (kind === 'assembly-flip-marquee') {
        const edgeActive =
          planLineAssemblyLayers &&
          !hideLayoutDrawingOnTrade &&
          isEdgeLayerMode &&
          !isMepRunMode(placeMode) &&
          structureTool === 'flipAssembly'
        const colActive =
          planLineAssemblyLayers &&
          !hideLayoutDrawingOnTrade &&
          placeMode === 'column' &&
          floorTool === 'flipAssembly'
        if (!edgeActive && !colActive) {
          endPaintStroke()
          release()
          return
        }
        const targets = edgeActive ? assemblyFlipTargetsEdge : assemblyFlipTargetsColumn
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        if (mr) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            const startSvg = marqueeStartRef.current
            const pinForHit = startSvg
              ? { xIn: startSvg.x / d.planScale, yIn: startSvg.y / d.planScale }
              : pin
            if (edgeActive) {
              if (pinForHit && insideSite(pinForHit.xIn, pinForHit.yIn)) {
                const hit = planGridFns.nearestEdge(pinForHit.xIn, pinForHit.yIn, maxDistIn)
                if (hit) {
                  const gk = edgeKeyString(hit)
                  const picked = targets
                    .filter((t) => 'segmentKey' in t && t.segmentKey === gk)
                    .map((t) => t.pk)
                  if (picked.length > 0) {
                    const uniq = [...new Set(picked)]
                    togglePlanArchAssemblyFlipToKeys(uniq)
                    setSelectedAssemblyFlipKeys((prev) =>
                      shift ? new Set([...prev, ...uniq]) : new Set(uniq),
                    )
                  } else if (!shift) {
                    setSelectedAssemblyFlipKeys(new Set())
                  }
                } else if (!shift) {
                  setSelectedAssemblyFlipKeys(new Set())
                }
              } else if (!shift) {
                setSelectedAssemblyFlipKeys(new Set())
              }
            } else {
              if (pinForHit && insideSite(pinForHit.xIn, pinForHit.yIn)) {
                const hitCol = (sketch.columns ?? []).find((c) =>
                  planPointInsideColumnFootprint(c, pinForHit.xIn, pinForHit.yIn),
                )
                const pk = hitCol ? planAssemblyColumnFlipKey(hitCol) : null
                const eligible = pk && targets.some((t) => t.pk === pk)
                if (eligible && pk) {
                  togglePlanArchAssemblyFlipToKeys([pk])
                  setSelectedAssemblyFlipKeys((prev) =>
                    shift ? new Set([...prev, pk]) : new Set([pk]),
                  )
                } else if (!shift) {
                  setSelectedAssemblyFlipKeys(new Set())
                }
              } else if (!shift) {
                setSelectedAssemblyFlipKeys(new Set())
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            let picked: string[] = []
            if (edgeActive) {
              const tEdge = targets as AssemblyFlipEdgeTarget[]
              picked = tEdge
                .filter((t) => planGridFns.gridEdgeIntersectsPlanRect(t.edge, minX, minY, maxX, maxY))
                .map((t) => t.pk)
            } else {
              const tCol = targets as AssemblyFlipColumnTarget[]
              picked = tCol
                .filter((t) => planColumnIntersectsPlanRect(t.col, minX, minY, maxX, maxY))
                .map((t) => t.pk)
            }
            if (picked.length > 0) {
              const uniq = [...new Set(picked)]
              togglePlanArchAssemblyFlipToKeys(uniq)
              setSelectedAssemblyFlipKeys((prev) =>
                shift ? new Set([...prev, ...uniq]) : new Set(uniq),
              )
            } else if (!shift) {
              setSelectedAssemblyFlipKeys(new Set())
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'level-line-drag') {
        const ids = levelLineDragIdsRef.current
        const { dj } = movePreviewDiDjRef.current
        if (ids && ids.length > 0 && dj !== 0) {
          const idSet = new Set(ids)
          const lines = sketch.elevationLevelLines ?? []
          const nextLines = lines.map((l) => {
            if (!idSet.has(l.id)) return l
            const newJ = Math.max(0, Math.min(siteNy, l.j + dj))
            return { ...l, j: newJ }
          })
          onSketchChange({ ...sketch, elevationLevelLines: nextLines })
        }
        levelLineDragIdsRef.current = null
        setMovePreview(null)
        movePreviewDiDjRef.current = { di: 0, dj: 0 }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'annotation-select-marquee') {
        const mr = marqueeRectRef.current
        const shift = e.shiftKey
        if (mr) {
          const tiny =
            mr.w < annotationMarqueeClickMaxPx && mr.h < annotationMarqueeClickMaxPx
          if (tiny) {
            // Prefer the pointer-DOWN position for click hit-testing so that slight
            // mouse drift between press and release does not select the wrong annotation
            // (especially when two level lines are close together).
            const startSvg = marqueeStartRef.current
            const pinForHit = startSvg
              ? { xIn: startSvg.x / d.planScale, yIn: startSvg.y / d.planScale }
              : pin
            if (pinForHit && insideSite(pinForHit.xIn, pinForHit.yIn)) {
              const hit = resolveAnnotOrConnectionFillHit(pinForHit, sketch)
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
            const picked = mergeAnnotationAndConnectionFillKeysInPlanRect(
              sketch,
              minX,
              minY,
              maxX,
              maxY,
              delta,
              isElevationCanvas,
              connectionDetailAnnotationPick,
              connectionDetailMarqueeRectPadIn,
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
          const tiny =
            mr.w < annotationMarqueeClickMaxPx && mr.h < annotationMarqueeClickMaxPx
          if (tiny) {
            const startSvgE = marqueeStartRef.current
            const pinForHitE = startSvgE
              ? { xIn: startSvgE.x / d.planScale, yIn: startSvgE.y / d.planScale }
              : pin
            if (pinForHitE && insideSite(pinForHitE.xIn, pinForHitE.yIn)) {
              const hit = resolveAnnotOrConnectionFillHit(pinForHitE, sketch)
              if (hit && confirmLevelLineDeletion([hit])) {
                let removed = false
                if (hit.startsWith('cdf:')) {
                  const ck = connectionDetailFillCellKeyFromInteractionKey(hit)
                  if (ck) {
                    const nextFill = removeConnectionDetailFillsAtCellKeys(sketch, [ck])
                    if (nextFill) {
                      onSketchChange(nextFill)
                      removed = true
                    }
                  }
                } else if (hit.startsWith('sed:')) {
                  const nextSeg = nextSketchAfterRemovingDetailSectionCutGridEdgeKey(
                    sketch,
                    hit,
                    delta,
                    siteWIn,
                    siteHIn,
                    () => `sc-${++sectionCutIdRef.current}`,
                    connectionDetailLayerGrid?.axesIn,
                  )
                  if (nextSeg) {
                    onSketchChange(nextSeg)
                    removed = true
                  }
                } else {
                  const next = nextSketchAfterRemovingAnnotationKeys(sketch, [hit], delta)
                  if (next) {
                    onSketchChange(next)
                    removed = true
                  }
                }
                if (removed) {
                  setSelectedAnnotationKeys((prev) => {
                    const n = new Set(prev)
                    n.delete(hit)
                    return n
                  })
                }
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const picked = mergeAnnotationAndConnectionFillKeysInPlanRect(
              sketch,
              minX,
              minY,
              maxX,
              maxY,
              delta,
              isElevationCanvas,
              connectionDetailAnnotationPick,
              connectionDetailMarqueeRectPadIn,
            )
            if (picked.length > 0 && confirmLevelLineDeletion(picked)) {
              const sedP = picked.filter((k) => k.startsWith('sed:'))
              const cdfP = picked
                .filter((k) => k.startsWith('cdf:'))
                .map((k) => connectionDetailFillCellKeyFromInteractionKey(k))
                .filter((k): k is string => k != null)
              const other = picked.filter((k) => !k.startsWith('sed:') && !k.startsWith('cdf:'))
              let s = sketch
              let did = false
              if (sedP.length > 0) {
                const n = nextSketchAfterRemovingDetailSectionCutSedKeys(
                  s,
                  sedP,
                  delta,
                  siteWIn,
                  siteHIn,
                  () => `sc-${++sectionCutIdRef.current}`,
                  connectionDetailLayerGrid?.axesIn,
                )
                if (n) {
                  s = n
                  did = true
                }
              }
              if (cdfP.length > 0) {
                const n = removeConnectionDetailFillsAtCellKeys(s, cdfP)
                if (n) {
                  s = n
                  did = true
                }
              }
              if (other.length > 0) {
                const n = nextSketchAfterRemovingAnnotationKeys(s, other, delta)
                if (n) {
                  s = n
                  did = true
                }
              }
              if (did) {
                onSketchChange(s)
                setSelectedAnnotationKeys((prev) => {
                  const n = new Set(prev)
                  for (const k of picked) n.delete(k)
                  return n
                })
              }
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
              const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
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
              .filter((ed) => planGridFns.gridEdgeIntersectsPlanRect(ed, minX, minY, maxX, maxY))
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
              const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
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
            const inBox = planGridFns.cellsIntersectingPlanRect(minX, minY, maxX, maxY)
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

      if (kind === 'mep-select-marquee' && isMepPointMode(placeMode)) {
        if (!blockMepMutations) {
          const mr = marqueeRectRef.current
          const shift = e.shiftKey
          const devices = sketch.mepDevices ?? []
          if (mr) {
            const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
            if (tiny) {
              const startSvg = marqueeStartRef.current
              const pinForHit = startSvg
                ? { xIn: startSvg.x / d.planScale, yIn: startSvg.y / d.planScale }
                : pin
              if (pinForHit && insideSite(pinForHit.xIn, pinForHit.yIn)) {
                const hit = devices.find((d) => planPointInsideMepDeviceFootprint(d, pinForHit.xIn, pinForHit.yIn))
                if (hit) {
                  const key = placedMepDeviceKey(hit)
                  setSelectedMepDeviceKeys((prev) => {
                    if (shift) {
                      const n = new Set(prev)
                      if (n.has(key)) n.delete(key)
                      else n.add(key)
                      return n
                    }
                    return new Set([key])
                  })
                } else if (!shift) {
                  setSelectedMepDeviceKeys(new Set())
                }
              } else if (!shift) {
                setSelectedMepDeviceKeys(new Set())
              }
            } else if (mr.w > 0 && mr.h > 0) {
              const minX = mr.x / d.planScale
              const minY = mr.y / d.planScale
              const maxX = (mr.x + mr.w) / d.planScale
              const maxY = (mr.y + mr.h) / d.planScale
              const picked = devices
                .filter((dev) => mepDeviceIntersectsPlanRect(dev, minX, minY, maxX, maxY))
                .map(placedMepDeviceKey)
              if (picked.length > 0) {
                setSelectedMepDeviceKeys((prev) => {
                  if (shift) return new Set([...prev, ...picked])
                  return new Set(picked)
                })
              } else if (!shift) {
                setSelectedMepDeviceKeys(new Set())
              }
            }
          }
        }
        endPaintStroke()
        release()
        return
      }

      if (kind === 'mep-erase-marquee' && isMepPointMode(placeMode)) {
        const mr = marqueeRectRef.current
        const devices = sketch.mepDevices ?? []
        if (mr && !blockMepMutations) {
          const tiny = mr.w < MARQUEE_CLICK_MAX_PX && mr.h < MARQUEE_CLICK_MAX_PX
          if (tiny) {
            const startSvg = marqueeStartRef.current
            const pinForHit = startSvg
              ? { xIn: startSvg.x / d.planScale, yIn: startSvg.y / d.planScale }
              : pin
            if (pinForHit && insideSite(pinForHit.xIn, pinForHit.yIn)) {
              const hit = devices.find((d) => planPointInsideMepDeviceFootprint(d, pinForHit.xIn, pinForHit.yIn))
              if (hit) {
                onSketchChange({ ...sketch, mepDevices: devices.filter((d) => d.id !== hit.id) })
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const removeIds = new Set(
              devices.filter((dev) => mepDeviceIntersectsPlanRect(dev, minX, minY, maxX, maxY)).map((d) => d.id),
            )
            if (removeIds.size > 0) {
              const next = devices.filter((d) => !removeIds.has(d.id))
              onSketchChange({ ...sketch, mepDevices: next.length > 0 ? next : undefined })
              setSelectedMepDeviceKeys((prev) => {
                const n = new Set(prev)
                for (const d of devices) {
                  if (removeIds.has(d.id)) n.delete(placedMepDeviceKey(d))
                }
                return n
              })
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
              const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
              if (hit) {
                const hk = edgeKeyString(hit)
                updateEdges((list) =>
                  list.filter((ed) => {
                    if (edgeKeyString(ed) !== hk) return true
                    return !edgeMatchesToolbarEraseKind(ed, placeMode, activeCatalog)
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
                if (!planGridFns.gridEdgeIntersectsPlanRect(ed, minX, minY, maxX, maxY)) return true
                return !edgeMatchesToolbarEraseKind(ed, placeMode, activeCatalog)
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
              const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
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
              list.filter((ed) => !planGridFns.gridEdgeIntersectsPlanRect(ed, minX, minY, maxX, maxY)),
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
              const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
              if (cell) {
                if (isFill) {
                  const placed: PlacedFloorCell = {
                    i: cell.i,
                    j: cell.j,
                    systemId: activeSystemId,
                    source: activeCatalog,
                    ...(activeCellPaintKind === 'stairs'
                      ? { cellKind: 'stairs' as const }
                      : activeCellPaintKind === 'roof'
                        ? { cellKind: 'roof' as const }
                        : {}),
                  }
                  updateCells((list) => mergePaintStrokeIntoCells(list, [placed]))
                } else {
                  updateCells((list) =>
                    list.filter(
                      (c) =>
                        c.i !== cell.i ||
                        c.j !== cell.j ||
                        cellPaintKind(c) !== activeCellPaintKind,
                    ),
                  )
                }
              }
            }
          } else if (mr.w > 0 && mr.h > 0) {
            const minX = mr.x / d.planScale
            const minY = mr.y / d.planScale
            const maxX = (mr.x + mr.w) / d.planScale
            const maxY = (mr.y + mr.h) / d.planScale
            const touched = planGridFns.cellsIntersectingPlanRect(minX, minY, maxX, maxY)
            if (isFill) {
              const stroke: PlacedFloorCell[] = touched.map((pos) => ({
                i: pos.i,
                j: pos.j,
                systemId: activeSystemId,
                source: activeCatalog,
                ...(activeCellPaintKind === 'stairs'
                  ? { cellKind: 'stairs' as const }
                  : activeCellPaintKind === 'roof'
                    ? { cellKind: 'roof' as const }
                    : {}),
              }))
              updateCells((list) => mergePaintStrokeIntoCells(list, stroke))
            } else {
              const rm = new Set(touched.map((c) => cellKeyString(c)))
              updateCells((list) =>
                list.filter((c) => !rm.has(cellKeyString(c)) || cellPaintKind(c) !== activeCellPaintKind),
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
              const hit = cols.find((c) => planPointInsideColumnFootprint(c, pin.xIn, pin.yIn))
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
              columns: cols.filter((c) => !planColumnIntersectsPlanRect(c, minX, minY, maxX, maxY)),
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
            const { nx: nMxR, ny: nMyR } = planGridFns.nodeMax
            const sa = planGridFns.snap(minX, minY)
            const sb = planGridFns.snap(maxX, maxY)
            const i0 = Math.max(0, Math.min(nMxR, Math.min(sa.i, sb.i)))
            const j0 = Math.max(0, Math.min(nMyR, Math.min(sa.j, sb.j)))
            const i1 = Math.max(0, Math.min(nMxR, Math.max(sa.i, sb.i)))
            const j1 = Math.max(0, Math.min(nMyR, Math.max(sa.j, sb.j)))
            const keys = rectangularFrameEdges(i0, j0, i1, j1)
            const valid =
              keys.length > 0 &&
              keys.every((k) => {
                if (k.axis === 'h') return k.i >= 0 && k.i < nMxR && k.j >= 0 && k.j <= nMyR
                return k.i >= 0 && k.i <= nMxR && k.j >= 0 && k.j < nMyR
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
            const { nx: nMxRm, ny: nMyRm } = planGridFns.nodeMax
            const saR = planGridFns.snap(minX, minY)
            const sbR = planGridFns.snap(maxX, maxY)
            const i0 = Math.max(0, Math.min(nMxRm, Math.min(saR.i, sbR.i)))
            const j0 = Math.max(0, Math.min(nMyRm, Math.min(saR.j, sbR.j)))
            const i1 = Math.max(0, Math.min(nMxRm, Math.max(saR.i, sbR.i)))
            const j1 = Math.max(0, Math.min(nMyRm, Math.max(saR.j, sbR.j)))
            const keys = rectangularFrameEdges(i0, j0, i1, j1)
            const valid =
              keys.length > 0 &&
              keys.every((k) => {
                if (k.axis === 'h') return k.i >= 0 && k.i < nMxRm && k.j >= 0 && k.j <= nMyRm
                return k.i >= 0 && k.i <= nMxRm && k.j >= 0 && k.j < nMyRm
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
          const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
          const keys = endNode
            ? planGridFns.manhattanWallPath(
                startSnap.i,
                startSnap.j,
                endNode.i,
                endNode.j,
                e.shiftKey,
                pin.xIn,
                pin.yIn,
              )
            : []
          const { nx: nMxM, ny: nMyM } = planGridFns.nodeMax
          const valid =
            keys.length > 0 &&
            keys.every((k) => {
              if (k.axis === 'h') return k.i >= 0 && k.i < nMxM && k.j >= 0 && k.j <= nMyM
              return k.i >= 0 && k.i <= nMxM && k.j >= 0 && k.j < nMyM
            })
          if (valid) {
            const id = `m-${++measureRunIdRef.current}`
            const run: PlanMeasureGridRun = {
              id,
              edgeKeys: keys.map(edgeKeyString),
              totalPlanIn: gridEdgeLengthsPlanInchesSum(
                keys,
                delta,
                planGridFns.useIrregular ? planGridFns.axesIn : null,
              ),
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
          const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
          const keys = endNode
            ? planGridFns.manhattanWallPath(
                startSnap.i,
                startSnap.j,
                endNode.i,
                endNode.j,
                e.shiftKey,
                pin.xIn,
                pin.yIn,
              )
            : []
          const { nx: nMxG, ny: nMyG } = planGridFns.nodeMax
          const valid =
            keys.length > 0 &&
            keys.every((k) => {
              if (k.axis === 'h') return k.i >= 0 && k.i < nMxG && k.j >= 0 && k.j <= nMyG
              return k.i >= 0 && k.i <= nMxG && k.j >= 0 && k.j < nMyG
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
          const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
          const { nx: nMxSc, ny: nMySc } = planGridFns.nodeMax
          if (
            endNode &&
            (endNode.i !== startSnap.i || endNode.j !== startSnap.j) &&
            endNode.i >= 0 &&
            endNode.j >= 0 &&
            endNode.i <= nMxSc &&
            endNode.j <= nMySc
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
          const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
          const keys = endNode
            ? edgesInNodeSpan(startSnap.i, startSnap.j, endNode.i, endNode.j)
            : []
          const { nx: nMxC, ny: nMyC } = planGridFns.nodeMax
          const valid =
            keys.length > 0 &&
            keys.every((k) => {
              if (k.axis === 'h') return k.i >= 0 && k.i < nMxC && k.j >= 0 && k.j <= nMyC
              return k.i >= 0 && k.i <= nMxC && k.j >= 0 && k.j < nMyC
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
          const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
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
        const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
        const keys = endNode
          ? planGridFns.manhattanWallPath(
              startSnap.i,
              startSnap.j,
              endNode.i,
              endNode.j,
              e.shiftKey,
              pin.xIn,
              pin.yIn,
            )
          : []
        const { nx: nMxW1, ny: nMyW1 } = planGridFns.nodeMax
        const valid =
          keys.length > 0 &&
          keys.every((k) => {
            if (k.axis === 'h') return k.i >= 0 && k.i < nMxW1 && k.j >= 0 && k.j <= nMyW1
            return k.i >= 0 && k.i <= nMxW1 && k.j >= 0 && k.j < nMyW1
          })
        if (valid) {
          applyRoomBoundaryStrokeKeys(keys)
          lastWallNodeRef.current = endNode
        } else {
          const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
          if (hit) {
            assignRoomBoundaryEdge(hit)
            lastWallNodeRef.current = planGridFns.closerNodeOnEdge(hit, pin.xIn, pin.yIn)
          }
        }
      }

      if (wasStructureWallDrag && startSnap && pin && insideSite(pin.xIn, pin.yIn)) {
        const endNode = planGridFns.nodeUnderCursor(pin.xIn, pin.yIn, wallDragSnapDist(maxDistIn))
        const keys = endNode
          ? planGridFns.manhattanWallPath(
              startSnap.i,
              startSnap.j,
              endNode.i,
              endNode.j,
              e.shiftKey,
              pin.xIn,
              pin.yIn,
            )
          : []
        const { nx: nMxW2, ny: nMyW2 } = planGridFns.nodeMax
        const valid =
          keys.length > 0 &&
          keys.every((k) => {
            if (k.axis === 'h') return k.i >= 0 && k.i < nMxW2 && k.j >= 0 && k.j <= nMyW2
            return k.i >= 0 && k.i <= nMxW2 && k.j >= 0 && k.j < nMyW2
          })
        if (valid) {
          applyWallStrokeKeys(keys)
          lastWallNodeRef.current = endNode
        } else {
          const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
          if (hit) {
            assignEdge(hit)
            lastWallNodeRef.current = planGridFns.closerNodeOnEdge(hit, pin.xIn, pin.yIn)
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
      blockMepMutations,
      sectionCutGraphicVariant,
      nextSketchAfterRemovingDetailSectionCutGridEdgeKey,
      nextSketchAfterRemovingDetailSectionCutSedKeys,
      confirmLevelLineDeletion,
      annotationHitKeyAtPlanInches,
      nextSketchAfterRemovingAnnotationKeys,
      annotationKeysIntersectingPlanRect,
      floorTool,
      planLineAssemblyLayers,
      hideLayoutDrawingOnTrade,
      assemblyFlipTargetsEdge,
      assemblyFlipTargetsColumn,
      togglePlanArchAssemblyFlipToKeys,
      isMepRunMode,
      planGridFns,
      wallDragSnapDist,
      connectionDetailAnnotationHitPickDistIn,
      connectionDetailMarqueeRectPadIn,
      annotationMarqueeClickMaxPx,
      connectionDetailAnnotationPick,
      connectionDetailLayerGrid,
    ],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (suspendPlanPainting) return
      if (planPointerEventIsOverCornerConnectionUi(e)) {
        e.stopPropagation()
        return
      }
      const svg = e.currentTarget as SVGSVGElement

      if (isElevationCanvas && !annotationToolActive) return

      if (annotationToolActive) {
        /** Strip targets handle toggles; avoid grid / marquee logic stealing the gesture. */
        if (annotationTool === 'flipConnectionStripLayers') return

        if (
          annotationTool === 'connectionDetailLayerFill' &&
          sectionCutGraphicVariant === 'detailLine' &&
          !isElevationCanvas
        ) {
          const pinFill = pointerToPlanInches(e.clientX, e.clientY)
          if (!pinFill || !insideSite(pinFill.xIn, pinFill.yIn)) return
          const axesFill = connectionDetailLayerGrid?.axesIn
          if (
            !axesFill ||
            axesFill.xsIn.length < 2 ||
            axesFill.ysIn.length < 2 ||
            connectionDetailLayerFillPick == null
          ) {
            return
          }
          const nextFill = applyConnectionDetailManualLayerFill({
            sketch,
            xIn: pinFill.xIn,
            yIn: pinFill.yIn,
            xsIn: axesFill.xsIn,
            ysIn: axesFill.ysIn,
            pick: connectionDetailLayerFillPick,
          })
          if (nextFill) onSketchChange(nextFill)
          return
        }

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

          // If clicking on a selected level line, start a drag to move it vertically
          if (isElevationCanvas && selectedAnnotationKeys.size > 0) {
            const pinHit = { xIn: pSvgAnn.x / d.planScale, yIn: pSvgAnn.y / d.planScale }
            const hit = annotationHitKeyAtPlanInches(pinHit, sketch, siteWIn, siteHIn, delta, maxDistIn, true)
            if (hit && hit.startsWith('lvl:') && selectedAnnotationKeys.has(hit)) {
              const dragIds = Array.from(selectedAnnotationKeys)
                .filter((k) => k.startsWith('lvl:'))
                .map((k) => k.slice(4))
              if (dragIds.length > 0) {
                tryCaptureM()
                paintDragRef.current = true
                dragKindRef.current = 'level-line-drag'
                levelLineDragIdsRef.current = dragIds
                levelLineDragStartYRef.current = pinHit.yIn
                moveDragStartPinRef.current = { xIn: pinHit.xIn, yIn: pinHit.yIn }
                movePreviewDiDjRef.current = { di: 0, dj: 0 }
                setMovePreview({ di: 0, dj: 0 })
                return
              }
            }
          }

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

        const hitM = planGridFns.nearestEdge(pinM.xIn, pinM.yIn, maxDistIn)
        if (!hitM) return

        tryCaptureM()
        paintDragRef.current = true
        dragKindRef.current = lineDragKind
        const sn = planGridFns.closerNodeOnEdge(hitM, pinM.xIn, pinM.yIn)
        wallLineDragStartRef.current = sn
        setWallLinePreviewKeys(null)
        setMeasurePreviewNodes(null)
        return
      }

      if (placeMode === 'room' && roomTool === 'fill') {
        const pinR = pointerToPlanInches(e.clientX, e.clientY)
        if (!pinR || !insideSite(pinR.xIn, pinR.yIn)) return
        const cell = planGridFns.planInchesToCell(pinR.xIn, pinR.yIn)
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
            const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
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
              const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
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

        const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
        if (!hit) {
          paintDragRef.current = false
          dragKindRef.current = null
          return
        }
        wallLineDragStartRef.current = planGridFns.closerNodeOnEdge(hit, pin.xIn, pin.yIn)
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
            const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
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

        if (
          structureTool === 'flipAssembly' &&
          planLineAssemblyLayers &&
          !hideLayoutDrawingOnTrade &&
          !isMepRunMode(placeMode)
        ) {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'assembly-flip-marquee'
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

        const hit = planGridFns.nearestEdge(pin.xIn, pin.yIn, maxDistIn)
        if (!hit) {
          paintDragRef.current = false
          dragKindRef.current = null
          return
        }
        wallLineDragStartRef.current = planGridFns.closerNodeOnEdge(hit, pin.xIn, pin.yIn)
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
        if (floorTool === 'flipAssembly' && planLineAssemblyLayers && !hideLayoutDrawingOnTrade) {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'assembly-flip-marquee'
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
        if (floorTool === 'paint') {
          if (!pin || !insideSite(pin.xIn, pin.yIn)) return
          const snapped = planGridFns.snap(pin.xIn, pin.yIn)
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

      if (isMepPointMode(placeMode)) {
        if (floorTool === 'erase') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'mep-erase-marquee'
          setMarqueeTone('erase')
          const sx = Math.max(0, Math.min(cw, pSvg.x))
          const sy = Math.max(0, Math.min(ch, pSvg.y))
          marqueeStartRef.current = { x: sx, y: sy }
          const r = { x: sx, y: sy, w: 0, h: 0 }
          marqueeRectRef.current = r
          setEraseMarqueeSvg(r)
          return
        }
        if (floorTool === 'select') {
          if (!onPlanSvg || !pSvg) return
          tryCapture()
          paintDragRef.current = true
          dragKindRef.current = 'mep-select-marquee'
          setMarqueeTone('select')
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
          if (blockMepMutations) return
          const snapped = planGridFns.snap(pin.xIn, pin.yIn)
          const item = mepById.get(activeSystemId)
          const hasReal = item && item.planEquipLengthIn > 0 && item.planEquipWidthIn > 0
          const lengthIn = hasReal ? item.planEquipLengthIn : 0
          const widthIn = hasReal ? item.planEquipWidthIn : 0
          const sizeIn = hasReal ? Math.max(lengthIn, widthIn) : delta * 0.6
          const categoryMap: Record<string, string> = {
            waterEquip: 'equipment', waterValve: 'valve',
            elecPanel: 'panel', elecDevice: 'device', elecLight: 'light',
            mechEquip: 'equipment', mechDiffuser: 'diffuser',
            plumbFixture: 'fixture',
            lsHead: 'head', lsDevice: 'device',
            teleOutlet: 'outlet', teleEquip: 'equipment',
          }
          const dev: PlacedMepDevice = {
            id: crypto.randomUUID(),
            cxIn: snapped.cxIn,
            cyIn: snapped.cyIn,
            sizeIn,
            ...(hasReal ? { lengthIn, widthIn } : {}),
            systemId: activeSystemId,
            category: categoryMap[placeMode] ?? 'device',
          }
          const prev = sketch.mepDevices ?? []
          onSketchChange({ ...sketch, mepDevices: [...prev, dev] })
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
            const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
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

        const cell = planGridFns.planInchesToCell(pin.xIn, pin.yIn)
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
          ...(activeCellPaintKind === 'stairs'
            ? { cellKind: 'stairs' as const }
            : activeCellPaintKind === 'roof'
              ? { cellKind: 'roof' as const }
              : {}),
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
      planLineAssemblyLayers,
      hideLayoutDrawingOnTrade,
      isMepRunMode,
      planGridFns,
      mepById,
      blockMepMutations,
      sectionCutGraphicVariant,
      connectionDetailLayerGrid,
      connectionDetailLayerFillPick,
    ],
  )

  /** One SVG path per filled region (union of grid cells), not one rect per cell. */
  const connectionDetailLayerFillPathItems = useMemo(() => {
    const axes = connectionDetailLayerGrid?.axesIn
    const byCell = sketch.connectionDetailLayerFillByCell
    if (
      sectionCutGraphicVariant !== 'detailLine' ||
      !axes ||
      !byCell ||
      Object.keys(byCell).length === 0
    ) {
      return [] as { d: string; fill: string }[]
    }
    const { xsIn, ysIn } = axes
    const comps = connectionDetailLayerFillConnectedComponents(byCell)
    const ps = d.planScale
    const out: { d: string; fill: string }[] = []
    for (const comp of comps) {
      const pathD = connectionDetailFilledRegionSvgPathD(xsIn, ysIn, comp.cellKeys, ps)
      if (!pathD) continue
      out.push({
        d: pathD,
        fill: connectionDetailManualFillSvgColor(comp.ref, orderedSystems, planColorCatalog),
      })
    }
    return out
  }, [
    sectionCutGraphicVariant,
    connectionDetailLayerGrid?.axesIn,
    sketch.connectionDetailLayerFillByCell,
    d.planScale,
    orderedSystems,
    planColorCatalog,
  ])

  const connectionDetailFillPreviewPathD = useMemo(() => {
    const axes = connectionDetailLayerGrid?.axesIn
    if (
      sectionCutGraphicVariant !== 'detailLine' ||
      !axes ||
      !connectionDetailFillPreviewCellKeys ||
      connectionDetailFillPreviewCellKeys.length === 0
    ) {
      return null
    }
    return connectionDetailFilledRegionSvgPathD(
      axes.xsIn,
      axes.ysIn,
      connectionDetailFillPreviewCellKeys,
      d.planScale,
    )
  }, [
    sectionCutGraphicVariant,
    connectionDetailLayerGrid?.axesIn,
    connectionDetailFillPreviewCellKeys,
    d.planScale,
  ])

  /** Stable ids for SVG pattern refs (dense grids: patterns replace O(n²) line nodes). */
  const patternUid = useId().replace(/[^a-zA-Z0-9_-]/g, '_')
  const patGridH = `${patternUid}-gh`
  const patGridV = `${patternUid}-gv`

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
        const hasLvl = Array.from(selectedAnnotationKeys).some((k) => k.startsWith('lvl:'))
        const elevPick = isElevationCanvas ? '; level: horizontal datum (drag to move)' : ''
        const detailSeg =
          sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas
            ? 'detail line: H/V by segment, diagonal whole line'
            : 'section: line'
        return n > 0
          ? `${n} selected · Shift+click add/remove · drag box to add more · Del removes · Esc clears${
              hasLvl ? ' · drag selected level line to move' : ''
            }${
              n === 1 && Array.from(selectedAnnotationKeys)[0]?.startsWith('lbl:')
                ? ' · edit label text in the top bar'
                : ''
            }`
          : `Select — hover highlights · click or drag a box · Shift adds/removes · dimensions & grid: edge; ${detailSeg}${elevPick}; label: anchor · one label selected: edit in top bar`
      }
      if (annotationTool === 'flipConnectionStripLayers') {
        if (sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas) {
          return 'Flip layers — click a junction wall or MEP strip to reverse catalog layer order for that direction; click again to restore'
        }
        return 'Flip layers — available on connection detail sheets'
      }
      if (annotationTool === 'connectionDetailLayerFill') {
        if (sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas) {
          return connectionDetailLayerFillPick == null
            ? 'Layer fill — choose a layer (or Clear) in the top bar; hover shows the zone that would update — click to apply (only your detail lines bound regions)'
            : connectionDetailLayerFillPick === 'clear'
              ? 'Layer fill — hover highlights the zone that would be cleared; click to remove fills in that region'
              : 'Layer fill — hover previews the closed region in semi-transparent color; click to fill with the selected layer'
        }
        return 'Layer fill — connection detail sheets only'
      }
      if (annotationTool === 'erase') {
        const nd = measureRuns.length
        const ng = annotationGridRuns.length
        const ns = annotationSectionCuts.length
        const nl = annotationLabels.length
        const nlv = isElevationCanvas ? elevationLevelLines.length : 0
        if (sectionCutGraphicVariant === 'detailLine' && !isElevationCanvas) {
          const hint =
            'Dimensions & grid refs: one edge at a time · orthogonal detail lines: one grid segment · diagonal detail: whole line · click or box removes what intersects'
          if (nd + ng + ns + nl === 0) {
            return `Erase — ${hint} · Nothing to erase yet`
          }
          return [
            hint,
            nd ? `${nd} dimension run(s)` : null,
            ng ? `${ng} grid ref` : null,
            ns ? `${ns} detail line(s)` : null,
            nl ? `${nl} label(s)` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        }
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
        return `${formatSiteMeasure(tot, planSiteDisplayUnit)} ${su} — release to add dimension · Esc clears dimensions only`
      }
      if (annotationTool === 'measureLine' && measureRuns.length > 0) {
        const last = measureRuns[measureRuns.length - 1]!
        const lastLen = last.edgeKeys.length * delta
        const { primary } = gridRunMeasureCaption(
          lastLen,
          last.startNode,
          last.endNode,
          last.edgeKeys.length,
          planSiteDisplayUnit,
        )
        const n = measureRuns.length
        return `${n} dimension run${n === 1 ? '' : 's'} · Last: ${primary} · Drag to add · Esc clears all dimensions`
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
            ? 'Erase box — release to clear column footprints inside'
            : floorTool === 'flipAssembly'
              ? 'Selection box — release to toggle assembly layer order for columns inside'
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
          'Drag a box to erase columns inside · tiny drag removes one column under the pointer',
        )
      } else if (floorTool === 'select') {
        parts.push(
          `${selectedColumnKeys.size} column(s) selected · Offset next to layer picker · Delete / ⌫ removes · header “Select all” selects every column`,
        )
      } else if (floorTool === 'flipAssembly') {
        parts.push(
          `${selectedAssemblyFlipKeys.size} column(s) tracked · click or drag box to toggle layer order · Shift adds to tracked set · Esc clears`,
        )
      } else {
        parts.push('Use Paint or Erase in the toolbar')
      }
      return parts.join(' · ')
    }
    if (isMepPointMode(placeMode)) {
      if (eraseMarqueeSvg && (eraseMarqueeSvg.w > 0 || eraseMarqueeSvg.h > 0)) {
        return marqueeTone === 'select'
          ? 'Selection box — release to choose symbols inside'
          : 'Erase box — release to clear symbols inside'
      }
      if (floorTool === 'paint') return 'Click a grid intersection to place a device symbol'
      if (floorTool === 'erase') {
        return 'Drag a box to erase symbols inside · tiny drag removes one under the pointer'
      }
      if (floorTool === 'select') {
        return `${selectedMepDeviceKeys.size} symbol(s) selected · drag box to select · Shift adds · Delete removes · tiny drag = one symbol`
      }
      return 'Use Place, Erase, or Select in the toolbar'
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
        parts.push(
          `${selectedEdgeKeys.size} edge(s) selected · Offset (next to layer picker) shifts strokes perpendicular to the grid`,
        )
      } else if (structureTool === 'flipAssembly') {
        parts.push(
          `${selectedAssemblyFlipKeys.size} segment(s) tracked · click or drag box to toggle layer order · Shift adds to tracked set · Esc clears`,
        )
      }
      if (structureTool === 'paint') {
        parts.push('Drag along the grid to draw')
      } else if (structureTool === 'rect') {
        parts.push('Drag a box for a wall frame')
      } else if (structureTool === 'erase') {
        parts.push(
          'Erase removes only the current tool’s strokes on each segment (walls, openings, or MEP runs — not mixed)',
        )
      } else if (structureTool === 'flipAssembly') {
        parts.push(
          'Each click or box toggles only the current tab’s edge type (e.g. Walls vs Windows vs Doors)',
        )
      } else {
        parts.push('Drag box to select walls')
      }
      return parts.filter(Boolean).join(' · ')
    }
    const cellKindLabel =
      placeMode === 'stairs' ? 'stair' : placeMode === 'roof' ? 'roof' : 'floor'
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
    selectedAssemblyFlipKeys.size,
    sketch.elevationGroundPlaneJ,
    isElevationCanvas,
    levelLineLabelDraft,
    sectionCutGraphicVariant,
    connectionDetailLayerFillPick,
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
      (isMepPointMode(placeMode) && floorTool === 'select' && selectedMepDeviceKeys.size > 0) ||
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
            applyZoom(zoom / ZOOM_BUTTON_RATIO, a ?? undefined)
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
            applyZoom(zoom * ZOOM_BUTTON_RATIO, a ?? undefined)
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
        <div className="w-px h-4 bg-border/60 mx-1" />
        <button
          type="button"
          onClick={() => downloadPlanLayoutSvg(svgRef.current, vectorExportBasename)}
          className="font-mono text-[9px] px-2 py-0.5 border border-border hover:bg-muted shrink-0"
          title="Export the current layout as vector SVG (current sheet / view)"
        >
          SVG
        </button>
        <button
          type="button"
          onClick={() => {
            void downloadPlanLayoutPdf(svgRef.current, vectorExportBasename).catch((err) =>
              alert('PDF export failed: ' + (err instanceof Error ? err.message : String(err))),
            )
          }}
          className="font-mono text-[9px] px-2 py-0.5 border border-border hover:bg-muted shrink-0"
          title="Export the current layout as vector PDF (current sheet / view)"
        >
          PDF
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
                        annotationTool === 'select' ||
                        annotationTool === 'flipConnectionStripLayers'
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
                <defs>
                  <pattern
                    id={patGridH}
                    width={cw}
                    height={cellPx}
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1={gridPatternEdgeInset}
                      y1={0}
                      x2={cw - gridPatternEdgeInset}
                      y2={0}
                      stroke="#ddd"
                      strokeWidth={gridPatternStrokeWSvg}
                      strokeLinecap="square"
                      shapeRendering="crispEdges"
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
                      y1={gridPatternEdgeInset}
                      x2={0}
                      y2={ch - gridPatternEdgeInset}
                      stroke="#ddd"
                      strokeWidth={gridPatternStrokeWSvg}
                      strokeLinecap="square"
                      shapeRendering="crispEdges"
                    />
                  </pattern>
                </defs>

                <g id="plan-export-background" pointerEvents="none">
                  <title>Background</title>
                  <rect width={cw} height={ch} fill="#faf9f7" />
                </g>

                {levelOverlaysBelowPlanContent ? renderLevelOverlaysGroup('plan-export-level-underlay') : null}

                {sectionCutGraphicVariant === 'detailLine' &&
                  connectionDetailLayerGrid?.axesIn &&
                  connectionDetailLayerFillPathItems.length > 0 && (
                    <g id="plan-export-connection-detail-manual-fills" pointerEvents="none" aria-hidden>
                      <title>Manual layer fills (bounded by detail lines)</title>
                      {connectionDetailLayerFillPathItems.map((item, idx) => (
                        <path
                          key={`cdf-path-${idx}`}
                          d={item.d}
                          fill={item.fill}
                          fillRule="evenodd"
                          stroke="none"
                          shapeRendering="geometricPrecision"
                        />
                      ))}
                    </g>
                  )}

                {sectionCutGraphicVariant === 'detailLine' &&
                  connectionDetailFillPreviewPathD &&
                  connectionDetailLayerFillPick != null && (
                    <g id="plan-export-connection-detail-fill-preview" pointerEvents="none" aria-hidden>
                      <title>Layer fill preview (hover)</title>
                      {(() => {
                        const isClear = connectionDetailLayerFillPick === 'clear'
                        const fillCol = isClear
                          ? '#fbbf24'
                          : connectionDetailManualFillSvgColor(
                              connectionDetailLayerFillPick,
                              orderedSystems,
                              planColorCatalog,
                            )
                        const swPrev = Math.max(0.45, 0.14 * connectionDetailVisualScale)
                        return (
                          <path
                            d={connectionDetailFillPreviewPathD}
                            fill={fillCol}
                            fillOpacity={isClear ? 0.34 : 0.4}
                            fillRule="evenodd"
                            stroke={isClear ? '#b45309' : '#2563eb'}
                            strokeOpacity={0.9}
                            strokeWidth={swPrev}
                            vectorEffect="non-scaling-stroke"
                            shapeRendering="geometricPrecision"
                          />
                        )
                      })()}
                    </g>
                  )}

                {sectionCutGraphicVariant === 'detailLine' &&
                  connectionDetailJunctionOutlineIn &&
                  connectionDetailJunctionOutlineIn.widthIn > 0 &&
                  connectionDetailJunctionOutlineIn.heightIn > 0 && (
                    <g id="plan-export-connection-junction-core" pointerEvents="none" aria-hidden>
                      <title>Junction area (without boundary padding)</title>
                      <rect
                        x={connectionDetailJunctionOutlineIn.insetPlanIn * d.planScale}
                        y={connectionDetailJunctionOutlineIn.insetPlanIn * d.planScale}
                        width={connectionDetailJunctionOutlineIn.widthIn * d.planScale}
                        height={connectionDetailJunctionOutlineIn.heightIn * d.planScale}
                        fill="none"
                        stroke="#94a3b8"
                        strokeOpacity={0.5}
                        strokeWidth={Math.max(0.06, 0.16 * connectionDetailVisualScale)}
                        strokeDasharray={`${2 * connectionDetailVisualScale} ${1.75 * connectionDetailVisualScale}`}
                      />
                    </g>
                  )}

                {sectionCutGraphicVariant === 'detailLine' &&
                  connectionDetailForCanvas &&
                  connectionDetailCorePx && (
                    <ConnectionDetailPlanStrips
                      connection={connectionDetailForCanvas}
                      buildingDimensions={d}
                      orderedSystems={orderedSystems}
                      mepItems={mepItems}
                      core={connectionDetailCorePx}
                      visualScale={connectionDetailVisualScale}
                      stripLayerFlips={connectionDetailStripFlipsMerged}
                      stripFlipPickActive={
                        annotationTool === 'flipConnectionStripLayers' &&
                        placeMode === 'annotate'
                      }
                      onStripLayerFlipToggle={(dir: ConnectionDetailStripDescriptor['dir']) => {
                        const prev = sketch.connectionDetailStripLayerFlips ?? {}
                        const next = { ...prev }
                        if (next[dir]) delete next[dir]
                        else next[dir] = true
                        if (Object.keys(next).length === 0) {
                          const { connectionDetailStripLayerFlips: _omit, ...rest } = sketch
                          onSketchChange(rest)
                        } else {
                          onSketchChange({ ...sketch, connectionDetailStripLayerFlips: next })
                        }
                      }}
                    />
                  )}

                {sectionCutGraphicVariant === 'detailLine' &&
                  connectionDetailCorePx &&
                  connectionDetailForCanvas && (
                    <g id="plan-export-connection-section-cut" pointerEvents="none" aria-hidden>
                      <title>Section cut at junction workspace</title>
                      <rect
                        x={connectionDetailCorePx.x0}
                        y={connectionDetailCorePx.y0}
                        width={connectionDetailCorePx.rw}
                        height={connectionDetailCorePx.rh}
                        fill="none"
                        stroke="#475569"
                        strokeOpacity={0.88}
                        strokeWidth={Math.max(0.07, 0.2 * connectionDetailVisualScale)}
                      />
                    </g>
                  )}

                {!hideLayoutDrawingOnTrade && (
                  <g id="plan-export-floor" pointerEvents="none">
                    <title>Floor</title>
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
                  </g>
                )}

                {!hideLayoutDrawingOnTrade && (
                <g id="plan-export-columns" pointerEvents="none">
                  <title>Columns</title>
                {displayColumnsSorted.map((col) => {
                  const half = col.sizeIn / 2
                  const ox = col.offsetXPlanIn ?? 0
                  const oy = col.offsetYPlanIn ?? 0
                  const { x, y } = planInchesToCanvasPx(d, col.cxIn - half + ox, col.cyIn - half + oy)
                  const sPx = col.sizeIn * d.planScale
                  const colPk = planAssemblyColumnFlipKey(col)
                  const colOp = planCellColumnOpacity(col, planVisualProfile ?? undefined, mepById)
                  const colStack =
                    planLineAssemblyLayers &&
                    computePlanArchColumnLayerStack({
                      col,
                      d,
                      orderedSystems,
                      bandRect: { x, y, width: sPx, height: sPx },
                      placedKey: colPk,
                      layerOrderFlipped: Boolean(sketch.planArchEdgeLayerFlipped?.[colPk]),
                    })
                  if (colStack) {
                    const vs = connectionDetailVisualScale
                    return (
                      <g key={placedColumnKey(col)} pointerEvents="none">
                        {colStack.slices.map((sl) => {
                          const { strokeW, dash } = planArchEdgeLayerSliceStrokePx(
                            sl.width,
                            sl.height,
                            sl.airGap,
                            vs,
                          )
                          return (
                            <rect
                              key={sl.key}
                              x={sl.x}
                              y={sl.y}
                              width={sl.width}
                              height={sl.height}
                              fill={sl.fill}
                              stroke="#171717"
                              strokeWidth={strokeW}
                              shapeRendering="crispEdges"
                              strokeDasharray={dash}
                              fillOpacity={colOp}
                              strokeOpacity={colOp}
                            />
                          )
                        })}
                        {colStack.seams.map((sm) => (
                          <line
                            key={sm.key}
                            x1={sm.x1}
                            y1={sm.y1}
                            x2={sm.x2}
                            y2={sm.y2}
                            stroke="#0f172a"
                            strokeOpacity={0.72 * colOp}
                            strokeWidth={planArchEdgeSeamStrokePx(vs)}
                            strokeLinecap="square"
                            shapeRendering="crispEdges"
                          />
                        ))}
                      </g>
                    )
                  }
                  return (
                    <rect
                      key={placedColumnKey(col)}
                      x={x}
                      y={y}
                      width={sPx}
                      height={sPx}
                      fill={planPaintSwatchColor('arch', col.systemId, 'column', planColorCatalog)}
                      fillOpacity={colOp}
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
                    const ox = col.offsetXPlanIn ?? 0
                    const oy = col.offsetYPlanIn ?? 0
                    const { x, y } = planInchesToCanvasPx(d, col.cxIn - half + ox, col.cyIn - half + oy)
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
                </g>
                )}

                <g id="plan-export-mep-devices" pointerEvents="none">
                  <title>MEP Devices</title>
                  {(sketch.mepDevices ?? []).map((dev) => {
                    const fill = planPaintSwatchColor('mep', dev.systemId, 'mep', planColorCatalog)
                    const isRect = mepDeviceHasRealDims(dev)
                    if (isRect) {
                      const lPx = dev.lengthIn! * d.planScale
                      const wPx = dev.widthIn! * d.planScale
                      const { x: ox, y: oy } = planInchesToCanvasPx(d, dev.cxIn - dev.lengthIn! / 2, dev.cyIn - dev.widthIn! / 2)
                      const fontSize = Math.max(4, Math.min(lPx, wPx) * 0.35)
                      return (
                        <g key={dev.id}>
                          <rect
                            x={ox} y={oy} width={lPx} height={wPx} rx={2}
                            fill={fill} fillOpacity={0.7}
                            stroke="rgba(0,0,0,0.35)" strokeWidth={0.55}
                            pointerEvents="none"
                          />
                          <text
                            x={ox + lPx / 2} y={oy + wPx / 2}
                            textAnchor="middle" dominantBaseline="central"
                            fill="rgba(0,0,0,0.7)" fontSize={fontSize}
                            fontFamily="monospace" pointerEvents="none"
                          >
                            {dev.category.charAt(0).toUpperCase()}
                          </text>
                        </g>
                      )
                    }
                    const half = dev.sizeIn / 2
                    const { x, y } = planInchesToCanvasPx(d, dev.cxIn - half, dev.cyIn - half)
                    const sPx = dev.sizeIn * d.planScale
                    return (
                      <g key={dev.id}>
                        <circle
                          cx={x + sPx / 2} cy={y + sPx / 2} r={sPx / 2}
                          fill={fill} fillOpacity={0.7}
                          stroke="rgba(0,0,0,0.35)" strokeWidth={0.55}
                          pointerEvents="none"
                        />
                        <text
                          x={x + sPx / 2} y={y + sPx / 2}
                          textAnchor="middle" dominantBaseline="central"
                          fill="rgba(0,0,0,0.7)" fontSize={Math.max(4, sPx * 0.35)}
                          fontFamily="monospace" pointerEvents="none"
                        >
                          {dev.category.charAt(0).toUpperCase()}
                        </text>
                      </g>
                    )
                  })}

                  {Array.from(selectedMepDeviceKeys)
                    .map((pk) => (sketch.mepDevices ?? []).find((dd) => placedMepDeviceKey(dd) === pk))
                    .filter((dev): dev is PlacedMepDevice => dev != null)
                    .map((dev) => {
                      const isRect = mepDeviceHasRealDims(dev)
                      if (isRect) {
                        const lPx = dev.lengthIn! * d.planScale
                        const wPx = dev.widthIn! * d.planScale
                        const { x: ox, y: oy } = planInchesToCanvasPx(d, dev.cxIn - dev.lengthIn! / 2, dev.cyIn - dev.widthIn! / 2)
                        return (
                          <rect
                            key={`sel-dev-${dev.id}`}
                            x={ox - 1.5} y={oy - 1.5}
                            width={lPx + 3} height={wPx + 3}
                            rx={3}
                            fill="none" stroke="#1976d2"
                            strokeWidth={2.5} strokeDasharray="6 4"
                            pointerEvents="none"
                          />
                        )
                      }
                      const half = dev.sizeIn / 2
                      const { x, y } = planInchesToCanvasPx(d, dev.cxIn - half, dev.cyIn - half)
                      const sPx = dev.sizeIn * d.planScale
                      return (
                        <circle
                          key={`sel-dev-${dev.id}`}
                          cx={x + sPx / 2} cy={y + sPx / 2}
                          r={sPx / 2 + 1.5}
                          fill="none" stroke="#1976d2"
                          strokeWidth={2.5} strokeDasharray="6 4"
                          pointerEvents="none"
                        />
                      )
                    })}
                </g>

                <g id="plan-export-grid" pointerEvents="none">
                  <title>Grid</title>
                  {connectionDetailLayerGrid?.linesPx ? (
                    <>
                      {connectionDetailLayerGrid.linesPx.ys.map((gy) => (
                        <line
                          key={`cg-h-${gy}`}
                          x1={gridPatternEdgeInset}
                          y1={gy}
                          x2={cw - gridPatternEdgeInset}
                          y2={gy}
                          stroke="#ddd"
                          strokeWidth={gridPatternStrokeWSvg}
                          strokeLinecap="square"
                          shapeRendering="crispEdges"
                        />
                      ))}
                      {connectionDetailLayerGrid.linesPx.xs.map((gx) => (
                        <line
                          key={`cg-v-${gx}`}
                          x1={gx}
                          y1={gridPatternEdgeInset}
                          x2={gx}
                          y2={ch - gridPatternEdgeInset}
                          stroke="#ddd"
                          strokeWidth={gridPatternStrokeWSvg}
                          strokeLinecap="square"
                          shapeRendering="crispEdges"
                        />
                      ))}
                    </>
                  ) : (
                    <>
                      <rect width={cw} height={ch} fill={`url(#${patGridH})`} pointerEvents="none" />
                      <rect width={cw} height={ch} fill={`url(#${patGridV})`} pointerEvents="none" />
                    </>
                  )}
                </g>

                <g id="plan-export-elevation" pointerEvents="none">
                  <title>Elevation</title>
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
                      strokeLinecap="butt"
                      pointerEvents="none"
                      opacity={0.92}
                    />
                  )}

                {isElevationCanvas && buildingLevels && buildingLevels.length > 0 && elevationFace && (() => {
                  const face = elevationFace
                  const sortedLevels = [...buildingLevels].sort((a, b) => a.j - b.j)

                  function wallBboxForSketch(sk: PlanLayoutSketch | undefined): { minI: number; maxI: number; minJ: number; maxJ: number } | null {
                    if (!sk || !sk.edges || sk.edges.length === 0) return null
                    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity
                    for (const e of sk.edges) {
                      if (e.kind !== 'wall') continue
                      if (e.axis === 'h') {
                        minI = Math.min(minI, e.i)
                        maxI = Math.max(maxI, e.i + 1)
                        minJ = Math.min(minJ, e.j)
                        maxJ = Math.max(maxJ, e.j)
                      } else {
                        minI = Math.min(minI, e.i)
                        maxI = Math.max(maxI, e.i)
                        minJ = Math.min(minJ, e.j)
                        maxJ = Math.max(maxJ, e.j + 1)
                      }
                    }
                    if (!Number.isFinite(minI)) return null
                    return { minI, maxI, minJ, maxJ }
                  }

                  return sortedLevels.map((level, idx) => {
                    // Level 1 always uses the primary layout sketch (implSketch).
                    // Identify by stable id, NOT by sorted position, so this stays correct
                    // when higher-elevation levels (smaller j) are also present.
                    const sk = level.id === '__default_level_1'
                      ? layoutSketchForProjection
                      : (levelSketches?.[level.id])
                    const bbox = wallBboxForSketch(sk)
                    if (!bbox) return null

                    // Each level's projection occupies the band between its own datum line
                    // (higherJ = closer to top of building, smaller y in canvas) and the
                    // next datum line below it (largerJ = closer to ground, larger y).
                    // Sorted ascending means sortedLevels[idx].j < sortedLevels[idx+1].j.
                    const higherJ = level.j   // this level's datum (top of its floor space)
                    const lowerJ = idx < sortedLevels.length - 1
                      ? sortedLevels[idx + 1]!.j   // next datum below = bottom of this floor space
                      : Math.min(Math.max(higherJ + 4, siteNy), siteNy)  // last level: extend to canvas bottom

                    // Skip if datum hasn't been placed yet (default j=0 means no datum set)
                    // or if the band has no height.
                    if (level.id === '__default_level_1' && higherJ === 0 && sortedLevels.length === 1) return null
                    if (lowerJ <= higherJ) return null

                    const hExtent = (face === 'N' || face === 'S')
                      ? { min: bbox.minI, max: bbox.maxI }
                      : { min: bbox.minJ, max: bbox.maxJ }

                    const x1 = hExtent.min * cellPx
                    const x2 = hExtent.max * cellPx
                    // higherJ → smaller y (top of rect); lowerJ → larger y (bottom of rect)
                    const rectY = higherJ * cellPx
                    const rectH = (lowerJ - higherJ) * cellPx

                    return (
                      <rect
                        key={`proj-${level.id}`}
                        x={Math.min(x1, x2)}
                        y={rectY}
                        width={Math.abs(x2 - x1)}
                        height={rectH}
                        fill="none"
                        stroke="#6b7280"
                        strokeWidth={Math.max(0.8, cellPx * 0.025)}
                        strokeDasharray="3 3"
                        opacity={0.55}
                        pointerEvents="none"
                      />
                    )
                  })
                })()}

                {isElevationCanvas &&
                  elevationLevelLines.map((lv) => {
                  const isDragging = dragKindRef.current === 'level-line-drag' &&
                    levelLineDragIdsRef.current?.includes(lv.id)
                  const dragDj = isDragging ? (movePreview?.dj ?? 0) : 0
                  const effectiveJ = Math.max(0, Math.min(siteNy, lv.j + dragDj))
                  if (effectiveJ < 0 || effectiveJ > siteNy) return null
                  const y = effectiveJ * cellPx
                  const lw = Math.max(1.1, cellPx * 0.035)
                  const lab = lv.label?.trim()
                  return (
                    <g key={lv.id} pointerEvents="none">
                      <line
                        x1={GRID_TRIM}
                        y1={y}
                        x2={cw - GRID_TRIM}
                        y2={y}
                        stroke={isDragging ? '#dc2626' : '#2563eb'}
                        strokeWidth={isDragging ? lw * 1.5 : lw}
                        strokeDasharray="5 4"
                        strokeLinecap="butt"
                        opacity={0.9}
                      />
                      {lab ? (
                        <text
                          x={GRID_TRIM + 4}
                          y={y}
                          textAnchor="start"
                          dominantBaseline="middle"
                          fill={isDragging ? '#991b1b' : '#1e3a8a'}
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
                </g>

                {!hideLayoutDrawingOnTrade &&
                  placeMode !== 'room' &&
                  (sketch.roomBoundaryEdges?.length ?? 0) > 0 && (
                    <g id="plan-export-room-underlay" pointerEvents="none">
                      <title>Room boundaries (under walls)</title>
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
                              strokeLinecap="butt"
                              strokeDasharray={PLAN_ROOM_BOUNDARY_MUTED_DASH}
                            />
                          )
                        })}
                      </g>
                    </g>
                  )}

                {!hideLayoutDrawingOnTrade && placeMode !== 'room' && enclosedRooms.length > 0 && (
                  <g id="plan-export-room-zone-outline-underlay" pointerEvents="none">
                    <title>Named room zones (under walls)</title>
                    <g aria-hidden pointerEvents="none">
                      {enclosedRooms.map((room, ri) => {
                        if (!roomZoneHasAssignedName(room.cellKeys, sketch.roomByCell)) return null
                        const outlineSegs = planRoomZoneOutlineSegments(room.cellKeys, cellPx)
                        const swOut = Math.max(0.6, strokeWidthForRoomBoundaryUnderlay(d) * 1.1)
                        return (
                          <g key={`room-zone-ul-${room.cellKeys[0] ?? ri}`}>
                            {outlineSegs.map((seg, si) => (
                              <line
                                key={`room-zone-ul-${room.cellKeys[0] ?? ri}-${si}`}
                                x1={seg.x1}
                                y1={seg.y1}
                                x2={seg.x2}
                                y2={seg.y2}
                                stroke={PLAN_ROOM_BOUNDARY_MUTED_STROKE}
                                strokeOpacity={0.4}
                                strokeWidth={swOut}
                                strokeLinecap="butt"
                                strokeDasharray={PLAN_ROOM_BOUNDARY_MUTED_DASH}
                              />
                            ))}
                          </g>
                        )
                      })}
                    </g>
                  </g>
                )}

                <g id="plan-export-structure">
                  <title>Walls and MEP</title>
                  {!hideLayoutDrawingOnTrade && (
                    <g id="plan-opening-ghosts-under" pointerEvents="none" aria-hidden>
                      {archOpeningGhostEdges.map((e) => {
                        const baseOp = planPlacedEdgeOpacity(e, planVisualProfile ?? undefined, mepById)
                        const wallAsWall: PlacedGridEdge = { ...e, kind: 'wall' }
                        const wallFill = planEdgeStroke(wallAsWall, planColorCatalog)
                        const bandRect = archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
                        const ghostKey = openGhostPlanArchAssemblyFlipStorageKey(e)
                        const ghostOp = baseOp * PLAN_ARCH_WALL_GHOST_UNDER_OPENING
                        const ghostStack =
                          planLineAssemblyLayers &&
                          computePlanArchEdgeLayerStack({
                            edge: wallAsWall,
                            d,
                            orderedSystems,
                            bandRect,
                            axis: e.axis,
                            placedKey: ghostKey,
                            layerOrderFlipped: planArchAssemblyLayerOrderFlipped(
                              sketch.planArchEdgeLayerFlipped,
                              e,
                              'openGhost',
                            ),
                          })
                        if (ghostStack) {
                          const vs = connectionDetailVisualScale
                          return (
                            <g key={ghostKey}>
                              {ghostStack.slices.map((sl) => {
                                const { strokeW, dash } = planArchEdgeLayerSliceStrokePx(
                                  sl.width,
                                  sl.height,
                                  sl.airGap,
                                  vs,
                                )
                                return (
                                  <rect
                                    key={sl.key}
                                    x={sl.x}
                                    y={sl.y}
                                    width={sl.width}
                                    height={sl.height}
                                    fill={sl.fill}
                                    stroke="#171717"
                                    strokeWidth={strokeW}
                                    shapeRendering="crispEdges"
                                    strokeDasharray={dash}
                                    fillOpacity={ghostOp}
                                    strokeOpacity={ghostOp}
                                  />
                                )
                              })}
                              {ghostStack.seams.map((sm) => (
                                <line
                                  key={sm.key}
                                  x1={sm.x1}
                                  y1={sm.y1}
                                  x2={sm.x2}
                                  y2={sm.y2}
                                  stroke="#0f172a"
                                  strokeOpacity={0.72 * ghostOp}
                                  strokeWidth={planArchEdgeSeamStrokePx(vs)}
                                  strokeLinecap="square"
                                  shapeRendering="crispEdges"
                                />
                              ))}
                            </g>
                          )
                        }
                        return (
                          <rect
                            key={ghostKey}
                            x={bandRect.x}
                            y={bandRect.y}
                            width={bandRect.width}
                            height={bandRect.height}
                            fill={wallFill}
                            fillOpacity={ghostOp}
                            stroke="none"
                          />
                        )
                      })}
                    </g>
                  )}
                {mergedPlanStructurePaint.map((row) => {
                  if (row.k === 'mepPath') {
                    return (
                      <path
                        key={row.reactKey}
                        d={row.d}
                        fill="none"
                        stroke={row.stroke}
                        strokeWidth={row.sw}
                        strokeOpacity={row.opacity}
                        strokeLinecap="butt"
                        strokeLinejoin="round"
                        strokeMiterlimit={8}
                        strokeDasharray={row.dash}
                      />
                    )
                  }
                  if (row.k === 'placedLine') {
                    const e = row.item.e
                    const pk = placedEdgeKey(e)
                    const asmLineKey = planArchAssemblyFlipEdgeKey(e)
                    const base =
                      (e.source ?? 'arch') === 'arch'
                        ? placedArchEdgeEndpointsCanvasPx(d, e, delta)
                        : edgeEndpointsCanvasPx(d, e, delta)
                    const off = mepRunOffsets.get(pk)
                    const x1 = base.x1 + (off?.dx ?? 0)
                    const y1 = base.y1 + (off?.dy ?? 0)
                    const x2 = base.x2 + (off?.dx ?? 0)
                    const y2 = base.y2 + (off?.dy ?? 0)
                    const sw = strokeWidthForEdge(d, e, mepById)
                    const dash = planEdgeStrokeDasharray(e.kind ?? 'wall')
                    const k = edgeKeyString(e)
                    const src = e.source ?? 'arch'
                    const kind = e.kind ?? 'wall'
                    const baseOp = planPlacedEdgeOpacity(e, planVisualProfile ?? undefined, mepById)
                    const wallUsesBand =
                      src === 'arch' && kind === 'wall' && archWallKeysWithOpeningOverlap.has(k)
                    const wallAsWall: PlacedGridEdge = { ...e, kind: 'wall' }
                    const mainOpacity = wallUsesBand
                      ? baseOp * PLAN_ARCH_WALL_OPACITY_WITH_OPENING
                      : baseOp
                    const wallFill = planEdgeStroke(wallAsWall, planColorCatalog)
                    const bandRect = archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
                    const stackBand = wallUsesBand
                      ? bandRect
                      : thinStrokeBandCanvasPx(e.axis, x1, y1, x2, y2, sw)
                    const archStack =
                      planLineAssemblyLayers &&
                      src === 'arch' &&
                      computePlanArchEdgeLayerStack({
                        edge: e,
                        d,
                        orderedSystems,
                        bandRect: stackBand,
                        axis: e.axis,
                        placedKey: asmLineKey,
                        layerOrderFlipped: planArchAssemblyLayerOrderFlipped(
                          sketch.planArchEdgeLayerFlipped,
                          e,
                          'edge',
                        ),
                      })
                    if (archStack) {
                      const vs = connectionDetailVisualScale
                      return (
                        <g key={asmLineKey}>
                          {archStack.slices.map((sl) => {
                            const { strokeW, dash } = planArchEdgeLayerSliceStrokePx(
                              sl.width,
                              sl.height,
                              sl.airGap,
                              vs,
                            )
                            return (
                              <rect
                                key={sl.key}
                                x={sl.x}
                                y={sl.y}
                                width={sl.width}
                                height={sl.height}
                                fill={sl.fill}
                                stroke="#171717"
                                strokeWidth={strokeW}
                                shapeRendering="crispEdges"
                                strokeDasharray={dash}
                                fillOpacity={mainOpacity}
                                strokeOpacity={mainOpacity}
                              />
                            )
                          })}
                          {archStack.seams.map((sm) => (
                            <line
                              key={sm.key}
                              x1={sm.x1}
                              y1={sm.y1}
                              x2={sm.x2}
                              y2={sm.y2}
                              stroke="#0f172a"
                              strokeOpacity={0.72 * mainOpacity}
                              strokeWidth={planArchEdgeSeamStrokePx(vs)}
                              strokeLinecap="square"
                              shapeRendering="crispEdges"
                            />
                          ))}
                        </g>
                      )
                    }
                    return (
                      <g key={asmLineKey}>
                        {wallUsesBand ? (
                          <rect
                            x={bandRect.x}
                            y={bandRect.y}
                            width={bandRect.width}
                            height={bandRect.height}
                            fill={wallFill}
                            fillOpacity={mainOpacity}
                            stroke="none"
                          />
                        ) : (
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={planEdgeStroke(e, planColorCatalog)}
                            strokeOpacity={mainOpacity}
                            strokeWidth={sw}
                            strokeLinecap="butt"
                            strokeDasharray={dash}
                          />
                        )}
                      </g>
                    )
                  }
                  if (row.k === 'cornerCap') {
                    const cc = row.cc
                    const { x: cx, y: cy } = connectionJunctionCapCenterCanvasPx(
                      cc,
                      d,
                      delta,
                      sketch.edges ?? [],
                    )
                    const armsForCap = cc.armsPhysical ?? cc.arms
                    const sketchEdgesCap = sketch.edges ?? []
                    const edgeFromArm = (arm: (typeof cc.arms)[number]): PlacedGridEdge =>
                      findPlacedEdgeForJunctionArm(sketchEdgesCap, cc.nodeI, cc.nodeJ, arm) ??
                      placedGridEdgeForJunctionArm(cc.nodeI, cc.nodeJ, arm)
                    let thickestArm = armsForCap[0]!
                    let thickestPx = strokeWidthForEdge(d, edgeFromArm(thickestArm), mepById)
                    for (const arm of armsForCap) {
                      const w = strokeWidthForEdge(d, edgeFromArm(arm), mepById)
                      if (w > thickestPx) {
                        thickestPx = w
                        thickestArm = arm
                      }
                    }
                    const edgeThick = edgeFromArm(thickestArm)
                    const fillCol = planEdgeStroke(edgeThick, planColorCatalog)
                    const { widthIn, depthIn } = connectionJunctionHighlightPlanInches(cc, d, mepById)
                    const rw = widthIn * d.planScale
                    const rh = depthIn * d.planScale
                    const x1 = cx - rw / 2
                    const y1 = cy - rh / 2
                    const effectiveKey = resolvedConnectionDetailTemplateKey(
                      cc,
                      sketch,
                      connectionSketchKeySet,
                    )
                    const sheetMeta = connectionSheetCornerLabelByTemplateKey.get(effectiveKey)
                    const repForCorner = connectionDetailRowByTemplateKey.get(effectiveKey)
                    const connSketchAtTemplate =
                      connectionSketches && repForCorner
                        ? connectionSketches[repForCorner.id]
                        : null
                    /** Don’t stack catalog junction strips when anything from the connection sheet is pasted on the plan (lines, fills, etc.). */
                    const suppressJunctionStripsForConnectionSketch =
                      connSketchAtTemplate != null &&
                      connectionDetailSketchHasPlanOverlayContent(connSketchAtTemplate)
                    const showJunctionStrips =
                      planLineAssemblyLayers &&
                      !hideLayoutDrawingOnTrade &&
                      connectionDetailStripDescriptorsFromPlan(cc, d.layoutRefs).length > 0 &&
                      !suppressJunctionStripsForConnectionSketch

                    if (showJunctionStrips) {
                      return (
                        <g key={row.tie} pointerEvents="none">
                          <title>
                            {sheetMeta
                              ? `Connection sheet ${sheetMeta.badge}: ${sheetMeta.subtitle}\n`
                              : ''}
                            {formatConnectionParticipantsFull(cc)}
                          </title>
                          <ConnectionDetailPlanStrips
                            connection={cc}
                            buildingDimensions={d}
                            orderedSystems={orderedSystems}
                            mepItems={mepItems}
                            core={{ x0: x1, y0: y1, rw, rh }}
                            visualScale={connectionDetailVisualScale}
                            exportGroupId={`plan-export-junction-strips-${cc.nodeI}-${cc.nodeJ}`}
                          />
                          {showCornerConditions ? (
                            <rect
                              x={x1}
                              y={y1}
                              width={rw}
                              height={rh}
                              fill="none"
                              stroke="#9ca3af"
                              strokeWidth={Math.max(0.2, 0.9 * connectionDetailVisualScale)}
                              strokeDasharray="2 3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeOpacity={0.92}
                              pointerEvents="none"
                            />
                          ) : null}
                        </g>
                      )
                    }

                    return (
                      <g key={row.tie} pointerEvents="none">
                        <title>
                          {sheetMeta
                            ? `Connection sheet ${sheetMeta.badge}: ${sheetMeta.subtitle}\n`
                            : ''}
                          {formatConnectionParticipantsFull(cc)}
                        </title>
                        <rect
                          x={x1}
                          y={y1}
                          width={rw}
                          height={rh}
                          fill={fillCol}
                          fillOpacity={1}
                          stroke={showCornerConditions ? '#9ca3af' : 'none'}
                          strokeWidth={
                            showCornerConditions
                              ? Math.max(0.2, 0.9 * connectionDetailVisualScale)
                              : 0
                          }
                          strokeDasharray={showCornerConditions ? '2 3' : undefined}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity={showCornerConditions ? 0.92 : 0}
                          pointerEvents="none"
                        />
                      </g>
                    )
                  }
                  if (row.k !== 'roomBd') return null
                  const e = row.item.e
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
                      strokeLinecap="butt"
                      strokeDasharray={PLAN_ROOM_BOUNDARY_DASH}
                      pointerEvents="none"
                    />
                  )
                })}
                </g>

                {!hideLayoutDrawingOnTrade &&
                  planLineAssemblyLayers &&
                  connectionSketches &&
                  !annotationsOnly &&
                  planConnections.map((cc) => {
                    const effKey = resolvedConnectionDetailTemplateKey(
                      cc,
                      sketch,
                      connectionSketchKeySet,
                    )
                    const rep = connectionDetailRowByTemplateKey.get(effKey)
                    if (!rep) return null
                    const detailSketch = connectionSketches[rep.id]
                    if (!detailSketch || !connectionDetailSketchHasPlanOverlayContent(detailSketch)) {
                      return null
                    }
                    const nodeAxesIn = connectionDetailOverlayIrregularAxesPlanInches({
                      planConnectionAtNode: cc,
                      representativeConnection: rep,
                      layoutSketch: layoutForConnectionDetails,
                      detailSketch,
                      d,
                      orderedSystems,
                      mepById,
                    })
                    const detailDelta = resolvedConnectionDetailGridSpacingIn(layoutForConnectionDetails)
                    const centerDetail = connectionDetailJunctionCenterCanvasPx(
                      cc,
                      layoutForConnectionDetails,
                      d,
                      mepById,
                    )
                    const centerFloor = planGridNodeCenterCanvasPx(cc.nodeI, cc.nodeJ, delta, d)
                    const overlayAlign = connectionDetailPlanOverlayAlignment(rep, cc)
                    const rotDeg = overlayAlign.rotSteps90 * 90
                    const clipOverlay = connectionDetailPlanOverlayClipRectCanvasPx(detailSketch, d)
                    const clipId = `plan-export-conn-detail-clip-${cc.nodeI}-${cc.nodeJ}`
                    const gridRuns = detailSketch.annotationGridRuns ?? []
                    const sectionCuts = detailSketch.annotationSectionCuts ?? []
                    const labels = detailSketch.annotationLabels ?? []
                    const measureRuns = detailSketch.measureRuns ?? []
                    return (
                      <g
                        key={`plan-export-conn-detail-anno-${cc.nodeI}-${cc.nodeJ}`}
                        id={`plan-export-conn-detail-anno-${cc.nodeI}-${cc.nodeJ}`}
                        transform={`translate(${centerFloor.x} ${centerFloor.y}) rotate(${rotDeg}) scale(${overlayAlign.scaleX} ${overlayAlign.scaleY}) translate(${-centerDetail.x} ${-centerDetail.y})`}
                        pointerEvents="none"
                        aria-hidden
                      >
                        <title>Connection detail linework at junction {cc.nodeI}:{cc.nodeJ}</title>
                        <defs>
                          <clipPath id={clipId}>
                            <rect
                              x={clipOverlay.x}
                              y={clipOverlay.y}
                              width={clipOverlay.width}
                              height={clipOverlay.height}
                            />
                          </clipPath>
                        </defs>
                        <g clipPath={`url(#${clipId})`}>
                          {nodeAxesIn &&
                            detailSketch.connectionDetailLayerFillByCell &&
                            Object.keys(detailSketch.connectionDetailLayerFillByCell).length > 0 &&
                            connectionDetailLayerFillConnectedComponents(
                              detailSketch.connectionDetailLayerFillByCell,
                            ).map((comp, fillIdx) => {
                              const pathD = connectionDetailFilledRegionSvgPathD(
                                nodeAxesIn.xsIn,
                                nodeAxesIn.ysIn,
                                comp.cellKeys,
                                d.planScale,
                              )
                              if (!pathD) return null
                              return (
                                <path
                                  key={`plan-cd-fill-${cc.nodeI}-${cc.nodeJ}-${fillIdx}`}
                                  d={pathD}
                                  fill={connectionDetailManualFillSvgColor(
                                    comp.ref,
                                    orderedSystems,
                                    planColorCatalog,
                                  )}
                                  fillRule="evenodd"
                                  stroke="none"
                                  shapeRendering="geometricPrecision"
                                />
                              )
                            })}
                          {gridRuns.map((run) => (
                            <GridReferencePathOverlay
                              key={run.id}
                              d={d}
                              delta={detailDelta}
                              edgeKeys={run.edgeKeys}
                              strokeWidthScale={connectionDetailVisualScale}
                              nodeAxesIn={nodeAxesIn}
                            />
                          ))}
                          {sectionCuts.map((cut) => (
                            <SectionCutGraphic
                              key={cut.id}
                              d={d}
                              delta={detailDelta}
                              variant="detailLine"
                              visualScale={connectionDetailVisualScale}
                              cut={cut}
                              nodeAxesIn={nodeAxesIn}
                            />
                          ))}
                          {labels.map((L) => {
                            const { x, y } = planInchesToCanvasPx(d, L.xIn, L.yIn)
                            const annFs = Math.max(5, 11 * connectionDetailVisualScale)
                            const annOutline = Math.max(0.45, 2 * connectionDetailVisualScale)
                            return (
                              <text
                                key={L.id}
                                x={x}
                                y={y}
                                textAnchor="start"
                                dominantBaseline="hanging"
                                fill="#0f172a"
                                stroke="#fff"
                                strokeWidth={annOutline}
                                paintOrder="stroke fill"
                                style={{
                                  fontFamily: "'Courier New', Courier, monospace",
                                  fontSize: annFs,
                                }}
                              >
                                {L.text}
                              </text>
                            )
                          })}
                          {measureRuns.map((run) => {
                            const cap = gridRunMeasureCaption(
                              run.totalPlanIn,
                              run.startNode,
                              run.endNode,
                              run.edgeKeys.length,
                              planSiteDisplayUnit,
                            )
                            return (
                              <GridPathDimensionOverlay
                                key={run.id}
                                d={d}
                                delta={detailDelta}
                                edgeKeys={run.edgeKeys}
                                startNode={run.startNode}
                                endNode={run.endNode}
                                primary={cap.primary}
                                visualScale={connectionDetailVisualScale}
                                nodeAxesIn={nodeAxesIn}
                              />
                            )
                          })}
                        </g>
                      </g>
                    )
                  })}

                {!hideLayoutDrawingOnTrade && enclosedRooms.length > 0 && (
                  <g id="plan-export-rooms">
                    <title>Room names</title>
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
                      const swVivid = Math.max(1.65, strokeWidthForRoomBoundaryLine(d) * 1.5)
                      return (
                        <g key={`room-anno-${room.cellKeys[0] ?? ri}`}>
                          {vividRoom
                            ? outlineSegs.map((seg, si) => (
                                <line
                                  key={`room-bd-${room.cellKeys[0] ?? ri}-${si}`}
                                  x1={seg.x1}
                                  y1={seg.y1}
                                  x2={seg.x2}
                                  y2={seg.y2}
                                  stroke={PLAN_ROOM_BOUNDARY_CYAN}
                                  strokeOpacity={1}
                                  strokeWidth={swVivid}
                                  strokeLinecap="butt"
                                  strokeDasharray={PLAN_ROOM_BOUNDARY_DASH}
                                />
                              ))
                            : null}
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
                  </g>
                )}

                {traceOverlay?.href &&
                  traceOverlay.visible &&
                  traceOverlay.opacity > 0 && (
                    <g
                      id="plan-export-trace"
                      pointerEvents="none"
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
                      <title>Trace overlay</title>
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

                {!levelOverlaysBelowPlanContent ? renderLevelOverlaysGroup('plan-export-level-overlays') : null}

                {!hideLayoutDrawingOnTrade && planConnections.length > 0 && (
                  <g
                    id="plan-export-corner-conditions-ui"
                    pointerEvents={showCornerConditions ? 'auto' : 'none'}
                  >
                    <title>Corner conditions — labels and controls</title>
                    {planConnections.map((cc) => {
                      const { x: cx, y: cy } = connectionJunctionCapCenterCanvasPx(
                        cc,
                        d,
                        delta,
                        sketch.edges ?? [],
                      )

                      const { widthIn, depthIn } = connectionJunctionHighlightPlanInches(cc, d, mepById)
                      const rw = widthIn * d.planScale
                      const rh = depthIn * d.planScale

                      const x1 = cx - rw / 2
                      const y1 = cy - rh / 2

                      const minDim = Math.min(rw, rh)
                      const labelFontSize = Math.max(
                        2.5,
                        Math.max(3.5, Math.min(8, minDim * 0.38)) * connectionDetailVisualScale,
                      )
                      const effectiveKey = resolvedConnectionDetailTemplateKey(
                        cc,
                        sketch,
                        connectionSketchKeySet,
                      )
                      const sheetMeta = connectionSheetCornerLabelByTemplateKey.get(effectiveKey)
                      const cornerLabelText = sheetMeta
                        ? `${cc.shape}, ${sheetMeta.badge}`
                        : cc.shape
                      const isHomogeneousCornerVariants = connectionDetailRowSupportsConnectionVariants(cc)
                      const junctionNodeKey = `${cc.nodeI}:${cc.nodeJ}`
                      const variantIds = isHomogeneousCornerVariants
                        ? getOrInferHomogeneousLVariantIds(
                            cc.templateKey,
                            sketch,
                            connectionSketchKeySet,
                          )
                        : []
                      const resolvedTail =
                        effectiveKey.split('\x1f').pop() ?? ''
                      const vm = /^v(\d+)$/.exec(resolvedTail)
                      const selectedVariantIndex =
                        vm && Number.isFinite(Number(vm[1])) ? Number(vm[1]) : 0
                      const edgePad = 6
                      /** Toolbar size in screen CSS px (viewport); foreignObject uses SVG units = css/zoom so plan zoom does not resize chips. */
                      const barCssW = isHomogeneousCornerVariants
                        ? Math.min(
                            420,
                            Math.max(cornerToolbarCssW, 40 + variantIds.length * 52 + 56),
                          )
                        : cornerToolbarCssW
                      const foW = barCssW / zoomSafeForUi
                      const foH = cornerToolbarCssH / zoomSafeForUi
                      const barW = foW
                      const barLeftUncentered = cx - barW / 2
                      const barLeft = Math.max(
                        edgePad,
                        Math.min(cw - barW - edgePad, barLeftUncentered),
                      )
                      const gapAboveCornerSvg = 8 / zoomSafeForUi
                      const foTop = Math.max(edgePad, y1 - foH - gapAboveCornerSvg)
                      const isBarOpen = homogeneousCornerHoverKey === junctionNodeKey
                      /** Tight hover union: junction + padded toolbar + vertical gap only (no wide slab). */
                      const safetyPadSvg = 4 / zoomSafeForUi
                      const barHitX0 = barLeft - safetyPadSvg
                      const barHitY0 = foTop - safetyPadSvg
                      const barHitW0 = barW + safetyPadSvg * 2
                      const barHitH0 = foH + safetyPadSvg * 2
                      const barHitX = Math.max(0, barHitX0)
                      const barHitY = Math.max(0, barHitY0)
                      const barHitW = Math.max(0, Math.min(cw, barHitX0 + barHitW0) - barHitX)
                      const barHitH = Math.max(0, Math.min(ch, barHitY0 + barHitH0) - barHitY)
                      const barBottom = foTop + foH
                      const connPadSvg = 3 / zoomSafeForUi
                      const bridgeX0 = Math.min(barLeft, x1) - connPadSvg
                      const bridgeY0 = barBottom
                      const bridgeW0 = Math.max(barLeft + barW, x1 + rw) - bridgeX0 + connPadSvg * 2
                      const bridgeH0 = Math.max(0, y1 - barBottom)
                      const bridgeX = Math.max(0, bridgeX0)
                      const bridgeY = Math.max(0, bridgeY0)
                      const bridgeW = Math.max(0, Math.min(cw, bridgeX0 + bridgeW0) - bridgeX)
                      const bridgeH = Math.max(0, Math.min(ch, bridgeY0 + bridgeH0) - bridgeY)

                      return (
                        <g
                          key={`cc-ui-${cc.nodeI}:${cc.nodeJ}`}
                          pointerEvents={isHomogeneousCornerVariants ? 'auto' : 'none'}
                        >
                          {showCornerConditions && isHomogeneousCornerVariants && (
                            <>
                              <rect
                                x={x1}
                                y={y1}
                                width={rw}
                                height={rh}
                                fill="transparent"
                                pointerEvents={isBarOpen ? 'none' : 'all'}
                                data-corner-connection-hit="1"
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseEnter={() => openCornerVariantBar(junctionNodeKey)}
                                onMouseLeave={
                                  isBarOpen
                                    ? undefined
                                    : () => scheduleCornerVariantBarClose()
                                }
                              />
                              {isBarOpen && (
                                <g
                                  pointerEvents="all"
                                  data-corner-connection-hit="1"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onMouseEnter={() => clearCornerVariantLeaveTimer()}
                                  onMouseLeave={() => scheduleCornerVariantBarClose()}
                                >
                                  <rect
                                    x={x1}
                                    y={y1}
                                    width={rw}
                                    height={rh}
                                    fill="transparent"
                                    pointerEvents="all"
                                    data-corner-connection-hit="1"
                                    onPointerDown={(e) => e.stopPropagation()}
                                  />
                                  {bridgeH > 0 && (
                                    <rect
                                      x={bridgeX}
                                      y={bridgeY}
                                      width={bridgeW}
                                      height={bridgeH}
                                      fill="transparent"
                                      pointerEvents="all"
                                      data-corner-connection-hit="1"
                                      onPointerDown={(e) => e.stopPropagation()}
                                    />
                                  )}
                                  <rect
                                    x={barHitX}
                                    y={barHitY}
                                    width={barHitW}
                                    height={barHitH}
                                    fill="transparent"
                                    pointerEvents="all"
                                    data-corner-connection-hit="1"
                                    onPointerDown={(e) => e.stopPropagation()}
                                  />
                                  <foreignObject
                                    x={barLeft}
                                    y={foTop}
                                    width={foW}
                                    height={foH}
                                  >
                                    <div
                                      data-corner-connection-ui="1"
                                      className="flex min-h-0 flex-wrap items-center justify-center gap-1 px-1 py-0.5 box-border"
                                      style={{
                                        width: barCssW,
                                        height: cornerToolbarCssH,
                                        transform: `scale(${1 / zoomSafeForUi})`,
                                        transformOrigin: 'top left',
                                        overflow: 'visible',
                                      }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      {variantIds.map((tplId, vi) => {
                                        const expandedTplKey = `${cc.templateKey}\x1fv${vi}`
                                        const sheetIdx = connectionDetailMergedSheets.findIndex(
                                          (r) => r.templateKey === expandedTplKey,
                                        )
                                        const variantSheetBadge =
                                          sheetIdx >= 0
                                            ? connectionDetailSheetBadge(sheetIdx)
                                            : `${vi + 1}`
                                        return (
                                          <button
                                            key={tplId}
                                            type="button"
                                            title={`Connection sheet ${variantSheetBadge} (same system on every arm)`}
                                            className={
                                              selectedVariantIndex === vi
                                                ? PLAN_CORNER_VARIANT_BTN_ON
                                                : PLAN_CORNER_VARIANT_BTN_IDLE
                                            }
                                            onClick={() =>
                                              setHomogeneousLSketchIdForNode(junctionNodeKey, tplId)
                                            }
                                          >
                                            {variantSheetBadge}
                                          </button>
                                        )
                                      })}
                                      <button
                                        type="button"
                                        title="Add another connection drawing for this uniform junction type"
                                        className={PLAN_CORNER_VARIANT_BTN_IDLE}
                                        onClick={() =>
                                          addHomogeneousLConnectionDrawing(
                                            cc.templateKey,
                                            junctionNodeKey,
                                          )
                                        }
                                      >
                                        + Add
                                      </button>
                                    </div>
                                  </foreignObject>
                                </g>
                              )}
                            </>
                          )}
                          {showCornerConditions && (
                            <text
                              x={cx}
                              y={cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize={labelFontSize}
                              fontFamily="monospace"
                              fontWeight="600"
                              fill="#1c1917"
                              fillOpacity={0.9}
                              pointerEvents="none"
                            >
                              {cornerLabelText}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                )}

                <g id="plan-export-ui-tool" pointerEvents="none">
                  <title>Tool overlays</title>

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
                      const ox = col.offsetXPlanIn ?? 0
                      const oy = col.offsetYPlanIn ?? 0
                      const { x, y } = planInchesToCanvasPx(d, col.cxIn - half + ox, col.cyIn - half + oy)
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
                    {(() => {
                      const seenJoinD = new Set<string>()
                      return layersBarHoverEdges.map((e) => {
                        const pk = placedEdgeKey(e)
                        const joinD =
                          planVisualProfile?.mode === 'trade_mep'
                            ? mepJoinedDrawModel.pathDByPlacedKey.get(pk)
                            : undefined
                        const sw = Math.max(3.5, strokeWidthForEdge(d, e, mepById) + 2.5)
                        if (joinD) {
                          if (seenJoinD.has(joinD)) return null
                          seenJoinD.add(joinD)
                          return (
                            <path
                              key={`layers-bar-hover-join-${pk}`}
                              d={joinD}
                              fill="none"
                              stroke="#d97706"
                              strokeWidth={sw}
                              strokeLinecap="butt"
                              strokeLinejoin="round"
                              opacity={0.92}
                            />
                          )
                        }
                        const base =
                          (e.source ?? 'arch') === 'arch'
                            ? placedArchEdgeEndpointsCanvasPx(d, e, delta)
                            : edgeEndpointsCanvasPx(d, e, delta)
                        const off = mepRunOffsets.get(pk)
                        return (
                          <line
                            key={`layers-bar-hover-edge-${pk}`}
                            x1={base.x1 + (off?.dx ?? 0)}
                            y1={base.y1 + (off?.dy ?? 0)}
                            x2={base.x2 + (off?.dx ?? 0)}
                            y2={base.y2 + (off?.dy ?? 0)}
                            stroke="#d97706"
                            strokeWidth={sw}
                            strokeLinecap="butt"
                            opacity={0.92}
                          />
                        )
                      })
                    })()}
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
                          strokeLinecap="butt"
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

                {mepDevicePaintPreview && isMepPointMode(placeMode) && floorTool === 'paint' && (
                  <g pointerEvents="none" aria-hidden>
                    {(() => {
                      const pv = mepDevicePaintPreview
                      const fill = planPaintSwatchColor('mep', activeSystemId, 'mep', planColorCatalog)
                      const pvRect = (pv.lengthIn ?? 0) > 0 && (pv.widthIn ?? 0) > 0
                      if (pvRect) {
                        const lPx = pv.lengthIn! * d.planScale
                        const wPx = pv.widthIn! * d.planScale
                        const { x: ox, y: oy } = planInchesToCanvasPx(d, pv.cxIn - pv.lengthIn! / 2, pv.cyIn - pv.widthIn! / 2)
                        return (
                          <rect
                            x={ox} y={oy} width={lPx} height={wPx} rx={2}
                            fill={fill} fillOpacity={0.42}
                            stroke="#c62828" strokeWidth={2.5}
                            strokeDasharray="5 4" strokeOpacity={0.88}
                          />
                        )
                      }
                      const half = pv.sizeIn / 2
                      const { x, y } = planInchesToCanvasPx(d, pv.cxIn - half, pv.cyIn - half)
                      const sPx = pv.sizeIn * d.planScale
                      return (
                        <circle
                          cx={x + sPx / 2} cy={y + sPx / 2} r={sPx / 2}
                          fill={fill} fillOpacity={0.42}
                          stroke="#c62828" strokeWidth={2.5}
                          strokeDasharray="5 4" strokeOpacity={0.88}
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
                      const polyPts = wallPreviewPolylinePointsCanvas(
                        wallLinePreviewKeys,
                        d,
                        delta,
                        connectionDetailNodeAxes,
                      )
                      const main = polyPts ? (
                        <polyline
                          points={polyPts}
                          fill="none"
                          stroke={pvStroke}
                          strokeWidth={2.5}
                          strokeLinecap="butt"
                          strokeLinejoin="miter"
                          strokeDasharray="5 4"
                          opacity={0.88}
                        />
                      ) : (
                        wallLinePreviewKeys.map((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return null
                          const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                          return (
                            <line
                              key={`pv-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={pvStroke}
                              strokeWidth={2.5}
                              strokeLinecap="butt"
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
                              strokeLinecap="butt"
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
                        const pos = previewPathCentroidCanvas(
                          wallLinePreviewKeys,
                          d,
                          delta,
                          connectionDetailNodeAxes,
                        )
                        if (!pos) return null
                        const parsedPv = wallLinePreviewKeys
                          .map((k) => parseEdgeKeyString(k))
                          .filter((p): p is NonNullable<typeof p> => p != null)
                        const previewLenIn =
                          parsedPv.length > 0
                            ? gridEdgeLengthsPlanInchesSum(
                                parsedPv,
                                delta,
                                planGridFns.useIrregular ? planGridFns.axesIn : null,
                              )
                            : wallLinePreviewKeys.length * delta
                        const label = gridRunMeasureCaption(
                          previewLenIn,
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
                      variant={sectionCutGraphicVariant}
                      visualScale={connectionDetailVisualScale}
                      nodeAxesIn={connectionDetailNodeAxes}
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
                    strokeWidth={
                      sectionCutGraphicVariant === 'detailLine'
                        ? connectionDetailMarqueeRectStrokeW
                        : 1
                    }
                    strokeDasharray={
                      sectionCutGraphicVariant === 'detailLine' ? '4 3' : '5 4'
                    }
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

                {(() => {
                  const seenJoinD = new Set<string>()
                  return Array.from(selectedEdgeKeys)
                    .map((pk) => edgeByPlaced.get(pk))
                    .filter((ed): ed is PlacedGridEdge => ed != null)
                    .sort((a, b) => {
                      const cmp = strokeWidthForEdge(d, b, mepById) - strokeWidthForEdge(d, a, mepById)
                      return cmp !== 0 ? cmp : placedEdgeKey(a).localeCompare(placedEdgeKey(b))
                    })
                    .map((ed) => {
                      const pk = placedEdgeKey(ed)
                      const joinD =
                        planVisualProfile?.mode === 'trade_mep'
                          ? mepJoinedDrawModel.pathDByPlacedKey.get(pk)
                          : undefined
                      const sw = Math.max(3, strokeWidthForEdge(d, ed, mepById) + 2)
                      if (joinD) {
                        if (seenJoinD.has(joinD)) return null
                        seenJoinD.add(joinD)
                        return (
                          <path
                            key={`sel-edge-join-${pk}`}
                            d={joinD}
                            fill="none"
                            stroke="#1976d2"
                            strokeWidth={sw}
                            strokeLinecap="butt"
                            strokeLinejoin="round"
                            opacity={0.85}
                            pointerEvents="none"
                          />
                        )
                      }
                      const base =
                        (ed.source ?? 'arch') === 'arch'
                          ? placedArchEdgeEndpointsCanvasPx(d, ed, delta)
                          : edgeEndpointsCanvasPx(d, ed, delta)
                      const off = mepRunOffsets.get(pk)
                      return (
                        <line
                          key={`sel-edge-${pk}`}
                          x1={base.x1 + (off?.dx ?? 0)}
                          y1={base.y1 + (off?.dy ?? 0)}
                          x2={base.x2 + (off?.dx ?? 0)}
                          y2={base.y2 + (off?.dy ?? 0)}
                          stroke="#1976d2"
                          strokeWidth={sw}
                          strokeLinecap="butt"
                          opacity={0.85}
                          pointerEvents="none"
                        />
                      )
                    })
                })()}

                {Array.from(selectedRoomEdgeKeys).map((gk) => {
                  const parsed = parseEdgeKeyString(gk)
                  if (!parsed) return null
                  const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                  return (
                    <line
                      key={`sel-room-edge-${gk}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={PLAN_ROOM_BOUNDARY_CYAN}
                      strokeWidth={Math.max(2.85, strokeWidthForRoomBoundaryLine(d) + 1.65)}
                      strokeLinecap="butt"
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
                          strokeLinecap="butt"
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
                      const base =
                        (ne.source ?? 'arch') === 'arch'
                          ? placedArchEdgeEndpointsCanvasPx(d, ne, delta)
                          : edgeEndpointsCanvasPx(d, ne, delta)
                      const off = mepRunOffsets.get(placedEdgeKey(e))
                      return (
                        <line
                          key={`mv-edge-${edgeKeyString(e)}`}
                          x1={base.x1 + (off?.dx ?? 0)}
                          y1={base.y1 + (off?.dy ?? 0)}
                          x2={base.x2 + (off?.dx ?? 0)}
                          y2={base.y2 + (off?.dy ?? 0)}
                          stroke="#1565c0"
                          strokeWidth={Math.max(2, strokeWidthForEdge(d, e, mepById))}
                          strokeLinecap="butt"
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
                        strokeLinecap="butt"
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
                    const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas({ axis, i, j })
                    return (
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#c62828"
                        strokeWidth={3}
                        strokeLinecap="butt"
                        opacity={0.85}
                        pointerEvents="none"
                      />
                    )
                  })()}

                {(isCellPaintMode || (placeMode === 'room' && roomTool !== 'autoFill')) && hoverCell && (
                  <rect
                    x={
                      planGridFns.useIrregular && planGridFns.axesIn
                        ? Math.min(
                            planGridFns.axesIn.xsIn[hoverCell.i]! * d.planScale,
                            planGridFns.axesIn.xsIn[hoverCell.i + 1]! * d.planScale,
                          )
                        : hoverCell.i * cellPx
                    }
                    y={
                      planGridFns.useIrregular && planGridFns.axesIn
                        ? Math.min(
                            planGridFns.axesIn.ysIn[hoverCell.j]! * d.planScale,
                            planGridFns.axesIn.ysIn[hoverCell.j + 1]! * d.planScale,
                          )
                        : hoverCell.j * cellPx
                    }
                    width={
                      planGridFns.useIrregular && planGridFns.axesIn
                        ? Math.abs(
                            planGridFns.axesIn.xsIn[hoverCell.i + 1]! * d.planScale -
                              planGridFns.axesIn.xsIn[hoverCell.i]! * d.planScale,
                          )
                        : cellPx
                    }
                    height={
                      planGridFns.useIrregular && planGridFns.axesIn
                        ? Math.abs(
                            planGridFns.axesIn.ysIn[hoverCell.j + 1]! * d.planScale -
                              planGridFns.axesIn.ysIn[hoverCell.j]! * d.planScale,
                          )
                        : cellPx
                    }
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
                </g>

                <g id="plan-export-annotations">
                  <title>Annotations</title>
                {annotationGridRuns.map((run) => (
                  <GridReferencePathOverlay
                    key={run.id}
                    d={d}
                    delta={delta}
                    edgeKeys={run.edgeKeys}
                    strokeWidthScale={connectionDetailVisualScale}
                    nodeAxesIn={connectionDetailNodeAxes}
                  />
                ))}
                {annotationSectionCuts.map((cut) => (
                  <SectionCutGraphic
                    key={cut.id}
                    d={d}
                    delta={delta}
                    variant={sectionCutGraphicVariant}
                    visualScale={connectionDetailVisualScale}
                    nodeAxesIn={connectionDetailNodeAxes}
                    cut={cut}
                  />
                ))}
                {annotationLabels.map((L) => {
                  const { x, y } = planInchesToCanvasPx(d, L.xIn, L.yIn)
                  const annFs = Math.max(5, 11 * connectionDetailVisualScale)
                  const annOutline = Math.max(0.45, 2 * connectionDetailVisualScale)
                  return (
                    <text
                      key={L.id}
                      x={x}
                      y={y}
                      textAnchor="start"
                      dominantBaseline="hanging"
                      fill="#0f172a"
                      stroke="#fff"
                      strokeWidth={annOutline}
                      paintOrder="stroke fill"
                      style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: annFs }}
                    >
                      {L.text}
                    </text>
                  )
                })}

                {measureRuns.map((run) => {
                  const cap = gridRunMeasureCaption(
                    run.totalPlanIn,
                    run.startNode,
                    run.endNode,
                    run.edgeKeys.length,
                    planSiteDisplayUnit,
                  )
                  return (
                    <GridPathDimensionOverlay
                      key={run.id}
                      d={d}
                      delta={delta}
                      edgeKeys={run.edgeKeys}
                      startNode={run.startNode}
                      endNode={run.endNode}
                      primary={cap.primary}
                      visualScale={connectionDetailVisualScale}
                      nodeAxesIn={connectionDetailNodeAxes}
                    />
                  )
                })}
                </g>

                <g id="plan-export-ui-annotation" pointerEvents="none">
                  <title>Selection and tool highlights</title>

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
                      strokeWidthScale={
                        sectionCutGraphicVariant === 'detailLine'
                          ? Math.max(0.1, connectionDetailVisualScale * 0.5)
                          : connectionDetailVisualScale
                      }
                      nodeAxesIn={connectionDetailNodeAxes}
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
                    strokeWidthScale={connectionDetailVisualScale}
                    nodeAxesIn={connectionDetailNodeAxes}
                  />
                )}

                {annotationTool === 'select' &&
                  hoverAnnotationSelectKey &&
                  !selectedAnnotationKeys.has(hoverAnnotationSelectKey) && (
                  <g pointerEvents="none" aria-hidden>
                    {Array.from([hoverAnnotationSelectKey]).flatMap((key) => {
                      const hi = '#ea580c'
                      const { sw, secExtra } = annotationHighlightStroke
                      if (key.startsWith('dim:')) {
                        const rest = key.slice(4)
                        const pipe = rest.indexOf('|')
                        const id = pipe >= 0 ? rest.slice(0, pipe) : rest
                        const oneEdge = pipe >= 0 ? rest.slice(pipe + 1) : null
                        const run = measureRuns.find((r) => r.id === id)
                        if (!run) return []
                        const edgeList = oneEdge
                          ? run.edgeKeys.includes(oneEdge)
                            ? [oneEdge]
                            : []
                          : run.edgeKeys
                        return edgeList.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                          return [
                            <line
                              key={`ann-hov-dim-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw}
                              strokeLinecap="butt"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('grid:')) {
                        const rest = key.slice(5)
                        const pipe = rest.indexOf('|')
                        const id = pipe >= 0 ? rest.slice(0, pipe) : rest
                        const oneEdge = pipe >= 0 ? rest.slice(pipe + 1) : null
                        const run = annotationGridRuns.find((r) => r.id === id)
                        if (!run) return []
                        const edgeList = oneEdge
                          ? run.edgeKeys.includes(oneEdge)
                            ? [oneEdge]
                            : []
                          : run.edgeKeys
                        return edgeList.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                          return [
                            <line
                              key={`ann-hov-grid-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw * 0.9}
                              strokeLinecap="butt"
                              strokeDasharray="5 4"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('sed:')) {
                        const rest = key.slice(4)
                        const pipe = rest.indexOf('|')
                        if (pipe < 0) return []
                        const ek = rest.slice(pipe + 1)
                        const parsed = parseEdgeKeyString(ek)
                        if (!parsed) return []
                        const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                        return [
                          <line
                            key={`ann-hov-sed-${ek}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={hi}
                            strokeWidth={sw}
                            strokeLinecap="butt"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('sec:')) {
                        const id = key.slice(4)
                        const cut = annotationSectionCuts.find((c) => c.id === id)
                        if (!cut) return []
                        const nodePin = (node: { i: number; j: number }) => {
                          const ax = connectionDetailNodeAxes
                          if (ax && ax.xsIn[node.i] != null && ax.ysIn[node.j] != null) {
                            return { xIn: ax.xsIn[node.i]!, yIn: ax.ysIn[node.j]! }
                          }
                          return { xIn: node.i * delta, yIn: node.j * delta }
                        }
                        const ps = nodePin(cut.startNode)
                        const pe = nodePin(cut.endNode)
                        const p1 = planInchesToCanvasPx(d, ps.xIn, ps.yIn)
                        const p2 = planInchesToCanvasPx(d, pe.xIn, pe.yIn)
                        return [
                          <line
                            key={`ann-hov-sec-${id}-ln`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={hi}
                            strokeWidth={sw + secExtra}
                            strokeLinecap="butt"
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
                            strokeLinecap="butt"
                            strokeDasharray="4 3"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('cdf:')) {
                        const ax = connectionDetailNodeAxes
                        if (!ax) return []
                        const cellKey = key.slice(4)
                        const parts = cellKey.split(':')
                        if (parts.length !== 2) return []
                        const ci = Number(parts[0])
                        const cj = Number(parts[1])
                        if (!Number.isFinite(ci) || !Number.isFinite(cj)) return []
                        const x0 = ax.xsIn[ci]
                        const x1 = ax.xsIn[ci + 1]
                        const y0 = ax.ysIn[cj]
                        const y1 = ax.ysIn[cj + 1]
                        if (x0 == null || x1 == null || y0 == null || y1 == null) return []
                        const loX = Math.min(x0, x1)
                        const hiX = Math.max(x0, x1)
                        const loY = Math.min(y0, y1)
                        const hiY = Math.max(y0, y1)
                        const p0 = planInchesToCanvasPx(d, loX, loY)
                        const p1 = planInchesToCanvasPx(d, hiX, hiY)
                        return [
                          <rect
                            key={`ann-hov-cdf-${cellKey}`}
                            x={p0.x}
                            y={p0.y}
                            width={Math.max(0.02, p1.x - p0.x)}
                            height={Math.max(0.02, p1.y - p0.y)}
                            fill="none"
                            stroke={hi}
                            strokeWidth={sw}
                            strokeDasharray="4 3"
                            rx={1}
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
                            strokeWidth={Math.max(0.35, 2 * connectionDetailVisualScale)}
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
                      const { sw, secExtra } = annotationHighlightStroke
                      if (key.startsWith('dim:')) {
                        const rest = key.slice(4)
                        const pipe = rest.indexOf('|')
                        const id = pipe >= 0 ? rest.slice(0, pipe) : rest
                        const oneEdge = pipe >= 0 ? rest.slice(pipe + 1) : null
                        const run = measureRuns.find((r) => r.id === id)
                        if (!run) return []
                        const edgeList = oneEdge
                          ? run.edgeKeys.includes(oneEdge)
                            ? [oneEdge]
                            : []
                          : run.edgeKeys
                        return edgeList.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                          return [
                            <line
                              key={`ann-sel-dim-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw}
                              strokeLinecap="butt"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('grid:')) {
                        const rest = key.slice(5)
                        const pipe = rest.indexOf('|')
                        const id = pipe >= 0 ? rest.slice(0, pipe) : rest
                        const oneEdge = pipe >= 0 ? rest.slice(pipe + 1) : null
                        const run = annotationGridRuns.find((r) => r.id === id)
                        if (!run) return []
                        const edgeList = oneEdge
                          ? run.edgeKeys.includes(oneEdge)
                            ? [oneEdge]
                            : []
                          : run.edgeKeys
                        return edgeList.flatMap((ks) => {
                          const parsed = parseEdgeKeyString(ks)
                          if (!parsed) return []
                          const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                          return [
                            <line
                              key={`ann-sel-grid-${id}-${ks}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={hi}
                              strokeWidth={sw * 0.9}
                              strokeLinecap="butt"
                              strokeDasharray="5 4"
                              opacity={0.92}
                            />,
                          ]
                        })
                      }
                      if (key.startsWith('sed:')) {
                        const rest = key.slice(4)
                        const pipe = rest.indexOf('|')
                        if (pipe < 0) return []
                        const ek = rest.slice(pipe + 1)
                        const parsed = parseEdgeKeyString(ek)
                        if (!parsed) return []
                        const { x1, y1, x2, y2 } = planGridFns.edgeEndpointsCanvas(parsed)
                        return [
                          <line
                            key={`ann-sel-sed-${ek}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={hi}
                            strokeWidth={sw}
                            strokeLinecap="butt"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('sec:')) {
                        const id = key.slice(4)
                        const cut = annotationSectionCuts.find((c) => c.id === id)
                        if (!cut) return []
                        const nodePinSel = (node: { i: number; j: number }) => {
                          const ax = connectionDetailNodeAxes
                          if (ax && ax.xsIn[node.i] != null && ax.ysIn[node.j] != null) {
                            return { xIn: ax.xsIn[node.i]!, yIn: ax.ysIn[node.j]! }
                          }
                          return { xIn: node.i * delta, yIn: node.j * delta }
                        }
                        const psS = nodePinSel(cut.startNode)
                        const peS = nodePinSel(cut.endNode)
                        const p1 = planInchesToCanvasPx(d, psS.xIn, psS.yIn)
                        const p2 = planInchesToCanvasPx(d, peS.xIn, peS.yIn)
                        return [
                          <line
                            key={`ann-sel-sec-${id}-ln`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={hi}
                            strokeWidth={sw + secExtra}
                            strokeLinecap="butt"
                            strokeDasharray="10 5"
                            opacity={0.88}
                          />,
                        ]
                      }
                      if (key.startsWith('lvl:')) {
                        const id = key.slice(4)
                        const L = elevationLevelLines.find((l) => l.id === id)
                        if (!L) return []
                        const isDrag = dragKindRef.current === 'level-line-drag' &&
                          levelLineDragIdsRef.current?.includes(id)
                        const dj2 = isDrag ? (movePreview?.dj ?? 0) : 0
                        const effJ = Math.max(0, Math.min(siteNy, L.j + dj2))
                        const yy = effJ * cellPx
                        return [
                          <line
                            key={`ann-sel-lvl-${id}`}
                            x1={GRID_TRIM}
                            y1={yy}
                            x2={cw - GRID_TRIM}
                            y2={yy}
                            stroke={hi}
                            strokeWidth={sw * 1.1}
                            strokeLinecap="butt"
                            strokeDasharray="4 3"
                            opacity={0.92}
                          />,
                        ]
                      }
                      if (key.startsWith('cdf:')) {
                        const axS = connectionDetailNodeAxes
                        if (!axS) return []
                        const cellKeyS = key.slice(4)
                        const partS = cellKeyS.split(':')
                        if (partS.length !== 2) return []
                        const ciS = Number(partS[0])
                        const cjS = Number(partS[1])
                        if (!Number.isFinite(ciS) || !Number.isFinite(cjS)) return []
                        const xa0 = axS.xsIn[ciS]
                        const xa1 = axS.xsIn[ciS + 1]
                        const ya0 = axS.ysIn[cjS]
                        const ya1 = axS.ysIn[cjS + 1]
                        if (xa0 == null || xa1 == null || ya0 == null || ya1 == null) return []
                        const lx = Math.min(xa0, xa1)
                        const hx = Math.max(xa0, xa1)
                        const ly = Math.min(ya0, ya1)
                        const hy = Math.max(ya0, ya1)
                        const q0 = planInchesToCanvasPx(d, lx, ly)
                        const q1 = planInchesToCanvasPx(d, hx, hy)
                        return [
                          <rect
                            key={`ann-sel-cdf-${cellKeyS}`}
                            x={q0.x}
                            y={q0.y}
                            width={Math.max(0.02, q1.x - q0.x)}
                            height={Math.max(0.02, q1.y - q0.y)}
                            fill="none"
                            stroke={hi}
                            strokeWidth={sw * 0.9}
                            strokeDasharray="4 3"
                            rx={1}
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
                            strokeWidth={Math.max(0.35, 2 * connectionDetailVisualScale)}
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
                </g>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
