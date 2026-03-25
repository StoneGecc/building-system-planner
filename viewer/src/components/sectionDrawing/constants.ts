import { DIVIDER_X, PANEL_H, PANEL_W, PANEL_X, PANEL_Y } from '../../data/sheetLayout'

/** Legend material wraps to many lines — cap rows so stacked callouts do not overlap. */
export const CALLOUT_NAME_MAX = 2
export const CALLOUT_MAT_MAX_DEFAULT = 2
export const CALLOUT_MAT_MAX_COMPACT = 1

// Wall section cut zone — reference: 193.74–703.74 (510 wide), y 290–540
export const WALL_CUT_X = 194
export const WALL_CUT_W = 510
export const WALL_CUT_Y = 290
export const WALL_CUT_H = 250

// Horizontal section cut zone — centered in wider panel (811 - 310) / 2 ≈ 250
export const HORIZ_CUT_X = PANEL_X + Math.round((PANEL_W - 310) / 2)
export const HORIZ_CUT_W = 310
export const HORIZ_CUT_Y_START = PANEL_Y + 55
export const HORIZ_CUT_MAX_H = PANEL_H - 80

export const MONO = "'Courier New', Courier, monospace"

export const FASTENER_LABEL_FS = 6.5
export const FASTENER_LABEL_LH = 9
export const FASTENER_LABEL_PAD = 4

/** Offset of cut indicator lines from section edge (same for wall and floor/roof sections) */
export const CUT_LINE_OFFSET = 10

// Leader line endpoint (reference: 862.96, just before callout bubble)
export const LEADER_END_X = DIVIDER_X + 4

export const CHAIN_OFFSET = 38 // px away from section edge
export const OVERALL_OFFSET = 66 // px away from section edge

export const LAYER_TYPE_LABELS: Record<string, string> = {
  CLT: 'CLT PANEL',
  WOOD: 'WOOD / TIMBER',
  INSULATION: 'INSULATION',
  MEMBRANE: 'MEMBRANE / WRB',
  METAL: 'METAL',
  CONCRETE: 'CONCRETE',
  AIR_GAP: 'AIR GAP / CAVITY',
  GLASS: 'GLAZING',
  GRAVEL_SOIL: 'AGGREGATE / SOIL',
  MISC: 'SEALANT / MISC',
}
