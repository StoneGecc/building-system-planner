import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCSV } from '../src/lib/csvParser'
import { buildLayout } from '../src/data/buildingLayout'
import { sortSystemsForDisplay } from '../src/lib/systemSort'

const dir = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(dir, '../fixtures/minimal_building_systems.csv'), 'utf8')
const { systems, buildingDimensions } = parseCSV(raw)

if (systems.length !== 2) {
  throw new Error(`expected 2 systems, got ${systems.length}: ${systems.map((s) => s.id).join(', ')}`)
}
if (buildingDimensions.layoutRefs.exterior_wall_assembly !== 'WALL-01') {
  throw new Error(`exterior_wall_assembly should be WALL-01, got ${buildingDimensions.layoutRefs.exterior_wall_assembly}`)
}
if (buildingDimensions.systemIdPrefix !== 'PFX-') {
  throw new Error(`systemIdPrefix should be PFX-, got ${buildingDimensions.systemIdPrefix}`)
}

const ordered = sortSystemsForDisplay(systems)
const layout = buildLayout(buildingDimensions, ordered)
if (layout.SYSTEM_PLACEMENTS.length !== 2) {
  throw new Error(`expected 2 placements, got ${layout.SYSTEM_PLACEMENTS.length}`)
}

if (!systems.some((s) => s.id === 'WALL-01') || !systems.some((s) => s.id === 'ROOF-99')) {
  throw new Error('missing non-A4 fixture IDs')
}

if (ordered[0]?.id !== 'WALL-01' || ordered[1]?.id !== 'ROOF-99') {
  throw new Error(`expected Sheet_Order sort WALL-01 then ROOF-99, got ${ordered.map((s) => s.id).join(' → ')}`)
}
console.log('smoke-csv-fixture ok:', ordered.map((s) => s.id).join(' → '))
