/**
 * Standard sheet sub-groups per discipline (NCS-style numbering).
 * Used to organize the sidebar under each discipline heading.
 */

export type SheetSubgroupDef = { key: string; title: string }

const G: SheetSubgroupDef[] = [
  { key: 'G0.0', title: 'Cover Sheet' },
  { key: 'G0.1', title: 'Drawing Index' },
  { key: 'G0.2', title: 'Code Analysis' },
  { key: 'G0.3', title: 'Life Safety' },
  { key: 'G0.4', title: 'Accessibility' },
  { key: 'G0.5', title: 'General Notes' },
]

const C: SheetSubgroupDef[] = [
  { key: 'C0.0', title: 'Civil Notes / Legend' },
  { key: 'C1.0', title: 'Existing Site Plan' },
  { key: 'C1.1', title: 'Demolition Plan' },
  { key: 'C2.0', title: 'Site Plan' },
  { key: 'C3.0', title: 'Grading Plan' },
  { key: 'C4.0', title: 'Site Sections' },
  { key: 'C5.0', title: 'Civil Details' },
  { key: 'C6.0', title: 'Civil Schedules' },
]

const V: SheetSubgroupDef[] = [
  { key: 'V0.0', title: 'Survey Notes' },
  { key: 'V1.0', title: 'Survey Plan' },
  { key: 'V2.0', title: 'Topographic Map' },
  { key: 'V3.0', title: 'Survey Sections' },
]

const B: SheetSubgroupDef[] = [
  { key: 'B0.0', title: 'Geotechnical Notes' },
  { key: 'B1.0', title: 'Soil / Boring Plan' },
  { key: 'B3.0', title: 'Soil Sections' },
  { key: 'B5.0', title: 'Foundation Recommendations' },
]

const H: SheetSubgroupDef[] = [
  { key: 'H0.0', title: 'Hazardous Notes' },
  { key: 'H1.0', title: 'Hazardous Materials Plan' },
  { key: 'H5.0', title: 'Abatement Details' },
]

const L: SheetSubgroupDef[] = [
  { key: 'L0.0', title: 'Landscape Notes' },
  { key: 'L1.0', title: 'Landscape Plan' },
  { key: 'L2.0', title: 'Landscape Elevations' },
  { key: 'L3.0', title: 'Landscape Sections' },
  { key: 'L5.0', title: 'Landscape Details' },
  { key: 'L6.0', title: 'Planting Schedule' },
]

const A: SheetSubgroupDef[] = [
  { key: 'A0.0', title: 'Architectural Notes' },
  { key: 'A1.0', title: 'Site Plan' },
  { key: 'A1.1', title: 'Ground Floor Plan' },
  { key: 'A1.2', title: 'Level 2 Plan' },
  { key: 'A1.3', title: 'Level 3 Plan' },
  { key: 'A1.4', title: 'Roof Plan' },
  { key: 'A2.0', title: 'Elevations' },
  { key: 'A3.0', title: 'Building Sections' },
  { key: 'A4.0', title: 'Wall Sections / Assemblies' },
  { key: 'A5.0', title: 'Architectural Details' },
  { key: 'A6.0', title: 'Schedules' },
  { key: 'A9.0', title: 'System Diagrams / Axons' },
]

const AD: SheetSubgroupDef[] = [
  { key: 'AD0.0', title: 'Demolition Notes' },
  { key: 'AD1.0', title: 'Demolition Plans' },
  { key: 'AD5.0', title: 'Demolition Details' },
]

const AS: SheetSubgroupDef[] = [
  { key: 'AS0.0', title: 'Site Notes' },
  { key: 'AS1.0', title: 'Site Plans' },
  { key: 'AS3.0', title: 'Site Sections' },
  { key: 'AS5.0', title: 'Site Details' },
]

const AE: SheetSubgroupDef[] = [
  { key: 'AE0.0', title: 'Element Notes' },
  { key: 'AE1.0', title: 'Element Plans' },
  { key: 'AE4.0', title: 'Element Assemblies' },
  { key: 'AE5.0', title: 'Element Details' },
  { key: 'AE6.0', title: 'Element Schedules' },
]

const AF: SheetSubgroupDef[] = [
  { key: 'AF0.0', title: 'Finish Notes' },
  { key: 'AF1.0', title: 'Finish Plans' },
  { key: 'AF5.0', title: 'Finish Details' },
  { key: 'AF6.0', title: 'Finish Schedules' },
]

const AI: SheetSubgroupDef[] = [
  { key: 'AI0.0', title: 'Interior Notes' },
  { key: 'AI1.0', title: 'Interior Plans' },
  { key: 'AI2.0', title: 'Interior Elevations' },
  { key: 'AI3.0', title: 'Interior Sections' },
  { key: 'AI5.0', title: 'Interior Details' },
  { key: 'AI6.0', title: 'Interior Schedules' },
]

const AG: SheetSubgroupDef[] = [
  { key: 'AG0.0', title: 'Graphics Notes' },
  { key: 'AG1.0', title: 'Signage Plans' },
  { key: 'AG5.0', title: 'Signage Details' },
  { key: 'AG6.0', title: 'Signage Schedules' },
]

const S: SheetSubgroupDef[] = [
  { key: 'S0.0', title: 'Structural Notes' },
  { key: 'S1.0', title: 'Foundation Plan' },
  { key: 'S2.0', title: 'Framing Plans' },
  { key: 'S3.0', title: 'Structural Sections' },
  { key: 'S4.0', title: 'Structural Details' },
  { key: 'S5.0', title: 'Connection Details' },
]

const M: SheetSubgroupDef[] = [
  { key: 'M0.0', title: 'Mechanical Notes' },
  { key: 'M1.0', title: 'HVAC Plans' },
  { key: 'M2.0', title: 'Duct Layouts' },
  { key: 'M3.0', title: 'Mechanical Sections' },
  { key: 'M5.0', title: 'Mechanical Details' },
  { key: 'M6.0', title: 'Equipment Schedules' },
]

const E: SheetSubgroupDef[] = [
  { key: 'E0.0', title: 'Electrical Notes' },
  { key: 'E1.0', title: 'Lighting Plans' },
  { key: 'E2.0', title: 'Power Plans' },
  { key: 'E3.0', title: 'Electrical Sections' },
  { key: 'E5.0', title: 'Electrical Details' },
  { key: 'E6.0', title: 'Panel Schedules' },
]

const P: SheetSubgroupDef[] = [
  { key: 'P0.0', title: 'Plumbing Notes' },
  { key: 'P1.0', title: 'Plumbing Plans' },
  { key: 'P2.0', title: 'Riser Diagrams' },
  { key: 'P3.0', title: 'Plumbing Sections' },
  { key: 'P5.0', title: 'Plumbing Details' },
  { key: 'P6.0', title: 'Fixture Schedules' },
]

const FP: SheetSubgroupDef[] = [
  { key: 'FP0.0', title: 'Fire Protection Notes' },
  { key: 'FP1.0', title: 'Sprinkler Plans' },
  { key: 'FP2.0', title: 'Riser Diagrams' },
  { key: 'FP5.0', title: 'Fire Protection Details' },
]

const T: SheetSubgroupDef[] = [
  { key: 'T0.0', title: 'Telecom Notes' },
  { key: 'T1.0', title: 'Telecom Plans' },
  { key: 'T2.0', title: 'Network Diagrams' },
  { key: 'T5.0', title: 'Telecom Details' },
]

const D: SheetSubgroupDef[] = [
  { key: 'D0.0', title: 'Process Notes' },
  { key: 'D1.0', title: 'Process Plans' },
  { key: 'D3.0', title: 'Process Sections' },
  { key: 'D5.0', title: 'Process Details' },
]

const Q: SheetSubgroupDef[] = [
  { key: 'Q0.0', title: 'Equipment Notes' },
  { key: 'Q1.0', title: 'Equipment Plans' },
  { key: 'Q5.0', title: 'Equipment Details' },
  { key: 'Q6.0', title: 'Equipment Schedules' },
]

const W: SheetSubgroupDef[] = [
  { key: 'W0.0', title: 'Energy Notes' },
  { key: 'W1.0', title: 'Energy Plans (PV Layout)' },
  { key: 'W2.0', title: 'Energy Diagrams' },
  { key: 'W5.0', title: 'Energy Details' },
  { key: 'W6.0', title: 'Energy Schedules' },
]

const O: SheetSubgroupDef[] = [
  { key: 'O0.0', title: 'Operations Notes' },
  { key: 'O1.0', title: 'Operations Plans' },
  { key: 'O6.0', title: 'Operations Schedules' },
]

const I: SheetSubgroupDef[] = [
  { key: 'I0.0', title: 'Interiors Notes' },
  { key: 'I1.0', title: 'Interiors Plans' },
  { key: 'I2.0', title: 'Interiors Elevations' },
  { key: 'I5.0', title: 'Interiors Details' },
  { key: 'I6.0', title: 'Interiors Schedules' },
]

const AX: SheetSubgroupDef[] = [
  { key: 'AX0.0', title: 'Systems Notes' },
  { key: 'AX1.0', title: 'Systems Plans' },
  { key: 'AX4.0', title: 'System Assemblies' },
  { key: 'AX5.0', title: 'System Details' },
  { key: 'AX9.0', title: 'System Diagrams' },
]

const BX: SheetSubgroupDef[] = [
  { key: 'BX0.0', title: 'Performance Notes' },
  { key: 'BX1.0', title: 'Analysis Plans' },
  { key: 'BX2.0', title: 'Environmental Diagrams' },
  { key: 'BX9.0', title: 'Simulation Visualizations' },
]

const DX: SheetSubgroupDef[] = [
  { key: 'DX0.0', title: 'Digital Notes' },
  { key: 'DX1.0', title: 'Computational Plans' },
  { key: 'DX5.0', title: 'Fabrication Details' },
  { key: 'DX9.0', title: 'Data / Workflow Diagrams' },
]

const Z: SheetSubgroupDef[] = [
  { key: 'Z0.0', title: 'Shop Drawing Notes' },
  { key: 'Z1.0', title: 'Shop Plans' },
  { key: 'Z5.0', title: 'Shop Details' },
]

const X: SheetSubgroupDef[] = [
  { key: 'X0.0', title: 'Other Notes' },
  { key: 'X1.0', title: 'Other Plans' },
  { key: 'X5.0', title: 'Other Details' },
]

export const DISCIPLINE_SHEET_SUBGROUPS: Record<string, SheetSubgroupDef[]> = {
  G,
  C,
  V,
  B,
  H,
  L,
  A,
  AD,
  AS,
  AE,
  AF,
  AI,
  AG,
  S,
  M,
  E,
  P,
  FP,
  T,
  D,
  Q,
  W,
  O,
  I,
  AX,
  BX,
  DX,
  Z,
  X,
}

/** Keys valid for a discipline (for resolving hyphenated sheet IDs). */
const subgroupKeySets: Map<string, Set<string>> = new Map()
for (const [disc, list] of Object.entries(DISCIPLINE_SHEET_SUBGROUPS)) {
  subgroupKeySets.set(disc, new Set(list.map((s) => s.key)))
}

export const OTHER_SUBGROUP_KEY = '__other__'

/**
 * Map a system ID to a subgroup key (e.g. A4.0) for the given discipline.
 * - Explicit `A4.01` / `A4-01` style: tries dotted then hyphen minor against known keys.
 * - Fallback: `{disc}{major}.0` for `A4-06`-style IDs (type series + sheet number).
 */
export function sheetSubgroupKeyForSystem(systemId: string, disciplineCode: string): string {
  const id = systemId.trim()
  const keys = subgroupKeySets.get(disciplineCode)
  if (!keys || !id.startsWith(disciplineCode)) return OTHER_SUBGROUP_KEY

  const rest = id.slice(disciplineCode.length)
  if (!rest) return OTHER_SUBGROUP_KEY

  const dotted = rest.match(/^(\d+)\.(\d+)/)
  if (dotted) {
    const k = `${disciplineCode}${dotted[1]}.${dotted[2]}`
    return keys.has(k) ? k : OTHER_SUBGROUP_KEY
  }

  const hyphen = rest.match(/^(\d+)-(\d+)/)
  if (hyphen) {
    const major = hyphen[1]!
    const minorNum = parseInt(hyphen[2]!, 10)
    const candidate = `${disciplineCode}${major}.${minorNum}`
    if (keys.has(candidate)) return candidate
    const zero = `${disciplineCode}${major}.0`
    if (keys.has(zero)) return zero
    return OTHER_SUBGROUP_KEY
  }

  const digits = rest.match(/^(\d+)/)
  if (digits) {
    const zero = `${disciplineCode}${digits[1]}.0`
    if (keys.has(zero)) return zero
  }

  return OTHER_SUBGROUP_KEY
}

export function sheetSubgroupTitle(disciplineCode: string, key: string): string {
  if (key === OTHER_SUBGROUP_KEY) return 'Other sheets'
  const list = DISCIPLINE_SHEET_SUBGROUPS[disciplineCode]
  const found = list?.find((s) => s.key === key)
  return found?.title ?? key
}

/** Subgroup order for one discipline (keys only, for stable sidebar ordering). */
export function orderedSubgroupKeysForDiscipline(disciplineCode: string): string[] {
  const list = DISCIPLINE_SHEET_SUBGROUPS[disciplineCode]
  if (!list) return [OTHER_SUBGROUP_KEY]
  return [...list.map((s) => s.key), OTHER_SUBGROUP_KEY]
}
