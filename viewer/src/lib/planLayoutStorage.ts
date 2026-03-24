import type { BuildingDimensions } from '../types/system'
import type {
  GridEdgeKey,
  PlacedPlanColumn,
  PlanLayoutSketch,
  PlanMeasureGridRun,
  PlanTraceOverlay,
} from '../types/planLayout'
import {
  PLAN_LAYOUT_VERSION,
  edgeKeyString,
  footprintStorageKey,
  normalizeExclusiveArchFloorPaintCells,
} from '../types/planLayout'

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

const LS_PREFIX = 'building-impl-plan-v1'

function storageKey(footprintKey: string): string {
  return `${LS_PREFIX}:${footprintKey}`
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
    const measureRuns = parseMeasureRuns(rec.measureRuns, gridSpacingIn)
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
      ...(Number.isFinite(sw) && sw > 0 ? { siteWidthIn: sw } : {}),
      ...(Number.isFinite(sh) && sh > 0 ? { siteDepthIn: sh } : {}),
      ...(traceOverlay ? { traceOverlay } : {}),
      ...(roomBoundaryEdges ? { roomBoundaryEdges } : {}),
      ...(roomByCell ? { roomByCell } : {}),
    }
  } catch {
    return null
  }
}

export function saveSketchToLocalStorage(d: BuildingDimensions, sketch: PlanLayoutSketch): void {
  try {
    localStorage.setItem(storageKey(footprintStorageKey(d)), JSON.stringify(sketch))
  } catch {
    /* quota or private mode */
  }
}

export function downloadSketchJson(sketch: PlanLayoutSketch, filename = 'implementation-plan.json') {
  const blob = new Blob([JSON.stringify(sketch, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function readSketchFromFile(file: File): Promise<PlanLayoutSketch | null> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const o = JSON.parse(String(r.result)) as PlanLayoutSketch
        if (o?.version !== PLAN_LAYOUT_VERSION || !Array.isArray(o.edges)) {
          resolve(null)
          return
        }
        if (!Number.isFinite(o.gridSpacingIn) || o.gridSpacingIn <= 0) {
          resolve(null)
          return
        }
        const rawCells = Array.isArray(o.cells) ? o.cells : []
        const cells = normalizeExclusiveArchFloorPaintCells(rawCells)
        const sw = Number(o.siteWidthIn)
        const sh = Number(o.siteDepthIn)
        const measureRuns = parseMeasureRuns(o.measureRuns, o.gridSpacingIn)
        const traceOverlay = parseTraceOverlay(o.traceOverlay)
        const rec = o as unknown as Record<string, unknown>
        const roomByCell = parseRoomByCell(rec.roomByCell)
        const roomBoundaryEdges = parseRoomBoundaryEdges(rec.roomBoundaryEdges)
        const columns = parseColumns(rec.columns)
        resolve({
          version: o.version,
          gridSpacingIn: o.gridSpacingIn,
          edges: o.edges,
          cells,
          ...(columns ? { columns } : {}),
          ...(measureRuns ? { measureRuns } : {}),
          ...(Number.isFinite(sw) && sw > 0 ? { siteWidthIn: sw } : {}),
          ...(Number.isFinite(sh) && sh > 0 ? { siteDepthIn: sh } : {}),
          ...(traceOverlay ? { traceOverlay } : {}),
          ...(roomBoundaryEdges ? { roomBoundaryEdges } : {}),
          ...(roomByCell ? { roomByCell } : {}),
        })
      } catch {
        resolve(null)
      }
    }
    r.onerror = () => resolve(null)
    r.readAsText(file)
  })
}
