import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  type MeasureTool,
  type RoomTool,
} from './PlanLayoutEditor'
import { PlanSketchLayersBar } from './PlanSketchLayersBar'
import { parseMepCsv } from '../lib/mepCsvParser'
import { downloadSketchJson, readSketchFromFile } from '../lib/planLayoutStorage'
import { applySequentialAutoRoomNames } from '../lib/planRooms'
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
  planPaintSwatchColor,
  type PlanColorCatalog,
  type PlanPlaceMode,
} from '../lib/planLayerColors'
import {
  archSystemMatchesPlanPlaceMode,
  inferDefaultPlanPlaceModeForArchSystem,
} from '../lib/planSystemPlaceModes'
import {
  PLAN_ROOMS_LAYER_ID,
  PLAN_ROOMS_LAYER_SOURCE,
  PLAN_ROOMS_LAYER_SYSTEM_ID,
} from '../lib/planRoomsLayerIdentity'

interface ImplementationPlanViewProps {
  buildingDimensions: BuildingDimensions
  orderedSystems: SystemData[]
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  onUndo?: () => void
  canUndo?: boolean
  onRedo?: () => void
  canRedo?: boolean
  className?: string
}

const GRID_PRESETS_IN = [4, 6, 12, 24]

function ToolbarGroup({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: string
  children: ReactNode
  className?: string
  /** Default: horizontal wrap. Use e.g. flex-col w-full min-w-0 for full-width controls. */
  bodyClassName?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 min-w-0',
        className,
      )}
    >
      <span className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground leading-none select-none">
        {title}
      </span>
      <div className={cn('flex flex-wrap items-center gap-1.5 gap-y-1', bodyClassName)}>{children}</div>
    </div>
  )
}

function cloneSketch(s: PlanLayoutSketch): PlanLayoutSketch {
  return {
    ...s,
    edges: s.edges.map((e) => ({ ...e })),
    cells: (s.cells ?? []).map((c) => ({ ...c })),
    measureRuns: (s.measureRuns ?? []).map((r) => ({
      ...r,
      startNode: { ...r.startNode },
      endNode: { ...r.endNode },
      edgeKeys: [...r.edgeKeys],
    })),
    traceOverlay: s.traceOverlay ? { ...s.traceOverlay } : undefined,
    roomBoundaryEdges: s.roomBoundaryEdges?.map((e) => ({ ...e })),
    roomByCell: s.roomByCell ? { ...s.roomByCell } : undefined,
  }
}

type PaintSystemOption = {
  value: string
  /** Left column in the picker (id — name). */
  title: string
  /** Right column, e.g. formatted thickness (right-aligned in the dropdown). */
  detail?: string
  catalog: ActiveCatalog
  id: string
}

function PlanSystemPicker({
  options,
  value,
  placeMode,
  planColorCatalog,
  onChange,
  disabled,
}: {
  options: PaintSystemOption[]
  value: string
  placeMode: PlanPlaceMode
  planColorCatalog: PlanColorCatalog
  onChange: (raw: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [placeMode])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc, true)
    return () => document.removeEventListener('pointerdown', onDoc, true)
  }, [open])

  const effectiveValue =
    options.length === 0 ? '' : options.some((o) => o.value === value) ? value : options[0]!.value

  const current = options.find((o) => o.value === effectiveValue)

  const swatch = (o: PaintSystemOption) => planPaintSwatchColor(o.catalog, o.id, placeMode, planColorCatalog)

  const optionAriaLabel = (o: PaintSystemOption) =>
    o.detail ? `${o.title}, ${o.detail}` : o.title

  if (disabled || options.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-muted/30 text-muted-foreground rounded-sm text-left"
      >
        <span className="h-2.5 w-2.5 rounded-sm border border-border shrink-0 bg-muted" />
        No systems
      </button>
    )
  }

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={current ? optionAriaLabel(current) : undefined}
        onClick={() => setOpen((x) => !x)}
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-white hover:bg-muted/40 rounded-sm text-left"
      >
        <span
          className="h-2.5 w-2.5 rounded-sm border border-black/25 shrink-0"
          style={{ backgroundColor: swatch(current!) }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate min-w-0">{current?.title}</span>
          {current?.detail ? (
            <span className="shrink-0 text-right tabular-nums text-muted-foreground">{current.detail}</span>
          ) : null}
        </span>
        <span className="text-muted-foreground shrink-0 text-[8px] leading-none pt-px">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-white py-0.5 shadow-md"
        >
          {options.map((o) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="option"
                aria-selected={o.value === effectiveValue}
                aria-label={optionAriaLabel(o)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left font-mono text-[9px] hover:bg-zinc-100',
                  o.value === effectiveValue && 'bg-zinc-100',
                )}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm border border-black/25 shrink-0"
                  style={{ backgroundColor: swatch(o) }}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate min-w-0">{o.title}</span>
                  {o.detail ? (
                    <span className="shrink-0 text-right tabular-nums text-muted-foreground">{o.detail}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ImplementationPlanView({
  buildingDimensions,
  orderedSystems,
  sketch,
  onSketchChange,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  className,
}: ImplementationPlanViewProps) {
  const [mepItems, setMepItems] = useState<MepItem[]>([])
  const [mepFileName, setMepFileName] = useState<string | null>(null)
  const [mepError, setMepError] = useState<string | null>(null)
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
  const [floorTool, setFloorTool] = useState<FloorTool>('paint')
  const [measureTool, setMeasureTool] = useState<MeasureTool>('line')
  const prevPlaceModeRef = useRef(placeMode)

  useEffect(() => {
    const prev = prevPlaceModeRef.current
    if (placeMode === 'floor' && prev !== 'floor' && structureTool === 'select') {
      setFloorTool('select')
    }
    if (placeMode === 'column' && prev !== 'column') {
      setFloorTool('paint')
    }
    if (placeMode !== 'measure' && prev === 'measure') {
      setMeasureTool('line')
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
    if (placeMode === 'measure' || placeMode === 'room' || placeMode === 'mep') return
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
    formatSiteMeasure(sketch.gridSpacingIn, loadGridDisplayUnit()),
  )
  const [siteWDraft, setSiteWDraft] = useState('')
  const [siteHDraft, setSiteHDraft] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  const [layersBarHoverLayerId, setLayersBarHoverLayerId] = useState<string | null>(null)
  const [layersBarSelectRequest, setLayersBarSelectRequest] = useState<{
    source: ActiveCatalog
    systemId: string
    nonce: number
  } | null>(null)

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

  const applySelectedZoneRoomName = useCallback(() => {
    if (!selectedRoomZoneCellKeys?.length) return
    const label = roomNameDraft.trim()
    const prev = sketch.roomByCell ?? {}
    const already =
      label.length > 0
        ? selectedRoomZoneCellKeys.every((k) => (prev[k] ?? '').trim() === label)
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
  const planCanvasPx = useMemo(
    () => ({
      w: siteResolved.w * buildingDimensions.planScale,
      h: siteResolved.h * buildingDimensions.planScale,
    }),
    [siteResolved.w, siteResolved.h, buildingDimensions.planScale],
  )
  const traceMoveRange = Math.max(400, Math.ceil(Math.max(planCanvasPx.w, planCanvasPx.h) * 1.5))

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
    placeMode === 'room' ? PLAN_ROOMS_LAYER_ID : `${activeCatalog}\t${activeSystemId}`

  const onLayersBarLayerActivate = useCallback(
    (source: ActiveCatalog, systemId: string) => {
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
    [sketch.edges, sketch.cells, sketch.columns, orderedSystems],
  )

  useEffect(() => {
    setGridDraft(formatSiteMeasure(sketch.gridSpacingIn, gridDisplayUnit))
  }, [sketch.gridSpacingIn, gridDisplayUnit])

  useEffect(() => {
    const wIn =
      sketch.siteWidthIn != null && Number.isFinite(sketch.siteWidthIn) ? sketch.siteWidthIn : siteResolved.w
    const hIn =
      sketch.siteDepthIn != null && Number.isFinite(sketch.siteDepthIn) ? sketch.siteDepthIn : siteResolved.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
  }, [sketch.siteWidthIn, sketch.siteDepthIn, siteResolved.w, siteResolved.h, siteDisplayUnit])

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
      const hasCells = (sketch.cells ?? []).length > 0
      if ((sketch.edges.length > 0 || hasCells) && Math.abs(nextDelta - sketch.gridSpacingIn) > 1e-6) {
        if (!window.confirm('Changing grid spacing clears all walls and floor fills. Continue?')) return
        onSketchChange({
          ...sketch,
          gridSpacingIn: nextDelta,
          edges: [],
          cells: [],
          measureRuns: [],
          roomBoundaryEdges: undefined,
          roomByCell: undefined,
        })
        return
      }
      onSketchChange({ ...sketch, gridSpacingIn: nextDelta })
    },
    [sketch, onSketchChange],
  )

  const syncSiteDraftsFromSketch = useCallback(() => {
    const res = resolvedSiteInches(sketch, buildingDimensions)
    const wIn =
      sketch.siteWidthIn != null && Number.isFinite(sketch.siteWidthIn) ? sketch.siteWidthIn : res.w
    const hIn =
      sketch.siteDepthIn != null && Number.isFinite(sketch.siteDepthIn) ? sketch.siteDepthIn : res.h
    setSiteWDraft(formatSiteMeasure(wIn, siteDisplayUnit))
    setSiteHDraft(formatSiteMeasure(hIn, siteDisplayUnit))
  }, [sketch, buildingDimensions, siteDisplayUnit])

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

  const minGridDisplay = useMemo(() => inchesToSiteDisplay(0.25, gridDisplayUnit), [gridDisplayUnit])
  const minSiteWDisplay = useMemo(() => inchesToSiteDisplay(fpW, siteDisplayUnit), [fpW, siteDisplayUnit])
  const minSiteDDisplay = useMemo(() => inchesToSiteDisplay(fpD, siteDisplayUnit), [fpD, siteDisplayUnit])

  const applyGridDraftFromInput = useCallback(() => {
    const nIn = inchesFromSiteDisplay(Number(gridDraft), gridDisplayUnit)
    if (!Number.isFinite(nIn) || nIn < 0.25) {
      setGridDraft(formatSiteMeasure(sketch.gridSpacingIn, gridDisplayUnit))
      return
    }
    trySetGridSpacing(nIn)
  }, [gridDraft, gridDisplayUnit, sketch.gridSpacingIn, trySetGridSpacing])

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
      if (items.length) {
        setActiveCatalog('mep')
        setActiveSystemId(items[0]!.id)
      }
    }
    reader.readAsText(f)
  }, [])

  const clearMep = useCallback(() => {
    setMepItems([])
    setMepFileName(null)
    setMepError(null)
    setPlaceMode((m) => (m === 'mep' ? 'structure' : m))
    setActiveCatalog('arch')
    setActiveSystemId(orderedSystems[0]?.id ?? '')
  }, [orderedSystems])

  const importJson = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f) return
      const loaded = await readSketchFromFile(f)
      if (!loaded) {
        alert('Invalid implementation plan JSON.')
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
    if (placeMode === 'measure') {
      return []
    }
    if (placeMode === 'room') {
      return []
    }
    if (placeMode === 'mep') {
      return mepItems.map(mepOption)
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
    const mep = mepItems.map(mepOption)
    if (placeMode !== 'structure') return arch
    return [...arch, ...mep]
  }, [buildingDimensions.thicknessBySystem, orderedSystems, mepItems, placeMode])

  const selectValue = `${activeCatalog}:${activeSystemId}`

  const onSelectSystem = useCallback((raw: string) => {
    const [cat, ...rest] = raw.split(':')
    const id = rest.join(':')
    if (cat === 'arch') {
      setActiveCatalog('arch')
      setActiveSystemId(id)
      if (placeMode !== 'measure' && placeMode !== 'room' && placeMode !== 'mep') {
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

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', className)}>
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-border bg-white shrink-0">
        <div className="flex flex-wrap items-center gap-2 min-h-0">
          <span className="font-mono text-[9px] font-bold tracking-widest uppercase text-foreground">
            Implementation plan
          </span>
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
              <ToolbarGroup title="Layer">
                <input
                  ref={traceOverlayInputRef}
                  type="file"
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={onTraceOverlayFile}
                />
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
                <button
                  type="button"
                  onClick={() => {
                    setTraceOverlayEditMode(false)
                    setPlaceMode('mep')
                  }}
                  disabled={mepItems.length === 0}
                  title={mepItems.length === 0 ? 'Load an MEP CSV in Setup first' : 'MEP runs on grid edges'}
                  className={cn(layerBtnOn('mep'), 'disabled:opacity-40')}
                >
                  MEP
                </button>
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
                <button
                  type="button"
                  onClick={() => {
                    setTraceOverlayEditMode(false)
                    setPlaceMode('measure')
                  }}
                  className={layerBtnOn('measure')}
                  title="Aligned dimension between two clicks (plan units from Setup)"
                >
                  Measure
                </button>
                <button
                  type="button"
                  onClick={() => traceOverlayInputRef.current?.click()}
                  className={btnIdle}
                  title="Place a JPEG or PNG over the plan (above walls; fade to compare)"
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
                Spacing between grid nodes for walls and floor cells. Stored as plan inches in the sketch; pick the unit you
                want for typing here (saved in this browser). Changing Δ clears walls and floor fills if anything is already
                drawn.
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
                Lot width and depth (minimum = building footprint in each direction). Values are stored as plan inches;
                pick the unit you want for typing here (saved in this browser). The plan canvas uses this rectangle as the
                yard around the building.
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
                Save the full implementation plan (grid, site, walls, floor, MEP lines) as JSON, or load a previously
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
            {/* Below PlanLayoutEditor zoom strip (~48px); centered over scroll/plan */}
            <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center px-3 sm:px-4">
              <div className="pointer-events-auto w-full max-w-md min-w-0">
                <ToolbarGroup
                  title={
                    traceOverlayEditMode
                      ? 'Drawing paused'
                      : placeMode === 'measure'
                        ? measureTool === 'line'
                          ? 'Measure · Line'
                          : 'Measure · Erase'
                        : placeMode === 'room'
                          ? roomTool === 'fill'
                            ? 'Room · Fill'
                            : roomTool === 'autoFill'
                              ? 'Room · Auto-fill'
                              : roomTool === 'paint'
                                ? 'Room · Line'
                                : roomTool === 'rect'
                                  ? 'Room · Rect'
                                  : roomTool === 'erase'
                                    ? 'Room · Erase'
                                    : 'Room · Select'
                          : placeMode === 'column'
                            ? floorTool === 'erase'
                              ? 'Columns · Erase'
                              : 'Columns · Paint'
                            : placeMode === 'floor' || placeMode === 'stairs'
                              ? 'Paint with'
                              : structureTool === 'rect'
                              ? 'Rectangle with'
                              : 'Line with'
                  }
                  className="min-w-[12rem] border-border/80 bg-white/95 shadow-lg backdrop-blur-sm"
                  bodyClassName="flex-col items-stretch w-full min-w-0"
                >
                  {traceOverlayEditMode ? (
                    <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
                      Layer tools are off while you adjust the trace. Press <span className="text-foreground/80">Done</span>{' '}
                      in the bottom overlay panel to return to{' '}
                      {placeMode === 'measure'
                        ? 'Measure'
                        : placeMode === 'floor' || placeMode === 'stairs'
                          ? 'cell paint'
                          : placeMode === 'column'
                            ? 'columns'
                            : placeMode === 'room'
                              ? 'room naming'
                              : 'walls and lines'}.
                    </p>
                  ) : placeMode === 'room' && roomTool === 'fill' ? (
                    <label className="flex flex-col gap-1 w-full min-w-0 font-mono text-[9px] text-muted-foreground">
                      <span className="uppercase tracking-wide">Fill — room name</span>
                      <input
                        type="text"
                        value={roomNameDraft}
                        onChange={(ev) => setRoomNameDraft(ev.target.value)}
                        placeholder="Room name"
                        className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                        title="Click inside a zone bounded by walls or room lines to set this name. Clear the field and click to remove names from that zone."
                      />
                    </label>
                  ) : placeMode === 'room' && roomTool === 'autoFill' ? (
                    <div className="flex flex-col gap-2 w-full min-w-0 font-mono text-[9px] text-muted-foreground">
                      <label className="flex flex-col gap-1">
                        <span className="uppercase tracking-wide">Auto-fill — name prefix</span>
                        <input
                          type="text"
                          value={roomNameDraft}
                          onChange={(ev) => setRoomNameDraft(ev.target.value)}
                          placeholder="Room (default)"
                          className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                          title="Each enclosed zone becomes “Prefix 1”, “Prefix 2”, … in stable order. Empty field uses “Room”."
                        />
                      </label>
                      <button
                        type="button"
                        onClick={applyAutoFillAllRooms}
                        className="w-full border border-border bg-white px-2 py-1.5 font-mono text-[10px] text-foreground rounded-sm hover:bg-muted/40"
                        title="Assign sequential names to every enclosed zone at once"
                      >
                        Name all enclosed zones
                      </button>
                    </div>
                  ) : placeMode === 'room' && roomTool === 'select' ? (
                    <label className="flex flex-col gap-1 w-full min-w-0 font-mono text-[9px] text-muted-foreground">
                      <span className="uppercase tracking-wide">Select — zone name</span>
                      <input
                        type="text"
                        value={roomNameDraft}
                        onChange={(ev) => setRoomNameDraft(ev.target.value)}
                        onBlur={() => applySelectedZoneRoomName()}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') {
                            ev.preventDefault()
                            applySelectedZoneRoomName()
                            ;(ev.target as HTMLInputElement).blur()
                          }
                        }}
                        placeholder={
                          selectedRoomZoneCellKeys?.length
                            ? 'Room name'
                            : 'Click a filled room on the plan (away from boundary lines)'
                        }
                        disabled={!selectedRoomZoneCellKeys?.length}
                        className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm disabled:opacity-50"
                        title="Select a zone on the plan, edit the name, then blur the field or press Enter to apply. Clear the name and apply to remove labels from that zone."
                      />
                    </label>
                  ) : placeMode === 'room' ? (
                    <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
                      Use <span className="text-foreground/80">Line</span> or{' '}
                      <span className="text-foreground/80">Rect</span> for room boundaries, or close areas with{' '}
                      <span className="text-foreground/80">walls</span>. Use <span className="text-foreground/80">Fill</span> to
                      name one zone per click, or <span className="text-foreground/80">Auto-fill</span> to number every zone at
                      once.
                    </p>
                  ) : (
                    <PlanSystemPicker
                      options={systemOptions}
                      value={selectValue}
                      placeMode={placeMode}
                      planColorCatalog={planColorCatalog}
                      onChange={onSelectSystem}
                      disabled={systemOptions.length === 0 || placeMode === 'measure'}
                    />
                  )}
                </ToolbarGroup>
              </div>
            </div>
            <PlanLayoutEditor
              buildingDimensions={buildingDimensions}
              sketch={sketch}
              onSketchChange={onSketchChange}
              activeCatalog={activeCatalog}
              activeSystemId={activeSystemId}
              placeMode={placeMode}
              roomNameDraft={roomNameDraft}
              roomTool={roomTool}
              structureTool={structureTool}
              floorTool={floorTool}
              measureTool={measureTool}
              mepItems={mepItems}
              orderedSystems={orderedSystems}
              planColorCatalog={planColorCatalog}
              planSiteDisplayUnit={siteDisplayUnit}
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
              selectedRoomZoneCellKeys={selectedRoomZoneCellKeys}
              onRoomZoneSelect={onRoomZoneSelect}
              className="flex flex-col flex-1 min-h-0"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:px-4">
              <div
                className={cn(
                  'pointer-events-auto min-w-0',
                  traceOverlayEditMode && hasTraceOverlay
                    ? 'w-full max-w-md'
                    : 'w-max max-w-[min(100%,24rem)]',
                )}
              >
                <ToolbarGroup
                  title={traceOverlayEditMode && hasTraceOverlay ? 'Overlay' : 'Tool'}
                  className="border-border/80 bg-white/95 shadow-lg backdrop-blur-sm"
                  bodyClassName={
                    traceOverlayEditMode && hasTraceOverlay
                      ? 'flex-col items-stretch gap-2 w-full min-w-0'
                      : undefined
                  }
                >
                  {traceOverlayEditMode && hasTraceOverlay && tr ? (
                    <>
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0 uppercase">
                          X
                        </span>
                        <input
                          type="range"
                          min={-traceMoveRange}
                          max={traceMoveRange}
                          step={1}
                          value={Math.max(-traceMoveRange, Math.min(traceMoveRange, traceTx))}
                          onChange={(ev) =>
                            onSketchChange(
                              { ...sketch, traceOverlay: { ...tr, tx: Number(ev.target.value) } },
                              { skipUndo: true },
                            )
                          }
                          className="flex-1 min-w-0 h-1 accent-foreground cursor-pointer"
                          title="Move trace horizontally (plan px)"
                        />
                        <input
                          type="number"
                          step={1}
                          value={traceTx}
                          onChange={(ev) => {
                            const v = Number(ev.target.value)
                            if (Number.isFinite(v)) {
                              onSketchChange({ ...sketch, traceOverlay: { ...tr, tx: v } }, { skipUndo: true })
                            }
                          }}
                          className="w-[4.25rem] shrink-0 border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0 uppercase">
                          Y
                        </span>
                        <input
                          type="range"
                          min={-traceMoveRange}
                          max={traceMoveRange}
                          step={1}
                          value={Math.max(-traceMoveRange, Math.min(traceMoveRange, traceTy))}
                          onChange={(ev) =>
                            onSketchChange(
                              { ...sketch, traceOverlay: { ...tr, ty: Number(ev.target.value) } },
                              { skipUndo: true },
                            )
                          }
                          className="flex-1 min-w-0 h-1 accent-foreground cursor-pointer"
                          title="Move trace vertically (plan px)"
                        />
                        <input
                          type="number"
                          step={1}
                          value={traceTy}
                          onChange={(ev) => {
                            const v = Number(ev.target.value)
                            if (Number.isFinite(v)) {
                              onSketchChange({ ...sketch, traceOverlay: { ...tr, ty: v } }, { skipUndo: true })
                            }
                          }}
                          className="w-[4.25rem] shrink-0 border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0">°</span>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={Math.max(-180, Math.min(180, traceRotateDeg))}
                          onChange={(ev) =>
                            onSketchChange(
                              { ...sketch, traceOverlay: { ...tr, rotateDeg: Number(ev.target.value) } },
                              { skipUndo: true },
                            )
                          }
                          className="flex-1 min-w-0 h-1 accent-foreground cursor-pointer"
                          title="Rotate around plan center (degrees)"
                        />
                        <input
                          type="number"
                          step={1}
                          value={traceRotateDeg}
                          onChange={(ev) => {
                            const v = Number(ev.target.value)
                            if (Number.isFinite(v)) {
                              onSketchChange(
                                { ...sketch, traceOverlay: { ...tr, rotateDeg: v } },
                                { skipUndo: true },
                              )
                            }
                          }}
                          className="w-[4.25rem] shrink-0 border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0">%</span>
                        <input
                          type="range"
                          min={20}
                          max={400}
                          step={1}
                          value={Math.round(traceScale * 100)}
                          onChange={(ev) =>
                            onSketchChange(
                              { ...sketch, traceOverlay: { ...tr, scale: Number(ev.target.value) / 100 } },
                              { skipUndo: true },
                            )
                          }
                          className="flex-1 min-w-0 h-1 accent-foreground cursor-pointer"
                          title="Uniform scale (100% = fit box)"
                        />
                        <input
                          type="number"
                          min={5}
                          max={800}
                          step={1}
                          value={Math.round(traceScale * 100)}
                          onChange={(ev) => {
                            const v = Number(ev.target.value)
                            if (Number.isFinite(v) && v > 0) {
                              onSketchChange(
                                { ...sketch, traceOverlay: { ...tr, scale: v / 100 } },
                                { skipUndo: true },
                              )
                            }
                          }}
                          className="w-[4.25rem] shrink-0 border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm tabular-nums"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setTraceOverlayEditMode(false)}
                          className={btnOn}
                          title="Return to drawing tools"
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={resetTraceOverlayTransform}
                          className={btnIdle}
                          title="Reset move, rotation, and scale"
                        >
                          Reset
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {placeMode !== 'floor' &&
                        placeMode !== 'stairs' &&
                        placeMode !== 'column' &&
                        placeMode !== 'measure' &&
                        placeMode !== 'room' &&
                        (['paint', 'rect', 'erase', 'select'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setStructureTool(t)}
                            className={structureTool === t ? btnOn : btnIdle}
                          >
                            {t === 'paint'
                              ? 'Line'
                              : t === 'rect'
                                ? 'Rect'
                                : t === 'erase'
                                  ? 'Erase'
                                  : 'Select'}
                          </button>
                        ))}
                      {placeMode === 'room' &&
                        (['paint', 'rect', 'erase', 'select', 'fill', 'autoFill'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setRoomTool(t)}
                            className={roomTool === t ? btnOn : btnIdle}
                            title={
                              t === 'fill'
                                ? 'Click inside a closed zone to apply the room name from the top field'
                                : t === 'autoFill'
                                  ? 'Assign “Prefix 1”, “Prefix 2”, … to every enclosed zone (toolbar button)'
                                  : t === 'select'
                                    ? 'Click inside a filled room (not on a boundary line) to select it, then edit the name above'
                                    : undefined
                            }
                          >
                            {t === 'paint'
                              ? 'Line'
                              : t === 'rect'
                                ? 'Rect'
                                : t === 'erase'
                                  ? 'Erase'
                                  : t === 'select'
                                    ? 'Select'
                                    : t === 'fill'
                                      ? 'Fill'
                                      : 'Auto'}
                          </button>
                        ))}
                      {(placeMode === 'floor' || placeMode === 'stairs') &&
                        (['paint', 'fill', 'erase', 'select'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setFloorTool(t)}
                            className={floorTool === t ? btnOn : btnIdle}
                            title={
                              t === 'fill'
                                ? 'Drag a rectangle to fill every grid cell inside with the current catalog layer'
                                : undefined
                            }
                          >
                            {t === 'paint'
                              ? 'Paint'
                              : t === 'fill'
                                ? 'Fill'
                                : t === 'erase'
                                  ? 'Erase'
                                  : 'Select'}
                          </button>
                        ))}
                      {placeMode === 'column' &&
                        (['paint', 'erase'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setFloorTool(t)}
                            className={floorTool === t ? btnOn : btnIdle}
                          >
                            {t === 'paint' ? 'Paint' : 'Erase'}
                          </button>
                        ))}
                      {placeMode === 'measure' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMeasureTool('line')}
                            className={measureTool === 'line' ? btnOn : btnIdle}
                            title="Drag along grid edges to place a dimension run"
                          >
                            Line
                          </button>
                          <button
                            type="button"
                            onClick={() => setMeasureTool('erase')}
                            className={measureTool === 'erase' ? btnOn : btnIdle}
                            title="Click a segment of an existing dimension run to remove it"
                          >
                            Erase
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </ToolbarGroup>
              </div>
            </div>
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
          />
        </div>
      )}
    </div>
  )
}

export { cloneSketch }
