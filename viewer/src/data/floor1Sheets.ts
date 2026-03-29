import type { PlanPlaceMode } from '../types/planPlaceMode'
import type { MepItem } from '../types/mep'

/** First page index for level sketch views (Layout + trade sheets). After composites 0–1 and physical space inventory at 2. */
export const LEVEL_PAGES_START = 3

/** Number of sub-sheets per building level (Layout + 7 trades). */
export const SHEETS_PER_LEVEL = 8

/** @deprecated Use LEVEL_PAGES_START */
export const FLOOR1_SKETCH_PAGE_BASE = LEVEL_PAGES_START

export type Floor1SheetId =
  | 'layout'
  | 'water'
  | 'electrical'
  | 'mechanical'
  | 'plumbing'
  | 'life_safety'
  | 'telecommunications'
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
    case 'telecommunications':
      return (
        d.includes('telecom') ||
        d.includes('telecommunication') ||
        d.includes('communications') ||
        d.includes('data') ||
        d.includes('voice') ||
        d.includes('network') ||
        d.includes('structured')
      )
    default:
      return false
  }
}

export type Floor1SheetDef = {
  id: Floor1SheetId
  label: string
  badge: string
  /** Page index in global nav. */
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

const WATER_MODES = new Set<PlanPlaceMode>(['waterPipe', 'waterEquip', 'waterValve', 'annotate'])
const ELECTRICAL_MODES_SHEET = new Set<PlanPlaceMode>(['elecConduit', 'elecPanel', 'elecDevice', 'elecLight', 'annotate'])
const MECHANICAL_MODES = new Set<PlanPlaceMode>(['mechDuct', 'mechEquip', 'mechDiffuser', 'annotate'])
const PLUMBING_MODES = new Set<PlanPlaceMode>(['plumbPipe', 'plumbFixture', 'annotate'])
const LIFE_SAFETY_MODES = new Set<PlanPlaceMode>(['lsPipe', 'lsHead', 'lsDevice', 'annotate'])
const TELECOM_MODES = new Set<PlanPlaceMode>(['telePath', 'teleOutlet', 'teleEquip', 'annotate'])

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

type SheetTemplate = Omit<Floor1SheetDef, 'pageIndex' | 'badge'>

const SHEET_TEMPLATES: readonly SheetTemplate[] = [
  {
    id: 'layout',
    label: 'Layout',
    allowsMepEditing: false,
    visualMode: 'layout',
    mepDisciplineFilterSheet: null,
    visiblePlaceModes: LAYOUT_MODES,
    defaultPlaceMode: 'structure',
  },
  {
    id: 'water',
    label: 'Water',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'water',
    visiblePlaceModes: WATER_MODES,
    defaultPlaceMode: 'waterPipe',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'electrical',
    visiblePlaceModes: ELECTRICAL_MODES_SHEET,
    defaultPlaceMode: 'elecConduit',
  },
  {
    id: 'mechanical',
    label: 'Mechanical',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'mechanical',
    visiblePlaceModes: MECHANICAL_MODES,
    defaultPlaceMode: 'mechDuct',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'plumbing',
    visiblePlaceModes: PLUMBING_MODES,
    defaultPlaceMode: 'plumbPipe',
  },
  {
    id: 'life_safety',
    label: 'Life safety',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'life_safety',
    visiblePlaceModes: LIFE_SAFETY_MODES,
    defaultPlaceMode: 'lsPipe',
  },
  {
    id: 'telecommunications',
    label: 'Telecommunications',
    allowsMepEditing: true,
    visualMode: 'trade_mep',
    mepDisciplineFilterSheet: 'telecommunications',
    visiblePlaceModes: TELECOM_MODES,
    defaultPlaceMode: 'telePath',
  },
  {
    id: 'interior',
    label: 'Interior',
    allowsMepEditing: false,
    visualMode: 'interior',
    mepDisciplineFilterSheet: null,
    visiblePlaceModes: INTERIOR_MODES,
    defaultPlaceMode: 'floor',
  },
]

const SHEET_BADGES: Record<Floor1SheetId, string> = {
  layout: 'L',
  water: 'W',
  electrical: 'E',
  mechanical: 'M',
  plumbing: 'P',
  life_safety: 'LS',
  telecommunications: 'T',
  interior: 'I',
}

/** Build the sheet definitions for a single building level at a given level index. */
export function buildLevelSheets(levelIndex: number): Floor1SheetDef[] {
  const base = LEVEL_PAGES_START + levelIndex * SHEETS_PER_LEVEL
  return SHEET_TEMPLATES.map((t, i) => ({
    ...t,
    badge: SHEET_BADGES[t.id],
    pageIndex: base + i,
  }))
}

/** Page base for a given level index. */
export function levelSketchPageBase(levelIndex: number): number {
  return LEVEL_PAGES_START + levelIndex * SHEETS_PER_LEVEL
}

/** Backward-compatible Floor 1 sheets at level index 0. */
export const FLOOR1_SHEETS: readonly Floor1SheetDef[] = buildLevelSheets(0)

export const FLOOR1_SKETCH_PAGE_COUNT = SHEETS_PER_LEVEL

/**
 * Find which level index and sheet def a page index corresponds to, given the total number of levels.
 * Returns null if the page is not a level sketch page.
 */
export function levelSheetFromPageIndex(
  pageIndex: number,
  numLevels: number,
): { levelIndex: number; sheet: Floor1SheetDef } | null {
  if (pageIndex < LEVEL_PAGES_START) return null
  const offset = pageIndex - LEVEL_PAGES_START
  const totalLevelPages = numLevels * SHEETS_PER_LEVEL
  if (offset >= totalLevelPages) return null
  const levelIndex = Math.floor(offset / SHEETS_PER_LEVEL)
  const sheetIndex = offset % SHEETS_PER_LEVEL
  const sheets = buildLevelSheets(levelIndex)
  return { levelIndex, sheet: sheets[sheetIndex]! }
}

export function isLevelSketchPage(pageIndex: number, numLevels: number): boolean {
  return levelSheetFromPageIndex(pageIndex, numLevels) != null
}

/** @deprecated Use levelSheetFromPageIndex with numLevels. */
export function floor1SheetFromPageIndex(pageIndex: number): Floor1SheetDef | null {
  const result = levelSheetFromPageIndex(pageIndex, 1)
  return result ? result.sheet : null
}

/** @deprecated Use isLevelSketchPage with numLevels. */
export function isFloor1SketchPage(pageIndex: number): boolean {
  return isLevelSketchPage(pageIndex, 1)
}

export function floor1SheetById(id: Floor1SheetId): Floor1SheetDef {
  return FLOOR1_SHEETS.find((s) => s.id === id)!
}

export function filterMepItemsForSheet(sheet: Floor1SheetDef, items: readonly MepItem[]): MepItem[] {
  if (!sheet.allowsMepEditing) return []
  const key = sheet.mepDisciplineFilterSheet
  if (!key) return items.slice()
  return items.filter((m) => mepDisciplineMatches(key, m.discipline))
}

/** Display label for discipline-specific place modes in the Layer toolbar. */
export const PLACE_MODE_LABELS: Partial<Record<PlanPlaceMode, string>> = {
  // Water
  waterPipe: 'Piping',
  waterEquip: 'Equipment',
  waterValve: 'Valves',
  // Electrical
  elecConduit: 'Conduit',
  elecPanel: 'Panels',
  elecDevice: 'Devices',
  elecLight: 'Lighting',
  // Mechanical
  mechDuct: 'Ductwork',
  mechEquip: 'Equipment',
  mechDiffuser: 'Diffusers',
  // Plumbing
  plumbPipe: 'Piping',
  plumbFixture: 'Fixtures',
  // Life Safety
  lsPipe: 'Piping',
  lsHead: 'Heads',
  lsDevice: 'Devices',
  // Telecommunications
  telePath: 'Pathways',
  teleOutlet: 'Outlets',
  teleEquip: 'Equipment',
}

/** Tooltip hints for discipline-specific place modes. */
export const PLACE_MODE_TOOLTIPS: Partial<Record<PlanPlaceMode, string>> = {
  waterPipe: 'Draw domestic water piping runs on grid edges',
  waterEquip: 'Place water equipment (heaters, pumps, tanks)',
  waterValve: 'Place valves and fittings on the plan',
  elecConduit: 'Draw conduit and wiring runs on grid edges',
  elecPanel: 'Place electrical panels and switchgear',
  elecDevice: 'Place devices (receptacles, switches, junction boxes)',
  elecLight: 'Place light fixtures on the plan',
  mechDuct: 'Draw ductwork runs on grid edges',
  mechEquip: 'Place mechanical equipment (AHU, RTU, condensers)',
  mechDiffuser: 'Place diffusers, grilles, and registers',
  plumbPipe: 'Draw waste/vent/drain piping runs on grid edges',
  plumbFixture: 'Place plumbing fixtures (sinks, toilets, floor drains)',
  lsPipe: 'Draw sprinkler piping runs on grid edges',
  lsHead: 'Place sprinkler heads on the plan',
  lsDevice: 'Place fire alarm devices (pull stations, horns/strobes)',
  telePath: 'Draw cable tray and pathway runs on grid edges',
  teleOutlet: 'Place data/voice outlets and wireless access points',
  teleEquip: 'Place telecom equipment (racks, patch panels)',
}
