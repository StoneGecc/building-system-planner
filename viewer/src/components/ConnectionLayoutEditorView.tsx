import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { BuildingDimensions, SystemData } from '../types/system'
import type { BuildingLevel, PlanLayoutSketch, PlanSketchCommitOptions } from '../types/planLayout'
import { floor1SheetById } from '../data/floor1Sheets'
import type { PlanConnection } from '../lib/planConnections'
import {
  formatConnectionParticipantsCompact,
  formatConnectionParticipantsFull,
} from '../lib/planConnections'
import { ImplementationPlanView } from './ImplementationPlanView'
import { cloneSketch } from '../lib/planSketchClone'

const HISTORY_CAP = 50

export interface ConnectionLayoutEditorViewProps {
  buildingDimensions: BuildingDimensions
  orderedSystems: SystemData[]
  connection: PlanConnection
  connectionOrdinal: number
  connectionCount: number
  sketch: PlanLayoutSketch
  onSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  /** Level 1 layout — Setup (grid, site, detail grid, etc.) always edits this sketch, not the per-connection sketch. */
  layoutSketch: PlanLayoutSketch
  onLayoutSketchChange: (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => void
  connectionDetailSketchesNonempty: boolean
  onResetAllConnectionSketches: () => void
  buildingHeightIn: number
  onBuildingHeightInChange: (inches: number) => void
  buildingLevels?: BuildingLevel[]
  onDownloadFullPlan?: () => void
  onImportFullPlan?: (file: File) => Promise<boolean>
  /** Bulk toggle CSV assembly layer visibility (same as system table Show checkboxes). */
  onToggleAllSystemsAssemblyLayers?: () => void
  className?: string
}

function ConnectionLayoutEditorViewComponent({
  buildingDimensions,
  orderedSystems,
  connection: c,
  connectionOrdinal,
  connectionCount,
  sketch,
  onSketchChange,
  layoutSketch,
  onLayoutSketchChange,
  connectionDetailSketchesNonempty,
  onResetAllConnectionSketches,
  buildingHeightIn,
  onBuildingHeightInChange,
  buildingLevels,
  onDownloadFullPlan,
  onImportFullPlan,
  onToggleAllSystemsAssemblyLayers,
  className,
}: ConnectionLayoutEditorViewProps) {
  const sketchRef = useRef(sketch)
  sketchRef.current = sketch

  const undoStackRef = useRef<PlanLayoutSketch[]>([])
  const redoStackRef = useRef<PlanLayoutSketch[]>([])
  const [stackEpoch, setStackEpoch] = useState(0)
  const bumpUi = useCallback(() => setStackEpoch((x) => x + 1), [])

  const commit = useCallback(
    (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
      if (!opts?.skipUndo) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(HISTORY_CAP - 1)),
          cloneSketch(sketchRef.current),
        ]
        redoStackRef.current = []
      }
      onSketchChange(next, opts)
      bumpUi()
    },
    [onSketchChange, bumpUi],
  )

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const snap = stack[stack.length - 1]!
    undoStackRef.current = stack.slice(0, -1)
    const current = cloneSketch(sketchRef.current)
    redoStackRef.current = [...redoStackRef.current.slice(-(HISTORY_CAP - 1)), current]
    onSketchChange(snap, { skipUndo: true })
    bumpUi()
  }, [onSketchChange, bumpUi])

  const redo = useCallback(() => {
    const rstack = redoStackRef.current
    if (rstack.length === 0) return
    const snap = rstack[rstack.length - 1]!
    redoStackRef.current = rstack.slice(0, -1)
    const current = cloneSketch(sketchRef.current)
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_CAP - 1)), current]
    onSketchChange(snap, { skipUndo: true })
    bumpUi()
  }, [onSketchChange, bumpUi])

  useEffect(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    bumpUi()
  }, [c.id, bumpUi])

  const title = `Connection ${connectionOrdinal + 1} / ${connectionCount} · ${c.label}`
  const occ = c.occurrences
  const occListStr = (() => {
    if (!occ || occ.length <= 1) return ''
    const max = 14
    if (occ.length <= max) return occ.map((o) => `${o.nodeI}:${o.nodeJ}`).join(', ')
    const head = occ.slice(0, max).map((o) => `${o.nodeI}:${o.nodeJ}`).join(', ')
    return `${head} … +${occ.length - max} more`
  })()
  const subtitle =
    occ && occ.length > 1
      ? `${occ.length} plan locations · ${c.shape} · ${occListStr}`
      : `Grid junction ${c.nodeI}:${c.nodeJ} · ${c.shape}`

  const participantsCompact = formatConnectionParticipantsCompact(c)
  const participantsFull = formatConnectionParticipantsFull(c)

  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0
  void stackEpoch

  return (
    <ImplementationPlanView
      className={className}
      annotationsOnly
      annotationsContextKey={c.id}
      planAlternateTitle={{
        primary: title,
        secondary: subtitle,
        tertiary: participantsCompact,
        tertiaryTitle: participantsFull,
      }}
      vectorExportBasenameOverride={`connection-${c.id.replace(/[^\w-]+/g, '-').slice(0, 48)}`}
      connectionDetailForCanvas={c}
      buildingDimensions={buildingDimensions}
      orderedSystems={orderedSystems}
      sketch={sketch}
      onSketchChange={commit}
      onUndo={undo}
      canUndo={canUndo}
      onRedo={redo}
      canRedo={canRedo}
      planViewContext={{ kind: 'floor1', sheet: floor1SheetById('layout') }}
      buildingHeightIn={buildingHeightIn}
      onBuildingHeightInChange={onBuildingHeightInChange}
      layoutSketch={layoutSketch}
      onLayoutSketchChange={onLayoutSketchChange}
      connectionDetailSketchesNonempty={connectionDetailSketchesNonempty}
      onResetAllConnectionSketches={onResetAllConnectionSketches}
      onDownloadFullPlan={onDownloadFullPlan}
      onImportFullPlan={onImportFullPlan}
      onToggleAllSystemsAssemblyLayers={onToggleAllSystemsAssemblyLayers}
      levelSketches={undefined}
      buildingLevels={buildingLevels}
    />
  )
}

export const ConnectionLayoutEditorView = memo(ConnectionLayoutEditorViewComponent)
