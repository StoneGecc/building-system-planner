import type { FastenerIconId } from '../lib/fastenerIcons'

export type DiagramDetailLevel = 0 | 1 | 2 | 3

export type FastenerDrawMode = 'none' | 'cap_only' | 'full'

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
  /** From CSV `Fastener_Spacing_OC_in` */
  fastenerSpacingOcIn?: string
  fastenerMinEdgeIn?: string
  fastenerMinEndIn?: string
  /** From CSV `Fastener_Pattern` */
  fastenerPattern?: string
  /** From CSV `Typ_Module_Width_in` */
  typModuleWidthIn?: string
  /** From CSV `Element_Spacing_OC_in` */
  elementSpacingOcIn?: string
  /** From CSV `Cavity_Depth_in` */
  cavityDepthIn?: string
  /** From CSV `Control_Joint_Spacing_ft` */
  controlJointSpacingFt?: string
  drawModuleJoints?: boolean
  drawControlJoints?: boolean
  drawFastenerGraphics?: FastenerDrawMode
  detailMaxModuleJoints?: number
  detailMinFeaturePx?: number
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
  /** From CSV `Category`: user-defined grouping label (any text). */
  category: string
  systemType?: string
  /** Tokens from CSV `Plan_Draw_Layers`: which implementation-plan layer modes may use this system (`wall` / `floor` / `column` / `window` / `door` / `roof` / `stairs`). */
  planDrawLayers?: readonly string[]
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
  /** System-level override; else BLD `default_diagram_detail_level`. */
  diagramDetailLevel?: DiagramDetailLevel
}

export interface CategoryGroup {
  id: string
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
  /** BLD `default_diagram_detail_level` */
  defaultDiagramDetailLevel?: DiagramDetailLevel
  /** BLD `detail_max_module_joints` */
  detailMaxModuleJoints?: number
  /** BLD `detail_min_feature_px` */
  detailMinFeaturePx?: number
  /** BLD `shop_max_fastener_marks_per_layer` */
  shopMaxFastenerMarksPerLayer?: number
}
