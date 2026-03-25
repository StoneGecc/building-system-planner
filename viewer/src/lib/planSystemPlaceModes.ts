import type { SystemData } from '../types/system'
import type { PlanPlaceMode } from './planLayerColors'

export const OPENING_WINDOW_TYPICAL = 'opening_window_typical'
export const OPENING_DOOR_TYPICAL = 'opening_door_typical'
export const DOOR_TYPICAL = 'door_typical'

/**
 * Default plan tool group for an arch system when the sketch has no geometry yet (or mixed edge kinds).
 * Uses `Plan_Draw_Layers` from CSV first, then `systemType` / `viewOrientation` fallbacks.
 */
export function inferDefaultPlanPlaceModeForArchSystem(s: SystemData): PlanPlaceMode {
  const tags = s.planDrawLayers ?? []
  const prefer: { tag: string; mode: PlanPlaceMode }[] = [
    { tag: 'door', mode: 'door' },
    { tag: 'window', mode: 'window' },
    { tag: 'roof', mode: 'roof' },
    { tag: 'stairs', mode: 'stairs' },
    { tag: 'column', mode: 'column' },
    { tag: 'floor', mode: 'floor' },
    { tag: 'wall', mode: 'structure' },
  ]
  for (const { tag, mode } of prefer) {
    if (tags.includes(tag)) return mode
  }
  const st = (s.systemType ?? '').trim()
  const stLower = st.toLowerCase()
  if (st === OPENING_DOOR_TYPICAL || stLower === DOOR_TYPICAL) return 'door'
  if (st === OPENING_WINDOW_TYPICAL) return 'window'
  if (stLower.includes('stair')) return 'stairs'
  if (s.viewOrientation === 'ROOF') return 'roof'
  if (s.viewOrientation === 'FLOOR') return 'floor'
  return 'structure'
}

/** Whether this architectural system appears in the picker for the given plan tool (Walls, Roof, …). */
export function archSystemMatchesPlanPlaceMode(s: SystemData, mode: PlanPlaceMode): boolean {
  if (mode === 'annotate' || mode === 'mep' || mode === 'room') return false
  const tags = s.planDrawLayers
  const st = s.systemType ?? ''
  const stLower = st.toLowerCase()

  if (mode === 'column') {
    if (tags && tags.length > 0) return tags.includes('column')
    return stLower.includes('column')
  }

  if (mode === 'stairs') {
    if (tags && tags.length > 0 && tags.includes('stairs')) return true
    return stLower.includes('stair')
  }

  if (tags && tags.length > 0) {
    if (mode === 'structure') return tags.includes('wall')
    if (mode === 'floor') return tags.includes('floor')
    if (mode === 'window') return tags.includes('window')
    if (mode === 'door') return tags.includes('door')
    if (mode === 'roof') return tags.includes('roof')
    return false
  }
  if (mode === 'window') return st === OPENING_WINDOW_TYPICAL
  if (mode === 'door') return st === OPENING_DOOR_TYPICAL || stLower === DOOR_TYPICAL
  if (mode === 'roof') return s.viewOrientation === 'ROOF'
  if (mode === 'structure') {
    return (
      st !== OPENING_WINDOW_TYPICAL &&
      st !== OPENING_DOOR_TYPICAL &&
      stLower !== DOOR_TYPICAL &&
      !stLower.includes('stair')
    )
  }
  if (mode === 'floor') return s.viewOrientation === 'FLOOR'
  return false
}
