import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlanLayoutSketch, PlanTraceOverlay } from '../../types/planLayout'
import { DEFAULT_LEVEL_PRESETS } from '../../types/planLayout'
import type { BuildingDimensions } from '../../types/system'
import type { AnnotationTool, FloorTool, LayoutTool, RoomTool } from '../PlanLayoutEditor'
import { PlanSystemPicker, type PaintSystemOption } from '../PlanSystemPicker'
import { ToolbarGroup } from '../ToolbarGroup'
import type { PlanColorCatalog, PlanPlaceMode } from '../../lib/planLayerColors'
import {
  parseLinearMeasureToPlanInches,
  parseOptionalLinearToPlanInches,
  PLAN_SITE_UNIT_SHORT,
  type PlanSiteDisplayUnit,
} from '../../lib/planDisplayUnits'
import {
  listEnclosedPlanRooms,
  planRoomFillColorForName,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
} from '../../lib/planRooms'
import { cn } from '../../lib/utils'
import { isMepRunMode, isMepPointMode, isMepDisciplineMode } from '../../types/planPlaceMode'
import { PLACE_MODE_LABELS } from '../../data/floor1Sheets'
import type { ImplementationPlanViewContext } from './viewContext'
import {
  CONNECTION_DETAIL_FILL_CLEAR_VALUE,
  type ConnectionDetailFillLayerOptionRow,
} from '../../lib/connectionDetailFillLayerOptions'

type NamedRoomJumpRow = {
  cellKeys: string[]
  displayName: string
  optionLabel: string
}

function planRoomZoneKey(cellKeys: readonly string[]): string {
  return [...cellKeys].sort().join('|')
}

/** Same chrome as {@link NamedRoomJumpPicker} — layer/MEP swatches from catalog fills (incl. rgba). */
function ConnectionDetailFillLayerPicker({
  rows,
  value,
  onChange,
}: {
  rows: readonly ConnectionDetailFillLayerOptionRow[]
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const optionBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const current = useMemo(
    () => rows.find((r) => r.value === value) ?? rows[0],
    [rows, value],
  )

  useLayoutEffect(() => {
    if (!open || !value) return
    const id = requestAnimationFrame(() => {
      optionBtnRefs.current.get(value)?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'auto',
      })
    })
    return () => cancelAnimationFrame(id)
  }, [open, value, rows])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc, true)
    return () => document.removeEventListener('pointerdown', onDoc, true)
  }, [open])

  const isClear = current?.value === CONNECTION_DETAIL_FILL_CLEAR_VALUE

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={current ? `Layer fill: ${current.label}` : 'Choose layer fill'}
        title="Pick a catalog layer (or Clear), then hover the plan for preview and click to apply"
        onClick={() => setOpen((x) => !x)}
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-white hover:bg-muted/40 rounded-sm text-left"
      >
        <span
          className={cn(
            'h-2.5 w-2.5 rounded-sm border shrink-0',
            isClear ? 'border-border bg-muted/60' : 'border-black/25',
          )}
          style={
            !isClear && current?.fillPreview
              ? { backgroundColor: current.fillPreview }
              : undefined
          }
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 truncate">
          {current?.label ?? 'Layer fill…'}
        </span>
        <span className="text-muted-foreground shrink-0 text-[8px] leading-none pt-px">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-white py-0.5 shadow-md"
        >
          {rows.map((row, rowIdx) => {
            const selected = row.value === value
            const rowIsClear = row.value === CONNECTION_DETAIL_FILL_CLEAR_VALUE
            return (
              <li key={row.value} role="none">
                <button
                  id={selected ? `cdf-fill-${rowIdx}` : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  ref={(el) => {
                    if (el) optionBtnRefs.current.set(row.value, el)
                    else optionBtnRefs.current.delete(row.value)
                  }}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left font-mono text-[9px] hover:bg-zinc-100',
                    selected && 'bg-zinc-100',
                  )}
                  onClick={() => {
                    onChange(row.value)
                    setOpen(false)
                  }}
                >
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-sm shrink-0 border',
                      rowIsClear ? 'border-border bg-muted/60' : 'border-black/25',
                    )}
                    style={
                      !rowIsClear ? { backgroundColor: row.fillPreview } : undefined
                    }
                    aria-hidden
                  />
                  <span className="truncate min-w-0">{row.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Same chrome as `PlanSystemPicker` — button trigger + floating listbox. */
function NamedRoomJumpPicker({
  rows,
  selectedZoneKey,
  onPick,
}: {
  rows: readonly NamedRoomJumpRow[]
  /** Sorted `cellKeys` join — when set, list scrolls to center that row on open. */
  selectedZoneKey: string | null
  onPick: (row: NamedRoomJumpRow) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const optionBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const currentRow = useMemo(
    () =>
      selectedZoneKey ? rows.find((r) => planRoomZoneKey(r.cellKeys) === selectedZoneKey) : undefined,
    [rows, selectedZoneKey],
  )

  useLayoutEffect(() => {
    if (!open || !selectedZoneKey) return
    const id = requestAnimationFrame(() => {
      const btn = optionBtnRefs.current.get(selectedZoneKey)
      btn?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, selectedZoneKey, rows])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc, true)
    return () => document.removeEventListener('pointerdown', onDoc, true)
  }, [open])

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={currentRow ? `Room: ${currentRow.optionLabel}` : 'Jump to named room'}
        title="Choose a room to select it and frame it in the plan"
        onClick={() => setOpen((x) => !x)}
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-white hover:bg-muted/40 rounded-sm text-left"
      >
        <span
          className={cn(
            'h-2.5 w-2.5 rounded-sm border shrink-0',
            currentRow ? 'border-black/25' : 'border-border bg-muted/60',
          )}
          style={
            currentRow ? { backgroundColor: planRoomFillColorForName(currentRow.displayName) } : undefined
          }
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 truncate">
          {currentRow ? currentRow.optionLabel : 'Jump to room…'}
        </span>
        <span className="text-muted-foreground shrink-0 text-[8px] leading-none pt-px">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-white py-0.5 shadow-md"
        >
          {rows.map((row, rowIdx) => {
            const zk = planRoomZoneKey(row.cellKeys)
            const selected = zk === selectedZoneKey
            return (
              <li key={zk} role="none">
                <button
                  id={selected ? `named-room-jump-${rowIdx}` : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  ref={(el) => {
                    if (el) optionBtnRefs.current.set(zk, el)
                    else optionBtnRefs.current.delete(zk)
                  }}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left font-mono text-[9px] hover:bg-zinc-100',
                    selected && 'bg-zinc-100',
                  )}
                  onClick={() => {
                    onPick(row)
                    setOpen(false)
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm border border-black/25 shrink-0"
                    style={{ backgroundColor: planRoomFillColorForName(row.displayName) }}
                    aria-hidden
                  />
                  <span className="truncate min-w-0">{row.optionLabel}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const btnBase = 'font-mono text-[8px] px-2 py-0.5 border uppercase tracking-wide transition-colors'
const btnIdle = `${btnBase} border-border hover:bg-muted`
const btnOn = `${btnBase} border-foreground bg-foreground text-white`

/** Shown next to the system picker when plan edges/columns are selected (Select tool). */
export type PlanToolbarOffsetSpec =
  | { kind: 'edge'; applyPerp: (perpIn: number) => void; clear: () => void }
  | { kind: 'column'; apply: (dxIn: number, dyIn: number) => void; clear: () => void }

function floatingToolbarTitle(
  traceOverlayEditMode: boolean,
  placeMode: PlanPlaceMode,
  annotationTool: AnnotationTool,
  roomTool: RoomTool,
  floorTool: FloorTool,
  structureTool: LayoutTool,
  connectionDetailAnnotate: boolean,
): string {
  if (traceOverlayEditMode) return 'Drawing paused'
  if (placeMode === 'annotate') {
    if (annotationTool === 'groundLine') return 'Annotation · Ground line'
    if (annotationTool === 'levelLine') return 'Annotation · Level line'
    if (annotationTool === 'measureLine') return 'Annotation · Measure line'
    if (annotationTool === 'gridLine') return 'Annotation · Grid line'
    if (annotationTool === 'textLabel') return 'Annotation · Text'
    if (annotationTool === 'sectionCut' && connectionDetailAnnotate) return 'Connection · Detail line'
    if (annotationTool === 'sectionCut') return 'Annotation · Section'
    if (annotationTool === 'flipConnectionStripLayers') return 'Connection · Flip layers'
    if (annotationTool === 'connectionDetailLayerFill' && connectionDetailAnnotate)
      return 'Connection · Layer fill'
    if (annotationTool === 'select' && connectionDetailAnnotate) return 'Connection · Select'
    if (annotationTool === 'select') return 'Annotation · Select'
    if (annotationTool === 'erase' && connectionDetailAnnotate) return 'Connection · Erase'
    return 'Annotation · Erase'
  }
  if (placeMode === 'room') {
    if (roomTool === 'fill') return 'Room · Fill'
    if (roomTool === 'autoFill') return 'Room · Auto-fill'
    if (roomTool === 'paint') return 'Room · Line'
    if (roomTool === 'rect') return 'Room · Rect'
    if (roomTool === 'erase') return 'Room · Erase'
    return 'Room · Select'
  }
  if (placeMode === 'column') {
    if (floorTool === 'erase') return 'Columns · Erase'
    if (floorTool === 'flipAssembly') return 'Columns · Flip layers'
    return 'Columns · Paint'
  }
  const modeLabel = PLACE_MODE_LABELS[placeMode]
  if (isMepRunMode(placeMode) && modeLabel) {
    const toolLabel =
      structureTool === 'rect'
        ? 'Rect'
        : structureTool === 'erase'
          ? 'Erase'
          : structureTool === 'select'
            ? 'Select'
            : structureTool === 'flipAssembly'
              ? 'Flip'
              : 'Line'
    return `${modeLabel} · ${toolLabel}`
  }
  if (isMepPointMode(placeMode) && modeLabel) {
    const toolLabel = floorTool === 'erase' ? 'Erase' : floorTool === 'select' ? 'Select' : 'Place'
    return `${modeLabel} · ${toolLabel}`
  }
  if (placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'roof') return 'Paint with'
  if (structureTool === 'rect') return 'Rectangle with'
  if (structureTool === 'flipAssembly') return 'Flip assembly layers with'
  return 'Line with'
}

export type ImplementationPlanFloatingToolbarProps = {
  traceOverlayEditMode: boolean
  placeMode: PlanPlaceMode
  annotationTool: AnnotationTool
  roomTool: RoomTool
  floorTool: FloorTool
  structureTool: LayoutTool
  planViewContext: ImplementationPlanViewContext
  levelLineLabelDraft: string
  setLevelLineLabelDraft: (v: string) => void
  annotationLabelDraft: string
  setAnnotationLabelDraft: (v: string) => void
  annotationSelectEditLabel?: { id: string; text: string }
  annotationSelectEditLabelId: string | null
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch) => void
  /** Same sketch as `PlanLayoutEditor` so room zones match the canvas (grid spacing / elevation merge). */
  roomPickerSketch: PlanLayoutSketch
  buildingDimensions: BuildingDimensions
  /** Room · Select: choosing a row selects the zone and frames it in the plan editor. */
  onRoomPickNavigate: (payload: { cellKeys: readonly string[]; displayName: string }) => void
  roomNameDraft: string
  setRoomNameDraft: (v: string) => void
  selectedRoomZoneCellKeys: readonly string[] | null
  applySelectedZoneRoomName: () => void
  applyAutoFillAllRooms: () => void
  systemOptions: PaintSystemOption[]
  selectValue: string
  planColorCatalog: PlanColorCatalog
  onSelectSystem: (raw: string) => void
  /** Floor-1 connection-detail sheet: custom annotate title/hint for detail line tool. */
  connectionDetailAnnotate?: boolean
  /** Connection-detail Layer fill: catalog rows + current value (toolbar dropdown). */
  connectionDetailFillLayerRows?: readonly ConnectionDetailFillLayerOptionRow[]
  connectionDetailFillPickKey?: string
  onConnectionDetailFillPickKeyChange?: (value: string) => void
  /** Select-tool selection: offset controls next to the system picker. */
  planToolbarOffset?: PlanToolbarOffsetSpec | null
  /** Default unit for offset fields (matches Setup site unit); user can change per session in the offset panel. */
  offsetMeasureUnitDefault: PlanSiteDisplayUnit
}

function LevelLineDropdown({
  value,
  onChange,
  placedLabels,
}: {
  value: string
  onChange: (v: string) => void
  placedLabels: string[]
}) {
  const [customMode, setCustomMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value
      if (v === '__custom__') {
        setCustomMode(true)
        onChange('')
        requestAnimationFrame(() => inputRef.current?.focus())
      } else {
        setCustomMode(false)
        onChange(v)
      }
    },
    [onChange],
  )

  const placedSet = useMemo(() => new Set(placedLabels.filter(Boolean)), [placedLabels])

  if (customMode) {
    return (
      <div className="w-full min-w-0 flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          placeholder="Custom level name"
          className="flex-1 border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
          aria-label="Custom level name"
        />
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(DEFAULT_LEVEL_PRESETS[0] ?? '') }}
          className="shrink-0 px-1.5 py-1 border border-border text-[9px] font-mono text-muted-foreground hover:text-foreground rounded-sm"
          title="Back to preset list"
        >
          &larr;
        </button>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <select
        value={value}
        onChange={handleSelect}
        className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
        aria-label="Level line label"
        title="Select a level, then click a grid row to place it. Click the same row to remove."
      >
        {DEFAULT_LEVEL_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}{placedSet.has(preset) ? ' ✓' : ''}
          </option>
        ))}
        <option disabled>────────</option>
        <option value="__custom__">Add custom level…</option>
      </select>
    </div>
  )
}

export function ImplementationPlanFloatingToolbar(props: ImplementationPlanFloatingToolbarProps) {
  const {
    traceOverlayEditMode,
    placeMode,
    annotationTool,
    roomTool,
    floorTool,
    structureTool,
    levelLineLabelDraft,
    setLevelLineLabelDraft,
    annotationLabelDraft,
    setAnnotationLabelDraft,
    annotationSelectEditLabel,
    annotationSelectEditLabelId,
    sketch,
    onSketchChange,
    roomPickerSketch,
    buildingDimensions,
    onRoomPickNavigate,
    roomNameDraft,
    setRoomNameDraft,
    selectedRoomZoneCellKeys,
    applySelectedZoneRoomName,
    applyAutoFillAllRooms,
    systemOptions,
    selectValue,
    planColorCatalog,
    onSelectSystem,
    connectionDetailAnnotate = false,
    connectionDetailFillLayerRows = [],
    connectionDetailFillPickKey = '',
    onConnectionDetailFillPickKeyChange,
    planToolbarOffset = null,
    offsetMeasureUnitDefault,
  } = props

  const [planOffsetOpen, setPlanOffsetOpen] = useState(false)
  const [planOffsetEdgeDraft, setPlanOffsetEdgeDraft] = useState('')
  const [planOffsetColX, setPlanOffsetColX] = useState('')
  const [planOffsetColY, setPlanOffsetColY] = useState('')
  const [offsetMeasureUnit, setOffsetMeasureUnit] = useState<PlanSiteDisplayUnit>(offsetMeasureUnitDefault)

  useEffect(() => {
    if (!planToolbarOffset) setPlanOffsetOpen(false)
  }, [planToolbarOffset])

  useEffect(() => {
    setOffsetMeasureUnit(offsetMeasureUnitDefault)
  }, [offsetMeasureUnitDefault])

  const OFFSET_PARSE_HINT =
    'Use decimals, fractions (3/4, 3 1/2, 3-1/2), or a suffix: in, ft, yd, mm, m, or " for inches.'

  const offsetUnitSelect = (
    <select
      aria-label="Unit for offset distances"
      value={offsetMeasureUnit}
      onChange={(ev) => setOffsetMeasureUnit(ev.target.value as PlanSiteDisplayUnit)}
      className="shrink-0 border border-border px-1 py-0.5 font-mono text-[9px] bg-white rounded-sm"
      title={`Values are converted to plan inches. Suffix on a field overrides this (${OFFSET_PARSE_HINT})`}
    >
      {(['in', 'ft', 'yd', 'mm', 'm'] as const).map((u) => (
        <option key={u} value={u}>
          {PLAN_SITE_UNIT_SHORT[u]}
        </option>
      ))}
    </select>
  )

  const title = floatingToolbarTitle(
    traceOverlayEditMode,
    placeMode,
    annotationTool,
    roomTool,
    floorTool,
    structureTool,
    connectionDetailAnnotate,
  )

  const namedRoomPickerRows = useMemo(() => {
    const rooms = listEnclosedPlanRooms(roomPickerSketch, buildingDimensions)
    const rbc = roomPickerSketch.roomByCell
    const raw: { cellKeys: string[]; displayName: string }[] = []
    for (let ri = 0; ri < rooms.length; ri++) {
      const zone = rooms[ri]!
      if (!roomZoneHasAssignedName(zone.cellKeys, rbc)) continue
      raw.push({
        cellKeys: [...zone.cellKeys],
        displayName: resolveRoomDisplayName(zone.cellKeys, rbc, ri + 1),
      })
    }
    raw.sort((a, b) => {
      const c = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
      if (c !== 0) return c
      return (a.cellKeys[0] ?? '').localeCompare(b.cellKeys[0] ?? '')
    })
    const nameCount = new Map<string, number>()
    for (const r of raw) {
      const nk = r.displayName.toLowerCase()
      nameCount.set(nk, (nameCount.get(nk) ?? 0) + 1)
    }
    const nameIdx = new Map<string, number>()
    return raw.map((r) => {
      const nk = r.displayName.toLowerCase()
      const total = nameCount.get(nk) ?? 1
      const n = (nameIdx.get(nk) ?? 0) + 1
      nameIdx.set(nk, n)
      const optionLabel =
        total > 1 && n > 1 ? `${r.displayName} (${n})` : r.displayName
      return { ...r, optionLabel }
    })
  }, [roomPickerSketch, buildingDimensions])

  const floatingToolbarHint = useMemo((): string | undefined => {
    if (traceOverlayEditMode) {
      const returnTo = placeMode === 'annotate'
        ? 'annotations'
        : placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'roof'
          ? 'cell paint'
          : placeMode === 'column'
            ? 'columns'
            : placeMode === 'room'
              ? 'room naming'
              : isMepDisciplineMode(placeMode)
                ? (PLACE_MODE_LABELS[placeMode]?.toLowerCase() ?? 'MEP tools')
                : 'walls and lines'
      return `Layer tools are paused while you adjust the trace. Press Done in the bottom trace panel to return to ${returnTo}.`
    }
    if (placeMode === 'annotate' && annotationTool === 'groundLine') {
      return 'Click a grid row for a full-width ground line; another row moves it. Delete in the zoom bar clears it while this tool is active.'
    }
    if (
      placeMode === 'annotate' &&
      annotationTool === 'sectionCut' &&
      connectionDetailAnnotate
    ) {
      return 'Drag from one grid intersection to another; diagonal segments are allowed. Use Erase to remove one grid segment at a time along the line.'
    }
    if (placeMode === 'annotate' && annotationTool === 'erase' && connectionDetailAnnotate) {
      return 'Tiny drag on a highlighted grid segment removes that step of the detail line (same idea as wall segment erase).'
    }
    if (placeMode === 'annotate' && annotationTool === 'select' && connectionDetailAnnotate) {
      return 'Click or box-select individual grid segments along a detail line (not the whole polyline); Shift adds or removes; Delete removes selected segments (splits lines like Erase).'
    }
    if (placeMode === 'annotate' && annotationTool === 'flipConnectionStripLayers' && connectionDetailAnnotate) {
      return 'Click a junction wall strip or MEP band to reverse catalog layer order for that direction only; click again to restore. Saved on this connection sheet.'
    }
    if (
      placeMode === 'annotate' &&
      annotationTool === 'connectionDetailLayerFill' &&
      connectionDetailAnnotate
    ) {
      return 'Choose a layer or Clear, then hover to preview the fill region (detail lines only). Click to apply.'
    }
    if (placeMode === 'annotate') {
      if (annotationTool === 'levelLine' || annotationTool === 'textLabel') return undefined
      if (annotationTool === 'select' && annotationSelectEditLabel) return undefined
      return 'Hover the annotation buttons in the bottom bar for tool-specific help.'
    }
    if (placeMode === 'room' && (roomTool === 'paint' || roomTool === 'rect' || roomTool === 'erase')) {
      return 'Use Line or Rect for room boundaries, or close areas with walls. Use Fill or Auto-fill from the bottom bar to name zones.'
    }
    return undefined
  }, [
    traceOverlayEditMode,
    placeMode,
    annotationTool,
    roomTool,
    annotationSelectEditLabel,
    connectionDetailAnnotate,
  ])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center px-3 sm:px-4">
      <div className="pointer-events-auto w-full max-w-md min-w-0">
        <ToolbarGroup
          title={title}
          hint={floatingToolbarHint}
          className="min-w-[12rem] border-border/80 bg-white/95 shadow-lg backdrop-blur-sm"
          bodyClassName="flex-col items-stretch w-full min-w-0"
        >
          {traceOverlayEditMode ? null : placeMode === 'annotate' && annotationTool === 'groundLine' ? null : placeMode === 'annotate' && annotationTool === 'levelLine' ? (
            <LevelLineDropdown
              value={levelLineLabelDraft}
              onChange={setLevelLineLabelDraft}
              placedLabels={sketch.elevationLevelLines?.map((l) => l.label ?? '') ?? []}
            />
          ) : placeMode === 'annotate' && annotationTool === 'textLabel' ? (
            <div className="w-full min-w-0">
              <input
                type="text"
                value={annotationLabelDraft}
                onChange={(ev) => setAnnotationLabelDraft(ev.target.value)}
                placeholder="Label text"
                className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                aria-label="Text label"
                title="Click the plan to drop this text at the pointer (plan coordinates). Erase tool removes the nearest label."
              />
            </div>
          ) : placeMode === 'annotate' &&
            annotationTool === 'connectionDetailLayerFill' &&
            connectionDetailAnnotate &&
            connectionDetailFillLayerRows.length > 0 &&
            onConnectionDetailFillPickKeyChange ? (
            <ConnectionDetailFillLayerPicker
              rows={connectionDetailFillLayerRows}
              value={connectionDetailFillPickKey}
              onChange={onConnectionDetailFillPickKeyChange}
            />
          ) : placeMode === 'annotate' && annotationTool === 'select' && annotationSelectEditLabel ? (
            <div className="w-full min-w-0">
              <input
                type="text"
                value={annotationSelectEditLabel.text}
                onChange={(ev) => {
                  const t = ev.target.value
                  const id = annotationSelectEditLabelId!
                  onSketchChange({
                    ...sketch,
                    annotationLabels: (sketch.annotationLabels ?? []).map((l) =>
                      l.id === id ? { ...l, text: t } : l,
                    ),
                  })
                }}
                placeholder="Label text"
                className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                aria-label="Selected label text"
                title="Edits the selected text annotation on the plan. Del / ⌫ removes the selection from the sketch."
              />
            </div>
          ) : placeMode === 'annotate' ? null : placeMode === 'room' && roomTool === 'fill' ? (
            <div className="w-full min-w-0">
              <input
                type="text"
                value={roomNameDraft}
                onChange={(ev) => setRoomNameDraft(ev.target.value)}
                placeholder="Room name"
                className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                aria-label="Room name for fill"
                title="Click inside a zone bounded by walls or room lines to set this name. Clear the field and click to remove names from that zone."
              />
            </div>
          ) : placeMode === 'room' && roomTool === 'autoFill' ? (
            <div className="flex flex-col gap-2 w-full min-w-0 font-mono text-[9px] text-muted-foreground">
              <div className="w-full min-w-0">
                <input
                  type="text"
                  value={roomNameDraft}
                  onChange={(ev) => setRoomNameDraft(ev.target.value)}
                  placeholder="Room (default)"
                  className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                  aria-label="Auto-fill name prefix"
                  title='Each enclosed zone becomes "Prefix 1", "Prefix 2", … in stable order. Empty field uses "Room".'
                />
              </div>
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
            <div className="w-full min-w-0 flex flex-col gap-1.5">
              {namedRoomPickerRows.length === 0 ? (
                !selectedRoomZoneCellKeys?.length ? (
                  <p
                    className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1 truncate"
                    title="Use Fill inside a closed zone, or click a filled room on the plan (away from boundary lines)."
                  >
                    No named rooms yet.
                  </p>
                ) : (
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
                    placeholder="Room name"
                    className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                    aria-label="Zone room name"
                    title="Edit the name, then blur the field or press Enter to apply. Clear the name and apply to remove labels from that zone."
                  />
                )
              ) : (
                <>
                  <NamedRoomJumpPicker
                    rows={namedRoomPickerRows}
                    selectedZoneKey={
                      selectedRoomZoneCellKeys?.length
                        ? planRoomZoneKey(selectedRoomZoneCellKeys)
                        : null
                    }
                    onPick={(row) => onRoomPickNavigate({ cellKeys: row.cellKeys, displayName: row.displayName })}
                  />
                  {selectedRoomZoneCellKeys?.length ? (
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
                      placeholder="Room name"
                      className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                      aria-label="Zone room name"
                      title="Edit the name, then blur the field or press Enter to apply. Clear the name and apply to remove labels from that zone."
                    />
                  ) : null}
                </>
              )}
            </div>
          ) : placeMode === 'room' ? null : (
            <>
              <div className="flex flex-row gap-1.5 w-full min-w-0 items-stretch">
                <div className="flex-1 min-w-0">
                  <PlanSystemPicker
                    options={systemOptions}
                    value={selectValue}
                    placeMode={placeMode}
                    planColorCatalog={planColorCatalog}
                    onChange={onSelectSystem}
                    disabled={systemOptions.length === 0}
                  />
                </div>
                {planToolbarOffset ? (
                  <button
                    type="button"
                    onClick={() => setPlanOffsetOpen((o) => !o)}
                    className={planOffsetOpen ? btnOn : btnIdle}
                    title={
                      planToolbarOffset.kind === 'edge'
                        ? `Perpendicular offset from grid (stored as plan inches). Horizontal: +Y, vertical: +X. ${OFFSET_PARSE_HINT}`
                        : `ΔX / ΔY from grid center (stored as plan inches). ${OFFSET_PARSE_HINT}`
                    }
                  >
                    Offset
                  </button>
                ) : null}
              </div>
              {planToolbarOffset && planOffsetOpen ? (
                <div className="flex flex-col gap-1.5 pt-1.5 mt-0.5 border-t border-border/60 w-full min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[8px] text-muted-foreground shrink-0">Unit</span>
                    {offsetUnitSelect}
                  </div>
                  <p className="font-mono text-[8px] text-muted-foreground leading-snug">{OFFSET_PARSE_HINT}</p>
                  {planToolbarOffset.kind === 'edge' ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[8px] text-muted-foreground shrink-0">Perp.</span>
                      <input
                        type="text"
                        value={planOffsetEdgeDraft}
                        onChange={(ev) => setPlanOffsetEdgeDraft(ev.target.value)}
                        placeholder="e.g. 3/4 or 6 mm"
                        className="min-w-[6rem] flex-1 max-w-[10rem] border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm"
                        title={OFFSET_PARSE_HINT}
                      />
                      <button
                        type="button"
                        className={btnIdle}
                        onClick={() => {
                          const inches = parseLinearMeasureToPlanInches(planOffsetEdgeDraft, offsetMeasureUnit)
                          if (inches === null) {
                            window.alert(`Could not parse offset. ${OFFSET_PARSE_HINT}`)
                            return
                          }
                          planToolbarOffset.applyPerp(inches)
                        }}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className={btnIdle}
                        onClick={() => {
                          planToolbarOffset.clear()
                          setPlanOffsetEdgeDraft('')
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[8px] text-muted-foreground shrink-0">ΔX</span>
                        <input
                          type="text"
                          value={planOffsetColX}
                          onChange={(ev) => setPlanOffsetColX(ev.target.value)}
                          placeholder="0"
                          className="min-w-[4.5rem] border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm"
                          title={OFFSET_PARSE_HINT}
                        />
                        <span className="font-mono text-[8px] text-muted-foreground shrink-0">ΔY</span>
                        <input
                          type="text"
                          value={planOffsetColY}
                          onChange={(ev) => setPlanOffsetColY(ev.target.value)}
                          placeholder="0"
                          className="min-w-[4.5rem] border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm"
                          title={OFFSET_PARSE_HINT}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className={btnIdle}
                          onClick={() => {
                            const dx = parseOptionalLinearToPlanInches(planOffsetColX, offsetMeasureUnit)
                            const dy = parseOptionalLinearToPlanInches(planOffsetColY, offsetMeasureUnit)
                            if (dx === null || dy === null) {
                              window.alert(`Could not parse ΔX/ΔY. ${OFFSET_PARSE_HINT}`)
                              return
                            }
                            planToolbarOffset.apply(dx, dy)
                          }}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className={btnIdle}
                          onClick={() => {
                            planToolbarOffset.clear()
                            setPlanOffsetColX('')
                            setPlanOffsetColY('')
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </ToolbarGroup>
      </div>
    </div>
  )
}

export type ImplementationPlanBottomToolbarProps = {
  traceOverlayEditMode: boolean
  hasTraceOverlay: boolean
  tr: PlanTraceOverlay | undefined
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch, opts?: { skipUndo?: boolean }) => void
  traceMoveRange: number
  traceTx: number
  traceTy: number
  traceRotateDeg: number
  traceScale: number
  resetTraceOverlayTransform: () => void
  planViewContext: ImplementationPlanViewContext
  placeMode: PlanPlaceMode
  structureTool: LayoutTool
  setStructureTool: (t: LayoutTool) => void
  roomTool: RoomTool
  setRoomTool: (t: RoomTool) => void
  floorTool: FloorTool
  setFloorTool: (t: FloorTool) => void
  annotationTool: AnnotationTool
  setAnnotationTool: (t: AnnotationTool) => void
  setTraceOverlayEditMode: (v: boolean) => void
  /** When set, only these annotation sub-tools render in Annotate mode (e.g. connection detail: detail line + erase). */
  allowedAnnotationTools?: readonly AnnotationTool[] | null
  /** Relabel Section → Detail line and tune tooltips for connection-detail sheets. */
  connectionDetailAnnotate?: boolean
  /** When all catalog assembly layers are visible — adds Flip tool for arch lines and columns. */
  assemblyLayersToolbar?: boolean
}

export function ImplementationPlanBottomToolbar(props: ImplementationPlanBottomToolbarProps) {
  const {
    traceOverlayEditMode,
    hasTraceOverlay,
    tr,
    sketch,
    onSketchChange,
    traceMoveRange,
    traceTx,
    traceTy,
    traceRotateDeg,
    traceScale,
    resetTraceOverlayTransform,
    planViewContext,
    placeMode,
    structureTool,
    setStructureTool,
    roomTool,
    setRoomTool,
    floorTool,
    setFloorTool,
    annotationTool,
    setAnnotationTool,
    setTraceOverlayEditMode,
    allowedAnnotationTools,
    connectionDetailAnnotate = false,
    assemblyLayersToolbar = false,
  } = props

  const annAllowed = (t: AnnotationTool) => !allowedAnnotationTools || allowedAnnotationTools.includes(t)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:px-4">
      <div
        className={`pointer-events-auto min-w-0 ${
          traceOverlayEditMode && hasTraceOverlay ? 'w-full max-w-md' : 'w-max max-w-[min(100%,24rem)]'
        }`}
      >
        <ToolbarGroup
          title={traceOverlayEditMode && hasTraceOverlay ? 'Overlay' : 'Tool'}
          className="border-border/80 bg-white/95 shadow-lg backdrop-blur-sm"
          bodyClassName={
            traceOverlayEditMode && hasTraceOverlay ? 'flex-col items-stretch gap-2 w-full min-w-0' : undefined
          }
        >
          {traceOverlayEditMode && hasTraceOverlay && tr ? (
            <>
              <div className="flex items-center gap-1.5 w-full min-w-0">
                <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0 uppercase">X</span>
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
                <span className="font-mono text-[8px] text-muted-foreground w-5 shrink-0 uppercase">Y</span>
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
                      onSketchChange({ ...sketch, traceOverlay: { ...tr, rotateDeg: v } }, { skipUndo: true })
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
                      onSketchChange({ ...sketch, traceOverlay: { ...tr, scale: v / 100 } }, { skipUndo: true })
                    }
                  }}
                  className="w-[4.25rem] shrink-0 border border-border px-1 py-0.5 font-mono text-[10px] bg-white rounded-sm tabular-nums"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setTraceOverlayEditMode(false)
                    if (planViewContext.kind === 'elevation') setAnnotationTool('groundLine')
                  }}
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
                placeMode !== 'roof' &&
                placeMode !== 'column' &&
                placeMode !== 'annotate' &&
                placeMode !== 'room' &&
                !isMepPointMode(placeMode) &&
                (
                  [
                    ...(['paint', 'rect', 'erase', 'select'] as const),
                    ...(assemblyLayersToolbar && !isMepRunMode(placeMode)
                      ? (['flipAssembly'] as const)
                      : []),
                  ] as LayoutTool[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setStructureTool(t)}
                    className={structureTool === t ? btnOn : btnIdle}
                    title={
                      t === 'flipAssembly'
                        ? 'Click a segment or drag a box: each action toggles interior/exterior assembly stack on multi-layer walls, openings, roof, or stairs'
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
                            : 'Flip'}
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
              {(placeMode === 'floor' || placeMode === 'stairs' || placeMode === 'roof') &&
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
                (assemblyLayersToolbar
                  ? (['paint', 'erase', 'flipAssembly'] as const)
                  : (['paint', 'erase'] as const)
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFloorTool(t)}
                    className={floorTool === t ? btnOn : btnIdle}
                    title={
                      t === 'flipAssembly'
                        ? 'Click a column or drag a box: each action toggles assembly layer order on multi-layer columns'
                        : undefined
                    }
                  >
                    {t === 'paint' ? 'Paint' : t === 'erase' ? 'Erase' : 'Flip'}
                  </button>
                ))}
              {isMepPointMode(placeMode) &&
                (['paint', 'erase', 'select'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFloorTool(t)}
                    className={floorTool === t ? btnOn : btnIdle}
                    title={
                      t === 'paint'
                        ? `Place ${PLACE_MODE_LABELS[placeMode]?.toLowerCase() ?? 'device'} symbols on the plan`
                        : t === 'erase'
                          ? 'Drag a box to erase symbols inside; tiny drag removes one under the pointer'
                          : 'Drag a box to select symbols; Shift adds; tiny drag selects one; Delete removes selection'
                    }
                  >
                    {t === 'paint' ? 'Place' : t === 'erase' ? 'Erase' : 'Select'}
                  </button>
                ))}
              {placeMode === 'annotate' && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {planViewContext.kind === 'elevation' && annAllowed('groundLine') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('groundLine')}
                      className={annotationTool === 'groundLine' ? btnOn : btnIdle}
                      title="Full-width horizontal grade on the elevation grid (elevation sheets only)"
                    >
                      Ground line
                    </button>
                  )}
                  {planViewContext.kind === 'elevation' && annAllowed('levelLine') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('levelLine')}
                      className={annotationTool === 'levelLine' ? btnOn : btnIdle}
                      title="Add or remove shared level / datum lines on the elevation grid (all faces)"
                    >
                      Level line
                    </button>
                  )}
                  {annAllowed('measureLine') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('measureLine')}
                      className={annotationTool === 'measureLine' ? btnOn : btnIdle}
                      title="Drag along grid edges for a dimension run with length label (Esc clears all dimensions)"
                    >
                      Measure
                    </button>
                  )}
                  {annAllowed('gridLine') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('gridLine')}
                      className={annotationTool === 'gridLine' ? btnOn : btnIdle}
                      title="Dashed reference polyline on grid edges (no numeric label)"
                    >
                      Grid
                    </button>
                  )}
                  {annAllowed('textLabel') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('textLabel')}
                      className={annotationTool === 'textLabel' ? btnOn : btnIdle}
                      title="Type text above, then click the plan to place"
                    >
                      Text
                    </button>
                  )}
                  {annAllowed('sectionCut') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('sectionCut')}
                      className={annotationTool === 'sectionCut' ? btnOn : btnIdle}
                      title={
                        connectionDetailAnnotate
                          ? 'Straight detail line between two grid intersections; diagonals allowed'
                          : 'Straight section cut line between two grid nodes, with opposing markers'
                      }
                    >
                      {connectionDetailAnnotate ? 'Detail line' : 'Section'}
                    </button>
                  )}
                  {annAllowed('flipConnectionStripLayers') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('flipConnectionStripLayers')}
                      className={annotationTool === 'flipConnectionStripLayers' ? btnOn : btnIdle}
                      title="Click a junction strip to reverse wall layer order for that arm (per direction); saved on this sheet"
                    >
                      Flip layers
                    </button>
                  )}
                  {connectionDetailAnnotate && annAllowed('connectionDetailLayerFill') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('connectionDetailLayerFill')}
                      className={annotationTool === 'connectionDetailLayerFill' ? btnOn : btnIdle}
                      title="Choose a layer in the top bar; hover previews the zone bounded by your detail lines, then click to fill or clear"
                    >
                      Layer fill
                    </button>
                  )}
                  {annAllowed('select') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('select')}
                      className={annotationTool === 'select' ? btnOn : btnIdle}
                      title="Click to select annotations; Shift+click to add or remove from selection; Delete removes selected"
                    >
                      Select
                    </button>
                  )}
                  {annAllowed('erase') && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('erase')}
                      className={annotationTool === 'erase' ? btnOn : btnIdle}
                      title={
                        connectionDetailAnnotate
                          ? 'Tiny drag on a grid segment along a detail line removes that segment (like wall erase); otherwise removes the nearest annotation'
                          : 'Remove nearest annotation: dimension → grid ref → section line → level line (elevation) → text label'
                      }
                    >
                      Erase
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </ToolbarGroup>
      </div>
    </div>
  )
}
