import type { PlacedFloorCell, PlacedGridEdge } from '../types/planLayout'
import type { SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import {
  fillForLayerType,
  layerExplicitFillHex,
  MISSING_EXPLICIT_FILL_HEX,
} from './layerDiagramFill'
import type { LayerType } from '../types/system'

/** Skip these when inferring plan color from `Fill` / `Layer_Type` so thin generic layers don’t hide structure. */
const PLAN_FILL_FALLBACK_SKIP: ReadonlySet<LayerType> = new Set(['MISC', 'AIR_GAP'])
import type { PlanPlaceMode } from '../types/planPlaceMode'
import type { Floor1SheetId, Floor1VisualMode } from '../data/floor1Sheets'

export type { PlanPlaceMode } from '../types/planPlaceMode'

export type PlanColorCatalog = {
  archSystemIds: readonly string[]
  mepSystemIds: readonly string[]
  /**
   * `#rrggbb` per system id — arch: {@link planHexFromFirstLayer} (CSV first layer row);
   * MEP: `Plan_Color` when set. Used for plan strokes/fills in {@link PlanLayoutEditor}.
   * Missing id → {@link MISSING_EXPLICIT_FILL_HEX} in stroke helpers.
   */
  mepPlanStrokeHexById?: ReadonlyMap<string, string>
}

function normalizeHex6Css(raw: string | undefined): string | undefined {
  const t = raw?.trim().replace(/^#/, '')
  if (t && /^[0-9a-fA-F]{6}$/.test(t)) {
    return `#${t.toLowerCase()}`
  }
  return undefined
}

/** `#rrggbb` → `rgba(r,g,b,a)` for semi-transparent plan fills. */
function rgbaFromHexCss(hexRgb: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hexRgb.trim())
  if (!m) return hexRgb
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Plan catalog hex (per building system):
 * 1. First layer row (CSV `#` order) with explicit hex: `Layer_Color` or 6-digit hex in `Fill`.
 * 2. First layer with a named CSV `Fill` token (`CLT`, `WOOD`, …) → same palette as section legend.
 * 3. First layer’s `Layer_Type` → that palette.
 * 4. System `Plan_Color`, then `Diagram_Color`.
 */
export function planStrokeHexForSystem(s: SystemData): string | undefined {
  const layers = s.layers ?? []
  for (const layer of layers) {
    const h = layerExplicitFillHex(layer)
    if (h) return h
  }
  for (const layer of layers) {
    if (layer.fill && !PLAN_FILL_FALLBACK_SKIP.has(layer.fill as LayerType)) {
      return fillForLayerType(layer.fill as LayerType)
    }
  }
  for (const layer of layers) {
    if (!PLAN_FILL_FALLBACK_SKIP.has(layer.layerType)) {
      return fillForLayerType(layer.layerType)
    }
  }
  if (layers.length > 0) {
    return fillForLayerType(layers[0]!.layerType)
  }
  return (
    normalizeHex6Css(s.planColorHex) ?? normalizeHex6Css(s.diagramColorHex)
  )
}

/**
 * Color for plan ink (walls, floor cells, columns, etc.): **first layer row** in CSV order
 * (`layers[0]`). Uses that row’s `Layer_Color` / hex `Fill`, else {@link fillForLayerType}
 * for its `Layer_Type`. If the system has no layers, falls back to {@link planStrokeHexForSystem}
 * then {@link MISSING_EXPLICIT_FILL_HEX}.
 */
export function planHexFromFirstLayer(s: SystemData): string {
  const first = s.layers?.[0]
  if (first) {
    return layerExplicitFillHex(first) ?? fillForLayerType(first.layerType)
  }
  return planStrokeHexForSystem(s) ?? MISSING_EXPLICIT_FILL_HEX
}

export function buildPlanColorCatalog(
  orderedSystems: readonly SystemData[],
  mepItems: readonly MepItem[],
): PlanColorCatalog {
  const mepPlanStrokeHexById = new Map<string, string>()
  for (const s of orderedSystems) {
    mepPlanStrokeHexById.set(s.id, planHexFromFirstLayer(s))
  }
  for (const m of mepItems) {
    if (mepPlanStrokeHexById.has(m.id)) continue
    const h = normalizeHex6Css(m.planColorHex)
    if (h) mepPlanStrokeHexById.set(m.id, h)
  }
  return {
    archSystemIds: orderedSystems.map((s) => s.id),
    mepSystemIds: mepItems.map((m) => m.id),
    ...(mepPlanStrokeHexById.size > 0 ? { mepPlanStrokeHexById } : {}),
  }
}

export function planEdgeStroke(
  e: Pick<PlacedGridEdge, 'source' | 'systemId' | 'kind'>,
  catalog?: PlanColorCatalog,
): string {
  const hex = catalog?.mepPlanStrokeHexById?.get(e.systemId)
  return hex ?? MISSING_EXPLICIT_FILL_HEX
}

/** SVG stroke-dasharray for plan edge kinds (empty = solid). */
export function planEdgeStrokeDasharray(kind: PlacedGridEdge['kind']): string | undefined {
  if (kind === 'roof') return '10 4'
  if (kind === 'stairs') return '3 2'
  return undefined
}

export function planFloorFillHsla(
  _source: 'arch' | 'mep',
  systemId: string,
  alpha = 0.48,
  catalog?: PlanColorCatalog,
): string {
  const hex = catalog?.mepPlanStrokeHexById?.get(systemId)
  if (hex) return rgbaFromHexCss(hex, alpha)
  return rgbaFromHexCss(MISSING_EXPLICIT_FILL_HEX, alpha)
}

/** Fill for implementation-plan unit cells (floor, roof area, stair squares). */
export function planCellFill(c: Pick<PlacedFloorCell, 'source' | 'systemId' | 'cellKind'>, catalog?: PlanColorCatalog): string {
  if (c.cellKind === 'stairs') {
    const hex = catalog?.mepPlanStrokeHexById?.get(c.systemId)
    if (hex) return rgbaFromHexCss(hex, 0.52)
    return rgbaFromHexCss(MISSING_EXPLICIT_FILL_HEX, 0.52)
  }
  return planFloorFillHsla(c.source, c.systemId, 0.48, catalog)
}

/** Swatch for UI pickers: matches what you see when painting walls vs floor vs MEP runs. */
export function planPaintSwatchColor(
  source: 'arch' | 'mep',
  systemId: string,
  placeMode: PlanPlaceMode,
  catalog: PlanColorCatalog,
): string {
  if (placeMode === 'annotate') {
    return '#64748b'
  }
  if (placeMode === 'room') {
    return 'hsla(268, 45%, 62%, 0.72)'
  }
  if (placeMode === 'column') {
    return planFloorFillHsla(source, systemId, 0.78, catalog)
  }
  if (placeMode === 'floor' || placeMode === 'roof') {
    return planFloorFillHsla(source, systemId, 0.78, catalog)
  }
  if (source === 'mep') {
    return planEdgeStroke({ source: 'mep', systemId, kind: 'run' }, catalog)
  }
  if (placeMode === 'window') {
    return planEdgeStroke({ source: 'arch', systemId, kind: 'window' }, catalog)
  }
  if (placeMode === 'door') {
    return planEdgeStroke({ source: 'arch', systemId, kind: 'door' }, catalog)
  }
  if (placeMode === 'stairs') {
    return planCellFill({ source: 'arch', systemId, cellKind: 'stairs' }, catalog)
  }
  return planEdgeStroke({ source: 'arch', systemId, kind: 'wall' }, catalog)
}

/**
 * Floor-1 sheet mode (layout vs trade vs interior). Used for MEP joined-path grouping and similar;
 * plan ink opacity is no longer dimmed per sheet — use level underlay on trade sheets instead.
 */
export type PlanVisualProfile = {
  mode: Floor1VisualMode
  /** When mode is `trade_mep`, which discipline sheet drives joined MEP run paths. */
  tradeMepSheetId: Floor1SheetId | null
}

/** Arch wall stroke opacity multiplier when a window or door occupies the **same** grid segment (another layer). */
export const PLAN_ARCH_WALL_OPACITY_WITH_OPENING = 0.52

/**
 * Synthetic “wall thickness” under window/door strokes when no arch wall edge exists on that segment
 * (e.g. opening replaced wall on the same layer). Scaled by `planPlacedEdgeOpacity`.
 */
export const PLAN_ARCH_WALL_GHOST_UNDER_OPENING = 0.44

/** Always `1` — trade/interior sheets no longer fade non-active layers (use overlays for reference). */
export function planPlacedEdgeOpacity(
  _e: Pick<PlacedGridEdge, 'source' | 'systemId' | 'kind'>,
  _profile: PlanVisualProfile | undefined,
  _mepById: ReadonlyMap<string, MepItem>,
): number {
  return 1
}

/** Always `1` — see {@link planPlacedEdgeOpacity}. */
export function planCellColumnOpacity(
  _c: Pick<PlacedFloorCell, 'source' | 'systemId'>,
  _profile: PlanVisualProfile | undefined,
  _mepById: ReadonlyMap<string, MepItem>,
): number {
  return 1
}
