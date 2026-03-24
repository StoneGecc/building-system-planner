import type { BuildingDimensions, Layer, SystemData } from '../types/system'

export type DiagramDetailLevel = 0 | 1 | 2 | 3

export type FastenerDrawMode = 'none' | 'cap_only' | 'full'

export const DIAGRAM_DETAIL_DEFAULTS = {
  defaultLevel: 1 as DiagramDetailLevel,
  detailMaxModuleJoints: 12,
  detailMinFeaturePx: 8,
  shopMaxFastenerMarksPerLayer: 8,
} as const

export function parseDiagramDetailLevel(raw: string | undefined): DiagramDetailLevel | undefined {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t) return undefined
  if (t === '0' || t === 'schematic') return 0
  if (t === '1' || t === 'typical') return 1
  if (t === '2' || t === 'detailed') return 2
  if (t === '3' || t === 'shop') return 3
  const n = parseInt(t, 10)
  if (n === 0 || n === 1 || n === 2 || n === 3) return n as DiagramDetailLevel
  return undefined
}

export function parseDrawFastenerGraphics(raw: string | undefined): FastenerDrawMode | undefined {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t) return undefined
  if (t === 'none') return 'none'
  if (t === 'cap_only' || t === 'cap only') return 'cap_only'
  if (t === 'full') return 'full'
  return undefined
}

/** `1` / `true` → true; `0` / `false` → false; empty → undefined (inherit). */
export function parseTriBool(raw: string | undefined): boolean | undefined {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t) return undefined
  if (t === '1' || t === 'true' || t === 'yes') return true
  if (t === '0' || t === 'false' || t === 'no') return false
  return undefined
}

export function parsePositiveInt(raw: string | undefined): number | undefined {
  const t = (raw ?? '').trim()
  if (!t) return undefined
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

export function effectiveDetailLevel(system: SystemData, bd: BuildingDimensions): DiagramDetailLevel {
  if (system.diagramDetailLevel !== undefined) return system.diagramDetailLevel
  return bd.defaultDiagramDetailLevel ?? DIAGRAM_DETAIL_DEFAULTS.defaultLevel
}

function presetModuleJoints(level: DiagramDetailLevel): boolean {
  return level >= 1
}

function presetControlJoints(level: DiagramDetailLevel): boolean {
  return level >= 2
}

function presetFastenerMode(level: DiagramDetailLevel): FastenerDrawMode {
  if (level <= 0) return 'none'
  return 'full'
}

export function effectiveFastenerMode(layer: Layer, level: DiagramDetailLevel): FastenerDrawMode {
  const o = layer.drawFastenerGraphics
  if (o === 'none' || o === 'cap_only' || o === 'full') return o
  return presetFastenerMode(level)
}

export function effectiveDrawModuleJoints(layer: Layer, level: DiagramDetailLevel): boolean {
  if (layer.drawModuleJoints === true) return true
  if (layer.drawModuleJoints === false) return false
  return presetModuleJoints(level)
}

export function effectiveDrawControlJoints(layer: Layer, level: DiagramDetailLevel): boolean {
  if (layer.drawControlJoints === true) return true
  if (layer.drawControlJoints === false) return false
  return presetControlJoints(level)
}

export function effectiveMaxModuleJoints(layer: Layer, bd: BuildingDimensions): number {
  const n = layer.detailMaxModuleJoints
  if (n !== undefined && Number.isFinite(n) && n >= 0) return Math.floor(n)
  return bd.detailMaxModuleJoints ?? DIAGRAM_DETAIL_DEFAULTS.detailMaxModuleJoints
}

export function effectiveMinFeaturePx(layer: Layer, bd: BuildingDimensions): number {
  const n = layer.detailMinFeaturePx
  if (n !== undefined && Number.isFinite(n) && n > 0) return n
  return bd.detailMinFeaturePx ?? DIAGRAM_DETAIL_DEFAULTS.detailMinFeaturePx
}

export function effectiveShopFastenerCap(bd: BuildingDimensions): number {
  return bd.shopMaxFastenerMarksPerLayer ?? DIAGRAM_DETAIL_DEFAULTS.shopMaxFastenerMarksPerLayer
}
