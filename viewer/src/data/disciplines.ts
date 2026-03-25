/**
 * Sheet prefix discipline codes — ordered catalog for sidebar + grouping.
 * Bands are separated lightly in the sidebar (see `SIDEBAR_DISCIPLINE_ROWS`).
 */

export type DisciplineDef = { code: string; label: string }

export type SidebarDisciplineRow =
  | { kind: 'discipline'; code: string; label: string }
  | { kind: 'separator' }

/** Ordered bands; each band is followed by a subtle UI separator (except after the last). */
const DISCIPLINE_BANDS: DisciplineDef[][] = [
  [{ code: 'G', label: 'General' }],
  [
    { code: 'C', label: 'Civil' },
    { code: 'V', label: 'Survey / Mapping' },
    { code: 'B', label: 'Geotechnical' },
    { code: 'H', label: 'Hazardous Materials' },
    { code: 'L', label: 'Landscape' },
  ],
  [
    { code: 'A', label: 'Architectural' },
    { code: 'AD', label: 'Architectural Demolition' },
    { code: 'AS', label: 'Architectural Site' },
    { code: 'AE', label: 'Architectural Elements' },
    { code: 'AF', label: 'Architectural Finishes' },
    { code: 'AI', label: 'Architectural Interiors' },
    { code: 'AG', label: 'Architectural Graphics' },
  ],
  [{ code: 'S', label: 'Structural' }],
  [
    { code: 'M', label: 'Mechanical' },
    { code: 'E', label: 'Electrical' },
    { code: 'P', label: 'Plumbing' },
    { code: 'FP', label: 'Fire Protection' },
    { code: 'T', label: 'Telecommunications' },
  ],
  [
    { code: 'D', label: 'Process' },
    { code: 'Q', label: 'Equipment' },
    { code: 'W', label: 'Distributed Energy' },
    { code: 'O', label: 'Operations' },
  ],
  [{ code: 'I', label: 'Interiors (Consultant)' }],
  [
    { code: 'AX', label: 'Architectural Systems / Experimental' },
    { code: 'BX', label: 'Building Performance / Analysis' },
    { code: 'DX', label: 'Digital / Computational' },
  ],
  [
    { code: 'Z', label: 'Contractor / Shop Drawings' },
    { code: 'X', label: 'Other Disciplines' },
  ],
]

/** Flat list: every discipline code (grouping, storage keys). Order matches sidebar bands. */
export const DISCIPLINES: DisciplineDef[] = DISCIPLINE_BANDS.flat()

/** Sidebar render order with subtle group dividers. */
export const SIDEBAR_DISCIPLINE_ROWS: SidebarDisciplineRow[] = DISCIPLINE_BANDS.flatMap(
  (band, bandIdx) => {
    const rows: SidebarDisciplineRow[] = band.map((d) => ({
      kind: 'discipline' as const,
      code: d.code,
      label: d.label,
    }))
    if (bandIdx < DISCIPLINE_BANDS.length - 1) rows.push({ kind: 'separator' })
    return rows
  },
)

const DISCIPLINES_SORTED_BY_LENGTH = [...DISCIPLINES].sort(
  (a, b) => b.code.length - a.code.length,
)

function disciplinePrefixMatches(id: string, code: string): boolean {
  if (!id.startsWith(code)) return false
  if (id.length === code.length) return true
  const next = id[code.length]
  return next !== undefined && /[\d.\-_]/.test(next)
}

/**
 * Map legacy / nonstandard prefixes into the current catalog.
 * - AJ / AK → AX / BX (replaces vague “user defined”)
 * - R → X (Resource removed)
 * - F… → FP when not already FP… (single Fire Protection code)
 */
function mapLegacyDisciplinePrefix(id: string): string | null {
  if (/^AJ(?:[\d.\-_]|$)/.test(id)) return 'AX'
  if (/^AK(?:[\d.\-_]|$)/.test(id)) return 'BX'
  if (/^R(?:[\d.\-_]|$)/.test(id)) return 'X'
  if (/^F(?:[\d.\-_]|$)/.test(id) && !id.startsWith('FP')) return 'FP'
  return null
}

/** Derive discipline code from system ID (e.g. A4-01 → A, AD3-02 → AD, F4-01 → FP). */
export function getDisciplineFromSystemId(systemId: string): string {
  const id = systemId.trim()
  if (!id) return 'A'

  for (const { code } of DISCIPLINES_SORTED_BY_LENGTH) {
    if (disciplinePrefixMatches(id, code)) return code
  }

  const legacy = mapLegacyDisciplinePrefix(id)
  if (legacy) return legacy

  const match = id.match(/^([A-Z]+)/)
  if (!match) return 'A'
  const first = match[1]![0]!
  if (first === 'R') return 'X'
  if (first === 'F') return 'FP'
  if (DISCIPLINES.some((d) => d.code === first)) return first
  return 'X'
}
