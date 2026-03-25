/** Layers-bar identity for room boundaries / names (not a CSV system id). */
export const PLAN_ROOMS_LAYER_SOURCE = 'arch' as const
export const PLAN_ROOMS_LAYER_SYSTEM_ID = '__plan_rooms__'
export const PLAN_ROOMS_LAYER_ID = `${PLAN_ROOMS_LAYER_SOURCE}\t${PLAN_ROOMS_LAYER_SYSTEM_ID}`

/** Layers-bar identity for annotation tools (not a CSV system id). */
export const PLAN_ANNOTATIONS_LAYER_SOURCE = 'annotate' as const
export const PLAN_ANNOTATIONS_LAYER_SYSTEM_ID = 'annotations'
export const PLAN_ANNOTATIONS_LAYER_ID = `${PLAN_ANNOTATIONS_LAYER_SOURCE}\t${PLAN_ANNOTATIONS_LAYER_SYSTEM_ID}`
