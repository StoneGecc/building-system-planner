import type { PlanLayoutSketch } from '../types/planLayout'
import type { SystemData } from '../types/system'
import { connectionDetailRasterFillCellKeysAtPlanInches } from './connectionDetailRasterFill'
import { resolveLayerDiagramFill } from './layerDiagramFill'
import { planFloorFillHsla, type PlanColorCatalog } from './planLayerColors'

function resolveSystemById(systemId: string, orderedSystems: readonly SystemData[]): SystemData | undefined {
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

export function connectionDetailManualFillSvgColor(
  ref: { source: 'arch' | 'mep'; systemId: string; layerIndex: number },
  orderedSystems: readonly SystemData[],
  planColorCatalog: PlanColorCatalog,
): string {
  if (ref.source === 'mep') {
    return planFloorFillHsla('mep', ref.systemId, 0.52, planColorCatalog)
  }
  const sys = resolveSystemById(ref.systemId, orderedSystems)
  const layer = sys?.layers?.[ref.layerIndex]
  if (!layer) return '#e7e5e4'
  return resolveLayerDiagramFill(layer)
}

export type ConnectionDetailLayerFillPick = {
  source: 'arch' | 'mep'
  systemId: string
  layerIndex: number
}

/** Interaction key for layer-fill cells on connection-detail sheets (erase / select). */
export const CONNECTION_DETAIL_FILL_KEY_PREFIX = 'cdf:' as const

export function connectionDetailFillInteractionKey(cellKey: string): string {
  return `${CONNECTION_DETAIL_FILL_KEY_PREFIX}${cellKey}`
}

export function connectionDetailFillCellKeyFromInteractionKey(key: string): string | null {
  if (!key.startsWith(CONNECTION_DETAIL_FILL_KEY_PREFIX)) return null
  const rest = key.slice(CONNECTION_DETAIL_FILL_KEY_PREFIX.length)
  return /^\d+:\d+$/.test(rest) ? rest : null
}

export function connectionDetailFilledCellHitAtPlanInches(
  pin: { xIn: number; yIn: number },
  byCell: Readonly<Record<string, ConnectionDetailLayerFillPick>>,
  xsIn: readonly number[],
  ysIn: readonly number[],
): string | null {
  if (Object.keys(byCell).length === 0) return null
  if (xsIn.length < 2 || ysIn.length < 2) return null
  for (const cellKey of Object.keys(byCell)) {
    const parts = cellKey.split(':')
    if (parts.length !== 2) continue
    const i = Number(parts[0])
    const j = Number(parts[1])
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue
    const x0 = xsIn[i]
    const x1 = xsIn[i + 1]
    const y0 = ysIn[j]
    const y1 = ysIn[j + 1]
    if (x0 == null || x1 == null || y0 == null || y1 == null) continue
    const loX = Math.min(x0, x1)
    const hiX = Math.max(x0, x1)
    const loY = Math.min(y0, y1)
    const hiY = Math.max(y0, y1)
    if (pin.xIn >= loX && pin.xIn <= hiX && pin.yIn >= loY && pin.yIn <= hiY) {
      return cellKey
    }
  }
  return null
}

export function connectionDetailFilledCellKeysIntersectingPlanRect(
  byCell: Readonly<Record<string, ConnectionDetailLayerFillPick>>,
  xsIn: readonly number[],
  ysIn: readonly number[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): string[] {
  if (Object.keys(byCell).length === 0) return []
  if (xsIn.length < 2 || ysIn.length < 2) return []
  const minx = Math.min(minX, maxX)
  const maxx = Math.max(minX, maxX)
  const miny = Math.min(minY, maxY)
  const maxy = Math.max(minY, maxY)
  const out: string[] = []
  for (const cellKey of Object.keys(byCell)) {
    const parts = cellKey.split(':')
    if (parts.length !== 2) continue
    const i = Number(parts[0])
    const j = Number(parts[1])
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue
    const x0 = xsIn[i]!
    const x1 = xsIn[i + 1]!
    const y0 = ysIn[j]!
    const y1 = ysIn[j + 1]!
    const clox = Math.min(x0, x1)
    const chix = Math.max(x0, x1)
    const cloy = Math.min(y0, y1)
    const chiy = Math.max(y0, y1)
    if (clox <= maxx && chix >= minx && cloy <= maxy && chiy >= miny) {
      out.push(cellKey)
    }
  }
  return out
}

export function removeConnectionDetailFillsAtCellKeys(
  sketch: PlanLayoutSketch,
  cellKeys: readonly string[],
): PlanLayoutSketch | null {
  if (cellKeys.length === 0) return null
  const prev = sketch.connectionDetailLayerFillByCell ?? {}
  const next: NonNullable<PlanLayoutSketch['connectionDetailLayerFillByCell']> = { ...prev }
  let changed = false
  for (const k of cellKeys) {
    if (next[k]) {
      delete next[k]
      changed = true
    }
  }
  if (!changed) return null
  return {
    ...sketch,
    connectionDetailLayerFillByCell: Object.keys(next).length > 0 ? next : undefined,
  }
}

function enclosedComponentCellKeysAtPlanInches(params: {
  sketch: PlanLayoutSketch
  xIn: number
  yIn: number
  xsIn: readonly number[]
  ysIn: readonly number[]
}): string[] | null {
  return connectionDetailRasterFillCellKeysAtPlanInches(params)
}

/** Cell keys that would be updated on click at `(xIn, yIn)`, or null if exterior / invalid. */
export function connectionDetailManualFillPreviewCellKeys(params: {
  sketch: PlanLayoutSketch
  xIn: number
  yIn: number
  xsIn: readonly number[]
  ysIn: readonly number[]
}): string[] | null {
  return enclosedComponentCellKeysAtPlanInches(params)
}

export function applyConnectionDetailManualLayerFill(params: {
  sketch: PlanLayoutSketch
  xIn: number
  yIn: number
  xsIn: readonly number[]
  ysIn: readonly number[]
  pick: ConnectionDetailLayerFillPick | 'clear'
}): PlanLayoutSketch | null {
  const { sketch, xIn, yIn, xsIn, ysIn, pick } = params
  const cellKeys = enclosedComponentCellKeysAtPlanInches({ sketch, xIn, yIn, xsIn, ysIn })
  if (!cellKeys) return null
  const prev = sketch.connectionDetailLayerFillByCell ?? {}
  const next: NonNullable<PlanLayoutSketch['connectionDetailLayerFillByCell']> = { ...prev }
  if (pick === 'clear') {
    for (const k of cellKeys) {
      delete next[k]
    }
  } else {
    for (const k of cellKeys) {
      next[k] = {
        source: pick.source,
        systemId: pick.systemId,
        layerIndex: pick.layerIndex,
      }
    }
  }
  return {
    ...sketch,
    connectionDetailLayerFillByCell: Object.keys(next).length > 0 ? next : undefined,
  }
}
