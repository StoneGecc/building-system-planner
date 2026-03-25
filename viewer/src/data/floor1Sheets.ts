import type { PlanPlaceMode } from '../types/planPlaceMode'
import type { MepItem } from '../types/mep'

/** First page index for Floor 1 sketch views (Layout + trade sheets). After composites 0–1 and physical space inventory at 2. */
export const FLOOR1_SKETCH_PAGE_BASE = 3

export type Floor1SheetId =
  | 'layout'
  | 'water'
  | 'electrical'
  | 'mechanical'
  | 'plumbing'
  | 'life_safety'
  | 'interior'

export type Floor1VisualMode = 'layout' | 'trade_mep' | 'interior'

function normDisc(s: string): string {
  return s.trim().toLowerCase()
}

/** Match MEP CSV `Discipline` text to a trade sheet (forbidden overlap is OK). */
export function mepDisciplineMatches(sheetId: Floor1SheetId, discipline: string): boolean {
  const d = normDisc(discipline)
  if (!d) return false
  switch (sheetId) {
    case 'water':
      return (
        d.includes('water') ||
        d.includes('domestic') ||
        /\bcw\b/.test(d) ||
        /\bhw\b/.test(d) ||
        d.includes('potable')
      )
    case 'plumbing':
      return (
        d.includes('plumb') ||
        d.includes('sanitary') ||
        d.includes('waste') ||
        d.includes('vent') ||
        d.includes('drain')
      )
    case 'electrical':
      return d.includes('electric') || d.includes('power') || d.includes('lighting') || d.includes('low volt')
    case 'mechanical':
      return (
        d.includes('mech') ||
        d.includes('hvac') ||
        d.includes('duct') ||
        d.includes('mechanical')
      )
    case 'life_safety':
      return (
        d.includes('fire') ||
        d.includes('sprinkler') ||
        d.includes('fp') ||
        d.includes('alarm') ||
        d.includes('life safety')
      )
    default:
      return false
  }
}

export type Floor1SheetDef = {
  id: Floor1SheetId
  label: string
  badge: string
  /** Page index in global nav (composite 0–1, then Floor 1 block). */
  pageIndex: number
  allowsMepEditing: boolean
  visualMode: Floor1VisualMode
  /** When `visualMode === 'trade_mep'`, emphasize MEP rows whose discipline matches. */
  mepDisciplineFilterSheet: Floor1SheetId | null
  visiblePlaceModes: ReadonlySet<PlanPlaceMode>
  /** Default when opening sheet; parent may override if MEP list empty. */
  defaultPlaceMode: PlanPlaceMode
}

const LAYOUT_MODES = new Set<PlanPlaceMode>([
  'structure',
  'roof',
  'window',
  'door',
  'stairs',
  'column',
  'floor',
  'room',
  'annotate',
])

const TRADE_MEP_MODES = new Set<PlanPlaceMode>(['mep', 'annotate'])

const INTERIOR_MODES = new Set<PlanPlaceMode>([
  'structure',
  'window',
  'door',
  'stairs',
  'column',
  'floor',
  'room',
  'annotate',
])

function def(
  i: number,
  partial: Omit<Floor1SheetDef, 'pageIndex'> & { pageIndex?: number },
): Floor1SheetDef {
  return { ...partial, pageIndex: FLOOR1_SKETCH_PAGE_BASE + i }
}

/** Ordered Floor 1 sketch pages: Layout then six trade sheets. */
export const FLOOR1_SHEETS: readonly Floor1SheetDef[] = [
  def(0, {
    id: 'layout',
    label: 'Layout',
    badge: 'L1',
    allowsMepEditing: false,
    visualMode: 'layout',
    mepDisciplineFilterSheet: null,
    visiblePlaceModes: LAYOUT_MODES,
    defaultPlaceMode: 'structure',
  }),
  def(1, {
    id: 'water',
    label: 'Water',
    badge: 'W',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'water',
    visiblePlaceModes: TRADE_MEP_MODES,
    defaultPlaceMode: 'mep',
  }),
  def(2, {
    id: 'electrical',
    label: 'Electrical',
    badge: 'E',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'electrical',
    visiblePlaceModes: TRADE_MEP_MODES,
    defaultPlaceMode: 'mep',
  }),
  def(3, {
    id: 'mechanical',
    label: 'Mechanical',
    badge: 'M',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'mechanical',
    visiblePlaceModes: TRADE_MEP_MODES,
    defaultPlaceMode: 'mep',
  }),
  def(4, {
    id: 'plumbing',
    label: 'Plumbing',
    badge: 'P',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'plumbing',
    visiblePlaceModes: TRADE_MEP_MODES,
    defaultPlaceMode: 'mep',
  }),
  def(5, {
    id: 'life_safety',
    label: 'Life safety',
    badge: 'LS',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'life_safety',
    visiblePlaceModes: TRADE_MEP_MODES,
    defaultPlaceMode: 'mep',
  }),
  def(6, {
    id: 'interior',
    label: 'Interior',
    badge: 'I',
    allowsMepEditing: false,
    visualMode: 'interior',
    mepDisciplineFilterSheet: null,
    visiblePlaceModes: INTERIOR_MODES,
    defaultPlaceMode: 'floor',
  }),
] as const

export const FLOOR1_SKETCH_PAGE_COUNT = FLOOR1_SHEETS.length

const byPageIndex = new Map<number, Floor1SheetDef>()
const byId = new Map<Floor1SheetId, Floor1SheetDef>()
for (const s of FLOOR1_SHEETS) {
  byPageIndex.set(s.pageIndex, s)
  byId.set(s.id, s)
}

export function floor1SheetFromPageIndex(pageIndex: number): Floor1SheetDef | null {
  return byPageIndex.get(pageIndex) ?? null
}

export function floor1SheetById(id: Floor1SheetId): Floor1SheetDef {
  return byId.get(id)!
}

export function isFloor1SketchPage(pageIndex: number): boolean {
  return pageIndex >= FLOOR1_SKETCH_PAGE_BASE && pageIndex < FLOOR1_SKETCH_PAGE_BASE + FLOOR1_SKETCH_PAGE_COUNT
}

export function filterMepItemsForSheet(sheet: Floor1SheetDef, items: readonly MepItem[]): MepItem[] {
  const key = sheet.mepDisciplineFilterSheet
  if (!key || !sheet.allowsMepEditing) return []
  return items.filter((m) => mepDisciplineMatches(key, m.discipline))
}
