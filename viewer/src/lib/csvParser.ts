import {
  type Layer,
  type LayerType,
  type SystemData,
  type CategoryGroup,
  type CategoryId,
  type BuildingDimensions,
  type LayoutRefs,
  type Orientation,
  CATEGORY_LABELS,
} from '../types/system'
import { inferFastenerIcon, normalizeFastenerIcon } from './fastenerIcons'
import { DEFAULT_LAYOUT_REFS } from '../data/schematicFrame'

const VALID_LAYER_TYPES = new Set<LayerType>([
  'CLT', 'WOOD', 'INSULATION', 'MEMBRANE', 'METAL',
  'CONCRETE', 'AIR_GAP', 'GLASS', 'GRAVEL_SOIL', 'MISC',
])

const VALID_FILLS = new Set<string>([
  'CLT', 'WOOD', 'INSULATION', 'MEMBRANE', 'METAL',
  'CONCRETE', 'AIR_GAP', 'GLASS', 'GRAVEL_SOIL', 'MISC',
])

const VALID_ORIENT = new Set<Orientation>(['WALL', 'ROOF', 'FLOOR', 'SLAB', 'SPECIAL'])

/** Parse numeric thickness from strings like "13.625", "3/4", "1-1/2", "~9 to 10.5", "varies" */
export function parseThickness(s: string): number {
  const trimmed = (s ?? '').trim()
  const mixedMatch = trimmed.match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/)
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1])
    const num = parseFloat(mixedMatch[2])
    const den = parseFloat(mixedMatch[3])
    return den > 0 ? whole + num / den : whole
  }
  const fracMatch = trimmed.match(/(\d+)\s*\/\s*(\d+)/)
  if (fracMatch) {
    const num = parseFloat(fracMatch[1])
    const den = parseFloat(fracMatch[2])
    return den > 0 ? num / den : 0
  }
  const numMatch = trimmed.match(/[\d.]+/)
  return numMatch ? parseFloat(numMatch[0]) : 0
}

/** Format thickness in inches as architectural feet-inches (e.g. 41 → "3'-5"", 11.5 → "11-1/2"") */
export function formatThickness(inches: number): string {
  if (inches <= 0) return '0"'
  const ft = Math.floor(inches / 12)
  const inRem = inches - ft * 12
  const fracs: [number, string][] = [[0.125, '1/8'], [0.25, '1/4'], [0.375, '3/8'], [0.5, '1/2'], [0.625, '5/8'], [0.75, '3/4'], [0.875, '7/8']]
  const inWhole = Math.floor(inRem)
  const inFrac = inRem - inWhole
  let inStr: string
  if (inFrac < 0.01) inStr = inWhole === 0 ? '0' : String(inWhole)
  else {
    const match = fracs.find(([v]) => Math.abs(inFrac - v) < 0.01)
    inStr = match ? (inWhole > 0 ? `${inWhole}-${match[1]}` : match[1]) : inRem.toFixed(2)
  }
  return ft > 0 ? `${ft}'-${inStr}"` : `${inStr}"`
}

function parseRow(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

type DimKey =
  | 'footprintWidth'
  | 'footprintDepth'
  | 'floorToFloor'
  | 'voidClearWidth'
  | 'stairWidth'
  | 'sectionScale'
  | 'planScale'
  | 'diagramSectionRefWidth'
  | 'diagramSectionRefHeight'
  | 'planRefWidth'
  | 'planRefHeight'

const BLD_LAYER_MAP: Record<string, DimKey> = {
  'Footprint Width (interior)': 'footprintWidth',
  'Footprint Width': 'footprintWidth',
  'Footprint Depth': 'footprintDepth',
  'Floor to Floor Height': 'floorToFloor',
  'Void Clear Width': 'voidClearWidth',
  'Stair Width': 'stairWidth',
  'Section Scale px/in': 'sectionScale',
  'Plan Scale px/in': 'planScale',
  'Diagram Section Ref Width': 'diagramSectionRefWidth',
  'Diagram Section Ref Height': 'diagramSectionRefHeight',
  'Plan Ref Width': 'planRefWidth',
  'Plan Ref Height': 'planRefHeight',
}

const LAYOUT_CONFIG_KEYS = new Set([
  'exterior_wall_assembly',
  'structural_clt_core',
  'interior_partition',
  'balcony_assembly',
])

function pickMetaRow(rows: string[][], i: (name: string) => number): string[] | null {
  const data = rows.filter((r) => (r[i('#')] ?? '').trim() !== 'TOTAL')
  if (data.length === 0) return null
  data.sort((a, b) => {
    const na = parseInt((a[i('#')] ?? '').trim(), 10)
    const nb = parseInt((b[i('#')] ?? '').trim(), 10)
    const va = Number.isFinite(na) ? na : 9999
    const vb = Number.isFinite(nb) ? nb : 9999
    return va - vb
  })
  return data[0] ?? null
}

export interface ParseResult {
  systems: SystemData[]
  buildingDimensions: BuildingDimensions
}

export function parseCSV(raw: string): ParseResult {
  const lines = raw.split('\n').filter((l) => l.trim())
  const [headerLine, ...dataLines] = lines
  const headers = parseRow(headerLine)

  const idx = (name: string) => headers.indexOf(name)
  const col = (name: string) => {
    const i = idx(name)
    return i >= 0 ? i : -1
  }

  const systemMap = new Map<string, string[][]>()
  for (const line of dataLines) {
    const row = parseRow(line)
    const sysId = row[idx('System_ID')]
    if (!sysId) continue
    if (!systemMap.has(sysId)) systemMap.set(sysId, [])
    systemMap.get(sysId)!.push(row)
  }

  const systems: SystemData[] = []
  const thicknessBySystem: Record<string, number> = {}

  const dims: Partial<Record<DimKey, number>> = {
    footprintWidth: 360,
    footprintDepth: 480,
    floorToFloor: 132,
    voidClearWidth: 53,
    stairWidth: 48,
    sectionScale: 1.4,
    planScale: 1.2,
  }

  const layoutRefs: LayoutRefs = { ...DEFAULT_LAYOUT_REFS }
  let systemIdPrefix = 'A4-'

  const bldRows = systemMap.get('BLD')
  if (bldRows) {
    for (const row of bldRows) {
      const ck = (row[col('Config_Key')] ?? '').trim()
      const cv = (row[col('Config_Value')] ?? '').trim()
      if (ck && cv) {
        if (ck === 'system_id_prefix') systemIdPrefix = cv
        else if (LAYOUT_CONFIG_KEYS.has(ck)) {
          (layoutRefs as unknown as Record<string, string>)[ck] = cv
        }
        continue
      }
      const layer = row[idx('Layer')] ?? ''
      const val = parseThickness(row[idx('Thickness_in')] ?? '0')
      const key = BLD_LAYER_MAP[layer]
      if (key) dims[key] = val
    }
  }

  const sheetOrderCol = col('Sheet_Order')
  const diagramLabelCol = col('Diagram_Label')
  const diagramHatchCol = col('Diagram_Hatch')
  const secJsonCol = col('Diagram_Section_Zones_JSON')
  const planJsonCol = col('Diagram_Plan_Zones_JSON')
  const voCol = col('View_Orientation')
  const vrCol = col('View_Reverse')
  const vtlCol = col('View_Top_Label')
  const vblCol = col('View_Bottom_Label')

  for (const [sysId, rows] of systemMap) {
    if (sysId === 'BLD') continue

    const meta = pickMetaRow(rows, idx) ?? rows[0]
    const sysName = meta[idx('System_Name')] ?? sysId
    const categoryCol = headers.includes('Category') ? idx('Category') : -1
    const rawCategory = categoryCol >= 0 ? meta[categoryCol]?.trim() : ''
    const category: CategoryId =
      rawCategory === 'A' || rawCategory === 'B' || rawCategory === 'C' || rawCategory === 'D'
        ? (rawCategory as CategoryId)
        : 'A'

    const stCol = col('System_Type')
    const locCol = col('Location')
    const sdCol = col('Stack_Direction')
    const metaExtras =
      stCol >= 0 || locCol >= 0 || sdCol >= 0
        ? {
            ...(stCol >= 0 ? { systemType: (meta[stCol] ?? '').trim() } : {}),
            ...(locCol >= 0 ? { location: (meta[locCol] ?? '').trim() } : {}),
            ...(sdCol >= 0 ? { stackDirection: (meta[sdCol] ?? '').trim() } : {}),
          }
        : {}

    const sheetOrder =
      sheetOrderCol >= 0 ? parseInt((meta[sheetOrderCol] ?? '').trim(), 10) : NaN
    const diagramLabel = diagramLabelCol >= 0 ? (meta[diagramLabelCol] ?? '').trim() || undefined : undefined
    const diagramHatch = diagramHatchCol >= 0 ? (meta[diagramHatchCol] ?? '').trim() || undefined : undefined
    const diagramSectionZonesJson = secJsonCol >= 0 ? (meta[secJsonCol] ?? '').trim() || undefined : undefined
    const diagramPlanZonesJson = planJsonCol >= 0 ? (meta[planJsonCol] ?? '').trim() || undefined : undefined

    let viewOrientation: Orientation | undefined
    if (voCol >= 0) {
      const v = (meta[voCol] ?? '').trim().toUpperCase() as Orientation
      if (VALID_ORIENT.has(v)) viewOrientation = v
    }
    const vrRaw = vrCol >= 0 ? (meta[vrCol] ?? '').trim() : ''
    const viewReverse = vrRaw === '1' || vrRaw.toLowerCase() === 'true'
    const viewTopLabel = vtlCol >= 0 ? (meta[vtlCol] ?? '').trim() || undefined : undefined
    const viewBottomLabel = vblCol >= 0 ? (meta[vblCol] ?? '').trim() || undefined : undefined

    const layers: Layer[] = []
    let totalThickness = '—'
    let totalR = '—'

    let layerCount = 0
    for (const row of rows) {
      const num = row[idx('#')]
      if (num === 'TOTAL') {
        totalThickness = row[idx('Thickness_in')] ?? '—'
        totalR = row[idx('Approx_R_Value')] ?? '—'
        thicknessBySystem[sysId] = parseThickness(totalThickness)
        continue
      }
      layerCount++
      const rawType = row[idx('Layer_Type')] ?? 'MISC'
      const layerType: LayerType = VALID_LAYER_TYPES.has(rawType as LayerType)
        ? (rawType as LayerType)
        : 'MISC'

      const rawFill = (row[idx('Fill')] ?? '').trim()
      const fill = rawFill && VALID_FILLS.has(rawFill) ? rawFill : undefined
      const fastenerIconCol = idx('Fastener_Icon')
      const rawFi = fastenerIconCol >= 0 ? row[fastenerIconCol]?.trim() ?? '' : ''
      const fastenerIcon =
        rawFi !== ''
          ? normalizeFastenerIcon(rawFi)
          : inferFastenerIcon(row[idx('Fastener')] ?? '', row[idx('Fastener_Size')] ?? '')

      layers.push({
        index: layerCount,
        name: row[idx('Layer')] ?? '',
        material: row[idx('Material')] ?? '',
        thickness: row[idx('Thickness_in')] ?? '0',
        rValue: row[idx('Approx_R_Value')] ?? '0',
        connection: row[idx('Connection')] ?? '',
        fastener: row[idx('Fastener')] ?? '',
        fastenerSize: row[idx('Fastener_Size')] ?? '',
        fastenerIcon,
        fastenerMinEdgeIn: (row[idx('Min_Edge_Dist_in')] ?? '').trim() || undefined,
        fastenerMinEndIn: (row[idx('Min_End_Dist_in')] ?? '').trim() || undefined,
        layerType,
        fill,
        notes: row[idx('Drawing_Note')] ?? '',
        visible: true,
      })
    }

    systems.push({
      id: sysId,
      name: sysName,
      category,
      ...metaExtras,
      layers,
      totalThickness,
      totalR,
      ...(Number.isFinite(sheetOrder) ? { sheetOrder } : {}),
      ...(diagramLabel ? { diagramLabel } : {}),
      ...(diagramHatch ? { diagramHatch } : {}),
      ...(diagramSectionZonesJson ? { diagramSectionZonesJson } : {}),
      ...(diagramPlanZonesJson ? { diagramPlanZonesJson } : {}),
      ...(viewOrientation ? { viewOrientation } : {}),
      ...(vrCol >= 0 ? { viewReverse } : {}),
      ...(viewTopLabel ? { viewTopLabel } : {}),
      ...(viewBottomLabel ? { viewBottomLabel } : {}),
    })
  }

  systems.sort((a, b) => {
    const ao = a.sheetOrder ?? 1_000_000
    const bo = b.sheetOrder ?? 1_000_000
    if (ao !== bo) return ao - bo
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })

  const buildingDimensions: BuildingDimensions = {
    footprintWidth: dims.footprintWidth ?? 360,
    footprintDepth: dims.footprintDepth ?? 480,
    floorToFloor: dims.floorToFloor ?? 132,
    voidClearWidth: dims.voidClearWidth ?? 53,
    stairWidth: dims.stairWidth ?? 48,
    sectionScale: dims.sectionScale ?? 1.4,
    planScale: dims.planScale ?? 1.2,
    thicknessBySystem,
    layoutRefs,
    systemIdPrefix,
    ...(dims.diagramSectionRefWidth !== undefined ? { diagramSectionRefWidth: dims.diagramSectionRefWidth } : {}),
    ...(dims.diagramSectionRefHeight !== undefined ? { diagramSectionRefHeight: dims.diagramSectionRefHeight } : {}),
    ...(dims.planRefWidth !== undefined ? { planRefWidth: dims.planRefWidth } : {}),
    ...(dims.planRefHeight !== undefined ? { planRefHeight: dims.planRefHeight } : {}),
  }

  return { systems, buildingDimensions }
}

export function groupByCategory(systems: SystemData[]): CategoryGroup[] {
  const order: CategoryId[] = ['A', 'B', 'C', 'D']
  return order.map((catId) => ({
    id: catId,
    label: CATEGORY_LABELS[catId],
    systems: systems.filter((s) => s.category === catId),
  }))
}
