import type { BuildingDimensions } from '../types/system'
import type {
  ElevationLevelLine,
  GridEdgeKey,
  PlacedPlanColumn,
  PlanAnnotationGridRun,
  PlanAnnotationLabel,
  PlanAnnotationSectionCut,
  PlanLayoutSketch,
  PlanMeasureGridRun,
  PlanTraceOverlay,
} from '../types/planLayout'
import {
  PLAN_LAYOUT_VERSION,
  edgeKeyString,
  emptySketch,
  footprintStorageKey,
  normalizeExclusiveArchFloorPaintCells,
} from '../types/planLayout'
import type { ElevationFace } from '../data/elevationSheets'

function parseTraceOverlay(raw: unknown): PlanTraceOverlay | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const imageDataUrl = typeof o.imageDataUrl === 'string' ? o.imageDataUrl : ''
  if (!/^data:image\/(jpeg|png|jpg);base64,/i.test(imageDataUrl)) return undefined
  const visible = o.visible === false ? false : true
  let opacityPct = Number(o.opacityPct)
  if (!Number.isFinite(opacityPct)) opacityPct = 45
  opacityPct = Math.max(5, Math.min(100, Math.round(opacityPct)))
  const tx = Number(o.tx)
  const ty = Number(o.ty)
  const rotateDeg = Number(o.rotateDeg)
  let scale = Number(o.scale)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  scale = Math.max(0.05, Math.min(8, scale))
  return {
    imageDataUrl,
    visible,
    opacityPct,
    tx: Number.isFinite(tx) ? tx : 0,
    ty: Number.isFinite(ty) ? ty : 0,
    rotateDeg: Number.isFinite(rotateDeg) ? rotateDeg : 0,
    scale,
  }
}

function parseRoomBoundaryEdges(raw: unknown): GridEdgeKey[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const m = new Map<string, GridEdgeKey>()
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const ax = o.axis
    const axis = ax === 'h' || ax === 'v' ? ax : null
    const i = Number(o.i)
    const j = Number(o.j)
    if (!axis || !Number.isFinite(i) || !Number.isFinite(j)) continue
    const e: GridEdgeKey = { axis, i: Math.trunc(i), j: Math.trunc(j) }
    m.set(edgeKeyString(e), e)
  }
  return m.size > 0 ? [...m.values()] : undefined
}

function parseRoomByCell(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t) out[k] = t
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseMeasureRuns(raw: unknown, gridSpacingIn: number): PlanMeasureGridRun[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const d = Math.max(1e-6, gridSpacingIn)
  const out: PlanMeasureGridRun[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const keys = Array.isArray(o.edgeKeys) ? o.edgeKeys.filter((k): k is string => typeof k === 'string') : []
    const totalRaw = Number(o.totalPlanIn)
    const totalPlanIn =
      Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : keys.length > 0 ? keys.length * d : 0
    const sn = o.startNode as { i?: unknown; j?: unknown } | undefined
    const en = o.endNode as { i?: unknown; j?: unknown } | undefined
    if (
      !id ||
      keys.length === 0 ||
      totalPlanIn <= 0 ||
      !sn ||
      !en ||
      !Number.isFinite(Number(sn.i)) ||
      !Number.isFinite(Number(sn.j)) ||
      !Number.isFinite(Number(en.i)) ||
      !Number.isFinite(Number(en.j))
    ) {
      continue
    }
    out.push({
      id,
      edgeKeys: keys,
      totalPlanIn,
      startNode: { i: Number(sn.i), j: Number(sn.j) },
      endNode: { i: Number(en.i), j: Number(en.j) },
    })
  }
  return out.length > 0 ? out : undefined
}

function parseAnnotationGridRuns(raw: unknown): PlanAnnotationGridRun[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: PlanAnnotationGridRun[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const keys = Array.isArray(o.edgeKeys) ? o.edgeKeys.filter((k): k is string => typeof k === 'string') : []
    if (!id || keys.length === 0) continue
    out.push({ id, edgeKeys: keys })
  }
  return out.length > 0 ? out : undefined
}

function parseAnnotationLabels(raw: unknown): PlanAnnotationLabel[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: PlanAnnotationLabel[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const text = typeof o.text === 'string' ? o.text : ''
    const xIn = Number(o.xIn)
    const yIn = Number(o.yIn)
    if (!id || !Number.isFinite(xIn) || !Number.isFinite(yIn)) continue
    out.push({ id, xIn, yIn, text })
  }
  return out.length > 0 ? out : undefined
}

function parseAnnotationSectionCuts(raw: unknown): PlanAnnotationSectionCut[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: PlanAnnotationSectionCut[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const sn = o.startNode as { i?: unknown; j?: unknown } | undefined
    const en = o.endNode as { i?: unknown; j?: unknown } | undefined
    if (
      !id ||
      !sn ||
      !en ||
      !Number.isFinite(Number(sn.i)) ||
      !Number.isFinite(Number(sn.j)) ||
      !Number.isFinite(Number(en.i)) ||
      !Number.isFinite(Number(en.j))
    ) {
      continue
    }
    const si = Number(sn.i)
    const sj = Number(sn.j)
    const ei = Number(en.i)
    const ej = Number(en.j)
    if (si === ei && sj === ej) continue
    out.push({
      id,
      startNode: { i: si, j: sj },
      endNode: { i: ei, j: ej },
    })
  }
  return out.length > 0 ? out : undefined
}

function parseColumns(raw: unknown): PlacedPlanColumn[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: PlacedPlanColumn[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const systemId = typeof o.systemId === 'string' ? o.systemId : ''
    const source = o.source === 'arch' ? 'arch' : null
    const cxIn = Number(o.cxIn)
    const cyIn = Number(o.cyIn)
    const sizeIn = Number(o.sizeIn)
    if (!id || !systemId || source !== 'arch') continue
    if (!Number.isFinite(cxIn) || !Number.isFinite(cyIn) || !Number.isFinite(sizeIn) || sizeIn <= 0) continue
    out.push({ id, cxIn, cyIn, sizeIn, systemId, source: 'arch' })
  }
  return out.length > 0 ? out : undefined
}

function parseElevationLevelLines(raw: unknown): ElevationLevelLine[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: ElevationLevelLine[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const j = Number(o.j)
    const lab = typeof o.label === 'string' ? o.label.trim() : ''
    if (!id || !Number.isFinite(j) || j < 0) continue
    out.push({ id, j: Math.round(j), ...(lab ? { label: lab } : {}) })
  }
  return out.length > 0 ? out : undefined
}

const CONNECTION_DETAIL_STRIP_DIRS = ['up', 'down', 'left', 'right'] as const

function parseConnectionDetailStripLayerFlips(
  raw: unknown,
): PlanLayoutSketch['connectionDetailStripLayerFlips'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['connectionDetailStripLayerFlips']> = {}
  for (const d of CONNECTION_DETAIL_STRIP_DIRS) {
    if (o[d] === true) out[d] = true
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseConnectionJunctionConvexConcaveByNode(
  raw: unknown,
): PlanLayoutSketch['connectionJunctionConvexConcaveByNode'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['connectionJunctionConvexConcaveByNode']> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d+:\d+$/.test(k)) continue
    if (v === 'convex' || v === 'concave') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseConnectionDetailHomogeneousLVariantIdsByFamily(
  raw: unknown,
): PlanLayoutSketch['connectionDetailHomogeneousLVariantIdsByFamily'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['connectionDetailHomogeneousLVariantIdsByFamily']> = {}
  for (const [familyKey, v] of Object.entries(o)) {
    if (typeof familyKey !== 'string' || familyKey.length === 0) continue
    if (!Array.isArray(v)) continue
    const ids: string[] = []
    const seen = new Set<string>()
    for (const x of v) {
      if (typeof x !== 'string' || !x.startsWith('tpl:')) continue
      if (seen.has(x)) continue
      seen.add(x)
      ids.push(x)
    }
    if (ids.length > 0) out[familyKey] = ids
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseConnectionJunctionHomogeneousLSketchIdByNode(
  raw: unknown,
): PlanLayoutSketch['connectionJunctionHomogeneousLSketchIdByNode'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['connectionJunctionHomogeneousLSketchIdByNode']> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d+:\d+$/.test(k)) continue
    if (typeof v !== 'string' || !v.startsWith('tpl:')) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parsePlanArchEdgeLayerFlipped(raw: unknown): PlanLayoutSketch['planArchEdgeLayerFlipped'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['planArchEdgeLayerFlipped']> = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof k !== 'string' || k.length === 0) continue
    if (v === true) out[k] = true
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseConnectionDetailLayerFillByCell(
  raw: unknown,
): PlanLayoutSketch['connectionDetailLayerFillByCell'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: NonNullable<PlanLayoutSketch['connectionDetailLayerFillByCell']> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d+:\d+$/.test(k)) continue
    if (!v || typeof v !== 'object') continue
    const rec = v as Record<string, unknown>
    const src = rec.source === 'mep' ? 'mep' : rec.source === 'arch' ? 'arch' : null
    const systemId = typeof rec.systemId === 'string' ? rec.systemId : null
    const layerIndex = Number(rec.layerIndex)
    if (!src || !systemId || !Number.isFinite(layerIndex) || layerIndex < 0) continue
    out[k] = { source: src, systemId, layerIndex: Math.round(layerIndex) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const LS_PREFIX = 'building-impl-plan-v1'

function storageKey(footprintKey: string): string {
  return `${LS_PREFIX}:${footprintKey}`
}

function levelStorageKey(footprintKey: string, levelId: string): string {
  return `${LS_PREFIX}:level:${levelId}:${footprintKey}`
}

function elevationStorageKey(footprintKey: string, face: ElevationFace): string {
  return `${LS_PREFIX}:elev:${face}:${footprintKey}`
}

function connectionSketchesMapStorageKey(footprintKey: string): string {
  return `${LS_PREFIX}:connections:${footprintKey}`
}

function parseSketchRecordMap(raw: unknown): Record<string, PlanLayoutSketch> {
  const out: Record<string, PlanLayoutSketch> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v) continue
    const s = parsePlanLayoutSketchFromJsonValue(v)
    if (s) out[k] = s
  }
  return out
}

/** All connection-detail sketches for this footprint (keyed by stable template `connection.id`). */
export function loadConnectionSketchesMapFromLocalStorage(
  d: BuildingDimensions,
): Record<string, PlanLayoutSketch> {
  try {
    const raw = localStorage.getItem(connectionSketchesMapStorageKey(footprintStorageKey(d)))
    if (!raw) return {}
    return parseSketchRecordMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveConnectionSketchesMapToLocalStorage(
  d: BuildingDimensions,
  map: Record<string, PlanLayoutSketch>,
): void {
  try {
    localStorage.setItem(connectionSketchesMapStorageKey(footprintStorageKey(d)), JSON.stringify(map))
  } catch {
    /* quota or private mode */
  }
}

export function loadSketchFromLocalStorage(
  d: BuildingDimensions,
): PlanLayoutSketch | null {
  try {
    const raw = localStorage.getItem(storageKey(footprintStorageKey(d)))
    if (!raw) return null
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const rec = o as Record<string, unknown>
    if (rec.version !== PLAN_LAYOUT_VERSION) return null
    const gridSpacingIn = Number(rec.gridSpacingIn)
    if (!Number.isFinite(gridSpacingIn) || gridSpacingIn <= 0) return null
    const edges = rec.edges
    if (!Array.isArray(edges)) return null
    const rawCells = Array.isArray(rec.cells) ? (rec.cells as PlanLayoutSketch['cells']) : []
    const cells = normalizeExclusiveArchFloorPaintCells(rawCells)
    const sw = Number(rec.siteWidthIn)
    const sh = Number(rec.siteDepthIn)
    const bh = Number(rec.buildingHeightIn)
    const measureRuns = parseMeasureRuns(rec.measureRuns, gridSpacingIn)
    const annotationGridRuns = parseAnnotationGridRuns(rec.annotationGridRuns)
    const annotationLabels = parseAnnotationLabels(rec.annotationLabels)
    const annotationSectionCuts = parseAnnotationSectionCuts(rec.annotationSectionCuts)
    const traceOverlay = parseTraceOverlay(rec.traceOverlay)
    const roomByCell = parseRoomByCell(rec.roomByCell)
    const roomBoundaryEdges = parseRoomBoundaryEdges(rec.roomBoundaryEdges)
    const columns = parseColumns(rec.columns)
    const egpj = Number(rec.elevationGroundPlaneJ)
    const elevationLevelLines = parseElevationLevelLines(rec.elevationLevelLines)
    const cdg = Number(rec.connectionDetailGridSpacingIn)
    const cdbc = Number(rec.connectionDetailBoundaryCells)
    const cdStripFlips = parseConnectionDetailStripLayerFlips(rec.connectionDetailStripLayerFlips)
    const ccNode = parseConnectionJunctionConvexConcaveByNode(rec.connectionJunctionConvexConcaveByNode)
    const homVar = parseConnectionDetailHomogeneousLVariantIdsByFamily(
      rec.connectionDetailHomogeneousLVariantIdsByFamily,
    )
    const homNode = parseConnectionJunctionHomogeneousLSketchIdByNode(
      rec.connectionJunctionHomogeneousLSketchIdByNode,
    )
    const archFlip = parsePlanArchEdgeLayerFlipped(rec.planArchEdgeLayerFlipped)
    const cdLayerFill = parseConnectionDetailLayerFillByCell(rec.connectionDetailLayerFillByCell)
    return {
      version: PLAN_LAYOUT_VERSION,
      gridSpacingIn,
      edges: edges as PlanLayoutSketch['edges'],
      cells,
      ...(columns ? { columns } : {}),
      ...(measureRuns ? { measureRuns } : {}),
      ...(annotationGridRuns ? { annotationGridRuns } : {}),
      ...(annotationLabels ? { annotationLabels } : {}),
      ...(annotationSectionCuts ? { annotationSectionCuts } : {}),
      ...(Number.isFinite(sw) && sw > 0 ? { siteWidthIn: sw } : {}),
      ...(Number.isFinite(sh) && sh > 0 ? { siteDepthIn: sh } : {}),
      ...(Number.isFinite(bh) && bh > 0 ? { buildingHeightIn: bh } : {}),
      ...(traceOverlay ? { traceOverlay } : {}),
      ...(roomBoundaryEdges ? { roomBoundaryEdges } : {}),
      ...(roomByCell ? { roomByCell } : {}),
      ...(Number.isFinite(cdg) && cdg > 0 ? { connectionDetailGridSpacingIn: cdg } : {}),
      ...(Number.isFinite(cdbc) && cdbc >= 0 && cdbc <= 48 ? { connectionDetailBoundaryCells: Math.round(cdbc) } : {}),
      ...(cdStripFlips ? { connectionDetailStripLayerFlips: cdStripFlips } : {}),
      ...(ccNode ? { connectionJunctionConvexConcaveByNode: ccNode } : {}),
      ...(homVar ? { connectionDetailHomogeneousLVariantIdsByFamily: homVar } : {}),
      ...(homNode ? { connectionJunctionHomogeneousLSketchIdByNode: homNode } : {}),
      ...(archFlip ? { planArchEdgeLayerFlipped: archFlip } : {}),
      ...(cdLayerFill ? { connectionDetailLayerFillByCell: cdLayerFill } : {}),
      ...(Number.isFinite(egpj) && egpj >= 0 ? { elevationGroundPlaneJ: Math.round(egpj) } : {}),
      ...(elevationLevelLines ? { elevationLevelLines } : {}),
    }
  } catch {
    return null
  }
}

/** Per-cardinal elevation sketch (same schema as plan sketch; canvas size comes from App). */
export function loadElevationSketchFromLocalStorage(
  d: BuildingDimensions,
  face: ElevationFace,
): PlanLayoutSketch | null {
  try {
    const raw = localStorage.getItem(elevationStorageKey(footprintStorageKey(d), face))
    if (!raw) return null
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const rec = o as Record<string, unknown>
    if (rec.version !== PLAN_LAYOUT_VERSION) return null
    const gridSpacingIn = Number(rec.gridSpacingIn)
    if (!Number.isFinite(gridSpacingIn) || gridSpacingIn <= 0) return null
    const edges = rec.edges
    if (!Array.isArray(edges)) return null
    const rawCells = Array.isArray(rec.cells) ? (rec.cells as PlanLayoutSketch['cells']) : []
    const cells = normalizeExclusiveArchFloorPaintCells(rawCells)
    const sw = Number(rec.siteWidthIn)
    const sh = Number(rec.siteDepthIn)
    const bh = Number(rec.buildingHeightIn)
    const measureRuns = parseMeasureRuns(rec.measureRuns, gridSpacingIn)
    const annotationGridRuns = parseAnnotationGridRuns(rec.annotationGridRuns)
    const annotationLabels = parseAnnotationLabels(rec.annotationLabels)
    const annotationSectionCuts = parseAnnotationSectionCuts(rec.annotationSectionCuts)
    const traceOverlay = parseTraceOverlay(rec.traceOverlay)
    const roomByCell = parseRoomByCell(rec.roomByCell)
    const roomBoundaryEdges = parseRoomBoundaryEdges(rec.roomBoundaryEdges)
    const columns = parseColumns(rec.columns)
    return {
      version: PLAN_LAYOUT_VERSION,
      gridSpacingIn,
      edges: edges as PlanLayoutSketch['edges'],
      cells,
      ...(columns ? { columns } : {}),
      ...(measureRuns ? { measureRuns } : {}),
      ...(annotationGridRuns ? { annotationGridRuns } : {}),
      ...(annotationLabels ? { annotationLabels } : {}),
      ...(annotationSectionCuts ? { annotationSectionCuts } : {}),
      ...(Number.isFinite(sw) && sw > 0 ? { siteWidthIn: sw } : {}),
      ...(Number.isFinite(sh) && sh > 0 ? { siteDepthIn: sh } : {}),
      ...(Number.isFinite(bh) && bh > 0 ? { buildingHeightIn: bh } : {}),
      ...(traceOverlay ? { traceOverlay } : {}),
      ...(roomBoundaryEdges ? { roomBoundaryEdges } : {}),
      ...(roomByCell ? { roomByCell } : {}),
    }
  } catch {
    return null
  }
}

export function saveElevationSketchToLocalStorage(
  d: BuildingDimensions,
  face: ElevationFace,
  sketch: PlanLayoutSketch,
): void {
  try {
    localStorage.setItem(elevationStorageKey(footprintStorageKey(d), face), JSON.stringify(sketch))
  } catch {
    /* quota or private mode */
  }
}

export function saveSketchToLocalStorage(d: BuildingDimensions, sketch: PlanLayoutSketch): void {
  try {
    localStorage.setItem(storageKey(footprintStorageKey(d)), JSON.stringify(sketch))
  } catch {
    /* quota or private mode */
  }
}

export function loadLevelSketchFromLocalStorage(
  d: BuildingDimensions,
  levelId: string,
): PlanLayoutSketch | null {
  try {
    const raw = localStorage.getItem(levelStorageKey(footprintStorageKey(d), levelId))
    if (!raw) return null
    return parsePlanLayoutSketchFromJsonValue(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveLevelSketchToLocalStorage(
  d: BuildingDimensions,
  levelId: string,
  sketch: PlanLayoutSketch,
): void {
  try {
    localStorage.setItem(levelStorageKey(footprintStorageKey(d), levelId), JSON.stringify(sketch))
  } catch {
    /* quota or private mode */
  }
}

export function downloadSketchJson(sketch: PlanLayoutSketch, filename = 'floor-1-layout.json') {
  const blob = new Blob([JSON.stringify(sketch, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Full project: Floor 1 sketch plus all elevation sketches (one file to move between browsers).
 * Optional `connectionSketches` stores hand-drawn per-template connection detail layouts (bundle v3+).
 * Connection **sheet list** (which junction types exist) is still derived from floor1 + catalog when loaded.
 */
export const PLAN_BUNDLE_FORMAT = 'building-plan-bundle' as const
export const PLAN_BUNDLE_VERSION = 3 as const

export function downloadPlanBundleJson(
  payload: {
    floor1: PlanLayoutSketch
    elevations: Record<ElevationFace, PlanLayoutSketch>
    levelSketches?: Record<string, PlanLayoutSketch>
    connectionSketches?: Record<string, PlanLayoutSketch>
  },
  filename = 'building-plan.json',
): void {
  const out: Record<string, unknown> = {
    format: PLAN_BUNDLE_FORMAT,
    bundleVersion: PLAN_BUNDLE_VERSION,
    floor1: payload.floor1,
    elevations: {
      N: payload.elevations.N,
      E: payload.elevations.E,
      S: payload.elevations.S,
      W: payload.elevations.W,
    },
  }
  if (payload.levelSketches && Object.keys(payload.levelSketches).length > 0) {
    out.levelSketches = payload.levelSketches
  }
  if (payload.connectionSketches && Object.keys(payload.connectionSketches).length > 0) {
    out.connectionSketches = payload.connectionSketches
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function parsePlanLayoutSketchFromJsonValue(raw: unknown): PlanLayoutSketch | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as PlanLayoutSketch
    if (o.version !== PLAN_LAYOUT_VERSION || !Array.isArray(o.edges)) return null
    if (!Number.isFinite(o.gridSpacingIn) || o.gridSpacingIn <= 0) return null
    const rawCells = Array.isArray(o.cells) ? o.cells : []
    const cells = normalizeExclusiveArchFloorPaintCells(rawCells)
    const sw = Number(o.siteWidthIn)
    const sh = Number(o.siteDepthIn)
    const bh = Number(o.buildingHeightIn)
    const rec = o as unknown as Record<string, unknown>
    const measureRuns = parseMeasureRuns(o.measureRuns, o.gridSpacingIn)
    const annotationGridRuns = parseAnnotationGridRuns(rec.annotationGridRuns)
    const annotationLabels = parseAnnotationLabels(rec.annotationLabels)
    const annotationSectionCuts = parseAnnotationSectionCuts(rec.annotationSectionCuts)
    const traceOverlay = parseTraceOverlay(o.traceOverlay)
    const roomByCell = parseRoomByCell(rec.roomByCell)
    const roomBoundaryEdges = parseRoomBoundaryEdges(rec.roomBoundaryEdges)
    const columns = parseColumns(rec.columns)
    const egpj = Number(rec.elevationGroundPlaneJ)
    const elevationLevelLines = parseElevationLevelLines(rec.elevationLevelLines)
    const cdg = Number(rec.connectionDetailGridSpacingIn)
    const cdbc = Number(rec.connectionDetailBoundaryCells)
    const cdStripFlips = parseConnectionDetailStripLayerFlips(rec.connectionDetailStripLayerFlips)
    const ccNode = parseConnectionJunctionConvexConcaveByNode(rec.connectionJunctionConvexConcaveByNode)
    const homVar = parseConnectionDetailHomogeneousLVariantIdsByFamily(
      rec.connectionDetailHomogeneousLVariantIdsByFamily,
    )
    const homNode = parseConnectionJunctionHomogeneousLSketchIdByNode(
      rec.connectionJunctionHomogeneousLSketchIdByNode,
    )
    const archFlip = parsePlanArchEdgeLayerFlipped(rec.planArchEdgeLayerFlipped)
    const cdLayerFill = parseConnectionDetailLayerFillByCell(rec.connectionDetailLayerFillByCell)
    return {
      version: o.version,
      gridSpacingIn: o.gridSpacingIn,
      edges: o.edges,
      cells,
      ...(columns ? { columns } : {}),
      ...(measureRuns ? { measureRuns } : {}),
      ...(annotationGridRuns ? { annotationGridRuns } : {}),
      ...(annotationLabels ? { annotationLabels } : {}),
      ...(annotationSectionCuts ? { annotationSectionCuts } : {}),
      ...(Number.isFinite(sw) && sw > 0 ? { siteWidthIn: sw } : {}),
      ...(Number.isFinite(sh) && sh > 0 ? { siteDepthIn: sh } : {}),
      ...(Number.isFinite(bh) && bh > 0 ? { buildingHeightIn: bh } : {}),
      ...(traceOverlay ? { traceOverlay } : {}),
      ...(roomBoundaryEdges ? { roomBoundaryEdges } : {}),
      ...(roomByCell ? { roomByCell } : {}),
      ...(Number.isFinite(cdg) && cdg > 0 ? { connectionDetailGridSpacingIn: cdg } : {}),
      ...(Number.isFinite(cdbc) && cdbc >= 0 && cdbc <= 48 ? { connectionDetailBoundaryCells: Math.round(cdbc) } : {}),
      ...(cdStripFlips ? { connectionDetailStripLayerFlips: cdStripFlips } : {}),
      ...(ccNode ? { connectionJunctionConvexConcaveByNode: ccNode } : {}),
      ...(homVar ? { connectionDetailHomogeneousLVariantIdsByFamily: homVar } : {}),
      ...(homNode ? { connectionJunctionHomogeneousLSketchIdByNode: homNode } : {}),
      ...(archFlip ? { planArchEdgeLayerFlipped: archFlip } : {}),
      ...(cdLayerFill ? { connectionDetailLayerFillByCell: cdLayerFill } : {}),
      ...(Number.isFinite(egpj) && egpj >= 0 ? { elevationGroundPlaneJ: Math.round(egpj) } : {}),
      ...(elevationLevelLines ? { elevationLevelLines } : {}),
    }
  } catch {
    return null
  }
}

export type PlanBundleImportResult =
  | {
      kind: 'bundle'
      floor1: PlanLayoutSketch
      elevations: Record<ElevationFace, PlanLayoutSketch>
      levelSketches: Record<string, PlanLayoutSketch>
      connectionSketches: Record<string, PlanLayoutSketch>
    }
  | { kind: 'sketch'; sketch: PlanLayoutSketch }

function parseLevelSketches(raw: unknown): Record<string, PlanLayoutSketch> {
  return parseSketchRecordMap(raw)
}

export function readPlanBundleOrSketchFromFile(file: File): Promise<PlanBundleImportResult | null> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result)) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rec = parsed as Record<string, unknown>
          if (rec.format === PLAN_BUNDLE_FORMAT && rec.floor1 != null) {
            const floor1 = parsePlanLayoutSketchFromJsonValue(rec.floor1)
            if (!floor1) {
              resolve(null)
              return
            }
            const faces: ElevationFace[] = ['N', 'E', 'S', 'W']
            const elevations = {} as Record<ElevationFace, PlanLayoutSketch>
            const rawElev = rec.elevations
            if (rawElev && typeof rawElev === 'object' && !Array.isArray(rawElev)) {
              const er = rawElev as Record<string, unknown>
              for (const f of faces) {
                const chunk = er[f]
                if (chunk != null) {
                  const p = parsePlanLayoutSketchFromJsonValue(chunk)
                  if (p) elevations[f] = p
                }
              }
            }
            for (const f of faces) {
              if (!elevations[f]) elevations[f] = emptySketch(floor1.gridSpacingIn)
            }
            const levelSketches = parseLevelSketches(rec.levelSketches)
            const connectionSketches = parseSketchRecordMap(rec.connectionSketches)
            resolve({ kind: 'bundle', floor1, elevations, levelSketches, connectionSketches })
            return
          }
        }
        const sketch = parsePlanLayoutSketchFromJsonValue(parsed)
        if (sketch) resolve({ kind: 'sketch', sketch })
        else resolve(null)
      } catch {
        resolve(null)
      }
    }
    r.onerror = () => resolve(null)
    r.readAsText(file)
  })
}

export function readSketchFromFile(file: File): Promise<PlanLayoutSketch | null> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const o = JSON.parse(String(r.result))
        resolve(parsePlanLayoutSketchFromJsonValue(o))
      } catch {
        resolve(null)
      }
    }
    r.onerror = () => resolve(null)
    r.readAsText(file)
  })
}
