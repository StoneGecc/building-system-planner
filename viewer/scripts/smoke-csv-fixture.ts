import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCSV } from '../src/lib/csvParser'
import { buildLayout } from '../src/data/buildingLayout'
import { sortSystemsForDisplay } from '../src/lib/systemSort'

const dir = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(dir, '../fixtures/minimal_building_systems.csv'), 'utf8')
const { systems, buildingDimensions } = parseCSV(raw)

if (systems.length !== 4) {
  throw new Error(`expected 4 systems, got ${systems.length}: ${systems.map((s) => s.id).join(', ')}`)
}
if (buildingDimensions.layoutRefs.exterior_wall_assembly !== 'WALL-01') {
  throw new Error(`exterior_wall_assembly should be WALL-01, got ${buildingDimensions.layoutRefs.exterior_wall_assembly}`)
}
if (buildingDimensions.systemIdPrefix !== 'PFX-') {
  throw new Error(`systemIdPrefix should be PFX-, got ${buildingDimensions.systemIdPrefix}`)
}
if (buildingDimensions.defaultDiagramDetailLevel !== 1) {
  throw new Error(
    `defaultDiagramDetailLevel should be 1, got ${buildingDimensions.defaultDiagramDetailLevel}`,
  )
}

const ordered = sortSystemsForDisplay(systems)
const layout = buildLayout(buildingDimensions, ordered)
if (layout.SYSTEM_PLACEMENTS.length !== 4) {
  throw new Error(`expected 4 placements, got ${layout.SYSTEM_PLACEMENTS.length}`)
}

const ids = new Set(systems.map((s) => s.id))
for (const need of ['WALL-01', 'ROOF-99', 'WIN-01', 'DOOR-01']) {
  if (!ids.has(need)) throw new Error(`missing fixture system ${need}`)
}

if (
  ordered[0]?.id !== 'WALL-01' ||
  ordered[1]?.id !== 'ROOF-99' ||
  ordered[2]?.id !== 'WIN-01' ||
  ordered[3]?.id !== 'DOOR-01'
) {
  throw new Error(`expected Sheet_Order sort, got ${ordered.map((s) => s.id).join(' → ')}`)
}
console.log('smoke-csv-fixture ok:', ordered.map((s) => s.id).join(' → '))
