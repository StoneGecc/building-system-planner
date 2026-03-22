import type { SystemData } from '../types/system'

/** Sheet / composite callout order: Sheet_Order then System_ID. */
export function sortSystemsForDisplay(systems: SystemData[]): SystemData[] {
  return [...systems].sort((a, b) => {
    const ao = a.sheetOrder ?? 1_000_000
    const bo = b.sheetOrder ?? 1_000_000
    if (ao !== bo) return ao - bo
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })
}

export function calloutSystemIdsFromSystems(systems: SystemData[]): string[] {
  return sortSystemsForDisplay(systems).map((s) => s.id)
}
