import type { Orientation, SystemData } from '../types/system'

export interface SystemOrientationConfig {
  orientation: Orientation
  reverse: boolean
  topLabel: string
  bottomLabel: string
}

function orientationFromStackDirection(stackDirection?: string): SystemOrientationConfig | null {
  const s = (stackDirection ?? '').trim()
  if (!s) return null
  if (s === 'wall_interior_to_exterior') {
    return { orientation: 'WALL', reverse: false, topLabel: '', bottomLabel: '' }
  }
  if (s === 'roof_exterior_to_interior') {
    return { orientation: 'ROOF', reverse: false, topLabel: '↑ EXTERIOR', bottomLabel: 'INTERIOR ↓' }
  }
  return null
}

/** `Stack_Direction` = special — disambiguate by `System_Type` (CSV). */
function orientationForSpecialStack(system: SystemData): SystemOrientationConfig | null {
  const t = (system.systemType ?? '').trim()
  switch (t) {
    case 'clt_connection_wall_floor':
    case 'clt_connection_panel_to_panel':
      return { orientation: 'WALL', reverse: false, topLabel: '', bottomLabel: '' }
    case 'edge_guardrail_typical':
      return { orientation: 'SPECIAL', reverse: false, topLabel: '↓ TOP RAIL', bottomLabel: '↑ FLOOR EDGE' }
    case 'rainwater_cistern_courtyard':
      return { orientation: 'FLOOR', reverse: false, topLabel: '↓ SURFACE DRAIN', bottomLabel: '↑ CISTERN' }
    case 'passive_ventilation_void_stack':
      return { orientation: 'FLOOR', reverse: false, topLabel: '↓ INLET / OUTLET', bottomLabel: '↑ THERMAL MASS' }
    case 'opening_window_typical':
      return { orientation: 'WALL', reverse: false, topLabel: '', bottomLabel: '' }
    default:
      return { orientation: 'SPECIAL', reverse: false, topLabel: '', bottomLabel: '' }
  }
}

/** Fallback when CSV `View_Orientation` is empty: disambiguate generic slab_top_to_bottom */
function orientationFromSlabStack(system: SystemData): SystemOrientationConfig | null {
  if ((system.stackDirection ?? '').trim() !== 'slab_top_to_bottom') return null
  const t = (system.systemType ?? '').trim()
  if (t === 'slab_on_grade_interior') {
    return { orientation: 'SLAB', reverse: true, topLabel: '↓ FINISH FLOOR', bottomLabel: '↑ SUBGRADE' }
  }
  if (t === 'clt_floor_acoustic_finish_stack') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ FINISH SURFACE', bottomLabel: '↑ STRUCTURE' }
  }
  if (t === 'ceiling_acoustic_resilient_below_clt') {
    return { orientation: 'FLOOR', reverse: true, topLabel: '↓ FINISH SURFACE', bottomLabel: '↑ STRUCTURE' }
  }
  if (t === 'interior_ceiling_clt_batten') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↑ STRUCTURE (CLT)', bottomLabel: '↓ VISIBLE FACE' }
  }
  if (t === 'interior_stair_assembly') {
    return { orientation: 'FLOOR', reverse: true, topLabel: '↓ TREAD SURFACE', bottomLabel: '↑ BEARING BASE' }
  }
  if (t === 'balcony_terrace_assembly') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ DECKING SURFACE', bottomLabel: '↑ STRUCTURE' }
  }
  if (t === 'rainwater_cistern_courtyard') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ SURFACE DRAIN', bottomLabel: '↑ CISTERN' }
  }
  if (t === 'green_roof_planting_well' || t === 'courtyard_tree_structural_planter') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ PLANTING MEDIUM', bottomLabel: '↑ STRUCTURE' }
  }
  if (t === 'podium_transfer_slab' || t === 'foundation_footing_system') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ FINISH / WEAR', bottomLabel: '↑ STRUCTURE' }
  }
  if (t === 'opening_window_typical') {
    return { orientation: 'SLAB', reverse: false, topLabel: '↓ FINISH FLOOR', bottomLabel: '↑ SUBGRADE' }
  }
  if (t === 'edge_guardrail_typical') {
    return { orientation: 'SPECIAL', reverse: false, topLabel: '↓ TOP RAIL', bottomLabel: '↑ FLOOR EDGE' }
  }
  if (t === 'passive_ventilation_void_stack') {
    return { orientation: 'FLOOR', reverse: false, topLabel: '↓ INLET / OUTLET', bottomLabel: '↑ THERMAL MASS' }
  }
  return { orientation: 'FLOOR', reverse: true, topLabel: '↓ FINISH SURFACE', bottomLabel: '↑ STRUCTURE' }
}

export function getSystemOrientation(system: SystemData): SystemOrientationConfig {
  if (system.viewOrientation) {
    return {
      orientation: system.viewOrientation,
      reverse: system.viewReverse ?? false,
      topLabel: system.viewTopLabel ?? '',
      bottomLabel: system.viewBottomLabel ?? '',
    }
  }
  const fromStack = orientationFromStackDirection(system.stackDirection)
  if (fromStack) return fromStack
  if ((system.stackDirection ?? '').trim() === 'special') {
    const sp = orientationForSpecialStack(system)
    if (sp) return sp
  }
  const fromSlab = orientationFromSlabStack(system)
  if (fromSlab) return fromSlab
  return { orientation: 'SPECIAL', reverse: false, topLabel: '', bottomLabel: '' }
}
