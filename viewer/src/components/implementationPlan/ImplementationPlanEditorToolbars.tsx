import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlanLayoutSketch, PlanTraceOverlay } from '../../types/planLayout'
import type { BuildingDimensions } from '../../types/system'
import type { AnnotationTool, FloorTool, LayoutTool, RoomTool } from '../PlanLayoutEditor'
import { PlanSystemPicker, type PaintSystemOption } from '../PlanSystemPicker'
import { ToolbarGroup } from '../ToolbarGroup'
import type { PlanColorCatalog, PlanPlaceMode } from '../../lib/planLayerColors'
import {
  listEnclosedPlanRooms,
  planRoomFillColorForName,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
} from '../../lib/planRooms'
import { cn } from '../../lib/utils'
import type { ImplementationPlanViewContext } from './viewContext'

type NamedRoomJumpRow = {
  cellKeys: string[]
  displayName: string
  optionLabel: string
}

function planRoomZoneKey(cellKeys: readonly string[]): string {
  return [...cellKeys].sort().join('|')
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

function floatingToolbarTitle(
  traceOverlayEditMode: boolean,
  placeMode: PlanPlaceMode,
  annotationTool: AnnotationTool,
  roomTool: RoomTool,
  floorTool: FloorTool,
  structureTool: LayoutTool,
): string {
  if (traceOverlayEditMode) return 'Drawing paused'
  if (placeMode === 'annotate') {
    if (annotationTool === 'groundLine') return 'Annotation · Ground line'
    if (annotationTool === 'levelLine') return 'Annotation · Level line'
    if (annotationTool === 'measureLine') return 'Annotation · Measure line'
    if (annotationTool === 'gridLine') return 'Annotation · Grid line'
    if (annotationTool === 'textLabel') return 'Annotation · Text'
    if (annotationTool === 'sectionCut') return 'Annotation · Section'
    if (annotationTool === 'select') return 'Annotation · Select'
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
    return floorTool === 'erase' ? 'Columns · Erase' : 'Columns · Paint'
  }
  if (placeMode === 'floor' || placeMode === 'stairs') return 'Paint with'
  if (structureTool === 'rect') return 'Rectangle with'
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
}

export function ImplementationPlanFloatingToolbar(props: ImplementationPlanFloatingToolbarProps) {
  const {
    traceOverlayEditMode,
    placeMode,
    annotationTool,
    roomTool,
    floorTool,
    structureTool,
    planViewContext,
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
  } = props

  const title = floatingToolbarTitle(
    traceOverlayEditMode,
    placeMode,
    annotationTool,
    roomTool,
    floorTool,
    structureTool,
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

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center px-3 sm:px-4">
      <div className="pointer-events-auto w-full max-w-md min-w-0">
        <ToolbarGroup
          title={title}
          className="min-w-[12rem] border-border/80 bg-white/95 shadow-lg backdrop-blur-sm"
          bodyClassName="flex-col items-stretch w-full min-w-0"
        >
          {traceOverlayEditMode ? (
            <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
              Layer tools are off while you adjust the trace. Press <span className="text-foreground/80">Done</span>{' '}
              in the bottom overlay panel to return to{' '}
              {placeMode === 'annotate'
                ? 'annotations.'
                : placeMode === 'floor' || placeMode === 'stairs'
                  ? 'cell paint.'
                  : placeMode === 'column'
                    ? 'columns.'
                    : placeMode === 'room'
                      ? 'room naming.'
                      : 'walls and lines.'}
            </p>
          ) : placeMode === 'annotate' && annotationTool === 'groundLine' ? (
            <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
              Elevation only: click the grid for a full-width horizontal <span className="text-foreground/80">ground line</span>.
              Click another row to move it. <span className="text-foreground/80">Delete</span> in the zoom bar clears it while
              this tool is active.
            </p>
          ) : placeMode === 'annotate' && annotationTool === 'levelLine' ? (
            <div className="w-full min-w-0">
              <input
                type="text"
                value={levelLineLabelDraft}
                onChange={(ev) => setLevelLineLabelDraft(ev.target.value)}
                placeholder="e.g. FF, L2"
                className="w-full border border-border px-2 py-1.5 font-mono text-[11px] text-foreground bg-white rounded-sm"
                aria-label="Level line tag (optional)"
                title="Shown at the left of the line. Click a grid row to add; click the same row again to remove that level line."
              />
            </div>
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
          ) : placeMode === 'annotate' ? (
            <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
              Use the tools below.{' '}
              {planViewContext.kind === 'elevation' ? (
                <>
                  <span className="text-foreground/80">Ground line</span> is the shared grade;{' '}
                  <span className="text-foreground/80">Level line</span> adds more full-width datums (toggle a row off by
                  clicking again). Use <span className="text-foreground/80">Erase</span> or{' '}
                  <span className="text-foreground/80">Select</span> to remove level lines.{' '}
                </>
              ) : null}
              <span className="text-foreground/80">Measure</span> and <span className="text-foreground/80">Grid</span> follow
              grid edges like wall Line. <span className="text-foreground/80">Section</span> is a straight cut between two
              nodes. <span className="text-foreground/80">Select</span> picks annotations; with one text label selected, edit
              it in this bar. <span className="text-foreground/80">Erase</span> uses hover preview; click or drag a box to
              remove annotations (dimensions → grid refs → sections → labels).
            </p>
          ) : placeMode === 'room' && roomTool === 'fill' ? (
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
                  <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
                    No named rooms yet — use <span className="text-foreground/80">Fill</span> inside a closed zone, or click a
                    filled room on the plan (away from boundary lines).
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
          ) : placeMode === 'room' ? (
            <p className="font-mono text-[9px] text-muted-foreground leading-snug px-0.5 py-1">
              Use <span className="text-foreground/80">Line</span> or <span className="text-foreground/80">Rect</span> for
              room boundaries, or close areas with <span className="text-foreground/80">walls</span>. Use{' '}
              <span className="text-foreground/80">Fill</span> to name one zone per click, or{' '}
              <span className="text-foreground/80">Auto-fill</span> to number every zone at once.
            </p>
          ) : (
            <PlanSystemPicker
              options={systemOptions}
              value={selectValue}
              placeMode={placeMode}
              planColorCatalog={planColorCatalog}
              onChange={onSelectSystem}
              disabled={systemOptions.length === 0}
            />
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
  } = props

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
                placeMode !== 'column' &&
                placeMode !== 'annotate' &&
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
              {placeMode === 'annotate' && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {planViewContext.kind === 'elevation' && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('groundLine')}
                      className={annotationTool === 'groundLine' ? btnOn : btnIdle}
                      title="Full-width horizontal grade on the elevation grid (elevation sheets only)"
                    >
                      Ground line
                    </button>
                  )}
                  {planViewContext.kind === 'elevation' && (
                    <button
                      type="button"
                      onClick={() => setAnnotationTool('levelLine')}
                      className={annotationTool === 'levelLine' ? btnOn : btnIdle}
                      title="Add or remove shared level / datum lines on the elevation grid (all faces)"
                    >
                      Level line
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('measureLine')}
                    className={annotationTool === 'measureLine' ? btnOn : btnIdle}
                    title="Drag along grid edges for a dimension run with length label (Esc clears all dimensions)"
                  >
                    Measure
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('gridLine')}
                    className={annotationTool === 'gridLine' ? btnOn : btnIdle}
                    title="Dashed reference polyline on grid edges (no numeric label)"
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('textLabel')}
                    className={annotationTool === 'textLabel' ? btnOn : btnIdle}
                    title="Type text above, then click the plan to place"
                  >
                    Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('sectionCut')}
                    className={annotationTool === 'sectionCut' ? btnOn : btnIdle}
                    title="Straight section cut line between two grid nodes, with opposing markers"
                  >
                    Section
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('select')}
                    className={annotationTool === 'select' ? btnOn : btnIdle}
                    title="Click to select annotations; Shift+click to add or remove from selection; Delete removes selected"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnnotationTool('erase')}
                    className={annotationTool === 'erase' ? btnOn : btnIdle}
                    title="Remove nearest annotation: dimension → grid ref → section line → level line (elevation) → text label"
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
  )
}
