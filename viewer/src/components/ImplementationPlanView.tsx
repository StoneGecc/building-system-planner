import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SystemData, BuildingDimensions } from '../types/system'
import type { MepItem } from '../types/mep'
import type { PlanLayoutSketch, PlanSketchCommitOptions } from '../types/planLayout'
import {
  layerIdentityFromCell,
  layerIdentityFromColumn,
  layerIdentityFromEdge,
  resolvedSiteInches,
} from '../types/planLayout'
import {
  PlanLayoutEditor,
  type ActiveCatalog,
  type FloorTool,
  type LayoutTool,
  type AnnotationTool,
  type RoomTool,
} from './PlanLayoutEditor'
import { PlanSketchLayersBar } from './PlanSketchLayersBar'
import { parseMepCsv } from '../lib/mepCsvParser'
import { downloadSketchJson, readSketchFromFile } from '../lib/planLayoutStorage'
import { applySequentialAutoRoomNames, roomNamesEqualIgnoreCase } from '../lib/planRooms'
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
import { buildPlanColorCatalog, type PlanPlaceMode } from '../lib/planLayerColors'
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
import { FLOOR1_SHEETS, filterMepItemsForSheet } from '../data/floor1Sheets'
import { elevationCanvasInches } from '../data/elevationSheets'
import { ToolbarGroup } from './ToolbarGroup'
import type { PaintSystemOption } from './PlanSystemPicker'
import {
  ImplementationPlanBottomToolbar,
  ImplementationPlanFloatingToolbar,
} from './implementationPlan/ImplementationPlanEditorToolbars'
import type { ImplementationPlanViewContext } from '@/components/implementationPlan/viewContext'

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
  className?: string
}

const GRID_PRESETS_IN = [4, 6, 12, 24]


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
  className,
}: ImplementationPlanViewProps) {
  const [mepItems, setMepItems] = useState<MepItem[]>([])
  const [mepFileName, setMepFileName] = useState<string | null>(null)
  const [mepError, setMepError] = useState<string | null>(null)
  const viewContextKeyRef = useRef<string | null>(null)

  const floor1Sheet = useMemo(
    () =>
      planViewContext.kind === 'floor1' ? planViewContext.sheet : FLOOR1_SHEETS[0]!,
    [planViewContext],
  )

  /** Elevation pages draw with the layout sketch’s grid spacing so plan and elevation grids stay aligned. */
  const editorSketch = useMemo((): PlanLayoutSketch => {
    if (planViewContext.kind !== 'elevation') return sketch
    if (sketch.gridSpacingIn === layoutSketch.gridSpacingIn) return sketch
    return { ...sketch, gridSpacingIn: layoutSketch.gridSpacingIn }
  }, [planViewContext.kind, sketch, layoutSketch.gridSpacingIn])

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
      const { elevationGroundPlaneJ: _cj, elevationLevelLines: _cl, ...curBody } = editorSketch
      if (JSON.stringify(nextBody) !== JSON.stringify(curBody)) {
        onSketchChange(nextBody as PlanLayoutSketch, opts)
      }
    },
    [planViewContext.kind, layoutSketch, onLayoutSketchChange, onSketchChange, editorSketch],
  )

  const mepInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
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
  const [roomNameDraft, setRoomNameDraft] = useState('Living room')
  const [structureTool, setStructureTool] = useState<LayoutTool>('paint')
  const [roomTool, setRoomTool] = useState<RoomTool>('paint')
  const [selectedRoomZoneCellKeys, setSelectedRoomZoneCellKeys] = useState<string[] | null>(null)
  const [roomZoneCameraRequest, setRoomZoneCameraRequest] = useState<{
    nonce: number
    cellKeys: string[]
  } | null>(null)
  const [floorTool, setFloorTool] = useState<FloorTool>('paint')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('measureLine')
  const [annotationLabelDraft, setAnnotationLabelDraft] = useState('Label')
  /** Elevation · Level line tool: optional tag placed at the left of the line. */
  const [levelLineLabelDraft, setLevelLineLabelDraft] = useState('LL')
  /** Mirrored from PlanLayoutEditor (annotation Select) for toolbar label editing. */
  const [selectedAnnotationKeysFromPlan, setSelectedAnnotationKeysFromPlan] = useState<string[]>([])
  const onSelectedAnnotationKeysChange = useCallback((keys: readonly string[]) => {
    setSelectedAnnotationKeysFromPlan([...keys])
  }, [])

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
    if (placeMode === 'floor' && prev !== 'floor' && structureTool === 'select') {
      setFloorTool('select')
    }
    if (placeMode === 'column' && prev !== 'column') {
      setFloorTool('paint')
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
      placeMode === 'room'
    ) {
      setActiveCatalog('arch')
    }
  }, [placeMode])

  useEffect(() => {
    if (placeMode === 'annotate' || placeMode === 'room' || placeMode === 'mep') return
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
    return {
      w: siteResolved.w * buildingDimensions.planScale,
      h: siteResolved.h * buildingDimensions.planScale,
    }
  }, [planViewContext, buildingHeightIn, buildingDimensions, layoutSketch, siteResolved.w, siteResolved.h])
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

  useEffect(() => {
    const ctxKey =
      planViewContext.kind === 'floor1'
        ? `f1:${planViewContext.sheet.id}`
        : `elev:${planViewContext.sheet.face}`
    if (viewContextKeyRef.current === ctxKey) return
    viewContextKeyRef.current = ctxKey

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
    if (next === 'mep' && (!floor1Sheet.allowsMepEditing || filtered.length === 0)) {
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
    if (next === 'mep') {
      setActiveCatalog('mep')
      setActiveSystemId(filtered[0]?.id ?? '')
    } else {
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
    setTraceOverlayEditMode(false)
  }, [planViewContext, floor1Sheet, mepItems, orderedSystems])

  useEffect(() => {
    if (placeMode !== 'mep' || activeCatalog !== 'mep') return
    if (mepItemsForActiveSheet.some((m) => m.id === activeSystemId)) return
    const first = mepItemsForActiveSheet[0]?.id
    if (first) setActiveSystemId(first)
    else {
      setPlaceMode(floor1Sheet.visiblePlaceModes.has('annotate') ? 'annotate' : 'structure')
      setActiveCatalog('arch')
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
  }, [
    placeMode,
    activeCatalog,
    activeSystemId,
    mepItemsForActiveSheet,
    floor1Sheet.visiblePlaceModes,
    orderedSystems,
  ])

  const onLayersBarLayerActivate = useCallback(
    (source: ActiveCatalog, systemId: string) => {
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
        nextPlaceMode = 'mep'
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
        nextPlaceMode = stairOnly ? 'stairs' : 'floor'
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
      setFloorTool(nextPlaceMode === 'column' ? 'paint' : 'select')
      setTraceOverlayEditMode(false)
      setLayersBarSelectRequest((prev) => ({
        source,
        systemId,
        nonce: (prev?.nonce ?? 0) + 1,
      }))
    },
    [sketch.edges, sketch.cells, sketch.columns, orderedSystems, floor1Sheet.allowsMepEditing, planViewContext.kind],
  )

  useEffect(() => {
    setGridDraft(formatSiteMeasure(layoutSketch.gridSpacingIn, gridDisplayUnit))
  }, [layoutSketch.gridSpacingIn, gridDisplayUnit])

  useEffect(() => {
    const wIn =
      sketch.siteWidthIn != null && Number.isFinite(sketch.siteWidthIn) ? sketch.siteWidthIn : siteResolved.w
    const hIn =
      sketch.siteDepthIn != null && Number.isFinite(sketch.siteDepthIn) ? sketch.siteDepthIn : siteResolved.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
    setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
  }, [
    sketch.siteWidthIn,
    sketch.siteDepthIn,
    siteResolved.w,
    siteResolved.h,
    siteDisplayUnit,
    buildingHeightIn,
  ])

  useEffect(() => {
    if (activeCatalog === 'arch' && !orderedSystems.some((s) => s.id === activeSystemId)) {
      setActiveSystemId(orderedSystems[0]?.id ?? '')
    }
    if (activeCatalog === 'mep' && mepItems.length > 0 && !mepItems.some((m) => m.id === activeSystemId)) {
      setActiveSystemId(mepItems[0]!.id)
    }
  }, [orderedSystems, mepItems, activeCatalog, activeSystemId])

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

  const syncSiteDraftsFromSketch = useCallback(() => {
    const res = resolvedSiteInches(sketch, buildingDimensions)
    const wIn =
      sketch.siteWidthIn != null && Number.isFinite(sketch.siteWidthIn) ? sketch.siteWidthIn : res.w
    const hIn =
      sketch.siteDepthIn != null && Number.isFinite(sketch.siteDepthIn) ? sketch.siteDepthIn : res.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
    setSiteHeightDraft(formatSiteMeasure(buildingHeightIn, siteDisplayUnit))
  }, [sketch, buildingDimensions, siteDisplayUnit, buildingHeightIn])

  const tryApplySiteDims = useCallback(() => {
    const wIn = inchesFromSiteDisplay(Number(siteWDraft), siteDisplayUnit)
    const hIn = inchesFromSiteDisplay(Number(siteHDraft), siteDisplayUnit)
    if (!Number.isFinite(wIn) || !Number.isFinite(hIn) || wIn < fpW || hIn < fpD) {
      syncSiteDraftsFromSketch()
      return
    }
    const tol = 1e-3
    if (Math.abs(wIn - fpW) < tol && Math.abs(hIn - fpD) < tol) {
      onSketchChange({ ...sketch, siteWidthIn: undefined, siteDepthIn: undefined })
      return
    }
    onSketchChange({ ...sketch, siteWidthIn: wIn, siteDepthIn: hIn })
  }, [siteWDraft, siteHDraft, fpW, fpD, sketch, onSketchChange, syncSiteDraftsFromSketch, siteDisplayUnit])

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
      if (items.length && floor1Sheet.allowsMepEditing && floor1Sheet.visiblePlaceModes.has('mep')) {
        const filtered = filterMepItemsForSheet(floor1Sheet, items)
        if (filtered.length) {
          setActiveCatalog('mep')
          setActiveSystemId(filtered[0]!.id)
          setPlaceMode('mep')
        }
      }
    }
    reader.readAsText(f)
  }, [floor1Sheet])

  const clearMep = useCallback(() => {
    setMepItems([])
    setMepFileName(null)
    setMepError(null)
    setPlaceMode((m) => {
      if (m !== 'mep') return m
      return floor1Sheet.visiblePlaceModes.has('annotate') ? 'annotate' : 'structure'
    })
    setActiveCatalog('arch')
    setActiveSystemId(orderedSystems[0]?.id ?? '')
  }, [orderedSystems, floor1Sheet.visiblePlaceModes])

  const importJson = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f) return
      const loaded = await readSketchFromFile(f)
      if (!loaded) {
        alert('Invalid layout JSON.')
        return
      }
      onSketchChange(loaded)
    },
    [onSketchChange],
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
    if (placeMode === 'mep') {
      return mepItemsForActiveSheet.map(mepOption)
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

  const onSelectSystem = useCallback((raw: string) => {
    const [cat, ...rest] = raw.split(':')
    const id = rest.join(':')
    if (cat === 'arch') {
      setActiveCatalog('arch')
      setActiveSystemId(id)
      if (placeMode !== 'annotate' && placeMode !== 'room' && placeMode !== 'mep') {
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
    if (planViewContext.kind === 'elevation') {
      setAnnotationTool('select')
      setGlobalSelectAllNonce((n) => n + 1)
      return
    }
    switch (placeMode) {
      case 'structure':
      case 'window':
      case 'door':
      case 'roof':
      case 'mep':
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
    setGlobalSelectAllNonce((n) => n + 1)
  }, [
    setupOpen,
    traceOverlayEditMode,
    hasTraceOverlay,
    planViewContext.kind,
    placeMode,
  ])

  const showLayerMode = (mode: PlanPlaceMode) => floor1Sheet.visiblePlaceModes.has(mode)

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

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', className)}>
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-border bg-white shrink-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-0">
          <div className="flex flex-col min-w-0">
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
          </div>
          <button
            type="button"
            onClick={() => setSetupOpen((o) => !o)}
            className={setupOpen ? btnOn : btnIdle}
            title={setupOpen ? 'Return to the plan editor' : 'Grid, site, MEP CSV, import / export'}
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
                        ? 'Load an MEP CSV in Setup first'
                        : mepItemsForActiveSheet.length === 0
                          ? `No MEP rows match this sheet’s discipline in the CSV`
                          : 'MEP runs on grid edges (this sheet’s systems only)'
                    }
                    className={cn(layerBtnOn('mep'), 'disabled:opacity-40')}
                  >
                    MEP
                  </button>
                )}
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
                  Add new overlay…
                </button>
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
                      Edit overlay…
                    </button>
                    <button
                      type="button"
                      onClick={() => traceOverlayInputRef.current?.click()}
                      className={btnIdle}
                      title="Replace with another JPEG or PNG"
                    >
                      Replace image…
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSketchChange({ ...sketch, traceOverlay: { ...tr, visible: !tr.visible } }, {
                          skipUndo: true,
                        })
                      }
                      className={traceVisible ? btnOn : btnIdle}
                      title={traceVisible ? 'Hide trace image' : 'Show trace image'}
                    >
                      {traceVisible ? 'Overlay on' : 'Overlay off'}
                    </button>
                    <label className="flex items-center gap-1.5 font-mono text-[8px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      <span className="select-none">Fade</span>
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
                        className="w-20 sm:w-24 h-1 accent-foreground cursor-pointer"
                        title="Trace image opacity"
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
                      title="Remove trace image"
                    >
                      Clear
                    </button>
                  </>
                )}
              </ToolbarGroup>
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
                Grid spacing, lot size, MEP catalog CSV, and sketch JSON live here. Use{' '}
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
                  {GRID_PRESETS_IN.map((pIn) => (
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

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>Site</h3>
              <p className={setupHelp}>
                Lot width and depth (minimum = building footprint in each direction). Height is the building’s vertical
                extent for elevation sheets and export (stored as plan inches on the Floor 1 sketch). Pick the unit you want
                for typing here (saved in this browser). Width and depth define the plan lot; the plan canvas uses that
                rectangle as the yard around the building.
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
                    title="Building height; stored on the Floor 1 sketch; used for elevation canvas height"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-white p-4 shadow-sm space-y-3">
              <h3 className={setupSectionTitle}>MEP CSV</h3>
              <p className={setupHelp}>
                Load a CSV of MEP runs/fixtures for the system picker. Clearing removes loaded MEP items from this session.
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
                    Clear MEP
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
              <h3 className={setupSectionTitle}>Sketch import / export</h3>
              <p className={setupHelp}>
                Save the full layout sketch (grid, site, walls, floor, MEP lines) as JSON, or load a previously
                exported file. Import replaces the current sketch.
              </p>
              <input ref={jsonInputRef} type="file" accept=".json,application/json" className="hidden" onChange={importJson} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => jsonInputRef.current?.click()} className={btnIdle}>
                  Import JSON…
                </button>
                <button type="button" onClick={() => downloadSketchJson(sketch)} className={btnIdle}>
                  Export JSON
                </button>
              </div>
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
            />

            <PlanLayoutEditor
              buildingDimensions={buildingDimensions}
              sketch={planSketchForEditor}
              onSketchChange={onPlanSketchCommit}
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
              mepItems={mepItems}
              orderedSystems={orderedSystems}
              planColorCatalog={planColorCatalog}
              planSiteDisplayUnit={siteDisplayUnit}
              canvasExtentsIn={
                planViewContext.kind === 'elevation'
                  ? elevationCanvasInches(
                      planViewContext.sheet.face,
                      buildingHeightIn,
                      buildingDimensions,
                      layoutSketch,
                    )
                  : null
              }
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
            onLayerHover={(source, systemId) => setLayersBarHoverLayerId(`${source}\t${systemId}`)}
            onLayerHoverEnd={() => setLayersBarHoverLayerId(null)}
            onLayerActivate={onLayersBarLayerActivate}
            allowMepLayerActivate={floor1Sheet.allowsMepEditing}
            onAnnotationsLayerActivate={() => {
              setPlaceMode('annotate')
              setTraceOverlayEditMode(false)
              if (planViewContext.kind === 'elevation') setAnnotationTool('groundLine')
            }}
          />
        </div>
      )}
    </div>
  )
}
