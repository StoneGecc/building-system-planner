/**
 * Writes seed-output.json for merge_building_csv_seed.py
 * Run: cd viewer && npx tsx scripts/seed-diagram-metadata.ts
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parseCSV } from '../src/lib/csvParser.ts'
import { computeSchematicFrame } from '../src/data/schematicFrame.ts'
import { diagramSeedJsonForCsv } from '../src/data/buildingLayout.ts'
import { getSystemOrientation } from '../src/lib/orientation.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dirname, '../../Building_Systems_Complete.csv')
const outPath = join(__dirname, 'seed-output.json')

const raw = readFileSync(csvPath, 'utf-8')
const { systems, buildingDimensions } = parseCSV(raw)
const frame = computeSchematicFrame(buildingDimensions)
const seedMap = diagramSeedJsonForCsv(frame, buildingDimensions)

function sheetOrderFromId(id: string): number {
  const m = id.match(/(\d+)/g)
  if (!m) return 1_000_000
  return parseInt(m[m.length - 1]!, 10) || 1_000_000
}

const out: Record<
  string,
  {
    section: string
    plan: string
    label: string
    hatch: string
    sheetOrder: number
    viewOrientation: string
    viewReverse: string
    viewTopLabel: string
    viewBottomLabel: string
  }
> = {}

for (const s of systems) {
  const seed = seedMap.get(s.id)
  const o = getSystemOrientation(s)
  out[s.id] = {
    section: seed?.section ?? '[]',
    plan: seed?.plan ?? '[]',
    label: seed?.label ?? s.name.toUpperCase(),
    hatch: seed?.hatch ?? 'p-MISC',
    sheetOrder: sheetOrderFromId(s.id),
    viewOrientation: o.orientation,
    viewReverse: o.reverse ? '1' : '0',
    viewTopLabel: o.topLabel,
    viewBottomLabel: o.bottomLabel,
  }
}

writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')
console.log('Wrote', outPath, 'systems:', Object.keys(out).length)
