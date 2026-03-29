import { useMemo } from 'react'
import type { PlacedGridEdge } from '../types/planLayout'
import type { BuildingDimensions, Layer, SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import {
  connectionDetailStripDescriptorsFromPlan,
  placedGridEdgeForJunctionArm,
  type ConnectionDetailStripDescriptor,
  type PlanConnection,
} from '../lib/planConnections'
import { buildHorizRects, buildWallRects, type LayerRect } from '../lib/geometry'
import { drawLayersForPlanEdge } from '../lib/planArchEdgeLayerStack'
import { parseThickness as parseThicknessCsv } from '../lib/csvParser'
import { resolveLayerDiagramFill } from '../lib/layerDiagramFill'
import { strokeWidthForEdge } from './planLayoutCore/planEditorGeometry'

function participantForStripDesc(
  c: PlanConnection,
  desc: ConnectionDetailStripDescriptor,
) {
  return c.participants.find(
    (p) => p.systemId === desc.systemId && p.source === desc.source && p.kind === desc.kind,
  )
}

/** Match plan junction `systemId` to catalog row (trim / case / loose suffix). */
function resolveArchSystem(
  systemId: string,
  orderedSystems: readonly SystemData[],
): SystemData | undefined {
  const tid = systemId.trim()
  if (!tid) return undefined
  const byId = new Map(orderedSystems.map((s) => [s.id.trim(), s]))
  let s = byId.get(tid)
  if (s) return s
  const tl = tid.toLowerCase()
  s = orderedSystems.find((x) => x.id.trim().toLowerCase() === tl)
  if (s) return s
  s = orderedSystems.find((x) => tid === x.id.trim() || tid.endsWith(x.id) || x.id.endsWith(tid))
  return s
}

/** Thickness in plan px; prefer CSV parser to match Building_Systems sheet. */
function layerThicknessPlanPx(thicknessRaw: string, planScale: number): number {
  const inches = parseThicknessCsv(thicknessRaw || '0')
  return Math.max(0.02, inches * planScale)
}

function syntheticLayerFromThicknessInches(index: number, inches: number): Layer {
  return {
    index,
    name: 'Assembly',
    material: '',
    thickness: String(inches),
    rValue: '',
    connection: '',
    fastener: '',
    fastenerSize: '',
    notes: '',
    layerType: 'MISC',
    visible: true,
  }
}

function layerRectsBBox(rects: LayerRect[]): { x: number; y: number; width: number; height: number } | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function edgeFromDescriptor(
  c: PlanConnection,
  desc: ConnectionDetailStripDescriptor,
): PlacedGridEdge {
  return placedGridEdgeForJunctionArm(c.nodeI, c.nodeJ, desc)
}

export interface ConnectionDetailPlanStripsProps {
  connection: PlanConnection
  buildingDimensions: BuildingDimensions
  orderedSystems: readonly SystemData[]
  mepItems: readonly MepItem[]
  core: { x0: number; y0: number; rw: number; rh: number }
  visualScale: number
  /** Per-arm flip of catalog layer order (`true` = reversed); keys are plan directions. */
  stripLayerFlips?: Partial<Record<ConnectionDetailStripDescriptor['dir'], true>>
  /**
   * When set per direction, scale that strip’s layer stack depth to this many px (matches plan wall band).
   */
  stripDepthOverridePxByDir?: Partial<Record<ConnectionDetailStripDescriptor['dir'], number>>
  /**
   * Per-direction canvas translate so strips match segment assembly bands when edges carry
   * `perpOffsetPlanIn` (corner arms otherwise use synthetic edges with no offset).
   */
  stripCanvasNudgePxByDir?: Partial<
    Record<ConnectionDetailStripDescriptor['dir'], { dx: number; dy: number }>
  >
  /** Root `<g>` id for SVG export; default preserves connection-detail sheet behavior. */
  exportGroupId?: string
  /** When true with `onStripLayerFlipToggle`, transparent targets receive clicks (annotation tool). */
  stripFlipPickActive?: boolean
  onStripLayerFlipToggle?: (dir: ConnectionDetailStripDescriptor['dir']) => void
}

export function ConnectionDetailPlanStrips({
  connection,
  buildingDimensions: d,
  orderedSystems,
  mepItems,
  core,
  visualScale,
  stripLayerFlips,
  stripDepthOverridePxByDir,
  stripCanvasNudgePxByDir,
  exportGroupId = 'plan-export-connection-detail-strips',
  stripFlipPickActive = false,
  onStripLayerFlipToggle,
}: ConnectionDetailPlanStripsProps) {
  const mepById = useMemo(() => new Map(mepItems.map((m) => [m.id, m])), [mepItems])

  const descriptors = useMemo(
    () => connectionDetailStripDescriptorsFromPlan(connection, d.layoutRefs),
    [connection, d.layoutRefs],
  )

  if (descriptors.length === 0) return null

  const { x0, y0, rw, rh } = core
  const pxPerInch = d.planScale

  /** SectionDrawing uses ~0.9 in large sheet space; here layers are only a few SVG units — hairlines + per-rect cap. */
  const vs = Math.max(visualScale, 0.18)
  const layerStrokeSolid = Math.max(0.04, Math.min(0.14, 0.09 * vs))
  const layerStrokeAir = Math.max(0.05, Math.min(0.18, 0.11 * vs))
  const mepBandStroke = Math.max(0.05, Math.min(0.16, 0.1 * vs))
  /** Cap so shared edges (two rects) do not read as a fat joint; ~2× this is the seam weight. */
  const strokeForLayerRect = (r: LayerRect, air: boolean) => {
    const m = Math.min(r.w, r.h)
    const cap = Math.max(0.035, m * 0.065)
    return Math.min(air ? layerStrokeAir : layerStrokeSolid, cap)
  }

  return (
    <g
      id={exportGroupId}
      pointerEvents={stripFlipPickActive ? 'auto' : 'none'}
      aria-hidden={stripFlipPickActive ? undefined : true}
    >
      {descriptors.map((desc) => {
        const nudge = stripCanvasNudgePxByDir?.[desc.dir]
        const ndx = nudge?.dx ?? 0
        const ndy = nudge?.dy ?? 0
        const stripNudgeXf = ndx !== 0 || ndy !== 0 ? `translate(${ndx} ${ndy})` : undefined
        const e = edgeFromDescriptor(connection, desc)
        const swMep = strokeWidthForEdge(d, e, mepById)
        const sys =
          desc.source === 'arch' ? resolveArchSystem(desc.systemId, orderedSystems) : undefined

        if (desc.source === 'mep' || desc.kind === 'run' || !sys) {
          /** Horizontal-edge arms: thin in X, span core in Y. Vertical-edge arms: span core in X, thin in Y. */
          const w = desc.dir === 'left' || desc.dir === 'right' ? Math.max(2, swMep) : rw
          const h = desc.dir === 'up' || desc.dir === 'down' ? Math.max(2, swMep) : rh
          let rx = x0
          let ry = y0
          if (desc.dir === 'down') {
            rx = x0
            ry = y0 + rh
          } else if (desc.dir === 'up') {
            rx = x0
            ry = y0 - h
          } else if (desc.dir === 'right') {
            rx = x0 + rw
            ry = y0
          } else {
            rx = x0 - w
            ry = y0
          }
          const hitW = desc.dir === 'left' || desc.dir === 'right' ? w : rw
          const hitH = desc.dir === 'up' || desc.dir === 'down' ? h : rh
          return (
            <g key={`${desc.systemId}-${desc.dir}`} transform={stripNudgeXf}>
              <rect
                x={rx}
                y={ry}
                width={hitW}
                height={hitH}
                fill="#94a3b8"
                fillOpacity={0.45}
                stroke="#0a0a0a"
                strokeWidth={mepBandStroke}
              />
              {stripFlipPickActive && onStripLayerFlipToggle && (
                <rect
                  x={rx}
                  y={ry}
                  width={hitW}
                  height={hitH}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation()
                    onStripLayerFlipToggle(desc.dir)
                  }}
                >
                  <title>Toggle layer order for this strip ({desc.dir})</title>
                </rect>
              )}
            </g>
          )
        }

        /** Same stack order as `computePlanArchEdgeLayerStack` on straight segments (no per-dir flip). */
        let drawLayers = drawLayersForPlanEdge(sys)
        if (drawLayers.length === 0) {
          const p = participantForStripDesc(connection, desc)
          const t = p?.totalThicknessIn
          if (t != null && Number.isFinite(t) && t > 0) {
            drawLayers = [syntheticLayerFromThicknessInches(0, t)]
          }
        }
        if (drawLayers.length === 0) return null
        /** User toggle: mirror catalog order vs default junction mapping (works for any layer count ≥1). */
        if (stripLayerFlips?.[desc.dir]) {
          drawLayers = [...drawLayers].reverse()
        }

        /** True plan scale from CSV thicknesses; optional normalize to plan stroke band. */
        const rawSizes = drawLayers.map((l) => layerThicknessPlanPx(l.thickness, pxPerInch))
        let sizes = rawSizes.map((s) => Math.max(0.02, s))
        let tw = sizes.reduce((a, b) => a + b, 0)
        const od = stripDepthOverridePxByDir?.[desc.dir]
        if (od != null && od > 0 && tw > 0) {
          sizes = sizes.map((s) => (s / tw) * od)
          tw = od
        }

        let layerRects: LayerRect[] = []
        /**
         * Left/right: walls ∥ plan Y — bands stack in Y (horizontal seams) across strip depth tw in X.
         * Up/down: walls ∥ plan X — slices stack in X (vertical seams), span rw in Y.
         */
        const yMidOff = y0 + Math.max(0, (rh - tw) / 2)
        if (desc.dir === 'left') {
          layerRects = buildHorizRects(sizes, x0 - tw, yMidOff, tw)
        } else if (desc.dir === 'right') {
          layerRects = buildHorizRects(sizes, x0 + rw, yMidOff, tw)
        } else if (desc.dir === 'down') {
          layerRects = buildWallRects(sizes, x0, y0 + rh, rw)
        } else {
          /** `tw` is thickness along X; each rect’s vertical span is `rw` (matches core top edge). Bottom must be `y0`. */
          layerRects = buildWallRects(sizes, x0, y0 - rw, rw)
        }

        const seamStroke = Math.max(0.1, Math.min(0.22, 0.16 * vs))
        const flipHitBox = layerRectsBBox(layerRects)

        return (
          <g key={`${desc.systemId}-${desc.dir}`} transform={stripNudgeXf}>
            {drawLayers.map((layer, i) => {
              const r = layerRects[i]!
              const isAirGap = layer.layerType === 'AIR_GAP'
              const sw = strokeForLayerRect(r, isAirGap)
              return (
                <g key={`${desc.systemId}-${desc.dir}-L${i}`}>
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={resolveLayerDiagramFill(layer)}
                    stroke="#171717"
                    strokeWidth={sw}
                    shapeRendering="crispEdges"
                    strokeDasharray={
                      isAirGap
                        ? `${Math.max(0.35, 1.15 * vs)} ${Math.max(0.3, 0.95 * vs)}`
                        : undefined
                    }
                  />
                </g>
              )
            })}
            {layerRects.length > 1 &&
              layerRects.slice(0, -1).map((r, i) => {
                const key = `${desc.systemId}-${desc.dir}-seam-${i}`
                /** Left/right: bands in Y → horizontal seams. Up/down: columns in X → vertical seams. */
                if (desc.dir === 'up' || desc.dir === 'down') {
                  const x = r.x + r.w
                  return (
                    <line
                      key={key}
                      x1={x}
                      y1={r.y}
                      x2={x}
                      y2={r.y + r.h}
                      stroke="#0f172a"
                      strokeOpacity={0.72}
                      strokeWidth={seamStroke}
                      strokeLinecap="square"
                      shapeRendering="crispEdges"
                    />
                  )
                }
                const y = r.y + r.h
                return (
                  <line
                    key={key}
                    x1={r.x}
                    y1={y}
                    x2={r.x + r.w}
                    y2={y}
                    stroke="#0f172a"
                    strokeOpacity={0.72}
                    strokeWidth={seamStroke}
                    strokeLinecap="square"
                    shapeRendering="crispEdges"
                  />
                )
              })}
            {stripFlipPickActive && onStripLayerFlipToggle && flipHitBox && (
              <rect
                x={flipHitBox.x}
                y={flipHitBox.y}
                width={flipHitBox.width}
                height={flipHitBox.height}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: 'pointer' }}
                onPointerDown={(ev) => {
                  ev.stopPropagation()
                  onStripLayerFlipToggle(desc.dir)
                }}
              >
                <title>Toggle layer order for this strip ({desc.dir})</title>
              </rect>
            )}
          </g>
        )
      })}
    </g>
  )
}
