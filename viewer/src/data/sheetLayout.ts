/**
 * Shared sheet layout constants — matches A1-CLT reference and individual system drawings.
 * Used by SectionDrawing, BuildingPlan, and BuildingSection for consistent appearance.
 */
export const SHEET_W = 1200
export const SHEET_H = 820

// Drawing panel (left column)
export const PANEL_X = 28
export const PANEL_Y = 28
export const PANEL_W = 811
export const PANEL_H = 764

// Divider between drawing and legend/title block
export const DIVIDER_X = 859

// Legend/callout zone (right column)
export const CALLOUT_BUBBLE_X = DIVIDER_X + 20
export const CALLOUT_TEXT_X = DIVIDER_X + 50
export const CALLOUT_Y_START = 54
export const CALLOUT_HEADER_Y = 46
export const LEGEND_ITEM_SPACING = 52

/** Legend ID badge (e.g. A4-01): width scales with id length; stays centered on CALLOUT_BUBBLE_X. */
export function layoutCalloutSystemIdBadge(systemId: string): { x: number; w: number } {
  const w = Math.max(22, Math.ceil(systemId.length * 5 + 12))
  return { w, x: CALLOUT_BUBBLE_X - w / 2 }
}

// Title block
export const TB_X = 861
export const TB_Y = 634
export const TB_W = 323
export const TB_H = 168
