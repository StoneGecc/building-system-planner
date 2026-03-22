import type { SystemData } from '../types/system'

/** Escape regex special chars */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Next available system id for the given prefix (from BLD `system_id_prefix` or default `A4-`).
 * Matches ids like PREFIX + digits (e.g. A4-01, PROJ-12).
 */
export function getNextSystemId(existingSystems: SystemData[], prefix = 'A4-'): string {
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`, 'i')
  const nums = existingSystems
    .map((s) => {
      const m = s.id.match(re)
      return m ? parseInt(m[1], 10) : 0
    })
    .filter((n) => n > 0)
  const max = nums.length > 0 ? Math.max(...nums) : 0
  const next = max + 1
  const pad = prefix.toLowerCase().startsWith('a4-') ? 2 : 1
  return `${prefix}${String(next).padStart(pad, '0')}`
}
