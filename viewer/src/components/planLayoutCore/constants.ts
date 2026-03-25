import type {
  ElevationLevelLine,
  PlanAnnotationGridRun,
  PlanAnnotationLabel,
  PlanAnnotationSectionCut,
  PlanMeasureGridRun,
} from '../../types/planLayout'

export const EMPTY_MEASURE_RUNS: PlanMeasureGridRun[] = []
export const EMPTY_ANNOTATION_GRID: PlanAnnotationGridRun[] = []
export const EMPTY_ANNOTATION_LABELS: PlanAnnotationLabel[] = []
export const EMPTY_SECTION_CUTS: PlanAnnotationSectionCut[] = []
export const EMPTY_ELEVATION_LEVEL_LINES: ElevationLevelLine[] = []

export const ZOOM_MIN = 0.15
export const ZOOM_MAX = 6
/** Multiplicative step for +/- buttons (≈16% per click). */
export const ZOOM_BUTTON_RATIO = 1.16
/** Trackpad / Ctrl+wheel sensitivity (higher = faster zoom). */
export const ZOOM_WHEEL_SENS = 0.0032

export const GRID_TRIM = 0.5
/** Below this size (SVG px), marquee release = single edge/cell erase (click). */
export const MARQUEE_CLICK_MAX_PX = 5

/** Room mode: dashed bright cyan construction / named-room ring. */
export const PLAN_ROOM_BOUNDARY_CYAN = '#00e5ff'
export const PLAN_ROOM_BOUNDARY_DASH = '5 5'
/** Other tools: faint dashed reference (not cyan). */
export const PLAN_ROOM_BOUNDARY_MUTED_STROKE = 'hsl(220, 10%, 55%)'
export const PLAN_ROOM_BOUNDARY_MUTED_DASH = '3.5 4'

export const PLAN_ROOM_DETAIL_MONO = "'Courier New', Courier, monospace"
