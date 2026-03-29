import type { BuildingDimensions, Layer, SystemData } from '../types/system'
import type { PlacedGridEdge, PlacedPlanColumn } from '../types/planLayout'
import { placedColumnKey } from '../types/planLayout'
import { parseThickness } from './csvParser'
import { buildHorizRects, buildWallRects, type LayerRect } from './geometry'
import { getSystemOrientation } from './orientation'
import { resolveLayerDiagramFill } from './layerDiagramFill'

export type PlanArchEdgeLayerSlice = {
  key: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  airGap: boolean
}

export type PlanArchEdgeLayerSeam = {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Match {@link ConnectionDetailPlanStrips} — junction-agnostic plan stacking (schematic order). */
function resolveArchSystem(systemId: string, orderedSystems: readonly SystemData[]): SystemData | undefined {
  const tid = systemId.trim()
  if (!tid) return undefined
  const byId = new Map(orderedSystems.map((s) => [s.id.trim(), s]))
  let s = byId.get(tid)
  if (s) return s
  const tl = tid.toLowerCase()
  s = orderedSystems.find((x) => x.id.trim().toLowerCase() === tl)
  if (s) return s
  return orderedSystems.find((x) => tid === x.id.trim() || tid.endsWith(x.id) || x.id.endsWith(tid))
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

/**
 * Visible CSV layers in schematic plan order: CSV indices filtered by visibility, then orientation.reverse.
 * If every layer is hidden but the system has rows, fall back to all indices.
 * Used by plan wall bands and {@link ConnectionDetailPlanStrips} so junction caps match straight runs.
 */
export function drawLayersForPlanEdge(sys: SystemData): Layer[] {
  const config = getSystemOrientation(sys)
  let visibleIndices = sys.layers
    .map((l, i) => (l.visible !== false ? i : -1))
    .filter((i) => i >= 0)
  if (visibleIndices.length === 0 && sys.layers.length > 0) {
    visibleIndices = sys.layers.map((_, i) => i)
  }
  const orderedIdx = config.reverse ? [...visibleIndices].reverse() : visibleIndices
  let layers = orderedIdx.map((i) => sys.layers[i]!)
  if (layers.length === 0) {
    const t = parseThickness(sys.totalThickness)
    if (t > 0) layers = [syntheticLayerFromThicknessInches(0, t)]
  }
  return layers
}

function seamsBetweenSlices(rects: LayerRect[], axis: 'h' | 'v', keyPrefix: string): PlanArchEdgeLayerSeam[] {
  if (rects.length < 2) return []
  const out: PlanArchEdgeLayerSeam[] = []
  for (let i = 0; i < rects.length - 1; i++) {
    const r = rects[i]!
    if (axis === 'h') {
      const y = r.y + r.h
      out.push({ key: `${keyPrefix}-seam-${i}`, x1: r.x, y1: y, x2: r.x + r.w, y2: y })
    } else {
      const x = r.x + r.w
      out.push({ key: `${keyPrefix}-seam-${i}`, x1: x, y1: r.y, x2: x, y2: r.y + r.h })
    }
  }
  return out
}

/** Centered band along a horizontal or vertical grid segment (stroke thickness `sw`). */
export function thinStrokeBandCanvasPx(
  axis: 'h' | 'v',
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sw: number,
): { x: number; y: number; width: number; height: number } {
  if (axis === 'h') {
    const xa = Math.min(x1, x2)
    const y = y1 - sw / 2
    return { x: xa, y, width: Math.abs(x2 - x1), height: sw }
  }
  const ya = Math.min(y1, y2)
  const x = x1 - sw / 2
  return { x, y: ya, width: sw, height: Math.abs(y2 - y1) }
}

export function planArchEdgeLayerSliceStrokePx(
  sliceW: number,
  sliceH: number,
  airGap: boolean,
  visualScale: number,
): { strokeW: number; dash: string | undefined } {
  const vs = Math.max(visualScale, 0.18)
  const m = Math.min(sliceW, sliceH)
  const cap = Math.max(0.035, m * 0.065)
  const layerStrokeSolid = Math.max(0.04, Math.min(0.14, 0.09 * vs))
  const layerStrokeAir = Math.max(0.05, Math.min(0.18, 0.11 * vs))
  const strokeW = Math.min(airGap ? layerStrokeAir : layerStrokeSolid, cap)
  const dash = airGap
    ? `${Math.max(0.35, 1.15 * vs)} ${Math.max(0.3, 0.95 * vs)}`
    : undefined
  return { strokeW, dash }
}

export function planArchEdgeSeamStrokePx(visualScale: number): number {
  const vs = Math.max(visualScale, 0.18)
  return Math.max(0.1, Math.min(0.22, 0.16 * vs))
}

const ARCH_LINE_KINDS = new Set(['wall', 'window', 'door', 'roof', 'stairs'])

export function archEdgeSupportsPlanAssemblyStack(e: PlacedGridEdge): boolean {
  if ((e.source ?? 'arch') !== 'arch') return false
  return ARCH_LINE_KINDS.has(e.kind ?? 'wall')
}

/** Persisted flip key for column assembly stacks (`planArchEdgeLayerFlipped`). */
export function planAssemblyColumnFlipKey(col: PlacedPlanColumn): string {
  return `assemblyColumn:${placedColumnKey(col)}`
}

/**
 * Subdivide a plan band (wall mass or thin stroke) into CSV layer slices for arch edges.
 * Returns null if the edge should fall back to legacy single-color line/band.
 */
export function computePlanArchEdgeLayerStack(args: {
  edge: PlacedGridEdge
  d: BuildingDimensions
  orderedSystems: readonly SystemData[]
  bandRect: { x: number; y: number; width: number; height: number }
  axis: 'h' | 'v'
  placedKey: string
  /** Reverse catalog layer order along thickness (persisted per segment). */
  layerOrderFlipped?: boolean
}): { slices: PlanArchEdgeLayerSlice[]; seams: PlanArchEdgeLayerSeam[] } | null {
  const src = args.edge.source ?? 'arch'
  if (src !== 'arch') return null
  const kind = args.edge.kind ?? 'wall'
  if (!ARCH_LINE_KINDS.has(kind)) return null

  const sys = resolveArchSystem(args.edge.systemId, args.orderedSystems)
  if (!sys) return null

  let drawLayers = drawLayersForPlanEdge(sys)
  if (drawLayers.length === 0) return null
  if (args.layerOrderFlipped && drawLayers.length > 1) {
    drawLayers = [...drawLayers].reverse()
  }

  const pxPerInch = args.d.planScale
  const rawSizes = drawLayers.map((l) => Math.max(1e-6, parseThickness(l.thickness) * pxPerInch))
  const depth = args.axis === 'h' ? args.bandRect.height : args.bandRect.width
  if (!(depth > 0)) return null

  let sizes = rawSizes.map((s) => Math.max(0.02, s))
  const tw = sizes.reduce((a, b) => a + b, 0)
  if (!(tw > 0)) return null
  sizes = sizes.map((s) => (s / tw) * depth)

  let layerRects: LayerRect[]
  if (args.axis === 'h') {
    layerRects = buildHorizRects(sizes, args.bandRect.x, args.bandRect.y, args.bandRect.width)
  } else {
    layerRects = buildWallRects(sizes, args.bandRect.x, args.bandRect.y, args.bandRect.height)
  }

  const slices: PlanArchEdgeLayerSlice[] = drawLayers.map((layer, i) => {
    const r = layerRects[i]!
    return {
      key: `${args.placedKey}-L${i}`,
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      fill: resolveLayerDiagramFill(layer),
      airGap: layer.layerType === 'AIR_GAP',
    }
  })

  const seams = seamsBetweenSlices(layerRects, args.axis, args.placedKey)
  return { slices, seams }
}

/**
 * Horizontal layer slices inside a square column footprint (same CSV layer logic as arch wall bands).
 */
export function computePlanArchColumnLayerStack(args: {
  col: PlacedPlanColumn
  d: BuildingDimensions
  orderedSystems: readonly SystemData[]
  bandRect: { x: number; y: number; width: number; height: number }
  placedKey: string
  layerOrderFlipped?: boolean
}): { slices: PlanArchEdgeLayerSlice[]; seams: PlanArchEdgeLayerSeam[] } | null {
  const fakeEdge: PlacedGridEdge = {
    i: 0,
    j: 0,
    axis: 'h',
    systemId: args.col.systemId,
    source: args.col.source ?? 'arch',
    kind: 'wall',
  }
  return computePlanArchEdgeLayerStack({
    edge: fakeEdge,
    d: args.d,
    orderedSystems: args.orderedSystems,
    bandRect: args.bandRect,
    axis: 'h',
    placedKey: args.placedKey,
    layerOrderFlipped: args.layerOrderFlipped,
  })
}
