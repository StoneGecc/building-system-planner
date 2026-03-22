/**
 * Sheet prefix discipline codes per architectural drawing standards.
 * Used for sidebar navigation and sheet organization.
 */
export const DISCIPLINES: Array<{ code: string; label: string }> = [
  { code: 'A', label: 'Architectural' },
  { code: 'AD', label: 'Architectural Demolition' },
  { code: 'AE', label: 'Architectural Elements' },
  { code: 'AF', label: 'Architectural Finishes' },
  { code: 'AG', label: 'Architectural Graphics' },
  { code: 'AI', label: 'Architectural Interiors' },
  { code: 'AS', label: 'Architectural Site' },
  { code: 'AJ', label: 'User Defined' },
  { code: 'AK', label: 'User Defined' },
  { code: 'B', label: 'Geotechnical' },
  { code: 'C', label: 'Civil' },
  { code: 'D', label: 'Process' },
  { code: 'E', label: 'Electrical' },
  { code: 'F', label: 'Fire Protection' },
  { code: 'G', label: 'General' },
  { code: 'H', label: 'Hazardous Materials' },
  { code: 'I', label: 'Interiors' },
  { code: 'L', label: 'Landscape' },
  { code: 'M', label: 'Mechanical' },
  { code: 'O', label: 'Operations' },
  { code: 'P', label: 'Plumbing' },
  { code: 'Q', label: 'Equipment' },
  { code: 'R', label: 'Resource' },
  { code: 'S', label: 'Structural' },
  { code: 'T', label: 'Telecommunications' },
  { code: 'V', label: 'Survey / Mapping' },
  { code: 'W', label: 'Distributed Energy' },
  { code: 'X', label: 'Other Disciplines' },
  { code: 'Z', label: 'Contractor / Shop Drawings' },
]

/** Derive discipline code from system ID (e.g. A4-01 → A, S3-02 → S) */
export function getDisciplineFromSystemId(systemId: string): string {
  const match = systemId.match(/^([A-Z]+)/)
  if (!match) return 'A'
  const prefix = match[1]
  // Multi-char codes (AD, AE, AF, etc.) - check if prefix matches a discipline
  const multi = DISCIPLINES.find(d => d.code === prefix)
  if (multi) return prefix
  // Single-char or numeric suffix (A4, S3) - use first char as discipline
  return prefix[0]
}
