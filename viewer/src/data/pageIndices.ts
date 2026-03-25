import { FLOOR1_SKETCH_PAGE_BASE, floor1SheetFromPageIndex, isFloor1SketchPage } from './floor1Sheets'
import {
  ELEVATION_SKETCH_PAGE_BASE,
  ELEVATION_SKETCH_PAGE_COUNT,
  elevationSheetFromPageIndex,
  isElevationSketchPage,
  isPlanSketchPage,
} from './elevationSheets'

/** Central map: sidebar / search / keyboard nav must stay aligned. */
export const PAGE_COMPOSITE_SECTION = 0
export const PAGE_COMPOSITE_PLAN = 1
/** Spreadsheet of enclosed Floor 1 rooms and areas (uses layout sketch). Must be `FLOOR1_SKETCH_PAGE_BASE - 1`. */
export const PAGE_PHYSICAL_SPACE_INVENTORY = FLOOR1_SKETCH_PAGE_BASE - 1
/** Floor 1 → Layout (first sketch page). */
export const PAGE_LAYOUT = FLOOR1_SKETCH_PAGE_BASE

export function isPhysicalSpaceInventoryPage(pageIndex: number): boolean {
  return pageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
}
/** First per-system sheet index in `orderedSystems` (after composites + Floor 1 + Elevations). */
export const SYSTEM_PAGE_OFFSET = ELEVATION_SKETCH_PAGE_BASE + ELEVATION_SKETCH_PAGE_COUNT

export {
  floor1SheetFromPageIndex,
  isFloor1SketchPage,
  elevationSheetFromPageIndex,
  isElevationSketchPage,
  isPlanSketchPage,
}

export function systemPageIndex(orderIndex: number): number {
  return orderIndex + SYSTEM_PAGE_OFFSET
}

export function systemOrderIndexFromPage(pageIndex: number): number | null {
  if (pageIndex < SYSTEM_PAGE_OFFSET) return null
  return pageIndex - SYSTEM_PAGE_OFFSET
}
