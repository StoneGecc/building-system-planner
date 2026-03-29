/** Toolbar / paint mode for the Floor 1 plan sketch editor. */
export type PlanPlaceMode =
  | 'structure'
  | 'floor'
  | 'column'
  | 'window'
  | 'door'
  | 'roof'
  | 'stairs'
  | 'mep'
  | 'annotate'
  | 'room'
  // Water
  | 'waterPipe'
  | 'waterEquip'
  | 'waterValve'
  // Electrical
  | 'elecConduit'
  | 'elecPanel'
  | 'elecDevice'
  | 'elecLight'
  // Mechanical
  | 'mechDuct'
  | 'mechEquip'
  | 'mechDiffuser'
  // Plumbing
  | 'plumbPipe'
  | 'plumbFixture'
  // Life Safety
  | 'lsPipe'
  | 'lsHead'
  | 'lsDevice'
  // Telecommunications
  | 'telePath'
  | 'teleOutlet'
  | 'teleEquip'

const MEP_RUN_MODES: ReadonlySet<PlanPlaceMode> = new Set([
  'mep',
  'waterPipe',
  'elecConduit',
  'mechDuct',
  'plumbPipe',
  'lsPipe',
  'telePath',
])

const MEP_POINT_MODES: ReadonlySet<PlanPlaceMode> = new Set([
  'waterEquip',
  'waterValve',
  'elecPanel',
  'elecDevice',
  'elecLight',
  'mechEquip',
  'mechDiffuser',
  'plumbFixture',
  'lsHead',
  'lsDevice',
  'teleOutlet',
  'teleEquip',
])

/** Linear run on grid edges (piping, conduit, ductwork, pathway). Includes legacy `mep` mode. */
export function isMepRunMode(m: PlanPlaceMode): boolean {
  return MEP_RUN_MODES.has(m)
}

/** Point-placed device/equipment/fixture on plan. */
export function isMepPointMode(m: PlanPlaceMode): boolean {
  return MEP_POINT_MODES.has(m)
}

/** Any discipline-specific MEP mode (run or point). */
export function isMepDisciplineMode(m: PlanPlaceMode): boolean {
  return isMepRunMode(m) || isMepPointMode(m)
}

/**
 * Mapping from each point-placement mode to the CSV-driven filter criteria.
 * `types` matches `MepItem.systemType` (from CSV `System_Type`).
 * `disciplineKeyword` further narrows by `MepItem.discipline` (from CSV `Category`)
 * for cases where multiple sub-categories share the same systemType (e.g. life safety).
 */
const POINT_MODE_FILTER: Partial<Record<PlanPlaceMode, { types: readonly string[]; disciplineKeyword?: string }>> = {
  waterEquip:   { types: ['equipment'] },
  waterValve:   { types: ['valve'] },
  elecPanel:    { types: ['equipment'] },
  elecDevice:   { types: ['device'] },
  elecLight:    { types: ['fixture'] },
  mechEquip:    { types: ['equipment'] },
  mechDiffuser: { types: ['device'] },
  plumbFixture: { types: ['fixture'] },
  lsHead:       { types: ['device'], disciplineKeyword: 'sprinkler' },
  lsDevice:     { types: ['device'], disciplineKeyword: 'alarm' },
  teleOutlet:   { types: ['device'] },
  teleEquip:    { types: ['equipment'] },
}

/** Filter MEP items to those relevant for the active tool mode.
 *  Run modes keep items with planWidthIn > 0 (pipes / ducts / conduits).
 *  Point modes filter by CSV `System_Type` (and optionally `Category` keyword). */
export function filterMepItemsForToolMode<T extends { planWidthIn: number; systemType: string; discipline: string }>(
  items: readonly T[],
  mode: PlanPlaceMode,
): T[] {
  if (isMepRunMode(mode)) {
    return items.filter((m) => m.planWidthIn > 0)
  }
  const spec = POINT_MODE_FILTER[mode]
  if (!spec) return [...items]
  const typesSet = new Set(spec.types)
  const kw = spec.disciplineKeyword?.toLowerCase()
  return items.filter((m) => {
    if (!typesSet.has(m.systemType)) return false
    if (kw && !m.discipline.toLowerCase().includes(kw)) return false
    return true
  })
}
