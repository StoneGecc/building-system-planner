import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SystemData, BuildingDimensions } from '../types/system'
import type { MepItem } from '../types/mep'
import type { PlanLayoutSketch, PlanSketchCommitOptions } from '../types/planLayout'
import {
  CONNECTION_DETAIL_DEFAULT_BOUNDARY_CELLS,
  CONNECTION_DETAIL_GRID_SPACING_IN,
  emptySketch,
  layerIdentityFromCell,
  layerIdentityFromColumn,
  layerIdentityFromEdge,
  placedColumnKey,
  placedEdgeKey,
  resolvedConnectionDetailBoundaryCells,
  resolvedConnectionDetailGridSpacingIn,
  resolvedSiteInches,
} from '../types/planLayout'
import {
  PlanLayoutEditor,
  type ActiveCatalog,
  type FloorTool,
  type LayoutTool,
  type AnnotationTool,
  type RoomTool,
  type LevelOverlayEntry,
} from './PlanLayoutEditor'
import { PlanSketchLayersBar } from './PlanSketchLayersBar'
import { parseMepCsv, deriveMepItemsFromSystems } from '../lib/mepCsvParser'
import { connectionJunctionHighlightPlanInches, type PlanConnection } from '../lib/planConnections'
import { downloadSketchJson, readSketchFromFile } from '../lib/planLayoutStorage'
import {
  applySequentialAutoRoomNames,
  roomNamesEqualIgnoreCase,
  withPrunedOrphanRoomByCell,
} from '../lib/planRooms'
import {
  type PlanSiteDisplayUnit,
  PLAN_SITE_UNIT_LABELS,
  PLAN_SITE_UNIT_SHORT,
  formatSiteMeasure,
  gridInputStep,
  siteInputStep,
  inchesFromSiteDisplay,
  inchesToSiteDisplay,
  loadGridDisplayUnit,
  saveGridDisplayUnit,
  loadSiteDisplayUnit,
  saveSiteDisplayUnit,
} from '../lib/planDisplayUnits'
import { formatThickness } from '../lib/csvParser'
import { cn } from '../lib/utils'
import {
  buildPlanColorCatalog,
  type PlanPlaceMode,
  type PlanVisualProfile,
} from '../lib/planLayerColors'

/** Full-opacity arch/MEP preview for same-level underlay on trade sheets. */
const TRADE_PLAN_UNDERLAY_PROFILE: PlanVisualProfile = {
  mode: 'layout',
  tradeMepSheetId: null,
}
import {
  archSystemMatchesPlanPlaceMode,
  inferDefaultPlanPlaceModeForArchSystem,
} from '../lib/planSystemPlaceModes'
import {
  PLAN_ANNOTATIONS_LAYER_ID,
  PLAN_ROOMS_LAYER_ID,
  PLAN_ROOMS_LAYER_SOURCE,
  PLAN_ROOMS_LAYER_SYSTEM_ID,
} from '../lib/planRoomsLayerIdentity'
import {
  FLOOR1_SHEETS,
  filterMepItemsForSheet,
  levelSheetFromPageIndex,
  PLACE_MODE_LABELS,
  PLACE_MODE_TOOLTIPS,
  type Floor1VisualMode,
} from '../data/floor1Sheets'
import { isMepRunMode, isMepPointMode, isMepDisciplineMode, filterMepItemsForToolMode } from '../types/planPlaceMode'
import type { BuildingLevel } from '../types/planLayout'
import { elevationCanvasInches } from '../data/elevationSheets'
import { ToolbarGroup } from './ToolbarGroup'
import type { PaintSystemOption } from './PlanSystemPicker'
import { archEdgeSupportsPlanAssemblyStack } from '../lib/planArchEdgeLayerStack'
import {
  ImplementationPlanBottomToolbar,
  ImplementationPlanFloatingToolbar,
} from './implementationPlan/ImplementationPlanEditorToolbars'
import type { ImplementationPlanViewContext } from '@/components/implementationPlan/viewContext'
import {
  CONNECTION_DETAIL_FILL_CLEAR_VALUE,
  connectionDetailFillLayerOptionRows,
  parseConnectionDetailFillPickKey,
} from '../lib/connectionDetailFillLayerOptions'

export type { ImplementationPlanViewContext }

interface ImplementationPlanViewProps {
  buildingDimensions: BuildingDimensions
  orderedSystems: SystemData[]
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  onUndo?: () => void
  canUndo?: boolean
  onRedo?: () => void
  canRedo?: boolean
  /** Floor 1 sheet vs elevation (N/E/S/W); tools and canvas follow this context. */
  planViewContext: ImplementationPlanViewContext
  /** Resolved building height in plan inches (from floor-1 sketch or default). */
  buildingHeightIn: number
  onBuildingHeightInChange: (inches: number) => void
  /** Floor 1 layout sketch — source of truth for grid spacing (elevations use the same Δ). */
  layoutSketch: PlanLayoutSketch
  onLayoutSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  /** Save full project (Floor 1 + all elevation sketches) as one JSON file. */
  onDownloadFullPlan?: () => void
  /** Load that file back, or a legacy Floor-1-only JSON export. Returns false if invalid. */
  onImportFullPlan?: (file: File) => Promise<boolean>
  /** Per-level sketches (beyond level 0 which uses layoutSketch). */
  levelSketches?: Record<string, PlanLayoutSketch>
  /** Derived building levels from elevation level lines. */
  buildingLevels?: BuildingLevel[]
  className?: string
  /**
   * Annotation-only editor: same chrome as floor layout (Setup, toolbars, layers bar, overlays) but only the
   * Annotation layer group is available (e.g. connection detail sketches).
   */
  annotationsOnly?: boolean
  /** When `annotationsOnly`, resets tool state when this key changes (e.g. connection template id). */
  annotationsContextKey?: string
  /** Replaces the sheet label block in the top bar (connection title lines). */
  planAlternateTitle?: { primary: string; secondary?: string; tertiary?: string; tertiaryTitle?: string }
  /** When set, used for SVG/PDF export basename instead of the default floor1-/elevation- name. */
  vectorExportBasenameOverride?: string
  /** True if any connection-detail sketch has drawable content (detail grid change may need to clear them). */
  connectionDetailSketchesNonempty?: boolean
  /** After confirm, parent clears all connection-detail sketches (detail grid spacing changed). */
  onResetAllConnectionSketches?: () => void
  /** When set with `annotationsOnly`, plan canvas size matches the junction highlight on the layout. */
  connectionDetailForCanvas?: PlanConnection | null
  /** Bulk toggle CSV assembly layer visibility for every system (sections, connection strips, system table). */
  onToggleAllSystemsAssemblyLayers?: () => void
  /** Per connection-detail sheet id: hand-drawn annotations composited onto matching junctions on the floor plan. */
  connectionSketches?: Record<string, PlanLayoutSketch> | null
}

const GRID_PRESETS_IN = [4, 6, 12, 24]
const CONNECTION_DETAIL_GRID_PRESETS_IN = [1, 2, 4, 6, 12, 24]
const LEVEL_OVERLAY_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16']

/** Connection-detail annotate toolbar: detail line + select + erase. */
const CONNECTION_DETAIL_ANNOTATION_TOOLS = [
  'sectionCut',
  'flipConnectionStripLayers',
  'connectionDetailLayerFill',
  'select',
  'erase',
] as const satisfies readonly AnnotationTool[]


export function ImplementationPlanView({
  buildingDimensions,
  orderedSystems,
  sketch,
  onSketchChange,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  planViewContext,
  buildingHeightIn,
  onBuildingHeightInChange,
  layoutSketch,
  onLayoutSketchChange,
  onDownloadFullPlan,
  onImportFullPlan,
  levelSketches,
  buildingLevels,
  className,
  annotationsOnly = false,
  annotationsContextKey,
  planAlternateTitle,
  vectorExportBasenameOverride,
  connectionDetailSketchesNonempty = false,
  onResetAllConnectionSketches,
  connectionDetailForCanvas = null,
  onToggleAllSystemsAssemblyLayers,
  connectionSketches = null,
}: ImplementationPlanViewProps) {
  const [mepItems, setMepItems] = useState<MepItem[]>(() => deriveMepItemsFromSystems(orderedSystems))
  const mepIsUserOverride = useRef(false)
  const [mepFileName, setMepFileName] = useState<string | null>(null)
  const [mepError, setMepError] = useState<string | null>(null)
  const viewContextKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!mepIsUserOverride.current) {
      setMepItems(deriveMepItemsFromSystems(orderedSystems))
    }
  }, [orderedSystems])

  const floor1Sheet = useMemo(
    () =>
      planViewContext.kind === 'floor1' ? planViewContext.sheet : FLOOR1_SHEETS[0]!,
    [planViewContext],
  )

  const connectionDetailGridIn = useMemo(
    () => resolvedConnectionDetailGridSpacingIn(layoutSketch),
    [layoutSketch],
  )

  const connectionDetailBoundaryCells = useMemo(
    () => resolvedConnectionDetailBoundaryCells(layoutSketch),
    [layoutSketch],
  )

  /**
   * Padded canvas extents plus unpadded junction “core” (for outline when boundary space > 0).
   */
  const connectionDetailCanvasPackage = useMemo(() => {
    if (!annotationsOnly || !connectionDetailForCanvas || planViewContext.kind !== 'floor1') {
      return null
    }
    const mepById = new Map(mepItems.map((m) => [m.id, m]))
    const g = connectionDetailGridIn
    const j = connectionJunctionHighlightPlanInches(connectionDetailForCanvas, buildingDimensions, mepById)
    const padIn = connectionDetailBoundaryCells * g
    const coreW = Math.max(j.widthIn, g)
    const coreH = Math.max(j.depthIn, g)
    return {
      extents: { widthIn: coreW + 2 * padIn, heightIn: coreH + 2 * padIn },
      junctionCoreIn: { widthIn: coreW, heightIn: coreH },
      /** Plan-inch inset so the core is centered inside the padded sheet (boundary on all sides). */
      insetPlanIn: padIn,
      showJunctionOutline: connectionDetailBoundaryCells > 0,
    }
  }, [
    annotationsOnly,
    connectionDetailForCanvas,
    planViewContext.kind,
    mepItems,
    buildingDimensions,
    connectionDetailGridIn,
    connectionDetailBoundaryCells,
  ])

  const connectionDetailCanvasExtents = connectionDetailCanvasPackage?.extents ?? null

  const connectionDetailJunctionOutlineIn =
    connectionDetailCanvasPackage?.showJunctionOutline === true
      ? {
          ...connectionDetailCanvasPackage.junctionCoreIn,
          insetPlanIn: connectionDetailCanvasPackage.insetPlanIn,
        }
      : null

  const connectionDetailAnnotate = useMemo(
    () =>
      annotationsOnly &&
      planViewContext.kind === 'floor1' &&
      connectionDetailForCanvas != null,
    [annotationsOnly, planViewContext.kind, connectionDetailForCanvas],
  )

  /** Connection details use global detail Δ from layout; elevations use layout floor grid Δ. */
  const editorSketch = useMemo((): PlanLayoutSketch => {
    if (annotationsOnly && planViewContext.kind === 'floor1') {
      if (sketch.gridSpacingIn === connectionDetailGridIn) return sketch
      return { ...sketch, gridSpacingIn: connectionDetailGridIn }
    }
    if (planViewContext.kind !== 'elevation') return sketch
    if (sketch.gridSpacingIn === layoutSketch.gridSpacingIn) return sketch
    return { ...sketch, gridSpacingIn: layoutSketch.gridSpacingIn }
  }, [
    annotationsOnly,
    planViewContext.kind,
    sketch,
    layoutSketch.gridSpacingIn,
    connectionDetailGridIn,
  ])

  /** Ground line is shared on `layoutSketch`; merge into the sketch passed to the editor on elevations. */
  const planSketchForEditor = useMemo((): PlanLayoutSketch => {
    if (planViewContext.kind !== 'elevation') return editorSketch
    return {
      ...editorSketch,
      elevationGroundPlaneJ: layoutSketch.elevationGroundPlaneJ,
      elevationLevelLines: layoutSketch.elevationLevelLines,
    }
  }, [
    planViewContext.kind,
    editorSketch,
    layoutSketch.elevationGroundPlaneJ,
    layoutSketch.elevationLevelLines,
  ])

  const onPlanSketchCommit = useCallback(
    (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
      if (planViewContext.kind !== 'elevation') {
        onSketchChange(next, opts)
        return
      }
      const nextJ = next.elevationGroundPlaneJ
      const layoutJ = layoutSketch.elevationGroundPlaneJ
      const nextLevels = next.elevationLevelLines
      const layoutLevels = layoutSketch.elevationLevelLines
      const groundChanged = nextJ !== layoutJ
      const levelsChanged =
        JSON.stringify(nextLevels ?? []) !== JSON.stringify(layoutLevels ?? [])
      if (groundChanged || levelsChanged) {
        const nextLayout = { ...layoutSketch }
        if (groundChanged) {
          if (nextJ === undefined) delete nextLayout.elevationGroundPlaneJ
          else nextLayout.elevationGroundPlaneJ = nextJ
        }
        if (levelsChanged) {
          if (!nextLevels || nextLevels.length === 0) delete nextLayout.elevationLevelLines
          else nextLayout.elevationLevelLines = nextLevels
        }
        onLayoutSketchChange(nextLayout, opts)
      }
      const { elevationGroundPlaneJ: _gj, elevationLevelLines: _gl, ...nextBody } = next
      const { elevationGroundPlaneJ: _cj, elevationLevelLines: _cl, ...curBody } = planSketchForEditor
      const flipNext = JSON.stringify(next.planArchEdgeLayerFlipped ?? null)
      const flipCur = JSON.stringify(planSketchForEditor.planArchEdgeLayerFlipped ?? null)
      if (flipNext !== flipCur || JSON.stringify(nextBody) !== JSON.stringify(curBody)) {
        onSketchChange(nextBody as PlanLayoutSketch, opts)
      }
    },
    [
      planViewContext.kind,
      layoutSketch,
      onLayoutSketchChange,
      onSketchChange,
      planSketchForEditor,
    ],
  )

  const mepInputRef = useRef<HTMLInputElement>(null)
  const planJsonInputRef = useRef<HTMLInputElement>(null)
  const traceOverlayInputRef = useRef<HTMLInputElement>(null)

  const [traceOverlayEditMode, setTraceOverlayEditMode] = useState(false)

  const [activeCatalog, setActiveCatalog] = useState<ActiveCatalog>('arch')
  const [activeSystemId, setActiveSystemId] = useState<string>(() => orderedSystems[0]?.id ?? '')
  /** Last arch system chosen per layer tool so switching Walls ↔ Floor ↔ … restores each tool’s picker. */
  const [archSystemIdByPlaceMode, setArchSystemIdByPlaceMode] = useState<
    Partial<Record<PlanPlaceMode, string>>
  >(() => {
    const id = orderedSystems[0]?.id
    return id ? { structure: id } : {}
  })
  const [placeMode, setPlaceMode] = useState<PlanPlaceMode>('structure')
  const [roomNameDraft, setRoomNameDraft] = useState('')
  const [structureTool, setStructureTool] = useState<LayoutTool>('paint')
  const [roomTool, setRoomTool] = useState<RoomTool>('paint')
  const [selectedRoomZoneCellKeys, setSelectedRoomZoneCellKeys] = useState<string[] | null>(null)
  const [roomZoneCameraRequest, setRoomZoneCameraRequest] = useState<{
    nonce: number
    cellKeys: string[]
  } | null>(null)
  const [floorTool, setFloorTool] = useState<FloorTool>('paint')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('measureLine')
  const [connectionDetailFillPickKey, setConnectionDetailFillPickKey] = useState<string>(
    CONNECTION_DETAIL_FILL_CLEAR_VALUE,
  )
  const [annotationLabelDraft, setAnnotationLabelDraft] = useState('Label')
  /** Elevation · Level line tool: optional tag placed at the left of the line. */
  const [levelLineLabelDraft, setLevelLineLabelDraft] = useState('Level 1')
  /** Mirrored from PlanLayoutEditor (annotation Select) for toolbar label editing. */
  const [selectedAnnotationKeysFromPlan, setSelectedAnnotationKeysFromPlan] = useState<string[]>([])
  const onSelectedAnnotationKeysChange = useCallback((keys: readonly string[]) => {
    setSelectedAnnotationKeysFromPlan([...keys])
  }, [])

  const [toolbarPlanSelection, setToolbarPlanSelection] = useState<{
    edgeKeys: string[]
    columnKeys: string[]
  }>({ edgeKeys: [], columnKeys: [] })
  const onToolbarPlanSelectionChange = useCallback((p: { edgeKeys: string[]; columnKeys: string[] }) => {
    setToolbarPlanSelection(p)
  }, [])

  const [overlayLevelIds, setOverlayLevelIds] = useState<Set<string>>(new Set())
  const [levelOverlayOpacity, setLevelOverlayOpacity] = useState(0.25)
  const [showCornerConditions, setShowCornerConditions] = useState(false)

  const currentLevelId = useMemo(() => {
    if (planViewContext.kind !== 'floor1' || !buildingLevels?.length) return null
    const numLevels = buildingLevels.length
    const info = levelSheetFromPageIndex(planViewContext.sheet.pageIndex, numLevels)
    if (!info) return null
    return buildingLevels[info.levelIndex]?.id ?? null
  }, [planViewContext, buildingLevels])

  const otherLevels = useMemo(() => {
    if (!buildingLevels?.length || !currentLevelId) return []
    return buildingLevels.filter((l) => l.id !== currentLevelId)
  }, [buildingLevels, currentLevelId])

  const levelColorMap = useMemo(() => {
    const m = new Map<string, string>()
    if (!buildingLevels) return m
    for (let i = 0; i < buildingLevels.length; i++) {
      m.set(buildingLevels[i]!.id, LEVEL_OVERLAY_COLORS[i % LEVEL_OVERLAY_COLORS.length]!)
    }
    return m
  }, [buildingLevels])

  const levelOverlayEntries: LevelOverlayEntry[] = useMemo(() => {
    if (overlayLevelIds.size === 0) return []

    const sketchForOverlay = (levelId: string): PlanLayoutSketch => {
      if (levelId === '__default_level_1') return layoutSketch
      const stored = levelSketches?.[levelId]
      if (stored) return stored
      return {
        ...emptySketch(layoutSketch.gridSpacingIn),
        siteWidthIn: layoutSketch.siteWidthIn,
        siteDepthIn: layoutSketch.siteDepthIn,
        buildingHeightIn: layoutSketch.buildingHeightIn,
      }
    }

    if (planViewContext.kind === 'floor1' && floor1Sheet.visualMode === 'trade_mep' && buildingLevels?.length) {
      const orderIndex = new Map(buildingLevels.map((l, i) => [l.id, i]))
      const entries: LevelOverlayEntry[] = []
      for (const levelId of overlayLevelIds) {
        const lev = buildingLevels.find((l) => l.id === levelId)
        if (!lev) continue
        const activeHere = currentLevelId != null && levelId === currentLevelId
        entries.push({
          levelId: lev.id,
          label: lev.label,
          sketch: activeHere ? sketch : sketchForOverlay(levelId),
          color: levelColorMap.get(levelId) ?? LEVEL_OVERLAY_COLORS[0]!,
          previewVisualProfile: TRADE_PLAN_UNDERLAY_PROFILE,
        })
      }
      entries.sort((a, b) => (orderIndex.get(a.levelId) ?? 0) - (orderIndex.get(b.levelId) ?? 0))
      return entries
    }

    if (!otherLevels.length) return []
    return otherLevels
      .filter((l) => overlayLevelIds.has(l.id))
      .map((l) => ({
        levelId: l.id,
        label: l.label,
        sketch: sketchForOverlay(l.id),
        color: levelColorMap.get(l.id) ?? LEVEL_OVERLAY_COLORS[0]!,
      }))
  }, [
    otherLevels,
    overlayLevelIds,
    levelSketches,
    layoutSketch,
    levelColorMap,
    planViewContext.kind,
    floor1Sheet.visualMode,
    currentLevelId,
    sketch,
    buildingLevels,
  ])

  const toggleOverlayLevel = useCallback((levelId: string) => {
    setOverlayLevelIds((prev) => {
      const next = new Set(prev)
      if (next.has(levelId)) next.delete(levelId)
      else next.add(levelId)
      return next
    })
  }, [])

  const prevFloor1VisualModeRef = useRef<Floor1VisualMode | null>(null)
  const prevTradeOverlayLevelIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (planViewContext.kind !== 'floor1') return
    const v = floor1Sheet.visualMode
    const prevV = prevFloor1VisualModeRef.current
    prevFloor1VisualModeRef.current = v

    if (v === 'trade_mep' && currentLevelId) {
      if (prevV !== 'trade_mep') {
        setOverlayLevelIds(new Set([currentLevelId]))
      } else if (prevTradeOverlayLevelIdRef.current !== currentLevelId) {
        setOverlayLevelIds((prev) => {
          const next = new Set(prev)
          next.add(currentLevelId)
          return next
        })
      }
      prevTradeOverlayLevelIdRef.current = currentLevelId
    } else {
      prevTradeOverlayLevelIdRef.current = null
    }

    if (v !== 'trade_mep' && prevV === 'trade_mep') {
      setOverlayLevelIds(new Set())
    }
  }, [planViewContext.kind, floor1Sheet.visualMode, currentLevelId])

  const annotationSelectEditLabelId = useMemo(() => {
    if (placeMode !== 'annotate' || annotationTool !== 'select') return null
    if (selectedAnnotationKeysFromPlan.length !== 1) return null
    const k = selectedAnnotationKeysFromPlan[0]!
    return k.startsWith('lbl:') ? k.slice(4) : null
  }, [placeMode, annotationTool, selectedAnnotationKeysFromPlan])

  const annotationSelectEditLabel = useMemo(() => {
    if (!annotationSelectEditLabelId) return undefined
    return sketch.annotationLabels?.find((l) => l.id === annotationSelectEditLabelId)
  }, [annotationSelectEditLabelId, sketch.annotationLabels])

  const prevPlaceModeRef = useRef(placeMode)

  useEffect(() => {
    const prev = prevPlaceModeRef.current
    if (
      (placeMode === 'floor' || placeMode === 'roof') &&
      prev !== placeMode &&
      structureTool === 'select'
    ) {
      setFloorTool('select')
    }
    if (placeMode === 'column' && prev !== 'column') {
      setFloorTool('paint')
    }
    if (prev === 'column' && placeMode !== 'column') {
      setFloorTool((t) => (t === 'flipAssembly' ? 'paint' : t))
    }
    if (placeMode !== 'annotate' && prev === 'annotate') {
      setAnnotationTool('measureLine')
    }
    prevPlaceModeRef.current = placeMode
  }, [placeMode, structureTool])

  useEffect(() => {
    if (
      placeMode === 'floor' ||
      placeMode === 'column' ||
      placeMode === 'window' ||
      placeMode === 'door' ||
      placeMode === 'stairs' ||
      placeMode === 'roof' ||
      placeMode === 'room'
    ) {
      setActiveCatalog('arch')
    }
  }, [placeMode])

  useEffect(() => {
    if (placeMode === 'annotate' || placeMode === 'room' || isMepDisciplineMode(placeMode)) return
    if (activeCatalog !== 'arch') return
    const eligible = orderedSystems.filter((s) => archSystemMatchesPlanPlaceMode(s, placeMode))
    if (eligible.length === 0) return
    const remembered = archSystemIdByPlaceMode[placeMode]
    const preferred =
      remembered && eligible.some((s) => s.id === remembered)
        ? remembered
        : activeSystemId && eligible.some((s) => s.id === activeSystemId)
          ? activeSystemId
          : eligible[0]!.id
    if (preferred !== activeSystemId) {
      setActiveSystemId(preferred)
    }
  }, [orderedSystems, activeCatalog, activeSystemId, placeMode, archSystemIdByPlaceMode])
  const [siteDisplayUnit, setSiteDisplayUnitState] = useState<PlanSiteDisplayUnit>(() => loadSiteDisplayUnit())
  const [gridDisplayUnit, setGridDisplayUnitState] = useState<PlanSiteDisplayUnit>(() => loadGridDisplayUnit())
  const [gridDraft, setGridDraft] = useState(() =>
    formatSiteMeasure(layoutSketch.gridSpacingIn, loadGridDisplayUnit()),
  )
  const [detailGridDraft, setDetailGridDraft] = useState(() =>
    formatSiteMeasure(resolvedConnectionDetailGridSpacingIn(layoutSketch), loadGridDisplayUnit()),
  )
  const [boundaryCellsDraft, setBoundaryCellsDraft] = useState(() =>
    String(resolvedConnectionDetailBoundaryCells(layoutSketch)),
  )
  const [siteWDraft, setSiteWDraft] = useState('')
  const [siteHDraft, setSiteHDraft] = useState('')
  /** Building height (plan inches → display via `siteDisplayUnit`); stored on Floor 1 sketch for elevations. */
  const [siteHeightDraft, setSiteHeightDraft] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  const [layersBarHoverLayerId, setLayersBarHoverLayerId] = useState<string | null>(null)
  const [layersBarSelectRequest, setLayersBarSelectRequest] = useState<{
    source: ActiveCatalog
    systemId: string
    nonce: number
  } | null>(null)
  const [globalSelectAllNonce, setGlobalSelectAllNonce] = useState(0)

  const setSiteDisplayUnit = useCallback((u: PlanSiteDisplayUnit) => {
    setSiteDisplayUnitState(u)
    saveSiteDisplayUnit(u)
  }, [])

  const setGridDisplayUnit = useCallback((u: PlanSiteDisplayUnit) => {
    setGridDisplayUnitState(u)
    saveGridDisplayUnit(u)
  }, [])

  const onRoomZoneSelect = useCallback(
    (payload: { cellKeys: readonly string[]; displayName: string } | null) => {
      if (!payload) {
        setSelectedRoomZoneCellKeys(null)
        return
      }
      setSelectedRoomZoneCellKeys([...payload.cellKeys])
      setRoomNameDraft(payload.displayName)
    },
    [],
  )

  const onRoomPickNavigate = useCallback((payload: { cellKeys: readonly string[]; displayName: string }) => {
    setSelectedRoomZoneCellKeys([...payload.cellKeys])
    setRoomNameDraft(payload.displayName)
    setRoomZoneCameraRequest((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      cellKeys: [...payload.cellKeys],
    }))
  }, [])

  const applySelectedZoneRoomName = useCallback(() => {
    if (!selectedRoomZoneCellKeys?.length) return
    const label = roomNameDraft.trim()
    const prev = sketch.roomByCell ?? {}
    const already =
      label.length > 0
        ? selectedRoomZoneCellKeys.every((k) => roomNamesEqualIgnoreCase(prev[k] ?? '', label))
        : selectedRoomZoneCellKeys.every((k) => prev[k] == null || prev[k] === '')
    if (already) return
    const next: Record<string, string> = { ...prev }
    if (label) {
      for (const k of selectedRoomZoneCellKeys) next[k] = label
    } else {
      for (const k of selectedRoomZoneCellKeys) delete next[k]
    }
    onSketchChange({
      ...sketch,
      roomByCell: Object.keys(next).length > 0 ? next : undefined,
    })
  }, [selectedRoomZoneCellKeys, roomNameDraft, sketch, onSketchChange])

  const applyAutoFillAllRooms = useCallback(() => {
    const next = applySequentialAutoRoomNames(sketch, buildingDimensions, roomNameDraft)
    if (next === sketch.roomByCell) return
    onSketchChange({ ...sketch, roomByCell: next })
  }, [sketch, buildingDimensions, roomNameDraft, onSketchChange])

  const siteResolved = useMemo(() => resolvedSiteInches(sketch, buildingDimensions), [sketch, buildingDimensions])

  /** Building lot site for Setup; on connection-detail pages the live sketch is per-connection — site fields still edit Level 1. */
  const setupSiteSource = useMemo((): PlanLayoutSketch => {
    return annotationsOnly && planViewContext.kind === 'floor1' ? layoutSketch : sketch
  }, [annotationsOnly, planViewContext.kind, layoutSketch, sketch])

  const setupSiteResolved = useMemo(
    () => resolvedSiteInches(setupSiteSource, buildingDimensions),
    [setupSiteSource, buildingDimensions],
  )

  const planCanvasPx = useMemo(() => {
    if (planViewContext.kind === 'elevation') {
      const { widthIn, heightIn } = elevationCanvasInches(
        planViewContext.sheet.face,
        buildingHeightIn,
        buildingDimensions,
        layoutSketch,
      )
      return {
        w: widthIn * buildingDimensions.planScale,
        h: heightIn * buildingDimensions.planScale,
      }
    }
    if (connectionDetailCanvasExtents) {
      return {
        w: connectionDetailCanvasExtents.widthIn * buildingDimensions.planScale,
        h: connectionDetailCanvasExtents.heightIn * buildingDimensions.planScale,
      }
    }
    return {
      w: siteResolved.w * buildingDimensions.planScale,
      h: siteResolved.h * buildingDimensions.planScale,
    }
  }, [
    planViewContext,
    buildingHeightIn,
    buildingDimensions,
    layoutSketch,
    siteResolved.w,
    siteResolved.h,
    connectionDetailCanvasExtents,
  ])
  const traceMoveRange = Math.max(400, Math.ceil(Math.max(planCanvasPx.w, planCanvasPx.h) * 1.5))

  /** Elevation canvas plan inches + human hint (not rotated vs plan when N is up on the composite plan). */
  const elevationCanvasSummary = useMemo(() => {
    if (planViewContext.kind !== 'elevation') return null
    const { widthIn, heightIn } = elevationCanvasInches(
      planViewContext.sheet.face,
      buildingHeightIn,
      buildingDimensions,
      layoutSketch,
    )
    const face = planViewContext.sheet.face
    const alongFacade =
      face === 'N' || face === 'S'
        ? 'Setup / Site width (same horizontal span as Floor Layout canvas)'
        : 'Setup / Site depth (same vertical span as Floor Layout canvas)'
    return {
      widthIn,
      heightIn,
      alongFacade,
    }
  }, [planViewContext, buildingHeightIn, buildingDimensions, layoutSketch])

  const tr = sketch.traceOverlay
  const hasTraceOverlay = tr != null
  const traceOpacityPct = tr?.opacityPct ?? 45
  const traceVisible = tr?.visible !== false
  const traceTx = tr?.tx ?? 0
  const traceTy = tr?.ty ?? 0
  const traceRotateDeg = tr?.rotateDeg ?? 0
  const traceScale = tr?.scale ?? 1

  const resetTraceOverlayTransform = useCallback(() => {
    const tr = sketch.traceOverlay
    if (!tr) return
    onSketchChange(
      { ...sketch, traceOverlay: { ...tr, tx: 0, ty: 0, rotateDeg: 0, scale: 1 } },
      { skipUndo: true },
    )
  }, [sketch, onSketchChange])

  const fpW = buildingDimensions.footprintWidth
  const fpD = buildingDimensions.footprintDepth

  const layersBarActiveIdentity =
    placeMode === 'room'
      ? PLAN_ROOMS_LAYER_ID
      : placeMode === 'annotate'
        ? PLAN_ANNOTATIONS_LAYER_ID
        : `${activeCatalog}\t${activeSystemId}`

  const mepItemsForActiveSheet = useMemo(
    () => filterMepItemsForSheet(floor1Sheet, mepItems),
    [floor1Sheet, mepItems],
  )

  const vectorExportBasename = useMemo(() => {
    if (vectorExportBasenameOverride) return vectorExportBasenameOverride
    return planViewContext.kind === 'floor1'
      ? `floor1-${planViewContext.sheet.id}`
      : `elevation-${planViewContext.sheet.id}`
  }, [planViewContext, vectorExportBasenameOverride])

  const gridPresetList = GRID_PRESETS_IN

  useEffect(() => {
    const ctxKey = annotationsOnly
      ? `anno:${annotationsContextKey ?? 'default'}`
      : planViewContext.kind === 'floor1'
        ? `f1:${planViewContext.sheet.pageIndex}:${planViewContext.sheet.id}`
        : `elev:${planViewContext.sheet.face}`
    if (viewContextKeyRef.current === ctxKey) return
    viewContextKeyRef.current = ctxKey

    if (annotationsOnly) {
      setPlaceMode('annotate')
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
      setAnnotationTool(
        planViewContext.kind === 'floor1' && connectionDetailForCanvas
          ? 'sectionCut'
          : 'measureLine',
      )
      setTraceOverlayEditMode(false)
      return
    }

    if (planViewContext.kind === 'elevation') {
      setPlaceMode('annotate')
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
      setAnnotationTool('groundLine')
      setTraceOverlayEditMode(false)
      return
    }

    setAnnotationTool((prev) =>
      prev === 'groundLine' || prev === 'levelLine' ? 'measureLine' : prev,
    )

    const vis = floor1Sheet.visiblePlaceModes
    const filtered = filterMepItemsForSheet(floor1Sheet, mepItems)
    let next: PlanPlaceMode = floor1Sheet.defaultPlaceMode
    const needsMepRows =
      next === 'mep' || (floor1Sheet.allowsMepEditing && isMepRunMode(next))
    if (needsMepRows && (!floor1Sheet.allowsMepEditing || filtered.length === 0)) {
      next = vis.has('annotate')
        ? 'annotate'
        : vis.has('structure')
          ? 'structure'
          : [...vis][0]!
    }
    if (!vis.has(next)) {
      next = [...vis][0]!
    }
    setPlaceMode(next)
    if (next === 'mep' || isMepDisciplineMode(next)) {
      setActiveCatalog('mep')
      setActiveSystemId(filtered[0]?.id ?? '')
    } else {
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
    setTraceOverlayEditMode(false)
  }, [
    planViewContext,
    floor1Sheet,
    mepItems,
    orderedSystems,
    annotationsOnly,
    annotationsContextKey,
    connectionDetailForCanvas,
  ])

  useEffect(() => {
    if (!connectionDetailAnnotate) return
    if (
      annotationTool !== 'sectionCut' &&
      annotationTool !== 'flipConnectionStripLayers' &&
      annotationTool !== 'connectionDetailLayerFill' &&
      annotationTool !== 'select' &&
      annotationTool !== 'erase'
    ) {
      setAnnotationTool('sectionCut')
    }
  }, [connectionDetailAnnotate, annotationTool])

  /**
   * MEP run/point tools use `activeLayerId` = mep\t{systemId}.
   * Never force placeMode back to Annotate when the discipline filter is empty — that made every non-annotation
   * layer button appear to “snap back” after one render. Arch modes must use arch catalog so walls/floor tools work.
   */
  useEffect(() => {
    if (annotationsOnly) return
    const useMepCatalog = isMepDisciplineMode(placeMode)
    if (useMepCatalog) {
      if (activeCatalog !== 'mep') {
        setActiveCatalog('mep')
        const first = mepItemsForActiveSheet[0]?.id
        if (first) setActiveSystemId(first)
        return
      }
      if (mepItemsForActiveSheet.length > 0) {
        if (!mepItemsForActiveSheet.some((m) => m.id === activeSystemId)) {
          setActiveSystemId(mepItemsForActiveSheet[0]!.id)
        }
      }
      return
    }
    if (activeCatalog === 'mep') {
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
  }, [
    placeMode,
    activeCatalog,
    activeSystemId,
    mepItemsForActiveSheet,
    orderedSystems,
    annotationsOnly,
  ])

  const onLayersBarLayerActivate = useCallback(
    (source: ActiveCatalog, systemId: string) => {
      if (annotationsOnly) return
      /* Elevation sheets only support annotations; arch/MEP rows are for context — use Annotation + layers “Annotations” row. */
      if (planViewContext.kind === 'elevation') return
      if (source === 'mep' && !floor1Sheet.allowsMepEditing) return
      if (source === PLAN_ROOMS_LAYER_SOURCE && systemId === PLAN_ROOMS_LAYER_SYSTEM_ID) {
        setPlaceMode('room')
        setRoomTool('select')
        setActiveCatalog('arch')
        setTraceOverlayEditMode(false)
        setLayersBarSelectRequest((prev) => ({
          source: 'arch',
          systemId: PLAN_ROOMS_LAYER_SYSTEM_ID,
          nonce: (prev?.nonce ?? 0) + 1,
        }))
        return
      }
      const lid = `${source}\t${systemId}`
      const layerEdges = sketch.edges.filter((e) => layerIdentityFromEdge(e) === lid)
      const cellsOfLayer = (sketch.cells ?? []).filter((c) => layerIdentityFromCell(c) === lid)
      const cellCount = cellsOfLayer.length
      const colsOfLayer = (sketch.columns ?? []).filter((c) => layerIdentityFromColumn(c) === lid)

      let nextPlaceMode: PlanPlaceMode = 'structure'
      if (source === 'mep') {
        nextPlaceMode = floor1Sheet.visiblePlaceModes.has('mep')
          ? 'mep'
          : floor1Sheet.defaultPlaceMode
      } else if (layerEdges.length > 0) {
        const kinds = new Set(layerEdges.map((e) => e.kind ?? 'wall'))
        if (kinds.size === 1) {
          const only = [...kinds][0]!
          if (only === 'window') nextPlaceMode = 'window'
          else if (only === 'door') nextPlaceMode = 'door'
          else if (only === 'roof') nextPlaceMode = 'roof'
          else if (only === 'stairs') nextPlaceMode = 'stairs'
          else nextPlaceMode = 'structure'
        } else {
          const sys = orderedSystems.find((x) => x.id === systemId)
          nextPlaceMode = sys ? inferDefaultPlanPlaceModeForArchSystem(sys) : 'structure'
        }
      } else if (colsOfLayer.length > 0 && cellCount === 0) {
        nextPlaceMode = 'column'
      } else if (cellCount > 0) {
        const stairOnly =
          cellsOfLayer.length > 0 && cellsOfLayer.every((c) => c.cellKind === 'stairs')
        const roofOnly =
          cellsOfLayer.length > 0 && cellsOfLayer.every((c) => c.cellKind === 'roof')
        nextPlaceMode = stairOnly ? 'stairs' : roofOnly ? 'roof' : 'floor'
      } else if (source === 'arch') {
        const sys = orderedSystems.find((x) => x.id === systemId)
        nextPlaceMode = sys ? inferDefaultPlanPlaceModeForArchSystem(sys) : 'structure'
      } else {
        nextPlaceMode = 'structure'
      }
      setPlaceMode(nextPlaceMode)
      setActiveCatalog(source)
      setActiveSystemId(systemId)
      if (source === 'arch') {
        setArchSystemIdByPlaceMode((prev) => ({ ...prev, [nextPlaceMode]: systemId }))
      }
      setStructureTool('select')
      setFloorTool(
        nextPlaceMode === 'column'
          ? 'paint'
          : nextPlaceMode === 'floor' || nextPlaceMode === 'stairs' || nextPlaceMode === 'roof'
            ? 'paint'
            : 'select',
      )
      setTraceOverlayEditMode(false)
      setLayersBarSelectRequest((prev) => ({
        source,
        systemId,
        nonce: (prev?.nonce ?? 0) + 1,
      }))
    },
    [
      sketch.edges,
      sketch.cells,
      sketch.columns,
      orderedSystems,
      floor1Sheet.allowsMepEditing,
      floor1Sheet.defaultPlaceMode,
      floor1Sheet.visiblePlaceModes,
      planViewContext.kind,
      annotationsOnly,
    ],
  )

  useEffect(() => {
    setGridDraft(formatSiteMeasure(layoutSketch.gridSpacingIn, gridDisplayUnit))
  }, [layoutSketch.gridSpacingIn, gridDisplayUnit])

  useEffect(() => {
    setDetailGridDraft(formatSiteMeasure(connectionDetailGridIn, gridDisplayUnit))
  }, [connectionDetailGridIn, gridDisplayUnit])

  useEffect(() => {
    setBoundaryCellsDraft(String(resolvedConnectionDetailBoundaryCells(layoutSketch)))
  }, [layoutSketch])

  useEffect(() => {
    const wIn =
      setupSiteSource.siteWidthIn != null && Number.isFinite(setupSiteSource.siteWidthIn)
        ? setupSiteSource.siteWidthIn
        : setupSiteResolved.w
    const hIn =
      setupSiteSource.siteDepthIn != null && Number.isFinite(setupSiteSource.siteDepthIn)
        ? setupSiteSource.siteDepthIn
        : setupSiteResolved.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
    setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
  }, [
    setupSiteSource.siteWidthIn,
    setupSiteSource.siteDepthIn,
    setupSiteResolved.w,
    setupSiteResolved.h,
    siteDisplayUnit,
    buildingHeightIn,
  ])

  useEffect(() => {
    if (activeCatalog === 'arch' && !orderedSystems.some((s) => s.id === activeSystemId)) {
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
    if (activeCatalog === 'mep' && mepItems.length > 0) {
      if (floor1Sheet.allowsMepEditing) {
        if (mepItemsForActiveSheet.length > 0) {
          if (!mepItemsForActiveSheet.some((m) => m.id === activeSystemId)) {
            setActiveSystemId(mepItemsForActiveSheet[0]!.id)
          }
        }
      } else if (!mepItems.some((m) => m.id === activeSystemId)) {
        setActiveSystemId(mepItems[0]!.id)
      }
    }
  }, [
    orderedSystems,
    mepItems,
    mepItemsForActiveSheet,
    floor1Sheet.allowsMepEditing,
    activeCatalog,
    activeSystemId,
  ])

  const trySetGridSpacing = useCallback(
    (nextDelta: number) => {
      if (!Number.isFinite(nextDelta) || nextDelta <= 0) return
      const base = layoutSketch
      const hasCells = (base.cells ?? []).length > 0
      if ((base.edges.length > 0 || hasCells) && Math.abs(nextDelta - base.gridSpacingIn) > 1e-6) {
        if (!window.confirm('Changing grid spacing clears all walls and floor fills. Continue?')) return
        onLayoutSketchChange({
          ...base,
          gridSpacingIn: nextDelta,
          edges: [],
          cells: [],
          measureRuns: [],
          annotationGridRuns: undefined,
          annotationLabels: undefined,
          annotationSectionCuts: undefined,
          roomBoundaryEdges: undefined,
          roomByCell: undefined,
        })
        return
      }
      onLayoutSketchChange({ ...base, gridSpacingIn: nextDelta })
    },
    [layoutSketch, onLayoutSketchChange],
  )

  const trySetConnectionDetailGridSpacing = useCallback(
    (nextDelta: number) => {
      if (!Number.isFinite(nextDelta) || nextDelta <= 0) return
      const cur = resolvedConnectionDetailGridSpacingIn(layoutSketch)
      if (Math.abs(nextDelta - cur) < 1e-6) return
      if (connectionDetailSketchesNonempty) {
        if (
          !window.confirm(
            'Changing the connection detail grid spacing clears all connection detail drawings. Continue?',
          )
        ) {
          return
        }
        onResetAllConnectionSketches?.()
      }
      const base = layoutSketch
      if (Math.abs(nextDelta - CONNECTION_DETAIL_GRID_SPACING_IN) < 1e-6) {
        const { connectionDetailGridSpacingIn: _omit, ...rest } = base
        onLayoutSketchChange(rest as PlanLayoutSketch)
      } else {
        onLayoutSketchChange({ ...base, connectionDetailGridSpacingIn: nextDelta })
      }
    },
    [
      layoutSketch,
      onLayoutSketchChange,
      connectionDetailSketchesNonempty,
      onResetAllConnectionSketches,
    ],
  )

  const trySetConnectionDetailBoundaryCells = useCallback(
    (nextCells: number) => {
      if (!Number.isFinite(nextCells)) return
      const clamped = Math.max(0, Math.min(48, Math.round(nextCells)))
      const base = layoutSketch
      if (clamped === CONNECTION_DETAIL_DEFAULT_BOUNDARY_CELLS) {
        const { connectionDetailBoundaryCells: _omit, ...rest } = base
        onLayoutSketchChange(rest as PlanLayoutSketch)
      } else {
        onLayoutSketchChange({ ...base, connectionDetailBoundaryCells: clamped })
      }
    },
    [layoutSketch, onLayoutSketchChange],
  )

  const applyBoundaryCellsDraftFromInput = useCallback(() => {
    const n = Math.round(Number(boundaryCellsDraft))
    if (!Number.isFinite(n) || n < 0 || n > 48) {
      setBoundaryCellsDraft(String(resolvedConnectionDetailBoundaryCells(layoutSketch)))
      return
    }
    trySetConnectionDetailBoundaryCells(n)
  }, [boundaryCellsDraft, layoutSketch, trySetConnectionDetailBoundaryCells])

  const syncSiteDraftsFromSketch = useCallback(() => {
    const res = resolvedSiteInches(setupSiteSource, buildingDimensions)
    const wIn =
      setupSiteSource.siteWidthIn != null && Number.isFinite(setupSiteSource.siteWidthIn)
        ? setupSiteSource.siteWidthIn
        : res.w
    const hIn =
      setupSiteSource.siteDepthIn != null && Number.isFinite(setupSiteSource.siteDepthIn)
        ? setupSiteSource.siteDepthIn
        : res.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
    setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
  }, [setupSiteSource, buildingDimensions, siteDisplayUnit, buildingHeightIn])

  const tryApplySiteDims = useCallback(() => {
    const wIn = inchesFromSiteDisplay(Number(siteWDraft), siteDisplayUnit)
    const hIn = inchesFromSiteDisplay(Number(siteHDraft), siteDisplayUnit)
    if (!Number.isFinite(wIn) || !Number.isFinite(hIn) || wIn < fpW || hIn < fpD) {
      syncSiteDraftsFromSketch()
      return
    }
    const tol = 1e-3
    if (Math.abs(wIn - fpW) < tol && Math.abs(hIn - fpD) < tol) {
      if (annotationsOnly && planViewContext.kind === 'floor1') {
        onLayoutSketchChange({ ...layoutSketch, siteWidthIn: undefined, siteDepthIn: undefined })
        return
      }
      onSketchChange({ ...sketch, siteWidthIn: undefined, siteDepthIn: undefined })
      return
    }
    if (annotationsOnly && planViewContext.kind === 'floor1') {
      onLayoutSketchChange({ ...layoutSketch, siteWidthIn: wIn, siteDepthIn: hIn })
      return
    }
    onSketchChange({ ...sketch, siteWidthIn: wIn, siteDepthIn: hIn })
  }, [
    siteWDraft,
    siteHDraft,
    fpW,
    fpD,
    sketch,
    onSketchChange,
    syncSiteDraftsFromSketch,
    siteDisplayUnit,
    annotationsOnly,
    planViewContext.kind,
    layoutSketch,
    onLayoutSketchChange,
  ])

  const tryApplyBuildingHeight = useCallback(() => {
    const raw = Number(siteHeightDraft)
    if (!Number.isFinite(raw) || raw <= 0) {
      setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
      return
    }
    const inches = inchesFromSiteDisplay(raw, siteDisplayUnit)
    if (!Number.isFinite(inches) || inches <= 0) {
      setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
      return
    }
    const maxIn = 2000 * 12
    if (inches > maxIn) {
      setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
      return
    }
    onBuildingHeightInChange(inches)
  }, [siteHeightDraft, buildingHeightIn, siteDisplayUnit, onBuildingHeightInChange])

  const minGridDisplay = useMemo(() => inchesToSiteDisplay(0.25, gridDisplayUnit), [gridDisplayUnit])
  const minSiteWDisplay = useMemo(() => inchesToSiteDisplay(fpW, siteDisplayUnit), [fpW, siteDisplayUnit])
  const minSiteDDisplay = useMemo(() => inchesToSiteDisplay(fpD, siteDisplayUnit), [fpD, siteDisplayUnit])
  const minHeightDisplay = useMemo(() => inchesToSiteDisplay(0.25, siteDisplayUnit), [siteDisplayUnit])

  const applyGridDraftFromInput = useCallback(() => {
    const nIn = inchesFromSiteDisplay(Number(gridDraft), gridDisplayUnit)
    if (!Number.isFinite(nIn) || nIn < 0.25) {
      setGridDraft(formatSiteMeasure(layoutSketch.gridSpacingIn, gridDisplayUnit))
      return
    }
    trySetGridSpacing(nIn)
  }, [gridDraft, gridDisplayUnit, layoutSketch.gridSpacingIn, trySetGridSpacing])

  const applyDetailGridDraftFromInput = useCallback(() => {
    const nIn = inchesFromSiteDisplay(Number(detailGridDraft), gridDisplayUnit)
    if (!Number.isFinite(nIn) || nIn < 0.25) {
      setDetailGridDraft(formatSiteMeasure(connectionDetailGridIn, gridDisplayUnit))
      return
    }
    trySetConnectionDetailGridSpacing(nIn)
  }, [detailGridDraft, gridDisplayUnit, connectionDetailGridIn, trySetConnectionDetailGridSpacing])

  const onMepFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const { items, errors } = parseMepCsv(text)
      if (errors.length) {
        setMepError(errors.join(' '))
        setMepItems([])
        setMepFileName(null)
        return
      }
      setMepError(null)
      setMepItems(items)
      setMepFileName(f.name)
      mepIsUserOverride.current = true
      if (items.length && floor1Sheet.allowsMepEditing) {
        const filtered = filterMepItemsForSheet(floor1Sheet, items)
        if (filtered.length) {
          setActiveCatalog('mep')
          setActiveSystemId(filtered[0]!.id)
          setPlaceMode(
            floor1Sheet.visiblePlaceModes.has('mep')
              ? 'mep'
              : floor1Sheet.defaultPlaceMode,
          )
        }
      }
    }
    reader.readAsText(f)
  }, [floor1Sheet])

  const clearMep = useCallback(() => {
    mepIsUserOverride.current = false
    setMepItems(deriveMepItemsFromSystems(orderedSystems))
    setMepFileName(null)
    setMepError(null)
    setPlaceMode((m) => {
      if (m === 'mep' || isMepDisciplineMode(m)) {
        return floor1Sheet.visiblePlaceModes.has('annotate') ? 'annotate' : 'structure'
      }
      return m
    })
    setActiveCatalog('arch')
    setActiveSystemId(orderedSystems[0]?.id ?? '')
  }, [orderedSystems, floor1Sheet.visiblePlaceModes])

  const onPlanJsonFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f) return
      if (onImportFullPlan) {
        const ok = await onImportFullPlan(f)
        if (!ok) {
          alert(
            'Could not read that file. Use a plan file saved from this app (JSON), or a Level 1–only layout export.',
          )
        }
        return
      }
      const loaded = await readSketchFromFile(f)
      if (!loaded) {
        alert('Invalid layout JSON.')
        return
      }
      onSketchChange(withPrunedOrphanRoomByCell(loaded, buildingDimensions))
    },
    [buildingDimensions, onImportFullPlan, onSketchChange],
  )

  const onTraceOverlayFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const mime = (f.type || '').toLowerCase()
    const okMime = mime === 'image/jpeg' || mime === 'image/png'
    const okExt = /\.(jpe?g|png)$/i.test(f.name)
    if (!okMime && !okExt) {
      alert('Please choose a JPEG or PNG image.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const u = typeof reader.result === 'string' ? reader.result : ''
      if (!u) return
      onSketchChange({
        ...sketch,
        traceOverlay: {
          imageDataUrl: u,
          visible: true,
          opacityPct: 45,
          tx: 0,
          ty: 0,
          rotateDeg: 0,
          scale: 1,
        },
      })
      setTraceOverlayEditMode(false)
    }
    reader.readAsDataURL(f)
  }, [sketch, onSketchChange])

  const planColorCatalog = useMemo(
    () => buildPlanColorCatalog(orderedSystems, mepItems),
    [orderedSystems, mepItems],
  )

  const connectionDetailFillLayerRows = useMemo(() => {
    if (!connectionDetailForCanvas) return []
    return connectionDetailFillLayerOptionRows(
      connectionDetailForCanvas,
      orderedSystems,
      mepItems,
      planColorCatalog,
    )
  }, [connectionDetailForCanvas, orderedSystems, mepItems, planColorCatalog])

  const connectionDetailLayerFillPick = useMemo(() => {
    if (!connectionDetailAnnotate) return null
    return parseConnectionDetailFillPickKey(connectionDetailFillPickKey)
  }, [connectionDetailAnnotate, connectionDetailFillPickKey])

  useEffect(() => {
    setConnectionDetailFillPickKey(CONNECTION_DETAIL_FILL_CLEAR_VALUE)
  }, [connectionDetailForCanvas?.id])

  useEffect(() => {
    if (connectionDetailFillLayerRows.length === 0) return
    if (connectionDetailFillLayerRows.some((r) => r.value === connectionDetailFillPickKey)) return
    setConnectionDetailFillPickKey(connectionDetailFillLayerRows[0]!.value)
  }, [connectionDetailFillLayerRows, connectionDetailFillPickKey])

  const systemOptions = useMemo((): PaintSystemOption[] => {
    const mepOption = (m: MepItem): PaintSystemOption => ({
      value: `mep:${m.id}`,
      title: `[MEP] ${m.id} — ${m.name}`,
      detail: m.planWidthIn > 0 ? formatThickness(m.planWidthIn) : undefined,
      catalog: 'mep' as const,
      id: m.id,
    })
    if (placeMode === 'annotate') {
      return []
    }
    if (placeMode === 'room') {
      return []
    }
    if (placeMode === 'mep' || isMepDisciplineMode(placeMode)) {
      const filtered = isMepDisciplineMode(placeMode)
        ? filterMepItemsForToolMode(mepItemsForActiveSheet, placeMode)
        : mepItemsForActiveSheet
      return filtered.map(mepOption)
    }
    const archSystems = orderedSystems.filter((s) => archSystemMatchesPlanPlaceMode(s, placeMode))
    const arch = archSystems.map((s) => {
      const th = buildingDimensions.thicknessBySystem[s.id] ?? 6
      return {
        value: `arch:${s.id}`,
        title: `${s.id} — ${s.name}`,
        detail: formatThickness(th),
        catalog: 'arch' as const,
        id: s.id,
      }
    })
    if (placeMode !== 'structure') return arch
    return arch
  }, [
    buildingDimensions.thicknessBySystem,
    orderedSystems,
    mepItemsForActiveSheet,
    placeMode,
  ])

  const selectValue = `${activeCatalog}:${activeSystemId}`

  useEffect(() => {
    if (systemOptions.length === 0) return
    if (!systemOptions.some((o) => o.value === selectValue)) {
      const first = systemOptions[0]!
      setActiveCatalog(first.catalog)
      setActiveSystemId(first.id)
    }
  }, [systemOptions, selectValue])

  const onSelectSystem = useCallback((raw: string) => {
    const [cat, ...rest] = raw.split(':')
    const id = rest.join(':')
    if (cat === 'arch') {
      setActiveCatalog('arch')
      setActiveSystemId(id)
      if (
        placeMode !== 'annotate' &&
        placeMode !== 'room' &&
        placeMode !== 'mep' &&
        !isMepDisciplineMode(placeMode)
      ) {
        setArchSystemIdByPlaceMode((prev) => ({ ...prev, [placeMode]: id }))
      }
    } else if (cat === 'mep') {
      setActiveCatalog('mep')
      setActiveSystemId(id)
    }
  }, [placeMode])

  const btnBase =
    'font-mono text-[8px] px-2 py-0.5 border uppercase tracking-wide transition-colors'
  const btnIdle = `${btnBase} border-border hover:bg-muted`
  const btnOn = `${btnBase} border-foreground bg-foreground text-white`

  const setupSectionTitle = 'font-mono text-[10px] font-bold tracking-widest uppercase text-foreground'
  const setupHelp = 'font-mono text-[9px] text-muted-foreground leading-relaxed max-w-xl'

  const layerBtnOn = (mode: PlanPlaceMode) =>
    !traceOverlayEditMode && placeMode === mode ? btnOn : btnIdle

  const handleGlobalSelectAll = useCallback(() => {
    if (setupOpen) return
    if (traceOverlayEditMode && hasTraceOverlay) return
    if (annotationsOnly) {
      setAnnotationTool('select')
      setGlobalSelectAllNonce((n) => n + 1)
      return
    }
    if (planViewContext.kind === 'elevation') {
      setAnnotationTool('select')
      setGlobalSelectAllNonce((n) => n + 1)
      return
    }
    if (isMepRunMode(placeMode)) {
      setStructureTool('select')
    } else if (isMepPointMode(placeMode)) {
      setFloorTool('select')
    } else {
      switch (placeMode) {
        case 'structure':
        case 'window':
        case 'door':
        case 'roof':
          setStructureTool('select')
          break
        case 'floor':
        case 'stairs':
        case 'column':
          setFloorTool('select')
          break
        case 'room':
          setRoomTool('select')
          break
        case 'annotate':
          setAnnotationTool('select')
          break
      }
    }
    setGlobalSelectAllNonce((n) => n + 1)
  }, [
    setupOpen,
    traceOverlayEditMode,
    hasTraceOverlay,
    planViewContext.kind,
    placeMode,
    annotationsOnly,
  ])

  const showLayerMode = (mode: PlanPlaceMode) =>
    annotationsOnly ? mode === 'annotate' : floor1Sheet.visiblePlaceModes.has(mode)

  const planVisualProfile =
    planViewContext.kind === 'elevation'
      ? { mode: 'layout' as const, tradeMepSheetId: null }
      : floor1Sheet.visualMode === 'layout'
        ? { mode: 'layout' as const, tradeMepSheetId: null }
        : floor1Sheet.visualMode === 'interior'
          ? { mode: 'interior' as const, tradeMepSheetId: null }
          : {
              mode: 'trade_mep' as const,
              tradeMepSheetId: floor1Sheet.mepDisciplineFilterSheet,
            }

  const planToolbarOffset = useMemo(() => {
    if (traceOverlayEditMode) return null
    const hideTrade = planVisualProfile.mode === 'trade_mep' && planViewContext.kind !== 'elevation'

    const edgeLayerToolbar =
      placeMode !== 'floor' &&
      placeMode !== 'stairs' &&
      placeMode !== 'roof' &&
      placeMode !== 'column' &&
      placeMode !== 'annotate' &&
      placeMode !== 'room' &&
      !isMepPointMode(placeMode)

    if (
      !hideTrade &&
      edgeLayerToolbar &&
      !isMepRunMode(placeMode) &&
      structureTool === 'select' &&
      toolbarPlanSelection.edgeKeys.length > 0
    ) {
      const sel = new Set(toolbarPlanSelection.edgeKeys)
      const anyArch = planSketchForEditor.edges.some(
        (e) => sel.has(placedEdgeKey(e)) && archEdgeSupportsPlanAssemblyStack(e),
      )
      if (anyArch) {
        return {
          kind: 'edge' as const,
          applyPerp: (perpIn: number) => {
            onPlanSketchCommit({
              ...planSketchForEditor,
              edges: planSketchForEditor.edges.map((e) => {
                if (!sel.has(placedEdgeKey(e)) || !archEdgeSupportsPlanAssemblyStack(e)) return e
                return { ...e, perpOffsetPlanIn: perpIn }
              }),
            })
          },
          clear: () => {
            onPlanSketchCommit({
              ...planSketchForEditor,
              edges: planSketchForEditor.edges.map((e) => {
                if (!sel.has(placedEdgeKey(e)) || !archEdgeSupportsPlanAssemblyStack(e)) return e
                const next = { ...e }
                delete next.perpOffsetPlanIn
                return next
              }),
            })
          },
        }
      }
    }

    if (
      !hideTrade &&
      placeMode === 'column' &&
      floorTool === 'select' &&
      toolbarPlanSelection.columnKeys.length > 0
    ) {
      const sel = new Set(toolbarPlanSelection.columnKeys)
      return {
        kind: 'column' as const,
        apply: (dxIn: number, dyIn: number) => {
          onPlanSketchCommit({
            ...planSketchForEditor,
            columns: (planSketchForEditor.columns ?? []).map((c) =>
              sel.has(placedColumnKey(c)) ? { ...c, offsetXPlanIn: dxIn, offsetYPlanIn: dyIn } : c,
            ),
          })
        },
        clear: () => {
          onPlanSketchCommit({
            ...planSketchForEditor,
            columns: (planSketchForEditor.columns ?? []).map((c) => {
              if (!sel.has(placedColumnKey(c))) return c
              const next = { ...c }
              delete next.offsetXPlanIn
              delete next.offsetYPlanIn
              return next
            }),
          })
        },
      }
    }

    return null
  }, [
    traceOverlayEditMode,
    planVisualProfile.mode,
    planViewContext.kind,
    placeMode,
    structureTool,
    floorTool,
    toolbarPlanSelection,
    planSketchForEditor,
    onPlanSketchCommit,
  ])

  const allAssemblyLayersShown = useMemo(
    () =>
      orderedSystems.length > 0 &&
      orderedSystems.every((s) => s.layers.length === 0 || s.layers.every((l) => l.visible !== false)),
    [orderedSystems],
  )
  const hasCatalogAssemblyLayers = useMemo(
    () => orderedSystems.some((s) => s.layers.length > 0),
    [orderedSystems],
  )

  useEffect(() => {
    if (!allAssemblyLayersShown) {
      if (structureTool === 'flipAssembly') setStructureTool('paint')
      if (floorTool === 'flipAssembly') setFloorTool('paint')
    }
  }, [allAssemblyLayersShown, structureTool, floorTool])

  useEffect(() => {
    if (isMepRunMode(placeMode) && structureTool === 'flipAssembly') {
      setStructureTool('paint')
    }
  }, [placeMode, structureTool])

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', className)}>
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-border bg-white shrink-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-0">
          <div className="flex flex-col min-w-0">
            {planAlternateTitle ? (
              <>
                <span className="font-mono text-[9px] font-bold tracking-widest uppercase text-foreground">
                  {planAlternateTitle.primary}
                </span>
                {planAlternateTitle.secondary ? (
                  <span className="font-mono text-[8px] text-muted-foreground tracking-wide max-w-[min(100%,42rem)]">
                    {planAlternateTitle.secondary}
                  </span>
                ) : null}
                {planAlternateTitle.tertiary ? (
                  <span
                    className="font-mono text-[8px] text-foreground/85 max-w-[min(100%,42rem)] leading-snug"
                    title={planAlternateTitle.tertiaryTitle ?? planAlternateTitle.tertiary}
                  >
                    {planAlternateTitle.tertiary}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span className="font-mono text-[9px] font-bold tracking-widest uppercase text-foreground">
                  {planViewContext.kind === 'elevation'
                    ? `Elevation ${planViewContext.sheet.face}`
                    : floor1Sheet.label}
                </span>
                {elevationCanvasSummary && (
                  <span
                    className="font-mono text-[8px] text-muted-foreground leading-snug max-w-[min(100%,42rem)]"
                    title="Canvas axes: left–right = along the façade on the plan; top–bottom = building height. Same grid spacing as Floor Layout."
                  >
                    Canvas{' '}
                    {formatSiteMeasure(elevationCanvasSummary.widthIn, 'ft', 3)} wide ×{' '}
                    {formatSiteMeasure(elevationCanvasSummary.heightIn, 'ft', 3)} tall · horizontal ={' '}
                    {elevationCanvasSummary.alongFacade}
                  </span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSetupOpen((o) => !o)}
            className={setupOpen ? btnOn : btnIdle}
            title={setupOpen ? 'Return to the plan editor' : 'Grid, site, MEP override, import / export'}
          >
            {setupOpen ? 'Back to plan' : 'Setup'}
          </button>
          <div className="flex-1 min-w-[1rem]" />
          <button
            type="button"
            disabled={setupOpen || (traceOverlayEditMode && hasTraceOverlay)}
            onClick={handleGlobalSelectAll}
            className={`${btnIdle} disabled:opacity-40`}
            title={
              setupOpen
                ? 'Available when the plan editor is visible'
                : traceOverlayEditMode && hasTraceOverlay
                  ? 'Finish trace overlay adjust first'
                  : connectionDetailAnnotate
                    ? 'Select all annotations on this connection sheet (detail lines, labels, …) — switches to Select'
                    : 'Select everything on the current layer tool (all walls, floor cells, room lines, annotations, …) — switches to Select where needed'
            }
          >
            Select all
          </button>
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => onUndo?.()}
            className={`${btnIdle} disabled:opacity-40`}
            title="Undo (⌘Z or Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={() => onRedo?.()}
            className={`${btnIdle} disabled:opacity-40`}
            title="Redo (⌘⇧Z, Ctrl+Shift+Z, or Ctrl+Y)"
          >
            Redo
          </button>
        </div>

        {!setupOpen && (
          <div className="flex flex-col lg:flex-row lg:items-start gap-2 lg:justify-between min-w-0">
            <div className="flex flex-wrap items-stretch gap-2 min-w-0 flex-1">
              <input
                ref={traceOverlayInputRef}
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                className="hidden"
                onChange={onTraceOverlayFile}
              />
              <ToolbarGroup title="Layer">
                {planViewContext.kind !== 'elevation' && showLayerMode('structure') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('structure')
                    }}
                    className={layerBtnOn('structure')}
                  >
                    Walls
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('roof') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('roof')
                      setFloorTool('paint')
                    }}
                    className={layerBtnOn('roof')}
                  >
                    Roof
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('window') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('window')
                    }}
                    className={layerBtnOn('window')}
                  >
                    Windows
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('door') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('door')
                    }}
                    className={layerBtnOn('door')}
                  >
                    Doors
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('stairs') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('stairs')
                      setFloorTool('paint')
                    }}
                    className={layerBtnOn('stairs')}
                    title="Paint full grid squares for stairs (same tools as Floor: Paint / Erase / Select)"
                  >
                    Stairs
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('mep') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('mep')
                    }}
                    disabled={mepItems.length === 0 || mepItemsForActiveSheet.length === 0}
                    title={
                      mepItems.length === 0
                        ? 'No MEP systems available'
                        : mepItemsForActiveSheet.length === 0
                          ? "No MEP systems match this sheet’s discipline"
                          : "MEP runs on grid edges (this sheet’s systems only)"
                    }
                    className={cn(layerBtnOn('mep'), 'disabled:opacity-40')}
                  >
                    MEP
                  </button>
                )}
                {planViewContext.kind !== 'elevation' &&
                  ([...floor1Sheet.visiblePlaceModes] as PlanPlaceMode[])
                    .filter((m) => PLACE_MODE_LABELS[m] != null)
                    .map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setTraceOverlayEditMode(false)
                          setPlaceMode(mode)
                          if (mode === 'floor' || mode === 'stairs' || mode === 'roof') {
                            setFloorTool('paint')
                          }
                        }}
                        disabled={
                          isMepDisciplineMode(mode) &&
                          (mepItems.length === 0 ||
                            filterMepItemsForToolMode(mepItemsForActiveSheet, mode).length === 0)
                        }
                        title={PLACE_MODE_TOOLTIPS[mode] ?? PLACE_MODE_LABELS[mode]}
                        className={cn(
                          layerBtnOn(mode),
                          isMepDisciplineMode(mode) && 'disabled:opacity-40',
                        )}
                      >
                        {PLACE_MODE_LABELS[mode]}
                      </button>
                    ))}
                {planViewContext.kind !== 'elevation' && showLayerMode('column') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('column')
                    }}
                    className={layerBtnOn('column')}
                    title="Place square column footprints from catalog systems (Plan_Draw_Layers: column)"
                  >
                    Columns
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('floor') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('floor')
                      setFloorTool('paint')
                    }}
                    className={layerBtnOn('floor')}
                  >
                    Floor
                  </button>
                )}
                {planViewContext.kind !== 'elevation' && showLayerMode('room') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('room')
                    }}
                    className={layerBtnOn('room')}
                    title="Draw room boundaries with Line / Rect below, then Fill to name each zone"
                  >
                    Room
                  </button>
                )}
                {showLayerMode('annotate') && (
                  <button
                    type="button"
                    onClick={() => {
                      setTraceOverlayEditMode(false)
                      setPlaceMode('annotate')
                    }}
                    className={layerBtnOn('annotate')}
                    title={
                      planViewContext.kind === 'elevation'
                        ? 'Annotations on this elevation — same tools as floor layout, plus ground line (toolbar below)'
                        : 'Dimensions, grid reference lines, text labels, and section cuts (plan units from Setup)'
                    }
                  >
                    Annotation
                  </button>
                )}
              </ToolbarGroup>

              {(planViewContext.kind === 'floor1' || planViewContext.kind === 'elevation') && (
                <ToolbarGroup title="Overlays">
                  {!hasTraceOverlay && (
                    <button
                      type="button"
                      onClick={() => traceOverlayInputRef.current?.click()}
                      className={btnIdle}
                      title={
                        planViewContext.kind === 'elevation'
                          ? 'Place a JPEG or PNG over the elevation (above the grid; fade to compare)'
                          : 'Place a JPEG or PNG over the plan (above walls; fade to compare)'
                      }
                    >
                      Add photo…
                    </button>
                  )}
                  {hasTraceOverlay && tr && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setTraceOverlayEditMode((v) => !v)
                          if (!tr.visible) {
                            onSketchChange({ ...sketch, traceOverlay: { ...tr, visible: true } }, { skipUndo: true })
                          }
                        }}
                        className={traceOverlayEditMode ? btnOn : btnIdle}
                        title="Move, rotate, and scale the trace image (bottom toolbar)"
                      >
                        Edit photo…
                      </button>
                      <button
                        type="button"
                        onClick={() => traceOverlayInputRef.current?.click()}
                        className={btnIdle}
                        title="Replace with another JPEG or PNG"
                      >
                        Replace photo…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSketchChange({ ...sketch, traceOverlay: { ...tr, visible: !tr.visible } }, {
                            skipUndo: true,
                          })
                        }
                        className={traceVisible ? btnOn : btnIdle}
                        title={traceVisible ? 'Hide photo overlay' : 'Show photo overlay'}
                      >
                        {traceVisible ? 'Photo on' : 'Photo off'}
                      </button>
                      <label className="flex items-center gap-1.5 font-mono text-[8px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        <span className="select-none">Photo</span>
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={1}
                          value={traceOpacityPct}
                          onChange={(ev) =>
                            onSketchChange(
                              { ...sketch, traceOverlay: { ...tr, opacityPct: Number(ev.target.value) } },
                              { skipUndo: true },
                            )
                          }
                          className="w-16 sm:w-20 h-1 accent-foreground cursor-pointer"
                          title="Photo overlay opacity"
                        />
                        <span className="tabular-nums text-foreground/80 w-7">{traceOpacityPct}%</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          onSketchChange({ ...sketch, traceOverlay: undefined })
                          setTraceOverlayEditMode(false)
                        }}
                        className={`${btnIdle} text-red-700 border-red-200 hover:bg-red-50`}
                        title="Remove photo overlay"
                      >
                        Clear photo
                      </button>
                    </>
                  )}
                  {planViewContext.kind === 'floor1' &&
                    (floor1Sheet.visualMode === 'trade_mep'
                      ? Boolean(buildingLevels?.length)
                      : otherLevels.length > 0) && (
                      <>
                        <span
                          className="hidden sm:inline-block w-px h-5 bg-border shrink-0 self-center mx-0.5"
                          aria-hidden
                        />
                        {(floor1Sheet.visualMode === 'trade_mep' ? buildingLevels ?? [] : otherLevels).map(
                          (level) => {
                            const isOn = overlayLevelIds.has(level.id)
                            const color = levelColorMap.get(level.id) ?? LEVEL_OVERLAY_COLORS[0]!
                            const trade = floor1Sheet.visualMode === 'trade_mep'
                            return (
                              <button
                                key={level.id}
                                type="button"
                                onClick={() => toggleOverlayLevel(level.id)}
                                className={isOn ? btnOn : btnIdle}
                                title={
                                  trade
                                    ? isOn
                                      ? `Hide layout underlay (${level.label})`
                                      : `Show layout underlay (${level.label})`
                                    : `${isOn ? 'Hide' : 'Show'} ${level.label} as a ghost overlay`
                                }
                                style={isOn ? { borderColor: color, backgroundColor: color } : undefined}
                              >
                                {level.label}
                              </button>
                            )
                          },
                        )}
                        {overlayLevelIds.size > 0 && (
                          <label className="flex items-center gap-1.5 font-mono text-[8px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                            <span className="select-none">Levels</span>
                            <input
                              type="range"
                              min={5}
                              max={80}
                              step={1}
                              value={Math.round(levelOverlayOpacity * 100)}
                              onChange={(ev) => setLevelOverlayOpacity(Number(ev.target.value) / 100)}
                              className="w-16 sm:w-20 h-1 accent-foreground cursor-pointer"
                              title="Level ghost overlay opacity"
                            />
                            <span className="tabular-nums text-foreground/80 w-7">
                              {Math.round(levelOverlayOpacity * 100)}%
                            </span>
                          </label>
                        )}
                        {overlayLevelIds.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setOverlayLevelIds(new Set())}
                            className={btnIdle}
                            title="Hide all level overlays"
                          >
                            Clear levels
                          </button>
                        )}
                      </>
                    )}
                  <span
                    className="hidden sm:inline-block w-px h-5 bg-border shrink-0 self-center mx-0.5"
                    aria-hidden
                  />
                  {!annotationsOnly && (
                    <button
                      type="button"
                      onClick={() => setShowCornerConditions((v) => !v)}
                      className={showCornerConditions ? btnOn : btnIdle}
                      title={
                        showCornerConditions
                          ? 'Hide corner labels and uniform-junction connection drawing bar (corner fills stay on)'
                          : 'Show L/T/X, C# on corners; hover uniform junctions (same system on every arm) to pick connection sheets'
                      }
                    >
                      Corner labels
                    </button>
                  )}
                  {onToggleAllSystemsAssemblyLayers && (
                    <button
                      type="button"
                      disabled={!hasCatalogAssemblyLayers}
                      onClick={onToggleAllSystemsAssemblyLayers}
                      className={cn(allAssemblyLayersShown ? btnOn : btnIdle, 'disabled:opacity-40')}
                      title={
                        allAssemblyLayersShown
                          ? 'Hide every CSV assembly layer in all systems (same as clearing all “Show” checkboxes in the system table)'
                          : 'Show every CSV assembly layer in all systems (sections, connection-detail strips, composite)'
                      }
                    >
                      Assembly layers
                    </button>
                  )}
                </ToolbarGroup>
              )}
            </div>
          </div>
        )}
      </div>

      {setupOpen ? (
        <div className="flex-1 min-h-0 overflow-y-auto bg-muted/15 border-b border-border/60">
          <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
            <div>
              <h2 className={setupSectionTitle}>Setup</h2>
              <p className={`${setupHelp} mt-1`}>
                Grid spacing, lot size, MEP CSV override, and sketch JSON live here. Use{' '}
                <span className="text-foreground/80">Back to plan</span> when you are ready to draw.
              </p>
            </div>

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>Grid</h3>
              <p className={setupHelp}>
                Spacing between grid nodes for walls and floor cells — this is the <span className="text-foreground/80">same</span>{' '}
                Δ for the Floor Layout and all elevation sheets. Elevation canvas width/depth match the Site lot dimensions and
                height from Setup (layout sketch), not separate CSV-only sizes. Stored as plan inches in the layout sketch; pick
                the unit you want for typing here (saved in this browser). Changing Δ clears walls and floor fills on the layout
                if anything is already drawn there.
                {annotationsOnly ? (
                  <>
                    {' '}
                    On a connection-detail sheet this still edits the <span className="text-foreground/80">shared</span> floor
                    layout; use <span className="text-foreground/80">Connection detail grid</span> below for the detail drawing
                    grid.
                  </>
                ) : null}
              </p>
              <label className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                Grid spacing unit
                <select
                  value={gridDisplayUnit}
                  onChange={(e) => setGridDisplayUnit(e.target.value as PlanSiteDisplayUnit)}
                  className="border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm min-w-[12rem]"
                >
                  {(['in', 'ft', 'yd', 'mm', 'm'] as const).map((u) => (
                    <option key={u} value={u}>
                      {PLAN_SITE_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  Spacing Δ ({PLAN_SITE_UNIT_SHORT[gridDisplayUnit]})
                  <input
                    type="number"
                    min={minGridDisplay}
                    step={gridInputStep(gridDisplayUnit)}
                    value={gridDraft}
                    onChange={(e) => setGridDraft(e.target.value)}
                    onBlur={applyGridDraftFromInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyGridDraftFromInput()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="w-28 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                  />
                </label>
                <span className="font-mono text-[9px] text-muted-foreground">Presets:</span>
                <div className="flex flex-wrap gap-1">
                  {gridPresetList.map((pIn) => (
                    <button
                      key={pIn}
                      type="button"
                      onClick={() => trySetGridSpacing(pIn)}
                      className="font-mono text-[9px] px-2 py-1 border border-border hover:bg-muted rounded-sm bg-white"
                      title={`${pIn} in`}
                    >
                      {formatSiteMeasure(pIn, gridDisplayUnit)} {PLAN_SITE_UNIT_SHORT[gridDisplayUnit]}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {planViewContext.kind === 'floor1' && (
              <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
                <h3 className={setupSectionTitle}>Connection detail grid</h3>
                <p className={setupHelp}>
                  Grid spacing for every connection-detail sheet (annotations and dimensions on those pages). Stored on the
                  Level 1 layout as plan inches; uses the same display unit as the main grid above. Changing spacing clears
                  all connection detail drawings if any sheet has content. Boundary space adds the same number of detail-grid
                  cells on every side of the connection area; the junction box stays centered on the sheet (default{' '}
                  {CONNECTION_DETAIL_DEFAULT_BOUNDARY_CELLS} cells per side). Use the dotted outline to see the connection area
                  vs padding.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    Detail spacing Δ ({PLAN_SITE_UNIT_SHORT[gridDisplayUnit]})
                    <input
                      type="number"
                      min={minGridDisplay}
                      step={gridInputStep(gridDisplayUnit)}
                      value={detailGridDraft}
                      onChange={(e) => setDetailGridDraft(e.target.value)}
                      onBlur={applyDetailGridDraftFromInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          applyDetailGridDraftFromInput()
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      className="w-28 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                    />
                  </label>
                  <span className="font-mono text-[9px] text-muted-foreground">Presets:</span>
                  <div className="flex flex-wrap gap-1">
                    {CONNECTION_DETAIL_GRID_PRESETS_IN.map((pIn) => (
                      <button
                        key={pIn}
                        type="button"
                        onClick={() => trySetConnectionDetailGridSpacing(pIn)}
                        className="font-mono text-[9px] px-2 py-1 border border-border hover:bg-muted rounded-sm bg-white"
                        title={`${pIn} in`}
                      >
                        {formatSiteMeasure(pIn, gridDisplayUnit)} {PLAN_SITE_UNIT_SHORT[gridDisplayUnit]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    Boundary space (cells per side)
                    <input
                      type="number"
                      min={0}
                      max={48}
                      step={1}
                      value={boundaryCellsDraft}
                      onChange={(e) => setBoundaryCellsDraft(e.target.value)}
                      onBlur={applyBoundaryCellsDraftFromInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          applyBoundaryCellsDraftFromInput()
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      className="w-20 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                      title="Extra detail-grid cells padded outside the junction on left, right, bottom, and top"
                    />
                  </label>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    Sheet grows by 2× this × detail Δ in each direction (plan inches).
                  </span>
                </div>
              </section>
            )}

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>Site</h3>
              <p className={setupHelp}>
                Lot width and depth (minimum = building footprint in each direction). Height is the building’s vertical
                extent for elevation sheets and export (stored as plan inches on the Level 1 sketch). Pick the unit you want
                for typing here (saved in this browser). Width and depth define the plan lot; the plan canvas uses that
                rectangle as the yard around the building.
                {annotationsOnly ? (
                  <>
                    {' '}
                    While viewing a connection detail, these fields still edit the <span className="text-foreground/80">shared</span>{' '}
                    project lot and height (the detail canvas keeps its own size on the sheet).
                  </>
                ) : null}
              </p>
              <label className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                Site dimensions unit
                <select
                  value={siteDisplayUnit}
                  onChange={(e) => setSiteDisplayUnit(e.target.value as PlanSiteDisplayUnit)}
                  className="border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm min-w-[12rem]"
                >
                  {(['in', 'ft', 'yd', 'mm', 'm'] as const).map((u) => (
                    <option key={u} value={u}>
                      {PLAN_SITE_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
                  Width ({PLAN_SITE_UNIT_SHORT[siteDisplayUnit]})
                  <input
                    type="number"
                    min={minSiteWDisplay}
                    step={siteInputStep(siteDisplayUnit)}
                    value={siteWDraft}
                    onChange={(e) => setSiteWDraft(e.target.value)}
                    onBlur={tryApplySiteDims}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        tryApplySiteDims()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="w-28 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
                  Depth ({PLAN_SITE_UNIT_SHORT[siteDisplayUnit]})
                  <input
                    type="number"
                    min={minSiteDDisplay}
                    step={siteInputStep(siteDisplayUnit)}
                    value={siteHDraft}
                    onChange={(e) => setSiteHDraft(e.target.value)}
                    onBlur={tryApplySiteDims}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        tryApplySiteDims()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="w-28 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
                  Height ({PLAN_SITE_UNIT_SHORT[siteDisplayUnit]})
                  <input
                    type="number"
                    min={minHeightDisplay}
                    step={siteInputStep(siteDisplayUnit)}
                    value={siteHeightDraft}
                    onChange={(e) => setSiteHeightDraft(e.target.value)}
                    onBlur={tryApplyBuildingHeight}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        tryApplyBuildingHeight()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="w-28 border border-border px-2 py-1 font-mono text-[11px] bg-white rounded-sm"
                    title="Building height; stored on the Level 1 sketch; used for elevation canvas height"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>MEP CSV Override</h3>
              <p className={setupHelp}>
                MEP systems are loaded automatically from the main building-systems CSV. Upload a custom CSV here to override them. Clear to restore auto-derived items.
              </p>
              <input ref={mepInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onMepFile} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => mepInputRef.current?.click()} className={btnIdle}>
                  Choose CSV…
                </button>
                {mepItems.length > 0 && (
                  <button
                    type="button"
                    onClick={clearMep}
                    className={`${btnIdle} text-red-700 border-red-200 hover:bg-red-50`}
                  >
                    {mepIsUserOverride.current ? 'Clear Override' : 'Clear MEP'}
                  </button>
                )}
              </div>
              {mepFileName && (
                <p className="font-mono text-[9px] text-muted-foreground truncate" title={mepFileName}>
                  Loaded: {mepFileName}
                </p>
              )}
              {mepError && <p className="font-mono text-[9px] text-red-600">{mepError}</p>}
            </section>

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>
                {onDownloadFullPlan && onImportFullPlan ? 'Save & open plan' : 'Sketch import / export'}
              </h3>
              {onDownloadFullPlan && onImportFullPlan ? (
                <>
                  <p className={setupHelp}>
                    Save your work to a JSON file (all level layouts plus elevation sketches). Open the same file
                    here anytime—on this device or another—to continue editing. Your browser also keeps a local copy
                    while you stay on this site.
                  </p>
                  <input
                    ref={planJsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={onPlanJsonFile}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => planJsonInputRef.current?.click()} className={btnIdle}>
                      Open plan from file…
                    </button>
                    <button type="button" onClick={onDownloadFullPlan} className={btnIdle}>
                      Save plan to file
                    </button>
                  </div>
                  <p className={setupHelp}>
                    Older <span className="font-mono">floor-1-layout.json</span> exports still work—they load into the
                    Level 1 layout.
                  </p>
                </>
              ) : (
                <>
                  <p className={setupHelp}>
                    Save the full layout sketch (grid, site, walls, floor, MEP lines) as JSON, or load a previously
                    exported file. Import replaces the current sketch.
                  </p>
                  <input
                    ref={planJsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={onPlanJsonFile}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => planJsonInputRef.current?.click()} className={btnIdle}>
                      Import JSON…
                    </button>
                    <button type="button" onClick={() => downloadSketchJson(sketch)} className={btnIdle}>
                      Export JSON
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ImplementationPlanFloatingToolbar
              traceOverlayEditMode={traceOverlayEditMode}
              placeMode={placeMode}
              annotationTool={annotationTool}
              roomTool={roomTool}
              floorTool={floorTool}
              structureTool={structureTool}
              planViewContext={planViewContext}
              levelLineLabelDraft={levelLineLabelDraft}
              setLevelLineLabelDraft={setLevelLineLabelDraft}
              annotationLabelDraft={annotationLabelDraft}
              setAnnotationLabelDraft={setAnnotationLabelDraft}
              annotationSelectEditLabel={
                annotationSelectEditLabel
                  ? { id: annotationSelectEditLabel.id, text: annotationSelectEditLabel.text }
                  : undefined
              }
              annotationSelectEditLabelId={annotationSelectEditLabelId}
              sketch={sketch}
              onSketchChange={onSketchChange}
              roomPickerSketch={planSketchForEditor}
              buildingDimensions={buildingDimensions}
              onRoomPickNavigate={onRoomPickNavigate}
              roomNameDraft={roomNameDraft}
              setRoomNameDraft={setRoomNameDraft}
              selectedRoomZoneCellKeys={selectedRoomZoneCellKeys}
              applySelectedZoneRoomName={applySelectedZoneRoomName}
              applyAutoFillAllRooms={applyAutoFillAllRooms}
              systemOptions={systemOptions}
              selectValue={selectValue}
              planColorCatalog={planColorCatalog}
              onSelectSystem={onSelectSystem}
              connectionDetailAnnotate={connectionDetailAnnotate}
              connectionDetailFillLayerRows={connectionDetailFillLayerRows}
              connectionDetailFillPickKey={connectionDetailFillPickKey}
              onConnectionDetailFillPickKeyChange={setConnectionDetailFillPickKey}
              planToolbarOffset={planToolbarOffset}
              offsetMeasureUnitDefault={siteDisplayUnit}
            />

            <PlanLayoutEditor
              buildingDimensions={buildingDimensions}
              sketch={planSketchForEditor}
              onSketchChange={onPlanSketchCommit}
              vectorExportBasename={vectorExportBasename}
              activeCatalog={activeCatalog}
              activeSystemId={activeSystemId}
              placeMode={placeMode}
              roomNameDraft={roomNameDraft}
              roomTool={roomTool}
              structureTool={structureTool}
              floorTool={floorTool}
              annotationTool={annotationTool}
              annotationLabelDraft={annotationLabelDraft}
              levelLineLabelDraft={levelLineLabelDraft}
              onSelectedAnnotationKeysChange={onSelectedAnnotationKeysChange}
              onToolbarPlanSelectionChange={onToolbarPlanSelectionChange}
              mepItems={mepItems}
              orderedSystems={orderedSystems}
              planColorCatalog={planColorCatalog}
              planSiteDisplayUnit={siteDisplayUnit}
              annotationsOnly={annotationsOnly}
              sectionCutGraphicVariant={connectionDetailAnnotate ? 'detailLine' : 'section'}
              canvasExtentsIn={
                planViewContext.kind === 'elevation'
                  ? elevationCanvasInches(
                      planViewContext.sheet.face,
                      buildingHeightIn,
                      buildingDimensions,
                      layoutSketch,
                    )
                  : connectionDetailCanvasExtents
              }
              connectionDetailJunctionOutlineIn={connectionDetailJunctionOutlineIn}
              connectionDetailForCanvas={connectionDetailForCanvas}
              connectionDetailLayerFillPick={connectionDetailLayerFillPick}
              allowMepEditing={floor1Sheet.allowsMepEditing}
              planVisualProfile={planVisualProfile}
              traceOverlay={
                tr
                  ? {
                      href: tr.imageDataUrl,
                      visible: traceVisible,
                      opacity: Math.max(0.05, Math.min(1, traceOpacityPct / 100)),
                      tx: traceTx,
                      ty: traceTy,
                      rotateDeg: traceRotateDeg,
                      scale: traceScale,
                    }
                  : null
              }
              suspendPlanPainting={traceOverlayEditMode && hasTraceOverlay}
              layersBarHoverLayerId={layersBarHoverLayerId}
              layersBarSelectRequest={layersBarSelectRequest}
              globalSelectAllNonce={globalSelectAllNonce}
              selectedRoomZoneCellKeys={selectedRoomZoneCellKeys}
              onRoomZoneSelect={onRoomZoneSelect}
              roomZoneCameraRequest={roomZoneCameraRequest}
              levelSketches={levelSketches}
              buildingLevels={buildingLevels}
              layoutSketchForProjection={layoutSketch}
              elevationFace={planViewContext.kind === 'elevation' ? planViewContext.sheet.face : undefined}
              levelOverlays={levelOverlayEntries}
              levelOverlayOpacity={levelOverlayOpacity}
              levelOverlaysBelowPlanContent={floor1Sheet.visualMode === 'trade_mep'}
              showCornerConditions={showCornerConditions}
              planLineAssemblyLayers={allAssemblyLayersShown}
              connectionSketches={connectionSketches}
              className="flex flex-col flex-1 min-h-0"
            />
            <ImplementationPlanBottomToolbar
              traceOverlayEditMode={traceOverlayEditMode}
              hasTraceOverlay={hasTraceOverlay}
              tr={tr}
              sketch={sketch}
              onSketchChange={onSketchChange}
              traceMoveRange={traceMoveRange}
              traceTx={traceTx}
              traceTy={traceTy}
              traceRotateDeg={traceRotateDeg}
              traceScale={traceScale}
              resetTraceOverlayTransform={resetTraceOverlayTransform}
              planViewContext={planViewContext}
              placeMode={placeMode}
              structureTool={structureTool}
              setStructureTool={setStructureTool}
              roomTool={roomTool}
              setRoomTool={setRoomTool}
              floorTool={floorTool}
              setFloorTool={setFloorTool}
              annotationTool={annotationTool}
              setAnnotationTool={setAnnotationTool}
              setTraceOverlayEditMode={setTraceOverlayEditMode}
              allowedAnnotationTools={
                connectionDetailAnnotate ? CONNECTION_DETAIL_ANNOTATION_TOOLS : null
              }
              connectionDetailAnnotate={connectionDetailAnnotate}
              assemblyLayersToolbar={allAssemblyLayersShown}
            />
          </div>

          <PlanSketchLayersBar
            buildingDimensions={buildingDimensions}
            sketch={sketch}
            siteDisplayUnit={siteDisplayUnit}
            orderedSystems={orderedSystems}
            mepItems={mepItems}
            planColorCatalog={planColorCatalog}
            activeLayerIdentity={layersBarActiveIdentity}
            lineAnnotationSurface={Boolean(annotationsOnly && connectionDetailForCanvas)}
            onLayerHover={(source, systemId) => setLayersBarHoverLayerId(`${source}\t${systemId}`)}
            onLayerHoverEnd={() => setLayersBarHoverLayerId(null)}
            onLayerActivate={onLayersBarLayerActivate}
            allowMepLayerActivate={annotationsOnly ? false : floor1Sheet.allowsMepEditing}
            onAnnotationsLayerActivate={() => {
              setPlaceMode('annotate')
              setTraceOverlayEditMode(false)
              if (planViewContext.kind === 'elevation') setAnnotationTool('groundLine')
              else if (
                annotationsOnly &&
                planViewContext.kind === 'floor1' &&
                connectionDetailForCanvas
              ) {
                setAnnotationTool('sectionCut')
              } else setAnnotationTool('measureLine')
            }}
          />
        </div>
      )}
    </div>
  )
}
