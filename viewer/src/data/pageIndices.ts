import {
  LEVEL_PAGES_START,
  FLOOR1_SKETCH_PAGE_BASE,
  floor1SheetFromPageIndex,
  isFloor1SketchPage,
  isLevelSketchPage,
  levelSheetFromPageIndex,
} from './floor1Sheets'
import {
  ELEVATION_SKETCH_PAGE_BASE,
  ELEVATION_SKETCH_PAGE_COUNT,
  elevationSheetFromPageIndex,
  elevationSheetFromPageIndexDynamic,
  isElevationSketchPage,
  isElevationSketchPageDynamic,
  isPlanSketchPage,
  isPlanSketchPageDynamic,
  elevationSketchPageBaseDynamic,
} from './elevationSheets'

/** Central map: sidebar / search / keyboard nav must stay aligned. */
export const PAGE_COMPOSITE_SECTION = 0
export const PAGE_COMPOSITE_PLAN = 1
/** Spreadsheet of enclosed Floor 1 rooms and areas (uses layout sketch). Must be `LEVEL_PAGES_START - 1`. */
export const PAGE_PHYSICAL_SPACE_INVENTORY = LEVEL_PAGES_START - 1
/** Floor 1 → Layout (first sketch page). */
export const PAGE_LAYOUT = FLOOR1_SKETCH_PAGE_BASE

export function isPhysicalSpaceInventoryPage(pageIndex: number): boolean {
  return pageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
}

/** First per-system sheet index (after composites + levels + elevations). */
export function systemPageOffsetDynamic(numLevels: number): number {
  return elevationSketchPageBaseDynamic(numLevels) + ELEVATION_SKETCH_PAGE_COUNT
}

/** First connection-detail sheet index (after all per-system sheets). */
export function connectionDetailPageBaseDynamic(numLevels: number, numSystems: number): number {
  return systemPageOffsetDynamic(numLevels) + numSystems
}

export function isConnectionDetailPage(
  pageIndex: number,
  numLevels: number,
  numSystems: number,
  numConnections: number,
): boolean {
  if (numConnections <= 0) return false
  const base = connectionDetailPageBaseDynamic(numLevels, numSystems)
  return pageIndex >= base && pageIndex < base + numConnections
}

export function connectionDetailIndexFromPage(
  pageIndex: number,
  numLevels: number,
  numSystems: number,
): number | null {
  const base = connectionDetailPageBaseDynamic(numLevels, numSystems)
  const idx = pageIndex - base
  return idx >= 0 ? idx : null
}

/** @deprecated Use systemPageOffsetDynamic */
export const SYSTEM_PAGE_OFFSET = ELEVATION_SKETCH_PAGE_BASE + ELEVATION_SKETCH_PAGE_COUNT

export {
  floor1SheetFromPageIndex,
  isFloor1SketchPage,
  isLevelSketchPage,
  levelSheetFromPageIndex,
  elevationSheetFromPageIndex,
  elevationSheetFromPageIndexDynamic,
  isElevationSketchPage,
  isElevationSketchPageDynamic,
  isPlanSketchPage,
  isPlanSketchPageDynamic,
}

export function systemPageIndex(orderIndex: number): number {
  return orderIndex + SYSTEM_PAGE_OFFSET
}

export function systemPageIndexDynamic(orderIndex: number, numLevels: number): number {
  return orderIndex + systemPageOffsetDynamic(numLevels)
}

export function systemOrderIndexFromPage(pageIndex: number): number | null {
  if (pageIndex < SYSTEM_PAGE_OFFSET) return null
  return pageIndex - SYSTEM_PAGE_OFFSET
}

export function systemOrderIndexFromPageDynamic(
  pageIndex: number,
  numLevels: number,
  numSystems: number,
): number | null {
  const offset = systemPageOffsetDynamic(numLevels)
  if (pageIndex < offset || pageIndex >= offset + numSystems) return null
  return pageIndex - offset
}
