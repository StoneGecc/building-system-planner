import type { BuildingDimensions, Layer, SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import {
  connectionDetailStripDescriptorsFromPlan,
  placedGridEdgeForJunctionArm,
  type ConnectionDetailStripDescriptor,
  type PlanConnection,
} from './planConnections'
import { buildHorizRects, buildWallRects, type LayerRect } from './geometry'
import { drawLayersForPlanEdge } from './planArchEdgeLayerStack'
import { parseThickness as parseThicknessCsv } from './csvParser'
import { strokeWidthForEdge } from '../components/planLayoutCore/planEditorGeometry'

function participantForStripDesc(
  c: PlanConnection,
  desc: { systemId: string; source: string; kind: string },
) {
  return c.participants.find(
    (p) => p.systemId === desc.systemId && p.source === desc.source && p.kind === desc.kind,
  )
}

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

function edgeFromDescriptor(c: PlanConnection, desc: ConnectionDetailStripDescriptor) {
  return placedGridEdgeForJunctionArm(c.nodeI, c.nodeJ, desc)
}

/**
 * Assembly / MEP strip rectangles in SVG px (same geometry as {@link ConnectionDetailPlanStrips}),
 * including `stripCanvasNudgePxByDir`, for deriving a grid that follows layer edges.
 */
export function connectionDetailAssemblyWorldRectsPx(params: {
  connection: PlanConnection
  d: BuildingDimensions
  orderedSystems: readonly SystemData[]
  mepById: Map<string, MepItem>
  core: { x0: number; y0: number; rw: number; rh: number }
  stripLayerFlips?: Partial<Record<'up' | 'down' | 'left' | 'right', true>>
  stripDepthOverridePxByDir?: Partial<Record<'up' | 'down' | 'left' | 'right', number>>
  stripCanvasNudgePxByDir?: Partial<
    Record<'up' | 'down' | 'left' | 'right', { dx: number; dy: number }>
  >
}): LayerRect[] {
  const {
    connection,
    d,
    orderedSystems,
    mepById,
    core,
    stripLayerFlips,
    stripDepthOverridePxByDir,
    stripCanvasNudgePxByDir,
  } = params
  const { x0, y0, rw, rh } = core
  const pxPerInch = d.planScale
  const descriptors = connectionDetailStripDescriptorsFromPlan(connection, d.layoutRefs)
  const out: LayerRect[] = []

  for (const desc of descriptors) {
    const nudge = stripCanvasNudgePxByDir?.[desc.dir]
    const ndx = nudge?.dx ?? 0
    const ndy = nudge?.dy ?? 0
    const tr = (r: LayerRect): LayerRect => ({ x: r.x + ndx, y: r.y + ndy, w: r.w, h: r.h })

    const e = edgeFromDescriptor(connection, desc)
    const swMep = strokeWidthForEdge(d, e, mepById)
    const sys = desc.source === 'arch' ? resolveArchSystem(desc.systemId, orderedSystems) : undefined

    if (desc.source === 'mep' || desc.kind === 'run' || !sys) {
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
      out.push(tr({ x: rx, y: ry, w: hitW, h: hitH }))
      continue
    }

    let drawLayers = drawLayersForPlanEdge(sys)
    if (drawLayers.length === 0) {
      const p = participantForStripDesc(connection, desc)
      const t = p?.totalThicknessIn
      if (t != null && Number.isFinite(t) && t > 0) {
        drawLayers = [syntheticLayerFromThicknessInches(0, t)]
      }
    }
    if (drawLayers.length === 0) continue
    if (stripLayerFlips?.[desc.dir]) {
      drawLayers = [...drawLayers].reverse()
    }

    const rawSizes = drawLayers.map((l) => layerThicknessPlanPx(l.thickness, pxPerInch))
    let sizes = rawSizes.map((s) => Math.max(0.02, s))
    let tw = sizes.reduce((a, b) => a + b, 0)
    const od = stripDepthOverridePxByDir?.[desc.dir]
    if (od != null && od > 0 && tw > 0) {
      sizes = sizes.map((s) => (s / tw) * od)
      tw = od
    }

    const yMidOff = y0 + Math.max(0, (rh - tw) / 2)
    let layerRects: LayerRect[] = []
    if (desc.dir === 'left') {
      layerRects = buildHorizRects(sizes, x0 - tw, yMidOff, tw)
    } else if (desc.dir === 'right') {
      layerRects = buildHorizRects(sizes, x0 + rw, yMidOff, tw)
    } else if (desc.dir === 'down') {
      layerRects = buildWallRects(sizes, x0, y0 + rh, rw)
    } else {
      layerRects = buildWallRects(sizes, x0, y0 - rw, rw)
    }

    for (const r of layerRects) {
      out.push(tr(r))
    }
  }

  return out
}

function quantizeCoord(v: number): number {
  return Math.round(v * 1024) / 1024
}

function mergeCloseSorted(values: number[], eps: number): number[] {
  if (values.length === 0) return []
  const s = [...values].sort((a, b) => a - b)
  const out: number[] = [s[0]!]
  for (let i = 1; i < s.length; i++) {
    const v = s[i]!
    if (v - out[out.length - 1]! > eps) out.push(v)
  }
  return out
}

/** Plan-inch axes for snapping: junction core + every assembly/MEP rect edge. */
export function connectionDetailDrawingAxesPlanInches(params: {
  core: { x0: number; y0: number; rw: number; rh: number }
  layerRects: LayerRect[]
  siteWIn: number
  siteHIn: number
  planScale: number
}): { xsIn: number[]; ysIn: number[] } {
  const { core, layerRects, siteWIn, siteHIn, planScale } = params
  const s = planScale
  const toIn = (px: number) => px / s
  const xs = new Set<number>()
  const ys = new Set<number>()
  const addXpx = (px: number) => {
    const v = toIn(px)
    if (v >= -1e-6 && v <= siteWIn + 1e-6) xs.add(Math.round(v * 1e6) / 1e6)
  }
  const addYpx = (px: number) => {
    const v = toIn(px)
    if (v >= -1e-6 && v <= siteHIn + 1e-6) ys.add(Math.round(v * 1e6) / 1e6)
  }
  addXpx(core.x0)
  addXpx(core.x0 + core.rw)
  addYpx(core.y0)
  addYpx(core.y0 + core.rh)
  for (const r of layerRects) {
    addXpx(r.x)
    addXpx(r.x + r.w)
    addYpx(r.y)
    addYpx(r.y + r.h)
  }
  return {
    xsIn: [...xs].sort((a, b) => a - b),
    ysIn: [...ys].sort((a, b) => a - b),
  }
}

/** SVG px lines at assembly/MEP edges only (no uniform Δ grid). */
export function connectionDetailLayerOnlyGridLinesPx(params: {
  core: { x0: number; y0: number; rw: number; rh: number }
  layerRects: LayerRect[]
}): { xs: number[]; ys: number[] } {
  const { core, layerRects } = params
  const xs = new Set<number>()
  const ys = new Set<number>()
  const addX = (x: number) => {
    if (Number.isFinite(x)) xs.add(quantizeCoord(x))
  }
  const addY = (y: number) => {
    if (Number.isFinite(y)) ys.add(quantizeCoord(y))
  }
  addX(core.x0)
  addX(core.x0 + core.rw)
  addY(core.y0)
  addY(core.y0 + core.rh)
  for (const r of layerRects) {
    addX(r.x)
    addX(r.x + r.w)
    addY(r.y)
    addY(r.y + r.h)
  }
  const eps = 0.02
  return {
    xs: mergeCloseSorted([...xs], eps),
    ys: mergeCloseSorted([...ys], eps),
  }
}

export function minCellSpanFromDrawingAxes(xsIn: readonly number[], ysIn: readonly number[]): number | null {
  let m = Infinity
  for (let i = 1; i < xsIn.length; i++) m = Math.min(m, xsIn[i]! - xsIn[i - 1]!)
  for (let j = 1; j < ysIn.length; j++) m = Math.min(m, ysIn[j]! - ysIn[j - 1]!)
  return Number.isFinite(m) && m > 0 ? m : null
}
