import { memo, useMemo } from 'react'
import type { BuildingDimensions, SystemData } from '../../types/system'
import type { MepItem } from '../../types/mep'
import type { PlanLayoutSketch, PlacedGridEdge } from '../../types/planLayout'
import {
  cellsByGeometry,
  edgeKeyString,
  openGhostPlanArchAssemblyFlipStorageKey,
  placedCellKey,
  placedColumnKey,
  placedEdgeKey,
  planArchAssemblyFlipEdgeKey,
  planArchAssemblyLayerOrderFlipped,
  planArchWallEdgeKeysOverlappedByOpenings,
} from '../../types/planLayout'
import {
  archWallBandRectCanvasPxForPlacedEdge,
  edgeEndpointsCanvasPx,
  gridCounts,
  placedArchEdgeEndpointsCanvasPx,
} from '../../lib/gridEdges'
import { planInchesToCanvasPx } from '../../lib/planCoordinates'
import {
  buildPlanConnections,
  buildConnectionDetailSheets,
  connectionDetailSheetBadge,
  connectionDetailSheetNavSubtitle,
  connectionDetailStripDescriptorsFromPlan,
  connectionJunctionCapCenterCanvasPx,
  connectionJunctionHighlightPlanInches,
  cornerConnectionPlanStrokeSortPx,
  resolvedConnectionDetailTemplateKey,
  formatConnectionParticipantsFull,
  findPlacedEdgeForJunctionArm,
  placedGridEdgeForJunctionArm,
  type PlanConnection,
} from '../../lib/planConnections'
import { ConnectionDetailPlanStrips } from '../ConnectionDetailPlanStrips'
import {
  computeEnclosedRoomComponents,
  planEnclosureBarrierKeys,
  resolveRoomDisplayName,
  roomZoneHasAssignedName,
} from '../../lib/planRooms'
import { formatPlanAreaFromSqIn } from '../../lib/planDisplayUnits'
import {
  planCellFill,
  planCellColumnOpacity,
  planEdgeStroke,
  planEdgeStrokeDasharray,
  planPaintSwatchColor,
  planPlacedEdgeOpacity,
  PLAN_ARCH_WALL_GHOST_UNDER_OPENING,
  PLAN_ARCH_WALL_OPACITY_WITH_OPENING,
  type PlanColorCatalog,
  type PlanVisualProfile,
} from '../../lib/planLayerColors'
import { PLAN_ROOM_BOUNDARY_MUTED_DASH, PLAN_ROOM_BOUNDARY_MUTED_STROKE } from './constants'
import {
  computeMepRunOffsets,
  floorCellInsetDims,
  planRoomZoneOutlineSegments,
  strokeWidthForEdge,
  strokeWidthForRoomBoundaryUnderlay,
} from './planEditorGeometry'
import { buildMepJoinedDrawModel, type MepJoinedDrawModel } from './mepRunPathJoin'
import { PlanRoomNameDetail } from './overlays'
import { placedMepDeviceKey, mepDeviceHasRealDims } from '../../types/planLayout'
import {
  computePlanArchColumnLayerStack,
  computePlanArchEdgeLayerStack,
  planArchEdgeLayerSliceStrokePx,
  planArchEdgeSeamStrokePx,
  planAssemblyColumnFlipKey,
  thinStrokeBandCanvasPx,
} from '../../lib/planArchEdgeLayerStack'

/** Stable when MEP join paths are off — avoids reallocating sets/maps each render. */
const EMPTY_MEP_JOINED_MODEL: MepJoinedDrawModel = {
  joinedPlacedEdgeKeys: new Set(),
  pathLayers: [],
  pathDByPlacedKey: new Map(),
}

const EMPTY_CORNER_SHEET_MAP = new Map<string, { badge: string; subtitle: string }>()

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

export type PlanSketchLayerPreviewProps = {
  sketch: PlanLayoutSketch
  buildingDimensions: BuildingDimensions
  /** Lot width/depth (in) — same canvas as the active plan. */
  siteWIn: number
  siteHIn: number
  planColorCatalog: PlanColorCatalog
  mepById: ReadonlyMap<string, MepItem>
  mepItems: MepItem[]
  orderedSystems: readonly SystemData[]
  annotationsOnly: boolean
  /** Prefix for React keys (e.g. level id). */
  reactKeyPrefix: string
  /** Accessible name for the preview group. */
  overlayLabel?: string
  /** When `trade_mep`, MEP runs use the same joined-path drawing as the active plan. */
  planVisualProfile?: PlanVisualProfile | null
  /** Match main plan: arch edges subdivide into CSV layers when all assembly layers are shown. */
  planLineAssemblyLayers?: boolean
}

function planSketchLayerPreviewPropsEqual(
  a: PlanSketchLayerPreviewProps,
  b: PlanSketchLayerPreviewProps,
): boolean {
  return (
    a.sketch === b.sketch &&
    a.buildingDimensions === b.buildingDimensions &&
    a.siteWIn === b.siteWIn &&
    a.siteHIn === b.siteHIn &&
    a.planColorCatalog === b.planColorCatalog &&
    a.mepById === b.mepById &&
    a.mepItems === b.mepItems &&
    a.orderedSystems === b.orderedSystems &&
    a.annotationsOnly === b.annotationsOnly &&
    a.reactKeyPrefix === b.reactKeyPrefix &&
    a.overlayLabel === b.overlayLabel &&
    a.planVisualProfile === b.planVisualProfile &&
    a.planLineAssemblyLayers === b.planLineAssemblyLayers
  )
}

/**
 * Renders another level’s sketch with the same wall/MEP merge order, opening bands,
 * corner caps, room underlays, and room labels as the main plan — not a hand-rolled subset.
 */
function PlanSketchLayerPreviewInner({
  sketch,
  buildingDimensions: d,
  siteWIn,
  siteHIn,
  planColorCatalog,
  mepById,
  mepItems,
  orderedSystems,
  annotationsOnly,
  reactKeyPrefix,
  overlayLabel,
  planVisualProfile: planVisualProfileProp = null,
  planLineAssemblyLayers = false,
}: PlanSketchLayerPreviewProps) {
  const delta = sketch.gridSpacingIn
  const cellPx = delta * d.planScale
  const mepMap = useMemo(() => new Map(mepById), [mepById])
  const { nx: siteNx, ny: siteNy } = useMemo(
    () => gridCounts(siteWIn, siteHIn, delta),
    [siteWIn, siteHIn, delta],
  )

  const cellsGeomMap = useMemo(() => cellsByGeometry(sketch.cells ?? []), [sketch.cells])
  const displayColumnsSorted = useMemo(() => {
    const list = sketch.columns ?? []
    return [...list].sort((a, b) => placedColumnKey(a).localeCompare(placedColumnKey(b)))
  }, [sketch.columns])

  const skipRoomEnclosure = annotationsOnly && !sketchHasStructuralPlanContent(sketch)
  const roomBarrierKeys = useMemo(
    () => planEnclosureBarrierKeys(sketch.roomBoundaryEdges, sketch.edges),
    [sketch.roomBoundaryEdges, sketch.edges],
  )
  const { rooms: enclosedRooms } = useMemo(() => {
    if (skipRoomEnclosure) {
      return { rooms: [] as ReturnType<typeof computeEnclosedRoomComponents>['rooms'] }
    }
    return computeEnclosedRoomComponents(siteNx, siteNy, roomBarrierKeys)
  }, [skipRoomEnclosure, siteNx, siteNy, roomBarrierKeys])

  /** Ghost preview: same edge ordering as non–Room mode on the main canvas. */
  const planLinesPaintOrder = useMemo(() => {
    type PlacedItem = { k: 'placed'; e: PlacedGridEdge }
    const placedItems: PlacedItem[] = sketch.edges.map((e) => ({ k: 'placed' as const, e }))
    return [...placedItems].sort((a, b) => {
      const swA = strokeWidthForEdge(d, a.e, mepMap)
      const swB = strokeWidthForEdge(d, b.e, mepMap)
      const cmp = swB - swA
      if (cmp !== 0) return cmp
      return placedEdgeKey(a.e).localeCompare(placedEdgeKey(b.e))
    })
  }, [sketch.edges, d, mepMap])

  const mepRunOffsets = useMemo(
    () => computeMepRunOffsets(sketch.edges, d, mepMap),
    [sketch.edges, d, mepMap],
  )

  const mepJoinedDrawModel = useMemo(() => {
    const profile = planVisualProfileProp ?? undefined
    if (profile?.mode !== 'trade_mep') return EMPTY_MEP_JOINED_MODEL
    return buildMepJoinedDrawModel(sketch.edges, d, delta, mepMap, planColorCatalog, profile)
  }, [sketch.edges, d, delta, mepMap, planColorCatalog, planVisualProfileProp])

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

  const mergedPlanStructurePaint = useMemo(() => {
    type PlacedPaint = { k: 'placed'; e: PlacedGridEdge }
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
          reactKey: `${reactKeyPrefix}-mep-join-${p.edgeKeys[0] ?? 'x'}-${pi}`,
        })
      })
    }
    for (const item of planLinesPaintOrder) {
      const e = item.e
      const pk = placedEdgeKey(e)
      if (
        (e.source ?? 'arch') === 'mep' &&
        e.kind === 'run' &&
        mepJoinedDrawModel.joinedPlacedEdgeKeys.has(pk)
      ) {
        continue
      }
      out.push({
        k: 'placedLine',
        sw: strokeWidthForEdge(d, e, mepMap),
        tie: pk,
        item,
      })
    }
    for (const cc of planConnections) {
      out.push({
        k: 'cornerCap',
        sw: cornerConnectionPlanStrokeSortPx(cc, d, mepMap),
        tie: `${reactKeyPrefix}-cc-${cc.nodeI}:${cc.nodeJ}`,
        cc,
      })
    }
    out.sort((a, b) => {
      const c = b.sw - a.sw
      return c !== 0 ? c : a.tie.localeCompare(b.tie)
    })
    const caps = out.filter((row): row is Extract<typeof row, { k: 'cornerCap' }> => row.k === 'cornerCap')
    const beneathCaps = out.filter((row) => row.k !== 'cornerCap')
    return [...beneathCaps, ...caps]
  }, [planLinesPaintOrder, mepJoinedDrawModel, planConnections, d, mepMap, reactKeyPrefix])

  const { archWallKeysWithOpeningOverlap, archOpeningGhostEdges } = useMemo(() => {
    const seg = new Set<string>()
    for (const e of sketch.edges) {
      if ((e.source ?? 'arch') === 'arch' && e.kind === 'wall') seg.add(edgeKeyString(e))
    }
    const archWallKeysWithOpeningOverlap = planArchWallEdgeKeysOverlappedByOpenings(sketch.edges)
    const archOpeningGhostEdges = sketch.edges.filter((e) => {
      if ((e.source ?? 'arch') !== 'arch') return false
      const k = e.kind ?? 'wall'
      if (k !== 'window' && k !== 'door' && k !== 'doorSwing') return false
      return !seg.has(edgeKeyString(e))
    })
    return { archWallKeysWithOpeningOverlap, archOpeningGhostEdges }
  }, [sketch.edges])

  const connectionDetailMergedRowsForPreview = useMemo(
    () =>
      planConnections.length === 0
        ? []
        : buildConnectionDetailSheets(
            planConnections,
            orderedSystems,
            mepItems,
            d.thicknessBySystem,
            sketch,
          ),
    [planConnections, orderedSystems, mepItems, d.thicknessBySystem, sketch],
  )

  const connectionSheetCornerLabelByTemplateKey = useMemo(() => {
    if (connectionDetailMergedRowsForPreview.length === 0) return EMPTY_CORNER_SHEET_MAP
    const m = new Map<string, { badge: string; subtitle: string }>()
    for (let i = 0; i < connectionDetailMergedRowsForPreview.length; i++) {
      const row = connectionDetailMergedRowsForPreview[i]!
      m.set(row.templateKey, {
        badge: connectionDetailSheetBadge(i),
        subtitle: connectionDetailSheetNavSubtitle(row),
      })
    }
    return m
  }, [connectionDetailMergedRowsForPreview])

  const showCornerConditions = false
  const connectionDetailVisualScale = 1
  const planVisualProfile = planVisualProfileProp ?? undefined

  return (
    <g pointerEvents="none" aria-hidden>
      {overlayLabel ? <title>{overlayLabel}</title> : null}

      <g>
        {Array.from(cellsGeomMap.values()).flatMap((arr) =>
          arr.map((c, idx) => {
            const { inset, w } = floorCellInsetDims(cellPx, idx, arr.length, c)
            return (
              <rect
                key={`${reactKeyPrefix}-floor-${placedCellKey(c)}`}
                x={c.i * cellPx + inset}
                y={c.j * cellPx + inset}
                width={w}
                height={w}
                fill={planCellFill(c, planColorCatalog)}
                fillOpacity={planCellColumnOpacity(c, planVisualProfile, mepById)}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={0.45}
              />
            )
          }),
        )}
      </g>

      <g>
        {displayColumnsSorted.map((col) => {
          const half = col.sizeIn / 2
          const ox = col.offsetXPlanIn ?? 0
          const oy = col.offsetYPlanIn ?? 0
          const { x, y } = planInchesToCanvasPx(d, col.cxIn - half + ox, col.cyIn - half + oy)
          const sPx = col.sizeIn * d.planScale
          const colPk = planAssemblyColumnFlipKey(col)
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
          const colOp = planCellColumnOpacity(
            { source: col.source ?? 'arch', systemId: col.systemId },
            planVisualProfile,
            mepById,
          )
          if (colStack) {
            const vs = connectionDetailVisualScale
            return (
              <g key={`${reactKeyPrefix}-col-${placedColumnKey(col)}`}>
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
              key={`${reactKeyPrefix}-col-${placedColumnKey(col)}`}
              x={x}
              y={y}
              width={sPx}
              height={sPx}
              fill={planPaintSwatchColor('arch', col.systemId, 'column', planColorCatalog)}
              fillOpacity={colOp}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={0.55}
            />
          )
        })}
      </g>

      <g>
        {(sketch.mepDevices ?? []).map((dev) => {
          const fill = planPaintSwatchColor('mep', dev.systemId, 'mep', planColorCatalog)
          const isRect = mepDeviceHasRealDims(dev)
          if (isRect) {
            const lPx = dev.lengthIn! * d.planScale
            const wPx = dev.widthIn! * d.planScale
            const { x: ox, y: oy } = planInchesToCanvasPx(
              d,
              dev.cxIn - dev.lengthIn! / 2,
              dev.cyIn - dev.widthIn! / 2,
            )
            const fontSize = Math.max(4, Math.min(lPx, wPx) * 0.35)
            return (
              <g key={`${reactKeyPrefix}-dev-${placedMepDeviceKey(dev)}`}>
                <rect
                  x={ox}
                  y={oy}
                  width={lPx}
                  height={wPx}
                  rx={2}
                  fill={fill}
                  fillOpacity={0.7}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={0.55}
                />
                <text
                  x={ox + lPx / 2}
                  y={oy + wPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="rgba(0,0,0,0.7)"
                  fontSize={fontSize}
                  fontFamily="monospace"
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
            <g key={`${reactKeyPrefix}-dev-${placedMepDeviceKey(dev)}`}>
              <circle
                cx={x + sPx / 2}
                cy={y + sPx / 2}
                r={sPx / 2}
                fill={fill}
                fillOpacity={0.7}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.55}
              />
              <text
                x={x + sPx / 2}
                y={y + sPx / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="rgba(0,0,0,0.7)"
                fontSize={Math.max(4, sPx * 0.35)}
                fontFamily="monospace"
              >
                {dev.category.charAt(0).toUpperCase()}
              </text>
            </g>
          )
        })}
      </g>

      {(sketch.roomBoundaryEdges?.length ?? 0) > 0 && (
        <g>
          {(sketch.roomBoundaryEdges ?? []).map((e) => {
            const { x1, y1, x2, y2 } = edgeEndpointsCanvasPx(d, e, delta)
            const swU = strokeWidthForRoomBoundaryUnderlay(d)
            return (
              <line
                key={`${reactKeyPrefix}-rb-ul-${edgeKeyString(e)}`}
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
      )}

      {enclosedRooms.length > 0 && (
        <g>
          {enclosedRooms.map((room, ri) => {
            if (!roomZoneHasAssignedName(room.cellKeys, sketch.roomByCell)) return null
            const outlineSegs = planRoomZoneOutlineSegments(room.cellKeys, cellPx)
            const swOut = Math.max(0.6, strokeWidthForRoomBoundaryUnderlay(d) * 1.1)
            return (
              <g key={`${reactKeyPrefix}-rz-ul-${room.cellKeys[0] ?? ri}`}>
                {outlineSegs.map((seg, si) => (
                  <line
                    key={`${reactKeyPrefix}-rz-ul-${room.cellKeys[0] ?? ri}-${si}`}
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
      )}

      <g>
        <g>
          {archOpeningGhostEdges.map((e) => {
            const baseOp = planPlacedEdgeOpacity(e, planVisualProfile, mepById)
            const wallAsWall: PlacedGridEdge = { ...e, kind: 'wall' }
            const wallFill = planEdgeStroke(wallAsWall, planColorCatalog)
            const bandRect = archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
            const ghostStorageKey = openGhostPlanArchAssemblyFlipStorageKey(e)
            const ghostKey = `${reactKeyPrefix}-${ghostStorageKey}`
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
            const sw = strokeWidthForEdge(d, e, mepMap)
            const dash = planEdgeStrokeDasharray(e.kind ?? 'wall')
            const k = edgeKeyString(e)
            const src = e.source ?? 'arch'
            const kind = e.kind ?? 'wall'
            const baseOp = planPlacedEdgeOpacity(e, planVisualProfile, mepById)
            const wallUsesBand = src === 'arch' && kind === 'wall' && archWallKeysWithOpeningOverlap.has(k)
            const wallAsWall: PlacedGridEdge = { ...e, kind: 'wall' }
            const mainOpacity = wallUsesBand ? baseOp * PLAN_ARCH_WALL_OPACITY_WITH_OPENING : baseOp
            const wallFill = planEdgeStroke(wallAsWall, planColorCatalog)
            const bandRect = archWallBandRectCanvasPxForPlacedEdge(d, e, delta)
            const stackBand = wallUsesBand
              ? bandRect
              : thinStrokeBandCanvasPx(e.axis, x1, y1, x2, y2, sw)
            const stackKey = `${reactKeyPrefix}-${asmLineKey}`
            const archStack =
              planLineAssemblyLayers &&
              src === 'arch' &&
              computePlanArchEdgeLayerStack({
                edge: e,
                d,
                orderedSystems,
                bandRect: stackBand,
                axis: e.axis,
                placedKey: stackKey,
                layerOrderFlipped: planArchAssemblyLayerOrderFlipped(
                  sketch.planArchEdgeLayerFlipped,
                  e,
                  'edge',
                ),
              })
            if (archStack) {
              const vs = connectionDetailVisualScale
              return (
                <g key={stackKey}>
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
              <g key={stackKey}>
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
            const { x: cx, y: cy } = connectionJunctionCapCenterCanvasPx(cc, d, delta, sketch.edges ?? [])
            const armsForCap = cc.armsPhysical ?? cc.arms
            const sketchEdgesCap = sketch.edges ?? []
            const edgeFromArm = (arm: (typeof cc.arms)[number]): PlacedGridEdge =>
              findPlacedEdgeForJunctionArm(sketchEdgesCap, cc.nodeI, cc.nodeJ, arm) ??
              placedGridEdgeForJunctionArm(cc.nodeI, cc.nodeJ, arm)
            let thickestArm = armsForCap[0]!
            let thickestPx = strokeWidthForEdge(d, edgeFromArm(thickestArm), mepMap)
            for (const arm of armsForCap) {
              const w = strokeWidthForEdge(d, edgeFromArm(arm), mepMap)
              if (w > thickestPx) {
                thickestPx = w
                thickestArm = arm
              }
            }
            const edgeThick = edgeFromArm(thickestArm)
            const fillCol = planEdgeStroke(edgeThick, planColorCatalog)
            const { widthIn, depthIn } = connectionJunctionHighlightPlanInches(cc, d, mepMap)
            const rw = widthIn * d.planScale
            const rh = depthIn * d.planScale
            const rx1 = cx - rw / 2
            const ry1 = cy - rh / 2
            const effectiveKey = resolvedConnectionDetailTemplateKey(cc, sketch, new Set<string>())
            const sheetMeta = connectionSheetCornerLabelByTemplateKey.get(effectiveKey)
            const showJunctionStrips =
              planLineAssemblyLayers &&
              connectionDetailStripDescriptorsFromPlan(cc, d.layoutRefs).length > 0

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
                    core={{ x0: rx1, y0: ry1, rw, rh }}
                    visualScale={connectionDetailVisualScale}
                    exportGroupId={`${reactKeyPrefix}-junction-strips-${cc.nodeI}-${cc.nodeJ}`}
                  />
                  {showCornerConditions ? (
                    <rect
                      x={rx1}
                      y={ry1}
                      width={rw}
                      height={rh}
                      fill="none"
                      stroke="#9ca3af"
                      strokeWidth={Math.max(0.2, 0.9 * connectionDetailVisualScale)}
                      strokeDasharray="2 3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity={0.92}
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
                  x={rx1}
                  y={ry1}
                  width={rw}
                  height={rh}
                  fill={fillCol}
                  fillOpacity={1}
                  stroke={showCornerConditions ? '#9ca3af' : 'none'}
                  strokeWidth={showCornerConditions ? Math.max(0.2, 0.9 * connectionDetailVisualScale) : 0}
                  strokeDasharray={showCornerConditions ? '2 3' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={showCornerConditions ? 0.92 : 0}
                />
              </g>
            )
          }
          return null
        })}
      </g>

      {enclosedRooms.length > 0 && (
        <g>
          {enclosedRooms.map((room, ri) => {
            if (!roomZoneHasAssignedName(room.cellKeys, sketch.roomByCell)) return null
            const displayName = resolveRoomDisplayName(room.cellKeys, sketch.roomByCell, ri + 1)
            const sqIn = room.cellKeys.length * delta * delta
            const areaSqFtLabel = formatPlanAreaFromSqIn(sqIn, 'ft')
            const rcx = room.centroid.x * cellPx
            const rcy = room.centroid.y * cellPx
            return (
              <g key={`${reactKeyPrefix}-room-${room.cellKeys[0] ?? ri}`}>
                <PlanRoomNameDetail
                  cx={rcx}
                  cy={rcy}
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
    </g>
  )
}

export const PlanSketchLayerPreview = memo(PlanSketchLayerPreviewInner, planSketchLayerPreviewPropsEqual)
