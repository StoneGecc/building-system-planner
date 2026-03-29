import type { BuildingDimensions } from '../../types/system'
import type {
  ElevationLevelLine,
  PlanAnnotationGridRun,
  PlanAnnotationLabel,
  PlanAnnotationSectionCut,
  PlanMeasureGridRun,
} from '../../types/planLayout'
import { parseEdgeKeyString, type GridEdgeKey } from '../../types/planLayout'
import { planInchesToCanvasPx } from '../../lib/planCoordinates'
import { edgeEndpointsCanvasPx, edgeEndpointsConnectionDetailCanvasPx } from '../../lib/gridEdges'
import { GRID_TRIM, PLAN_ROOM_DETAIL_MONO } from './constants'
function edgeEndpointsOverlayCanvasPx(
  bd: BuildingDimensions,
  key: GridEdgeKey,
  delta: number,
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
) {
  if (nodeAxesIn && nodeAxesIn.xsIn.length >= 2 && nodeAxesIn.ysIn.length >= 2) {
    return edgeEndpointsConnectionDetailCanvasPx(bd, key, nodeAxesIn.xsIn, nodeAxesIn.ysIn)
  }
  return edgeEndpointsCanvasPx(bd, key, delta)
}

function gridNodePlanInches(
  n: { i: number; j: number },
  delta: number,
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { xIn: number; yIn: number } {
  if (nodeAxesIn && nodeAxesIn.xsIn[n.i] != null && nodeAxesIn.ysIn[n.j] != null) {
    return { xIn: nodeAxesIn.xsIn[n.i]!, yIn: nodeAxesIn.ysIn[n.j]! }
  }
  return { xIn: n.i * delta, yIn: n.j * delta }
}

function sectionCutEndpointsPlanInches(
  cut: { startNode: { i: number; j: number }; endNode: { i: number; j: number } },
  delta: number,
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null,
): { x1: number; y1: number; x2: number; y2: number } {
  const a = gridNodePlanInches(cut.startNode, delta, nodeAxesIn)
  const b = gridNodePlanInches(cut.endNode, delta, nodeAxesIn)
  return { x1: a.xIn, y1: a.yIn, x2: b.xIn, y2: b.yIn }
}

/** Room label as a small title-block style detail (matches section / composite sheet typography). */
export function PlanRoomNameDetail({
  cx,
  cy,
  cellPx,
  displayName,
  fallbackIndex,
  areaSqFtLabel,
}: {
  cx: number
  cy: number
  cellPx: number
  displayName: string
  fallbackIndex: number
  /** Pre-formatted area, e.g. "128.5 sq ft" */
  areaSqFtLabel: string
}) {
  const raw = displayName.trim() || `Room ${fallbackIndex}`
  const nameUpper = raw.toUpperCase()
  const pad = Math.max(3, Math.min(9, cellPx * 0.11))
  const areaFs = Math.max(5.5, Math.min(7.5, cellPx * 0.14))
  const nameFs = Math.max(7, Math.min(11.5, cellPx * 0.22))
  const ruleSw = Math.max(0.35, 0.5)
  const charWName = nameFs * 0.56
  const charWArea = areaFs * 0.56
  const maxW = Math.min(cellPx * 16, 300, Math.max(120, cellPx * 8))
  const maxNameChars = Math.max(4, Math.floor((maxW - 2 * pad) / charWName))
  const nameLine =
    nameUpper.length <= maxNameChars
      ? nameUpper
      : `${nameUpper.slice(0, Math.max(1, maxNameChars - 1))}…`
  const maxAreaChars = Math.max(6, Math.floor((maxW - 2 * pad) / charWArea))
  const areaLine =
    areaSqFtLabel.length <= maxAreaChars
      ? areaSqFtLabel
      : `${areaSqFtLabel.slice(0, Math.max(1, maxAreaChars - 1))}…`
  const w = Math.min(
    maxW,
    Math.max(
      cellPx * 3.2,
      nameLine.length * charWName + 2 * pad,
      areaLine.length * charWArea + 2 * pad,
    ),
  )
  const nameBlock = nameFs + 3
  const areaBlock = areaFs + 3
  const h = pad + nameBlock + areaBlock + pad
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  const ruleY = y0 + pad + nameBlock - 1
  const nameBaseline = y0 + pad + nameFs * 0.88
  const areaBaseline = y0 + pad + nameBlock + areaFs * 0.88

  return (
    <g fontFamily={PLAN_ROOM_DETAIL_MONO} pointerEvents="none" aria-hidden>
      <rect x={x0} y={y0} width={w} height={h} fill="white" stroke="black" strokeWidth={ruleSw} />
      <line
        x1={x0 + pad}
        y1={ruleY}
        x2={x0 + w - pad}
        y2={ruleY}
        stroke="black"
        strokeWidth={ruleSw * 0.9}
      />
      <text
        x={cx}
        y={nameBaseline}
        textAnchor="middle"
        fontSize={nameFs}
        fontWeight="bold"
        fill="black"
        letterSpacing={0.55}
      >
        {nameLine}
      </text>
      <text
        x={cx}
        y={areaBaseline}
        textAnchor="middle"
        fontSize={areaFs}
        fill="#475569"
        letterSpacing={0.35}
      >
        {areaLine}
      </text>
    </g>
  )
}

/** Grid-snapped run with dimension ticks at ends and label near path. */
export function GridPathDimensionOverlay({
  d,
  delta,
  edgeKeys,
  startNode,
  endNode,
  primary,
  sub,
  dashed,
  visualScale = 1,
  nodeAxesIn,
}: {
  d: BuildingDimensions
  delta: number
  edgeKeys: string[]
  startNode: { i: number; j: number }
  endNode: { i: number; j: number }
  primary: string
  /** Optional second line below the length (e.g. grid deltas); omitted for plain dimensions. */
  sub?: string
  dashed?: boolean
  visualScale?: number
  /** Connection-detail: node indices map to these plan-inch lines instead of uniform Δ. */
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null
}) {
  const v = visualScale
  const stroke = dashed ? '#1d4ed8' : '#0f172a'
  const dash = dashed ? '5 4' : undefined
  const showSub = Boolean(sub?.trim())
  const subFill = dashed ? '#1e40af' : '#475569'
  let sx = 0
  let sy = 0
  let n = 0
  const lines = edgeKeys.map((ks) => {
    const parsed = parseEdgeKeyString(ks)
    if (!parsed) return null
    const { x1, y1, x2, y2 } = edgeEndpointsOverlayCanvasPx(d, parsed, delta, nodeAxesIn)
    sx += (x1 + x2) / 2
    sy += (y1 + y2) / 2
    n += 1
    return (
      <line
        key={`md-${ks}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={Math.max(0.2, (dashed ? 2.25 : 2.75) * v)}
        strokeLinecap="butt"
        strokeDasharray={dash}
      />
    )
  })
  const mx = n > 0 ? sx / n : 0
  const my = n > 0 ? sy / n : 0
  const psN = gridNodePlanInches(startNode, delta, nodeAxesIn)
  const peN = gridNodePlanInches(endNode, delta, nodeAxesIn)
  const ps = planInchesToCanvasPx(d, psN.xIn, psN.yIn)
  const pe = planInchesToCanvasPx(d, peN.xIn, peN.yIn)
  const tk = 6.5 * v
  const tickSw = Math.max(0.15, 1.15 * v)
  return (
    <g pointerEvents="none">
      {lines}
      <line
        x1={ps.x - tk}
        y1={ps.y - tk}
        x2={ps.x + tk}
        y2={ps.y + tk}
        stroke={stroke}
        strokeWidth={tickSw}
        strokeLinecap="butt"
      />
      <line
        x1={pe.x - tk}
        y1={pe.y - tk}
        x2={pe.x + tk}
        y2={pe.y + tk}
        stroke={stroke}
        strokeWidth={tickSw}
        strokeLinecap="butt"
      />
      <text
        x={mx}
        y={showSub ? my - 6 * v : my}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={stroke}
        stroke="#fff"
        strokeWidth={Math.max(0.35, 2.5 * v)}
        paintOrder="stroke fill"
        style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: Math.max(5, 11 * v) }}
      >
        {primary}
      </text>
      {showSub ? (
        <text
          x={mx}
          y={my + 8 * v}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={subFill}
          stroke="#fff"
          strokeWidth={Math.max(0.3, 2 * v)}
          paintOrder="stroke fill"
          style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: Math.max(4, 9 * v) }}
        >
          {sub}
        </text>
      ) : null}
    </g>
  )
}

/** Highlight geometry for annotation hit keys (select / erase hover and erase marquee preview). */
export function AnnotationKeyHighlightOverlay({
  keys,
  stroke,
  strokeOpacity = 1,
  reactKeyPrefix,
  d,
  delta,
  measureRuns,
  annotationGridRuns,
  annotationSectionCuts,
  annotationLabels,
  elevationLevelLines,
  canvasW,
  cellPx,
  strokeWidthScale = 1,
  nodeAxesIn,
}: {
  keys: readonly string[]
  stroke: string
  strokeOpacity?: number
  reactKeyPrefix: string
  d: BuildingDimensions
  delta: number
  measureRuns: readonly PlanMeasureGridRun[]
  annotationGridRuns: readonly PlanAnnotationGridRun[]
  annotationSectionCuts: readonly PlanAnnotationSectionCut[]
  annotationLabels: readonly PlanAnnotationLabel[]
  elevationLevelLines?: readonly ElevationLevelLine[] | undefined
  canvasW: number
  cellPx: number
  /** Multiplier for hover/marquee strokes (connection-detail small grid). */
  strokeWidthScale?: number
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null
}) {
  if (keys.length === 0) return null
  const swPlan = Math.max(3.2, 2.2 * d.planScale * 0.12) * strokeWidthScale
  /** Connection-detail: planScale stays “sheet” scale while cells are tiny — cap to grid pixel size. */
  const swCap = Math.max(0.12, cellPx * 0.06)
  const sw =
    strokeWidthScale < 1 ? Math.min(swPlan, swCap) : swPlan
  const secExtra = strokeWidthScale < 1 ? 0.85 * strokeWidthScale : 1.5
  return (
    <g pointerEvents="none" aria-hidden>
      {keys.flatMap((key) => {
        if (key.startsWith('dim:')) {
          const rest = key.slice(4)
          const pipe = rest.indexOf('|')
          const id = pipe >= 0 ? rest.slice(0, pipe) : rest
          const oneEdge = pipe >= 0 ? rest.slice(pipe + 1) : null
          const run = measureRuns.find((r) => r.id === id)
          if (!run) return []
          const edgeList = oneEdge ? (run.edgeKeys.includes(oneEdge) ? [oneEdge] : []) : run.edgeKeys
          return edgeList.flatMap((ks) => {
            const parsed = parseEdgeKeyString(ks)
            if (!parsed) return []
            const { x1, y1, x2, y2 } = edgeEndpointsOverlayCanvasPx(d, parsed, delta, nodeAxesIn)
            return [
              <line
                key={`${reactKeyPrefix}-dim-${id}-${ks}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeOpacity={strokeOpacity}
                strokeWidth={sw}
                strokeLinecap="butt"
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
          const edgeList = oneEdge ? (run.edgeKeys.includes(oneEdge) ? [oneEdge] : []) : run.edgeKeys
          return edgeList.flatMap((ks) => {
            const parsed = parseEdgeKeyString(ks)
            if (!parsed) return []
            const { x1, y1, x2, y2 } = edgeEndpointsOverlayCanvasPx(d, parsed, delta, nodeAxesIn)
            return [
              <line
                key={`${reactKeyPrefix}-grid-${id}-${ks}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeOpacity={strokeOpacity}
                strokeWidth={sw * 0.9}
                strokeLinecap="butt"
                strokeDasharray="5 4"
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
          const { x1, y1, x2, y2 } = edgeEndpointsOverlayCanvasPx(d, parsed, delta, nodeAxesIn)
          return [
            <line
              key={`${reactKeyPrefix}-sed-${ek}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeOpacity={strokeOpacity}
              strokeWidth={sw}
              strokeLinecap="butt"
            />,
          ]
        }
        if (key.startsWith('cdf:')) {
          const cellKey = key.slice(4)
          if (!nodeAxesIn || cellKey.length < 3) return []
          const parts = cellKey.split(':')
          if (parts.length !== 2) return []
          const ci = Number(parts[0])
          const cj = Number(parts[1])
          if (!Number.isFinite(ci) || !Number.isFinite(cj)) return []
          const xs = nodeAxesIn.xsIn
          const ys = nodeAxesIn.ysIn
          const x0 = xs[ci]
          const x1 = xs[ci + 1]
          const y0 = ys[cj]
          const y1 = ys[cj + 1]
          if (x0 == null || x1 == null || y0 == null || y1 == null) return []
          const loX = Math.min(x0, x1)
          const hiX = Math.max(x0, x1)
          const loY = Math.min(y0, y1)
          const hiY = Math.max(y0, y1)
          const p0 = planInchesToCanvasPx(d, loX, loY)
          const p1 = planInchesToCanvasPx(d, hiX, hiY)
          const rw = p1.x - p0.x
          const rh = p1.y - p0.y
          return [
            <rect
              key={`${reactKeyPrefix}-cdf-${cellKey}`}
              x={p0.x}
              y={p0.y}
              width={Math.max(0.02, rw)}
              height={Math.max(0.02, rh)}
              fill="none"
              stroke={stroke}
              strokeOpacity={strokeOpacity}
              strokeWidth={sw * 0.85}
              strokeDasharray="4 3"
              rx={1}
            />,
          ]
        }
        if (key.startsWith('sec:')) {
          const id = key.slice(4)
          const cut = annotationSectionCuts.find((c) => c.id === id)
          if (!cut) return []
          const ep = sectionCutEndpointsPlanInches(cut, delta, nodeAxesIn)
          const p1 = planInchesToCanvasPx(d, ep.x1, ep.y1)
          const p2 = planInchesToCanvasPx(d, ep.x2, ep.y2)
          return [
            <line
              key={`${reactKeyPrefix}-sec-${id}-ln`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={stroke}
              strokeOpacity={strokeOpacity}
              strokeWidth={sw + secExtra}
              strokeLinecap="butt"
              strokeDasharray="10 5"
            />,
          ]
        }
        if (key.startsWith('lvl:')) {
          const id = key.slice(4)
          const L = elevationLevelLines?.find((l) => l.id === id)
          if (!L) return []
          const y = L.j * cellPx
          return [
            <line
              key={`${reactKeyPrefix}-lvl-${id}`}
              x1={GRID_TRIM}
              y1={y}
              x2={canvasW - GRID_TRIM}
              y2={y}
              stroke={stroke}
              strokeOpacity={strokeOpacity}
              strokeWidth={sw * 1.15}
              strokeLinecap="butt"
              strokeDasharray="4 3"
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
              key={`${reactKeyPrefix}-lbl-${id}`}
              x={x - 3}
              y={y - 2}
              width={tw}
              height={th}
              fill="none"
              stroke={stroke}
              strokeOpacity={strokeOpacity}
              strokeWidth={Math.max(0.35, 2 * strokeWidthScale)}
              strokeDasharray="5 3"
              rx={2}
            />,
          ]
        }
        return []
      })}
    </g>
  )
}

/** Grid reference polyline — dashed, no ticks or dimension text. */
export function GridReferencePathOverlay({
  d,
  delta,
  edgeKeys,
  strokeWidthScale = 1,
  nodeAxesIn,
}: {
  d: BuildingDimensions
  delta: number
  edgeKeys: string[]
  strokeWidthScale?: number
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null
}) {
  const stroke = '#475569'
  const sw = Math.max(0.25, 1.65 * strokeWidthScale)
  const lines = edgeKeys.map((ks) => {
    const parsed = parseEdgeKeyString(ks)
    if (!parsed) return null
    const { x1, y1, x2, y2 } = edgeEndpointsOverlayCanvasPx(d, parsed, delta, nodeAxesIn)
    return (
      <line
        key={`gr-${ks}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeDasharray="4 3"
        opacity={0.92}
      />
    )
  })
  return <g pointerEvents="none">{lines}</g>
}

/** Straight section cut: long-dash line and opposing triangles at midpoint. */
export function SectionCutGraphic({
  d,
  delta,
  cut,
  variant = 'section',
  visualScale = 1,
  nodeAxesIn,
}: {
  d: BuildingDimensions
  delta: number
  cut: PlanAnnotationSectionCut
  /** `detailLine`: hairline solid segment, flat butt caps (connection-detail). */
  variant?: 'section' | 'detailLine'
  visualScale?: number
  nodeAxesIn?: { xsIn: readonly number[]; ysIn: readonly number[] } | null
}) {
  const ep = sectionCutEndpointsPlanInches(cut, delta, nodeAxesIn)
  const p1 = planInchesToCanvasPx(d, ep.x1, ep.y1)
  const p2 = planInchesToCanvasPx(d, ep.x2, ep.y2)
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const vx = -uy
  const vy = ux
  const h = Math.max(7, Math.min(14, len * 0.08))
  const w = h * 0.55
  const tri1 = `${mx + vx * h},${my + vy * h} ${mx - ux * w + vx * 0.15 * h},${my - uy * w + vy * 0.15 * h} ${mx + ux * w + vx * 0.15 * h},${my + uy * w + vy * 0.15 * h}`
  const tri2 = `${mx - vx * h},${my - vy * h} ${mx - ux * w - vx * 0.15 * h},${my - uy * w - vy * 0.15 * h} ${mx + ux * w - vx * 0.15 * h},${my + uy * w - vy * 0.15 * h}`
  if (variant === 'detailLine') {
    return (
      <g pointerEvents="none">
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="#0f172a"
          strokeWidth={Math.max(0.06, 0.25 * visualScale)}
          strokeLinecap="butt"
          shapeRendering="crispEdges"
        />
      </g>
    )
  }
  return (
    <g pointerEvents="none">
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke="#0f172a"
        strokeWidth={2.25}
        strokeLinecap="butt"
        strokeDasharray="10 5"
      />
      <polygon points={tri1} fill="#0f172a" stroke="none" />
      <polygon points={tri2} fill="#0f172a" stroke="none" />
    </g>
  )
}
