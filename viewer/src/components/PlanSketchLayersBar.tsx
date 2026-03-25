import { useMemo } from 'react'
import type { PlanLayoutSketch } from '../types/planLayout'
import { resolvedSiteInches } from '../types/planLayout'
import type { BuildingDimensions, SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import type { ActiveCatalog } from './PlanLayoutEditor'
import {
  planCellFill,
  planEdgeStroke,
  planFloorFillHsla,
  planPaintSwatchColor,
  type PlanColorCatalog,
} from '../lib/planLayerColors'
import { cn } from '../lib/utils'
import {
  formatPlanAreaFromSqIn,
  formatSiteLinearWithUnit,
  type PlanSiteDisplayUnit,
} from '../lib/planDisplayUnits'
import {
  PLAN_ANNOTATIONS_LAYER_ID,
  PLAN_ROOMS_LAYER_ID,
  PLAN_ROOMS_LAYER_SOURCE,
  PLAN_ROOMS_LAYER_SYSTEM_ID,
} from '../lib/planRoomsLayerIdentity'
import { gridCounts } from '../lib/gridEdges'
import { planEnclosureBarrierKeys, computeEnclosedRoomComponents } from '../lib/planRooms'

interface PlanSketchLayersBarProps {
  buildingDimensions: BuildingDimensions
  sketch: PlanLayoutSketch
  /** Site / lot dimension unit (same as Setup) for lengths and floor areas. */
  siteDisplayUnit: PlanSiteDisplayUnit
  orderedSystems: SystemData[]
  mepItems: MepItem[]
  planColorCatalog: PlanColorCatalog
  /** Current active catalog + system (`source\\tsystemId`) for list selection styling. */
  activeLayerIdentity: string
  onLayerHover?: (source: ActiveCatalog, systemId: string) => void
  onLayerHoverEnd?: () => void
  onLayerActivate?: (source: ActiveCatalog, systemId: string) => void
  /** Switch to Annotation mode (toolbar); optional. */
  onAnnotationsLayerActivate?: () => void
  /** When false, MEP layer chips do not switch the editor to MEP (e.g. Layout sheet). */
  allowMepLayerActivate?: boolean
}

type Acc = {
  source: 'arch' | 'mep'
  systemId: string
  walls: number
  runs: number
  windows: number
  doors: number
  roofs: number
  stairs: number
  floorCells: number
  stairSquares: number
  columns: number
}

function resolveLabel(source: 'arch' | 'mep', systemId: string, systems: SystemData[], mep: MepItem[]): string {
  if (source === 'arch') {
    const s = systems.find((x) => x.id === systemId)
    return s ? `${s.id} — ${s.name}` : systemId
  }
  const m = mep.find((x) => x.id === systemId)
  return m ? `[MEP] ${m.id} — ${m.name}` : `[MEP] ${systemId}`
}

export function PlanSketchLayersBar({
  buildingDimensions,
  sketch,
  siteDisplayUnit,
  orderedSystems,
  mepItems,
  planColorCatalog,
  activeLayerIdentity,
  onLayerHover,
  onLayerHoverEnd,
  onLayerActivate,
  onAnnotationsLayerActivate,
  allowMepLayerActivate = true,
}: PlanSketchLayersBarProps) {
  const rows = useMemo(() => {
    const m = new Map<string, Acc>()
    const touch = (source: 'arch' | 'mep', systemId: string): Acc => {
      const k = `${source}\t${systemId}`
      let a = m.get(k)
      if (!a) {
        a = {
          source,
          systemId,
          walls: 0,
          runs: 0,
          windows: 0,
          doors: 0,
          roofs: 0,
          stairs: 0,
          floorCells: 0,
          stairSquares: 0,
          columns: 0,
        }
        m.set(k, a)
      }
      return a
    }
    for (const e of sketch.edges) {
      const a = touch(e.source, e.systemId)
      const k = e.kind ?? 'wall'
      if (k === 'wall') a.walls += 1
      else if (k === 'run') a.runs += 1
      else if (k === 'window') a.windows += 1
      else if (k === 'door') a.doors += 1
      else if (k === 'roof') a.roofs += 1
      else if (k === 'stairs') a.stairs += 1
      else a.walls += 1
    }
    for (const c of sketch.cells ?? []) {
      const a = touch(c.source, c.systemId)
      if (c.cellKind === 'stairs') a.stairSquares += 1
      else a.floorCells += 1
    }
    for (const col of sketch.columns ?? []) {
      const a = touch(col.source, col.systemId)
      a.columns += 1
    }
    const list = [...m.values()]
    const archOrder = new Map(orderedSystems.map((s, i) => [s.id, i]))
    const mepOrder = new Map(mepItems.map((x, i) => [x.id, i]))
    list.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'arch' ? -1 : 1
      const oa = a.source === 'arch' ? archOrder.get(a.systemId) : mepOrder.get(a.systemId)
      const ob = b.source === 'arch' ? archOrder.get(b.systemId) : mepOrder.get(b.systemId)
      if (oa != null && ob != null && oa !== ob) return oa - ob
      if (oa != null && ob == null) return -1
      if (oa == null && ob != null) return 1
      return a.systemId.localeCompare(b.systemId)
    })
    return list.map((acc) => ({
      ...acc,
      label: resolveLabel(acc.source, acc.systemId, orderedSystems, mepItems),
      wallStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'wall' }, planColorCatalog),
      runStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'run' }, planColorCatalog),
      windowStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'window' }, planColorCatalog),
      doorStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'door' }, planColorCatalog),
      roofStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'roof' }, planColorCatalog),
      stairsStroke: planEdgeStroke({ source: acc.source, systemId: acc.systemId, kind: 'stairs' }, planColorCatalog),
      floorFill: planFloorFillHsla(acc.source, acc.systemId, 0.48, planColorCatalog),
      stairCellFill: planCellFill(
        { source: acc.source, systemId: acc.systemId, cellKind: 'stairs' },
        planColorCatalog,
      ),
      columnFill:
        acc.source === 'arch'
          ? planPaintSwatchColor('arch', acc.systemId, 'column', planColorCatalog)
          : planFloorFillHsla(acc.source, acc.systemId, 0.48, planColorCatalog),
    }))
  }, [sketch.edges, sketch.cells, sketch.columns, sketch.gridSpacingIn, orderedSystems, mepItems, planColorCatalog])

  const { enclosedRoomCount, roomBoundaryCount, roomNamedCellCount } = useMemo(() => {
    const delta = sketch.gridSpacingIn
    const { w: siteWIn, h: siteHIn } = resolvedSiteInches(sketch, buildingDimensions)
    let enclosed = 0
    if (delta > 0 && siteWIn > 0 && siteHIn > 0) {
      const { nx, ny } = gridCounts(siteWIn, siteHIn, delta)
      const barriers = planEnclosureBarrierKeys(sketch.roomBoundaryEdges, sketch.edges)
      const { rooms } = computeEnclosedRoomComponents(nx, ny, barriers)
      enclosed = rooms.length
    }
    return {
      enclosedRoomCount: enclosed,
      roomBoundaryCount: sketch.roomBoundaryEdges?.length ?? 0,
      roomNamedCellCount: sketch.roomByCell ? Object.keys(sketch.roomByCell).length : 0,
    }
  }, [sketch, buildingDimensions])

  /** Match plan canvas: labels only appear when there is at least one enclosed zone. */
  const showRoomsLayer = enclosedRoomCount > 0
  const roomsSwatch = 'hsl(230, 22%, 42%)'
  const nDim = sketch.measureRuns?.length ?? 0
  const nGrid = sketch.annotationGridRuns?.length ?? 0
  const nSec = sketch.annotationSectionCuts?.length ?? 0
  const nLab = sketch.annotationLabels?.length ?? 0
  const showAnnotationsLayer = nDim + nGrid + nSec + nLab > 0
  const annotationsSwatch = '#64748b'

  if (rows.length === 0 && !showRoomsLayer && !showAnnotationsLayer) {
    return (
      <div className="shrink-0 border-t border-border/60 bg-transparent px-3 py-2">
        <p className="font-mono text-[9px] text-muted-foreground tracking-wide">
          Plan layers — paint walls, roof edges, windows, doors, runs, or floor cells, or add room boundaries, to see each layer listed here.
        </p>
      </div>
    )
  }

  return (
    <div className="shrink-0 min-w-0 border-t border-border/60 bg-transparent px-2 py-2">
      <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-1 pr-1">
        {rows.map((r) => {
          const delta = sketch.gridSpacingIn > 0 && Number.isFinite(sketch.gridSpacingIn) ? sketch.gridSpacingIn : 0
          const parts: string[] = []
          if (r.walls && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.walls * delta, siteDisplayUnit)} wall`)
          }
          if (r.roofs && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.roofs * delta, siteDisplayUnit)} roof`)
          }
          if (r.windows && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.windows * delta, siteDisplayUnit)} window`)
          }
          if (r.doors && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.doors * delta, siteDisplayUnit)} door`)
          }
          if (r.stairs && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.stairs * delta, siteDisplayUnit)} stair edge`)
          }
          if (r.stairSquares && delta > 0) {
            parts.push(`${formatPlanAreaFromSqIn(r.stairSquares * delta * delta, siteDisplayUnit)} stair`)
          }
          if (r.runs && delta > 0) {
            parts.push(`${formatSiteLinearWithUnit(r.runs * delta, siteDisplayUnit)} run`)
          }
          if (r.floorCells && delta > 0) {
            parts.push(`${formatPlanAreaFromSqIn(r.floorCells * delta * delta, siteDisplayUnit)} floor`)
          }
          if (r.columns > 0) {
            parts.push(`${r.columns} column${r.columns === 1 ? '' : 's'}`)
          }
          const rowIdentity = `${r.source}\t${r.systemId}`
          const isActiveRow = activeLayerIdentity === rowIdentity
          const mepActivateBlocked = r.source === 'mep' && !allowMepLayerActivate
          return (
            <div
              key={`${r.source}:${r.systemId}`}
              role="button"
              tabIndex={0}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 w-[min(18rem,calc(100vw-6rem))] min-w-[11rem] transition-colors',
                mepActivateBlocked
                  ? 'cursor-not-allowed opacity-60 border-border/60 bg-muted/5'
                  : 'cursor-pointer border-border/80 bg-muted/10 hover:bg-muted/25',
                isActiveRow && 'border-foreground/60 bg-muted/35 ring-1 ring-foreground/25',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}
              title={mepActivateBlocked ? `${r.label} — open a trade sheet to edit MEP` : r.label}
              onMouseEnter={() => onLayerHover?.(r.source, r.systemId)}
              onMouseLeave={() => onLayerHoverEnd?.()}
              onClick={() => {
                if (mepActivateBlocked) return
                onLayerActivate?.(r.source, r.systemId)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (mepActivateBlocked) return
                  onLayerActivate?.(r.source, r.systemId)
                }
              }}
            >
              <div className="flex flex-wrap gap-0.5 shrink-0 items-center content-center max-w-[2rem]">
                {r.walls > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.wallStroke }}
                    title="Wall stroke"
                  />
                )}
                {r.roofs > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.roofStroke }}
                    title="Roof edge"
                  />
                )}
                {r.windows > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.windowStroke }}
                    title="Window edge"
                  />
                )}
                {r.doors > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.doorStroke }}
                    title="Door edge"
                  />
                )}
                {r.stairs > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.stairsStroke }}
                    title="Stair edge (legacy line)"
                  />
                )}
                {r.stairSquares > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.stairCellFill }}
                    title="Stair cells"
                  />
                )}
                {r.columns > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.columnFill }}
                    title="Columns"
                  />
                )}
                {r.runs > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.runStroke }}
                    title="MEP / run stroke"
                  />
                )}
                {r.floorCells > 0 && (
                  <span
                    className="block h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: r.floorFill }}
                    title="Floor fill"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="font-mono text-[9px] text-foreground leading-tight truncate">{r.label}</div>
                <div className="font-mono text-[8px] text-muted-foreground leading-tight truncate">
                  {parts.join(' · ')}
                </div>
              </div>
            </div>
          )
        })}
        {showAnnotationsLayer && (
          <div
            key="plan-annotations-layer"
            role="button"
            tabIndex={0}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 w-[min(18rem,calc(100vw-6rem))] min-w-[11rem] cursor-pointer transition-colors',
              'border-border/80 bg-muted/10 hover:bg-muted/25',
              activeLayerIdentity === PLAN_ANNOTATIONS_LAYER_ID &&
                'border-foreground/60 bg-muted/35 ring-1 ring-foreground/25',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            )}
            title="Annotations: dimensions, grid lines, section cuts, text — click to open Annotation tools"
            onMouseLeave={() => onLayerHoverEnd?.()}
            onClick={() => onAnnotationsLayerActivate?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onAnnotationsLayerActivate?.()
              }
            }}
          >
            <div className="flex flex-wrap gap-0.5 shrink-0 items-center content-center max-w-[2rem]">
              <span
                className="block h-2.5 w-2.5 rounded-sm border border-black/15 shrink-0"
                style={{ backgroundColor: annotationsSwatch, opacity: 0.75 }}
                title="Annotation stroke"
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="font-mono text-[9px] text-foreground leading-tight truncate">Annotations</div>
              <div className="font-mono text-[8px] text-muted-foreground leading-tight truncate">
                {[
                  nDim ? `${nDim} dimension run${nDim === 1 ? '' : 's'}` : null,
                  nGrid ? `${nGrid} grid ref${nGrid === 1 ? '' : 's'}` : null,
                  nSec ? `${nSec} section cut${nSec === 1 ? '' : 's'}` : null,
                  nLab ? `${nLab} label${nLab === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
        )}
        {showRoomsLayer && (
          <div
            key="plan-rooms-layer"
            role="button"
            tabIndex={0}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 w-[min(18rem,calc(100vw-6rem))] min-w-[11rem] cursor-pointer transition-colors',
              'border-border/80 bg-muted/10 hover:bg-muted/25',
              activeLayerIdentity === PLAN_ROOMS_LAYER_ID && 'border-foreground/60 bg-muted/35 ring-1 ring-foreground/25',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            )}
            title="Room boundaries and zone names"
            onMouseEnter={() => onLayerHover?.(PLAN_ROOMS_LAYER_SOURCE, PLAN_ROOMS_LAYER_SYSTEM_ID)}
            onMouseLeave={() => onLayerHoverEnd?.()}
            onClick={() => onLayerActivate?.(PLAN_ROOMS_LAYER_SOURCE, PLAN_ROOMS_LAYER_SYSTEM_ID)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onLayerActivate?.(PLAN_ROOMS_LAYER_SOURCE, PLAN_ROOMS_LAYER_SYSTEM_ID)
              }
            }}
          >
            <div className="flex flex-wrap gap-0.5 shrink-0 items-center content-center max-w-[2rem]">
              <span
                className="block h-2.5 w-2.5 rounded-sm border border-black/15 shrink-0"
                style={{ backgroundColor: roomsSwatch, opacity: 0.55 }}
                title="Room boundary stroke"
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="font-mono text-[9px] text-foreground leading-tight truncate">Rooms</div>
              <div className="font-mono text-[8px] text-muted-foreground leading-tight truncate">
                {[
                  `${enclosedRoomCount} enclosed zone${enclosedRoomCount === 1 ? '' : 's'}`,
                  roomBoundaryCount > 0 ? `${roomBoundaryCount} boundary segment${roomBoundaryCount === 1 ? '' : 's'}` : null,
                  roomNamedCellCount > 0
                    ? `${roomNamedCellCount} named cell${roomNamedCellCount === 1 ? '' : 's'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
