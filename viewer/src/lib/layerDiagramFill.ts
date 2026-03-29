import type { Layer, LayerType } from '../types/system'

/**
 * When a CSV layer has no `Layer_Color` / hex `Fill`, diagrams and plans must not invent a hue from
 * `Layer_Type` — use this so missing data is obvious.
 */
export const MISSING_EXPLICIT_FILL_HEX = '#dc2626'

/** Default solid fill when no CSV hex is set (matches former hatch material families). */
export const LAYER_TYPE_FALLBACK: Record<LayerType, string> = {
  CLT: '#c4a574',
  WOOD: '#a67c52',
  INSULATION: '#f5e6a3',
  MEMBRANE: '#94a3b8',
  METAL: '#9ca3af',
  CONCRETE: '#d6d3d1',
  AIR_GAP: '#f8fafc',
  GLASS: '#bae6fd',
  GRAVEL_SOIL: '#78716c',
  MISC: '#e7e5e4',
}

const DEFAULT_FILL = '#e5e5e5'

export function isHex6(s: string | undefined): boolean {
  if (!s) return false
  const t = s.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(t)
}

/** Returns `#rrggbb` or undefined if invalid. Accepts optional leading `#`. */
export function normalizeHex6(s: string | undefined): string | undefined {
  const t = (s ?? '').trim().replace(/^#/, '')
  if (!/^([0-9a-fA-F]{6})$/.test(t)) return undefined
  return `#${t.toLowerCase()}`
}

export function fillForLayerType(t: LayerType): string {
  return LAYER_TYPE_FALLBACK[t] ?? DEFAULT_FILL
}

/** Hex from CSV `Layer_Color` or hex in `Fill` only (named fills like `CLT` are not colors). */
export function layerExplicitFillHex(
  l: Pick<Layer, 'fill' | 'colorHex'>,
): string | undefined {
  return normalizeHex6(l.colorHex) ?? normalizeHex6(l.fill)
}

/**
 * Solid SVG fill for a section layer: CSV `Layer_Color` / hex `Fill`, else `Layer_Type` palette
 * ({@link fillForLayerType}) so assemblies match the legend when hex is omitted.
 */
export function resolveLayerDiagramFill(l: Pick<Layer, 'layerType' | 'fill' | 'colorHex'>): string {
  return layerExplicitFillHex(l) ?? fillForLayerType(l.layerType)
}

/** Diagram hatch id (`p-CLT`, …) does not carry hex — require `Diagram_Color` instead. */
export function resolveDiagramHatchFill(_hatchId: string): string {
  return MISSING_EXPLICIT_FILL_HEX
}

export function resolveSystemDiagramFill(
  diagramColorHex: string | undefined,
  diagramHatch: string | undefined,
): string {
  const fromHex = normalizeHex6(diagramColorHex)
  if (fromHex) return fromHex
  const hatch = (diagramHatch ?? 'p-MISC').trim() || 'p-MISC'
  return resolveDiagramHatchFill(hatch)
}
