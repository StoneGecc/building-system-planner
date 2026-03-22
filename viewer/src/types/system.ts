import type { FastenerIconId } from '../lib/fastenerIcons'

export type LayerType =
  | 'CLT'
  | 'WOOD'
  | 'INSULATION'
  | 'MEMBRANE'
  | 'METAL'
  | 'CONCRETE'
  | 'AIR_GAP'
  | 'GLASS'
  | 'GRAVEL_SOIL'
  | 'MISC'

export type Orientation = 'WALL' | 'ROOF' | 'FLOOR' | 'SLAB' | 'SPECIAL'

export type CategoryId = 'A' | 'B' | 'C' | 'D'

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  A: 'Structural Systems',
  B: 'Building Envelope',
  C: 'Interior Systems',
  D: 'Special / Project-Specific',
}

export interface Layer {
  index: number
  name: string
  material: string
  thickness: string
  rValue: string
  connection: string
  fastener: string
  fastenerSize: string
  fastenerIcon?: FastenerIconId
  fastenerMinEdgeIn?: string
  fastenerMinEndIn?: string
  layerType: LayerType
  fill?: string
  notes: string
  visible?: boolean
}

/** Semantic keys → System_ID for schematic thickness (from BLD Config_* rows) */
export interface LayoutRefs {
  exterior_wall_assembly: string
  structural_clt_core: string
  interior_partition: string
  balcony_assembly: string
}

export interface SystemData {
  id: string
  name: string
  category: CategoryId
  systemType?: string
  location?: string
  stackDirection?: string
  layers: Layer[]
  totalThickness: string
  totalR: string
  /** CSV row 1: sort sheets / composite callouts */
  sheetOrder?: number
  diagramLabel?: string
  diagramHatch?: string
  diagramSectionZonesJson?: string
  diagramPlanZonesJson?: string
  viewOrientation?: Orientation
  viewReverse?: boolean
  viewTopLabel?: string
  viewBottomLabel?: string
}

export interface CategoryGroup {
  id: CategoryId
  label: string
  systems: SystemData[]
}

export interface BuildingDimensions {
  footprintWidth: number
  footprintDepth: number
  floorToFloor: number
  voidClearWidth: number
  stairWidth: number
  sectionScale: number
  planScale: number
  thicknessBySystem: Record<string, number>
  /** From BLD Config_Key / Config_Value */
  layoutRefs: LayoutRefs
  /** Optional diagram reference sizes from BLD (documentation / future validation) */
  diagramSectionRefWidth?: number
  diagramSectionRefHeight?: number
  planRefWidth?: number
  planRefHeight?: number
  /** BLD `system_id_prefix` for next-id UX */
  systemIdPrefix: string
}
