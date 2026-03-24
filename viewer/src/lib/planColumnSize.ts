import { parseThickness } from './csvParser'
import type { SystemData } from '../types/system'

const DEFAULT_COLUMN_SQUARE_IN = 12

/** Nominal square column face from CONCRETE layer thicknesses (max); fallback 12". */
export function planColumnSquareInchesFromSystem(s: SystemData | undefined): number {
  if (!s?.layers?.length) return DEFAULT_COLUMN_SQUARE_IN
  let max = 0
  for (const layer of s.layers) {
    if (layer.layerType !== 'CONCRETE') continue
    const t = parseThickness(layer.thickness)
    if (Number.isFinite(t) && t > max) max = t
  }
  return max > 0 ? max : DEFAULT_COLUMN_SQUARE_IN
}
