import type { BuildingDimensions } from '../types/system'
import type { PlanLayoutSketch } from '../types/planLayout'
import { resolvedSiteInches } from '../types/planLayout'
import { LEVEL_PAGES_START, SHEETS_PER_LEVEL } from './floor1Sheets'

/** @deprecated Use elevationSketchPageBaseDynamic */
export const ELEVATION_SKETCH_PAGE_BASE = LEVEL_PAGES_START + SHEETS_PER_LEVEL

/** First page index for elevation sketch views (after all level pages). */
export function elevationSketchPageBaseDynamic(numLevels: number): number {
  return LEVEL_PAGES_START + numLevels * SHEETS_PER_LEVEL
}

export type ElevationFace = 'N' | 'E' | 'S' | 'W'

export type ElevationSheetId = 'elevation_n' | 'elevation_e' | 'elevation_s' | 'elevation_w'

export type ElevationSheetDef = {
  id: ElevationSheetId
  face: ElevationFace
  label: string
  badge: string
  pageIndex: number
}

const ELEVATION_TEMPLATES: readonly Omit<ElevationSheetDef, 'pageIndex'>[] = [
  { id: 'elevation_n', face: 'N', label: 'North', badge: 'N' },
  { id: 'elevation_e', face: 'E', label: 'East', badge: 'E' },
  { id: 'elevation_s', face: 'S', label: 'South', badge: 'S' },
  { id: 'elevation_w', face: 'W', label: 'West', badge: 'W' },
]

/** Build elevation sheet defs for a given number of levels. */
export function buildElevationSheets(numLevels: number): ElevationSheetDef[] {
  const base = elevationSketchPageBaseDynamic(numLevels)
  return ELEVATION_TEMPLATES.map((t, i) => ({ ...t, pageIndex: base + i }))
}

/** Backward-compatible elevation sheets (1 level). */
export const ELEVATION_SHEETS: readonly ElevationSheetDef[] = buildElevationSheets(1)

export const ELEVATION_SKETCH_PAGE_COUNT = ELEVATION_TEMPLATES.length

export function elevationSheetFromPageIndexDynamic(
  pageIndex: number,
  numLevels: number,
): ElevationSheetDef | null {
  const base = elevationSketchPageBaseDynamic(numLevels)
  const offset = pageIndex - base
  if (offset < 0 || offset >= ELEVATION_TEMPLATES.length) return null
  return { ...ELEVATION_TEMPLATES[offset]!, pageIndex }
}

/** @deprecated Use elevationSheetFromPageIndexDynamic */
export function elevationSheetFromPageIndex(pageIndex: number): ElevationSheetDef | null {
  return elevationSheetFromPageIndexDynamic(pageIndex, 1)
}

export function isElevationSketchPageDynamic(pageIndex: number, numLevels: number): boolean {
  return elevationSheetFromPageIndexDynamic(pageIndex, numLevels) != null
}

/** @deprecated Use isElevationSketchPageDynamic */
export function isElevationSketchPage(pageIndex: number): boolean {
  return isElevationSketchPageDynamic(pageIndex, 1)
}

export function isPlanSketchPageDynamic(pageIndex: number, numLevels: number): boolean {
  const base = LEVEL_PAGES_START
  const end = elevationSketchPageBaseDynamic(numLevels) + ELEVATION_SKETCH_PAGE_COUNT
  return pageIndex >= base && pageIndex < end
}

/** @deprecated Use isPlanSketchPageDynamic */
export function isPlanSketchPage(pageIndex: number): boolean {
  return isPlanSketchPageDynamic(pageIndex, 1)
}

export function elevationCanvasInches(
  face: ElevationFace,
  heightIn: number,
  d: BuildingDimensions,
  layoutSketch: PlanLayoutSketch,
): { widthIn: number; heightIn: number } {
  const { w: siteW, h: siteH } = resolvedSiteInches(layoutSketch, d)
  const rawW = face === 'N' || face === 'S' ? siteW : siteH
  const rawH = Number.isFinite(heightIn) && heightIn > 0 ? heightIn : d.floorToFloor
  return { widthIn: Math.max(rawW, 1), heightIn: Math.max(rawH, 1) }
}
