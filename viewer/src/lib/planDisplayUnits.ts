/**
 * Linear units for Setup fields. Sketch still stores plan inches (`gridSpacingIn`, site W/D).
 */
export type PlanSiteDisplayUnit = 'in' | 'ft' | 'yd' | 'mm' | 'm'

const LS_GRID_KEY = 'building-impl-plan-grid-display-unit'
const LS_SITE_KEY = 'building-impl-plan-site-display-unit'
/** Legacy combined key; migrated once to site unit. */
const LS_LEGACY_KEY = 'building-impl-plan-display-unit'

const IN_PER_FT = 12
const IN_PER_YD = 36
const MM_PER_IN = 25.4
const IN_PER_M = 1000 / MM_PER_IN

export const PLAN_SITE_UNIT_LABELS: Record<PlanSiteDisplayUnit, string> = {
  in: 'Inches (in)',
  ft: 'Feet (ft)',
  yd: 'Yards (yd)',
  mm: 'Millimeters (mm)',
  m: 'Meters (m)',
}

export const PLAN_SITE_UNIT_SHORT: Record<PlanSiteDisplayUnit, string> = {
  in: 'in',
  ft: 'ft',
  yd: 'yd',
  mm: 'mm',
  m: 'm',
}

function isSiteUnit(s: string | null): s is PlanSiteDisplayUnit {
  return s === 'in' || s === 'ft' || s === 'yd' || s === 'mm' || s === 'm'
}

/** Convert a site field value (in the chosen unit) to plan inches. */
export function inchesFromSiteDisplay(value: number, unit: PlanSiteDisplayUnit): number {
  switch (unit) {
    case 'in':
      return value
    case 'ft':
      return value * IN_PER_FT
    case 'yd':
      return value * IN_PER_YD
    case 'mm':
      return value / MM_PER_IN
    case 'm':
      return value * IN_PER_M
    default:
      return value
  }
}

/** Convert plan inches to the site display unit. */
export function inchesToSiteDisplay(inches: number, unit: PlanSiteDisplayUnit): number {
  switch (unit) {
    case 'in':
      return inches
    case 'ft':
      return inches / IN_PER_FT
    case 'yd':
      return inches / IN_PER_YD
    case 'mm':
      return inches * MM_PER_IN
    case 'm':
      return inches / IN_PER_M
    default:
      return inches
  }
}

/**
 * Parse a numeric expression with optional fractions (in the caller’s display unit before suffix).
 * Supports: decimals (`1.5`), simple fractions (`3/4`, `-1/2`), mixed with space (`3 1/2`),
 * mixed with hyphen (`3-1/2`). Commas are treated as decimal separators.
 */
function parseRationalExpression(expr: string): number | null {
  const t = expr.trim().replace(/,/g, '.')
  if (!t) return null

  const mixedSpace = t.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixedSpace) {
    const sign = mixedSpace[1] === '-' ? -1 : 1
    const w = Number(mixedSpace[2])
    const num = Number(mixedSpace[3])
    const den = Number(mixedSpace[4])
    if (den === 0 || ![w, num, den].every(Number.isFinite)) return null
    return sign * (w + num / den)
  }

  const mixedHyphen = t.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/)
  if (mixedHyphen) {
    const w = Number(mixedHyphen[1])
    const num = Number(mixedHyphen[2])
    const den = Number(mixedHyphen[3])
    if (den === 0 || ![w, num, den].every(Number.isFinite)) return null
    return w + num / den
  }

  const pureFrac = t.match(/^(-?\d+)\s*\/\s*(\d+)$/)
  if (pureFrac) {
    const num = Number(pureFrac[1])
    const den = Number(pureFrac[2])
    if (den === 0) return null
    return num / den
  }

  const dec = parseFloat(t)
  if (Number.isFinite(dec)) return dec
  return null
}

/** Strip a trailing linear unit token; remainder is the magnitude in that unit (or default). */
function stripLinearUnitSuffix(input: string): { rest: string; unit: PlanSiteDisplayUnit | null } {
  const t = input.trim()
  if (!t) return { rest: '', unit: null }

  const tryStrip = (re: RegExp, unit: PlanSiteDisplayUnit): { rest: string; unit: PlanSiteDisplayUnit } | null => {
    const m = t.match(re)
    if (!m) return null
    const rest = m[1]!.trim()
    if (rest === '') return null
    return { rest, unit }
  }

  return (
    tryStrip(/^(.*)\s*mm\s*$/i, 'mm') ??
    tryStrip(/^(.*)\s*(yd|yard|yards)\s*$/i, 'yd') ??
    tryStrip(/^(.*)\s*(in|inch|inches)\s*$/i, 'in') ??
    tryStrip(/^(.*)(?:\s*)(?:\"|\u2033)\s*$/i, 'in') ??
    tryStrip(/^(.*)\s*(ft|feet|foot|')\s*$/i, 'ft') ??
    tryStrip(/^(.*)\s*(m|meter|meters)\s*$/i, 'm') ??
    { rest: t, unit: null }
  )
}

/**
 * Parse a user-typed linear distance into **plan inches**.
 * Optional suffix overrides the default unit: `in`, `ft`, `yd`, `mm`, `m`, `"` (inches).
 * Fractions and mixed numbers use the effective unit (suffix or `defaultUnit`).
 */
export function parseLinearMeasureToPlanInches(
  raw: string,
  defaultUnit: PlanSiteDisplayUnit,
): number | null {
  const { rest, unit } = stripLinearUnitSuffix(raw)
  if (!rest) return null
  const u = unit ?? defaultUnit
  const n = parseRationalExpression(rest)
  if (n === null || !Number.isFinite(n)) return null
  return inchesFromSiteDisplay(n, u)
}

/** Like `parseLinearMeasureToPlanInches`, but blank input → `0` (for ΔX/ΔY where one axis may be omitted). */
export function parseOptionalLinearToPlanInches(
  raw: string,
  defaultUnit: PlanSiteDisplayUnit,
): number | null {
  if (!raw.trim()) return 0
  return parseLinearMeasureToPlanInches(raw, defaultUnit)
}

/** String for grid spacing or site width/depth inputs. */
export function formatSiteMeasure(inches: number, unit: PlanSiteDisplayUnit, maxDecimals = 6): string {
  const v = inchesToSiteDisplay(inches, unit)
  const d =
    unit === 'm' || unit === 'ft' || unit === 'yd'
      ? Math.min(maxDecimals, 4)
      : unit === 'mm'
        ? Math.min(maxDecimals, 2)
        : Math.min(maxDecimals, 4)
  const rounded = Number(v.toFixed(d))
  return String(rounded)
}

/** Linear plan dimension with unit suffix (e.g. `48.5 ft`). */
export function formatSiteLinearWithUnit(inches: number, unit: PlanSiteDisplayUnit): string {
  if (!Number.isFinite(inches) || inches <= 0) return '—'
  return `${formatSiteMeasure(inches, unit)} ${PLAN_SITE_UNIT_SHORT[unit]}`
}

const SQ_IN_PER_SQ_FT = 144
const SQ_IN_PER_SQ_YD = 36 * 36

/** Floor / cell area from square plan inches, in the user’s site unit. */
export function formatPlanAreaFromSqIn(sqIn: number, unit: PlanSiteDisplayUnit): string {
  if (!Number.isFinite(sqIn) || sqIn <= 0) return '—'
  switch (unit) {
    case 'in':
      return `${formatSiteMeasure(sqIn, 'in', 2)} sq in`
    case 'ft': {
      const v = sqIn / SQ_IN_PER_SQ_FT
      return `${Number(v.toFixed(2))} sq ft`
    }
    case 'yd': {
      const v = sqIn / SQ_IN_PER_SQ_YD
      return `${Number(v.toFixed(3))} sq yd`
    }
    case 'mm': {
      const v = sqIn * MM_PER_IN * MM_PER_IN
      return `${Number(v.toFixed(0))} mm²`
    }
    case 'm': {
      const v = sqIn / (IN_PER_M * IN_PER_M)
      return `${Number(v.toFixed(3))} m²`
    }
    default:
      return `${formatSiteMeasure(sqIn, 'in')} sq in`
  }
}

/** Finer step for grid Δ (small spacing). */
export function gridInputStep(unit: PlanSiteDisplayUnit): string {
  switch (unit) {
    case 'in':
      return '0.25'
    case 'ft':
      return '0.001'
    case 'yd':
      return '0.0001'
    case 'mm':
      return '1'
    case 'm':
      return '0.0001'
    default:
      return '0.25'
  }
}

/** Step for site width/depth fields. */
export function siteInputStep(unit: PlanSiteDisplayUnit): string {
  switch (unit) {
    case 'in':
      return '1'
    case 'ft':
      return '0.01'
    case 'yd':
      return '0.01'
    case 'mm':
      return '10'
    case 'm':
      return '0.01'
    default:
      return '1'
  }
}

export function loadSiteDisplayUnit(): PlanSiteDisplayUnit {
  try {
    const v = localStorage.getItem(LS_SITE_KEY)
    if (isSiteUnit(v)) return v
    const legacy = localStorage.getItem(LS_LEGACY_KEY)
    if (isSiteUnit(legacy)) {
      localStorage.setItem(LS_SITE_KEY, legacy)
      return legacy
    }
  } catch {
    /* private mode */
  }
  return 'ft'
}

export function saveSiteDisplayUnit(u: PlanSiteDisplayUnit): void {
  try {
    localStorage.setItem(LS_SITE_KEY, u)
  } catch {
    /* ignore */
  }
}

export function loadGridDisplayUnit(): PlanSiteDisplayUnit {
  try {
    const v = localStorage.getItem(LS_GRID_KEY)
    if (isSiteUnit(v)) return v
  } catch {
    /* private mode */
  }
  return 'in'
}

export function saveGridDisplayUnit(u: PlanSiteDisplayUnit): void {
  try {
    localStorage.setItem(LS_GRID_KEY, u)
  } catch {
    /* ignore */
  }
}
