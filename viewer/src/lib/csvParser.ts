import {
  type Layer,
  type LayerType,
  type SystemData,
  type CategoryGroup,
  type BuildingDimensions,
  type LayoutRefs,
  type Orientation,
} from '../types/system'
import { inferFastenerIcon, normalizeFastenerIcon } from './fastenerIcons'
import {
  parseDiagramDetailLevel,
  parseDrawFastenerGraphics,
  parsePositiveInt,
  parseTriBool,
} from './diagramDetail'
import type { DiagramDetailLevel } from '../types/system'
import { DEFAULT_LAYOUT_REFS } from '../data/schematicFrame'
import { splitCsvLine } from './csvSplit'
import { isHex6 } from './layerDiagramFill'

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
  const headers = splitCsvLine(headerLine)

  const idx = (name: string) => headers.indexOf(name)
  const col = (name: string) => {
    const i = idx(name)
    return i >= 0 ? i : -1
  }

  const systemMap = new Map<string, string[][]>()
  for (const line of dataLines) {
    const row = splitCsvLine(line)
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
  let defaultDiagramDetailLevel: DiagramDetailLevel | undefined
  let detailMaxModuleJointsBld: number | undefined
  let detailMinFeaturePxBld: number | undefined
  let shopMaxFastenerMarksPerLayerBld: number | undefined

  const bldRows = systemMap.get('BLD')
  if (bldRows) {
    for (const row of bldRows) {
      const ck = (row[col('Config_Key')] ?? '').trim()
      const cv = (row[col('Config_Value')] ?? '').trim()
      if (ck && cv) {
        if (ck === 'system_id_prefix') systemIdPrefix = cv
        else if (ck === 'default_diagram_detail_level') {
          const p = parseDiagramDetailLevel(cv)
          if (p !== undefined) defaultDiagramDetailLevel = p
        } else if (ck === 'detail_max_module_joints') {
          const n = parseInt(cv.trim(), 10)
          if (Number.isFinite(n) && n >= 0) detailMaxModuleJointsBld = n
        } else if (ck === 'detail_min_feature_px') {
          const n = parseInt(cv.trim(), 10)
          if (Number.isFinite(n) && n > 0) detailMinFeaturePxBld = n
        } else if (ck === 'shop_max_fastener_marks_per_layer') {
          const n = parseInt(cv.trim(), 10)
          if (Number.isFinite(n) && n > 0) shopMaxFastenerMarksPerLayerBld = n
        } else if (LAYOUT_CONFIG_KEYS.has(ck)) {
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
  const diagramColorCol = col('Diagram_Color')
  const planColorCol = col('Plan_Color')
  const secJsonCol = col('Diagram_Section_Zones_JSON')
  const planJsonCol = col('Diagram_Plan_Zones_JSON')
  const voCol = col('View_Orientation')
  const vrCol = col('View_Reverse')
  const vtlCol = col('View_Top_Label')
  const vblCol = col('View_Bottom_Label')
  const diagramDetailLevelCol = col('Diagram_Detail_Level')
  const drawModCol = col('Draw_Module_Joints')
  const drawCtrlCol = col('Draw_Control_Joints')
  const drawFastCol = col('Draw_Fastener_Graphics')
  const maxModJointCol = col('Detail_Max_Module_Joints')
  const minFeatPxCol = col('Detail_Min_Feature_Px')
  const fspCol = col('Fastener_Spacing_OC_in')
  const fpCol = col('Fastener_Pattern')
  const tmCol = col('Typ_Module_Width_in')
  const esCol = col('Element_Spacing_OC_in')
  const cavCol = col('Cavity_Depth_in')
  const cjCol = col('Control_Joint_Spacing_ft')
  const pdwCol = col('Plan_Draw_Width_in')
  const pelCol = col('Plan_Equip_Length_in')
  const pewCol = col('Plan_Equip_Width_in')
  const pedCol = col('Plan_Equip_Depth_in')
  const layerColorCol = col('Layer_Color')

  for (const [sysId, rows] of systemMap) {
    if (sysId === 'BLD') continue

    const meta = pickMetaRow(rows, idx) ?? rows[0]
    const sysName = meta[idx('System_Name')] ?? sysId
    const categoryCol = headers.includes('Category') ? idx('Category') : -1
    const rawCategory = categoryCol >= 0 ? meta[categoryCol]?.trim() : ''
    const category = rawCategory || 'Uncategorized'

    const stCol = col('System_Type')
    const locCol = col('Location')
    const sdCol = col('Stack_Direction')
    const pdlCol = col('Plan_Draw_Layers')
    const planDrawLayers =
      pdlCol >= 0
        ? (meta[pdlCol] ?? '')
            .split(/[;,\s]+/)
            .map((t) => t.trim().toLowerCase())
            .filter(
              (t) =>
                t === 'wall' ||
                t === 'floor' ||
                t === 'window' ||
                t === 'door' ||
                t === 'roof' ||
                t === 'stairs' ||
                t === 'column',
            )
        : []
    const metaExtras =
      stCol >= 0 || locCol >= 0 || sdCol >= 0 || planDrawLayers.length > 0
        ? {
            ...(stCol >= 0 ? { systemType: (meta[stCol] ?? '').trim() } : {}),
            ...(locCol >= 0 ? { location: (meta[locCol] ?? '').trim() } : {}),
            ...(sdCol >= 0 ? { stackDirection: (meta[sdCol] ?? '').trim() } : {}),
            ...(planDrawLayers.length > 0 ? { planDrawLayers } : {}),
          }
        : {}

    const sheetOrder =
      sheetOrderCol >= 0 ? parseInt((meta[sheetOrderCol] ?? '').trim(), 10) : NaN
    const diagramLabel = diagramLabelCol >= 0 ? (meta[diagramLabelCol] ?? '').trim() || undefined : undefined
    const diagramHatch = diagramHatchCol >= 0 ? (meta[diagramHatchCol] ?? '').trim() || undefined : undefined
    const diagramColorRaw = diagramColorCol >= 0 ? (meta[diagramColorCol] ?? '').trim() : ''
    const diagramColorHex = isHex6(diagramColorRaw) ? diagramColorRaw.toLowerCase() : undefined
    const planColorRaw = planColorCol >= 0 ? (meta[planColorCol] ?? '').trim() : ''
    const planColorHex = isHex6(planColorRaw) ? planColorRaw.toLowerCase() : undefined
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
    const diagramDetailLevelRaw =
      diagramDetailLevelCol >= 0 ? (meta[diagramDetailLevelCol] ?? '').trim() : ''
    const diagramDetailLevelParsed = parseDiagramDetailLevel(diagramDetailLevelRaw)
    const planDrawWidthIn = pdwCol >= 0 ? parseThickness((meta[pdwCol] ?? '').trim()) : 0
    const planEquipLengthIn = pelCol >= 0 ? parseThickness((meta[pelCol] ?? '').trim()) : 0
    const planEquipWidthIn = pewCol >= 0 ? parseThickness((meta[pewCol] ?? '').trim()) : 0
    const planEquipDepthIn = pedCol >= 0 ? parseThickness((meta[pedCol] ?? '').trim()) : 0

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

      const rawLayerColor = layerColorCol >= 0 ? (row[layerColorCol] ?? '').trim() : ''
      const rawFill = (row[idx('Fill')] ?? '').trim()
      const colorHex =
        isHex6(rawLayerColor)
          ? rawLayerColor.toLowerCase()
          : isHex6(rawFill)
            ? rawFill.toLowerCase()
            : undefined
      const fill = rawFill && VALID_FILLS.has(rawFill) && !isHex6(rawFill) ? rawFill : undefined
      const fastenerIconCol = idx('Fastener_Icon')
      const rawFi = fastenerIconCol >= 0 ? row[fastenerIconCol]?.trim() ?? '' : ''
      const fastenerIcon =
        rawFi !== ''
          ? normalizeFastenerIcon(rawFi)
          : inferFastenerIcon(row[idx('Fastener')] ?? '', row[idx('Fastener_Size')] ?? '')

      const fastenerSpacingOcIn = fspCol >= 0 ? (row[fspCol] ?? '').trim() || undefined : undefined
      const fastenerPattern = fpCol >= 0 ? (row[fpCol] ?? '').trim() || undefined : undefined
      const typModuleWidthIn = tmCol >= 0 ? (row[tmCol] ?? '').trim() || undefined : undefined
      const elementSpacingOcIn = esCol >= 0 ? (row[esCol] ?? '').trim() || undefined : undefined
      const cavityDepthIn = cavCol >= 0 ? (row[cavCol] ?? '').trim() || undefined : undefined
      const controlJointSpacingFt = cjCol >= 0 ? (row[cjCol] ?? '').trim() || undefined : undefined
      const drawModuleJoints = drawModCol >= 0 ? parseTriBool(row[drawModCol]) : undefined
      const drawControlJoints = drawCtrlCol >= 0 ? parseTriBool(row[drawCtrlCol]) : undefined
      const drawFastenerGraphics = drawFastCol >= 0 ? parseDrawFastenerGraphics(row[drawFastCol]) : undefined
      const detailMaxModuleJoints = maxModJointCol >= 0 ? parsePositiveInt(row[maxModJointCol]) : undefined
      const detailMinFeaturePx = minFeatPxCol >= 0 ? parsePositiveInt(row[minFeatPxCol]) : undefined

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
        ...(fastenerSpacingOcIn ? { fastenerSpacingOcIn } : {}),
        fastenerMinEdgeIn: (row[idx('Min_Edge_Dist_in')] ?? '').trim() || undefined,
        fastenerMinEndIn: (row[idx('Min_End_Dist_in')] ?? '').trim() || undefined,
        ...(fastenerPattern ? { fastenerPattern } : {}),
        ...(typModuleWidthIn ? { typModuleWidthIn } : {}),
        ...(elementSpacingOcIn ? { elementSpacingOcIn } : {}),
        ...(cavityDepthIn ? { cavityDepthIn } : {}),
        ...(controlJointSpacingFt ? { controlJointSpacingFt } : {}),
        ...(drawModuleJoints !== undefined ? { drawModuleJoints } : {}),
        ...(drawControlJoints !== undefined ? { drawControlJoints } : {}),
        ...(drawFastenerGraphics ? { drawFastenerGraphics } : {}),
        ...(detailMaxModuleJoints !== undefined ? { detailMaxModuleJoints } : {}),
        ...(detailMinFeaturePx !== undefined ? { detailMinFeaturePx } : {}),
        layerType,
        fill,
        ...(colorHex ? { colorHex } : {}),
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
      ...(diagramColorHex ? { diagramColorHex } : {}),
      ...(planColorHex ? { planColorHex } : {}),
      ...(diagramSectionZonesJson ? { diagramSectionZonesJson } : {}),
      ...(diagramPlanZonesJson ? { diagramPlanZonesJson } : {}),
      ...(viewOrientation ? { viewOrientation } : {}),
      ...(vrCol >= 0 ? { viewReverse } : {}),
      ...(viewTopLabel ? { viewTopLabel } : {}),
      ...(viewBottomLabel ? { viewBottomLabel } : {}),
      ...(diagramDetailLevelParsed !== undefined ? { diagramDetailLevel: diagramDetailLevelParsed } : {}),
      ...(planDrawWidthIn > 0 ? { planDrawWidthIn } : {}),
      ...(planEquipLengthIn > 0 ? { planEquipLengthIn } : {}),
      ...(planEquipWidthIn > 0 ? { planEquipWidthIn } : {}),
      ...(planEquipDepthIn > 0 ? { planEquipDepthIn } : {}),
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
    ...(defaultDiagramDetailLevel !== undefined ? { defaultDiagramDetailLevel } : {}),
    ...(detailMaxModuleJointsBld !== undefined ? { detailMaxModuleJoints: detailMaxModuleJointsBld } : {}),
    ...(detailMinFeaturePxBld !== undefined ? { detailMinFeaturePx: detailMinFeaturePxBld } : {}),
    ...(shopMaxFastenerMarksPerLayerBld !== undefined
      ? { shopMaxFastenerMarksPerLayer: shopMaxFastenerMarksPerLayerBld }
      : {}),
  }

  return { systems, buildingDimensions }
}

export function groupByCategory(systems: SystemData[]): CategoryGroup[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const s of systems) {
    const c = s.category || 'Uncategorized'
    if (!seen.has(c)) {
      seen.add(c)
      order.push(c)
    }
  }
  return order.map((id) => ({
    id,
    label: id,
    systems: systems.filter((s) => (s.category || 'Uncategorized') === id),
  }))
}
