import type { BuildingDimensions } from '../types/system'
import type { PlanLayoutSketch } from '../types/planLayout'
import { resolvedSiteInches } from '../types/planLayout'
import { FLOOR1_SKETCH_PAGE_BASE, FLOOR1_SKETCH_PAGE_COUNT } from './floor1Sheets'

/** First page index for elevation sketch views (after all Floor 1 pages). */
export const ELEVATION_SKETCH_PAGE_BASE = FLOOR1_SKETCH_PAGE_BASE + FLOOR1_SKETCH_PAGE_COUNT

export type ElevationFace = 'N' | 'E' | 'S' | 'W'

export type ElevationSheetId = 'elevation_n' | 'elevation_e' | 'elevation_s' | 'elevation_w'

export type ElevationSheetDef = {
  id: ElevationSheetId
  face: ElevationFace
  label: string
  badge: string
  pageIndex: number
}

function def(i: number, partial: Omit<ElevationSheetDef, 'pageIndex'>): ElevationSheetDef {
  return { ...partial, pageIndex: ELEVATION_SKETCH_PAGE_BASE + i }
}

export const ELEVATION_SHEETS: readonly ElevationSheetDef[] = [
  def(0, { id: 'elevation_n', face: 'N', label: 'North', badge: 'N' }),
  def(1, { id: 'elevation_e', face: 'E', label: 'East', badge: 'E' }),
  def(2, { id: 'elevation_s', face: 'S', label: 'South', badge: 'S' }),
  def(3, { id: 'elevation_w', face: 'W', label: 'West', badge: 'W' }),
] as const

export const ELEVATION_SKETCH_PAGE_COUNT = ELEVATION_SHEETS.length

const byPageIndex = new Map<number, ElevationSheetDef>()
for (const s of ELEVATION_SHEETS) {
  byPageIndex.set(s.pageIndex, s)
}

export function elevationSheetFromPageIndex(pageIndex: number): ElevationSheetDef | null {
  return byPageIndex.get(pageIndex) ?? null
}

export function isElevationSketchPage(pageIndex: number): boolean {
  return (
    pageIndex >= ELEVATION_SKETCH_PAGE_BASE &&
    pageIndex < ELEVATION_SKETCH_PAGE_BASE + ELEVATION_SKETCH_PAGE_COUNT
  )
}

export function isPlanSketchPage(pageIndex: number): boolean {
  return (
    pageIndex >= FLOOR1_SKETCH_PAGE_BASE &&
    pageIndex < ELEVATION_SKETCH_PAGE_BASE + ELEVATION_SKETCH_PAGE_COUNT
  )
}

/**
 * Elevation canvas in plan inches — **same global setup as the Floor Layout sketch**, not separate CSV-only
 * footprint sizes. Horizontal span uses `resolvedSiteInches(layoutSketch, d)` (Setup lot width / depth);
 * vertical span uses `heightIn` (layout sketch building height or caller default). Grid spacing still comes
 * from `layoutSketch.gridSpacingIn` in the editor.
 *
 * **Axes:** `widthIn` = left–right on screen; `heightIn` = building height (top of SVG toward roof).
 * N/S facades span the plan **width** (lot W); E/W span the plan **depth** (lot D).
 */
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
