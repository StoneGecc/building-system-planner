import type { PlacedFloorCell, PlacedGridEdge } from '../types/planLayout'
import type { SystemData } from '../types/system'
import type { MepItem } from '../types/mep'
import type { PlanPlaceMode } from '../types/planPlaceMode'
import type { Floor1SheetId, Floor1VisualMode } from '../data/floor1Sheets'
import { mepDisciplineMatches } from '../data/floor1Sheets'

export type { PlanPlaceMode } from '../types/planPlaceMode'

/** Golden-angle step (degrees) so consecutive catalog systems land far apart on the hue wheel. */
const GOLDEN_HUE_STEP = 137.50776405003785
/** Phase offset so MEP hues don’t sit on top of architectural ones. */
const MEP_HUE_PHASE = 53

export type PlanColorCatalog = {
  archSystemIds: readonly string[]
  mepSystemIds: readonly string[]
}

export function buildPlanColorCatalog(
  orderedSystems: readonly SystemData[],
  mepItems: readonly MepItem[],
): PlanColorCatalog {
  return {
    archSystemIds: orderedSystems.map((s) => s.id),
    mepSystemIds: mepItems.map((m) => m.id),
  }
}

/** FNV-1a–style mix; spreads better than small multipliers on similar IDs (e.g. A4-01, A4-02). */
function hashStringHue(key: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h % 360
}

function hueFromCatalog(source: 'arch' | 'mep', systemId: string, catalog: PlanColorCatalog | undefined): number | null {
  if (!catalog) return null
  if (source === 'arch') {
    const i = catalog.archSystemIds.indexOf(systemId)
    if (i >= 0) return (i * GOLDEN_HUE_STEP) % 360
  } else {
    const i = catalog.mepSystemIds.indexOf(systemId)
    if (i >= 0) return (i * GOLDEN_HUE_STEP + MEP_HUE_PHASE) % 360
  }
  return null
}

/** Hue 0–359 for a system; uses catalog order when known, else strong string hash. */
export function planLayerHue(
  source: 'arch' | 'mep',
  systemId: string,
  catalog?: PlanColorCatalog,
): number {
  return hueFromCatalog(source, systemId, catalog) ?? hashStringHue(`${source}:${systemId}`)
}

export function planEdgeStroke(
  e: Pick<PlacedGridEdge, 'source' | 'systemId' | 'kind'>,
  catalog?: PlanColorCatalog,
): string {
  const h = planLayerHue(e.source, e.systemId, catalog)
  if (e.kind === 'wall') {
    return `hsl(${h}, 76%, 34%)`
  }
  if (e.kind === 'window') {
    return 'hsl(200, 76%, 64%)'
  }
  if (e.kind === 'door') {
    return `hsl(${(h + 48) % 360}, 55%, 38%)`
  }
  if (e.kind === 'roof') {
    return `hsl(${(h + 105) % 360}, 58%, 36%)`
  }
  if (e.kind === 'stairs') {
    return `hsl(${(h + 28) % 360}, 62%, 40%)`
  }
  return `hsl(${(h + 24) % 360}, 82%, 40%)`
}

/** SVG stroke-dasharray for plan edge kinds (empty = solid). */
export function planEdgeStrokeDasharray(kind: PlacedGridEdge['kind']): string | undefined {
  if (kind === 'door') return '2 5'
  if (kind === 'roof') return '10 4'
  if (kind === 'stairs') return '3 2'
  return undefined
}

export function planFloorFillHsla(
  source: 'arch' | 'mep',
  systemId: string,
  alpha = 0.48,
  catalog?: PlanColorCatalog,
): string {
  const h = planLayerHue(source, systemId, catalog)
  return `hsla(${h}, 62%, 50%, ${alpha})`
}

/** Fill for implementation-plan unit cells (floor paint vs stair squares). */
export function planCellFill(c: Pick<PlacedFloorCell, 'source' | 'systemId' | 'cellKind'>, catalog?: PlanColorCatalog): string {
  if (c.cellKind === 'stairs') {
    const h = planLayerHue(c.source, c.systemId, catalog)
    return `hsla(${(h + 28) % 360}, 62%, 40%, 0.52)`
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
  if (placeMode === 'floor') {
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
  if (placeMode === 'roof') {
    return planEdgeStroke({ source: 'arch', systemId, kind: 'roof' }, catalog)
  }
  if (placeMode === 'stairs') {
    return planCellFill({ source: 'arch', systemId, cellKind: 'stairs' }, catalog)
  }
  return planEdgeStroke({ source: 'arch', systemId, kind: 'wall' }, catalog)
}

/** Per–Floor-1-sheet emphasis for placed plan edges (stroke opacity multiplier). */
export type PlanVisualProfile = {
  mode: Floor1VisualMode
  /** When mode is `trade_mep`, which discipline filter sheet to highlight. */
  tradeMepSheetId: Floor1SheetId | null
}

const DIM_ARCH = 0.38
const DIM_MEP_OFF = 0.28
const DIM_MEP_INTERIOR = 0.22

export function planPlacedEdgeOpacity(
  e: Pick<PlacedGridEdge, 'source' | 'systemId' | 'kind'>,
  profile: PlanVisualProfile | undefined,
  mepById: ReadonlyMap<string, MepItem>,
): number {
  if (!profile || profile.mode === 'layout') return 1
  const src = e.source ?? 'arch'
  if (profile.mode === 'interior') {
    return src === 'mep' ? DIM_MEP_INTERIOR : 1
  }
  // trade_mep
  if (src === 'arch') return DIM_ARCH
  const sheet = profile.tradeMepSheetId
  if (!sheet) return DIM_MEP_OFF
  const disc = mepById.get(e.systemId)?.discipline ?? ''
  return mepDisciplineMatches(sheet, disc) ? 1 : DIM_MEP_OFF
}

export function planCellColumnOpacity(
  c: Pick<PlacedFloorCell, 'source' | 'systemId'>,
  profile: PlanVisualProfile | undefined,
  mepById: ReadonlyMap<string, MepItem>,
): number {
  if (!profile || profile.mode === 'layout') return 1
  const src = c.source ?? 'arch'
  if (profile.mode === 'interior') {
    return src === 'mep' ? DIM_MEP_INTERIOR : 1
  }
  if (src === 'arch') return DIM_ARCH
  const sheet = profile.tradeMepSheetId
  if (!sheet) return DIM_MEP_OFF
  const disc = mepById.get(c.systemId)?.discipline ?? ''
  return mepDisciplineMatches(sheet, disc) ? 1 : DIM_MEP_OFF
}
