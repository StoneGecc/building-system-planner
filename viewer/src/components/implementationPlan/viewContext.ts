import type { Floor1SheetDef } from '../../data/floor1Sheets'
import type { ElevationSheetDef } from '../../data/elevationSheets'

export type ImplementationPlanViewContext =
  | { kind: 'floor1'; sheet: Floor1SheetDef }
  | { kind: 'elevation'; sheet: ElevationSheetDef }
