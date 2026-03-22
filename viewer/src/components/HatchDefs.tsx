/** Standardized SVG fill/stroke tokens for architectural hatch patterns */
const STROKE = '#000'
const FILL = '#000'
const FILL_WHITE = 'white'

/** Valid fill IDs (without p- prefix) for dropdown and validation */
export const FILL_OPTIONS = [
  'CLT', 'WOOD', 'INSULATION', 'MEMBRANE', 'METAL',
  'CONCRETE', 'AIR_GAP', 'GLASS', 'GRAVEL_SOIL', 'MISC',
] as const

/** SVG <defs> block containing all 10 architectural hatch patterns. */
export function HatchDefs() {
  return (
    <defs>
      {/* CLT — horizontal grain lines, heavy (laminated timber) */}
      <pattern id="p-CLT" width="40" height="8" patternUnits="userSpaceOnUse">
        <line x1="0" y1="1.5" x2="40" y2="1.5" stroke={STROKE} strokeWidth="0.9" />
        <line x1="0" y1="4.5" x2="40" y2="4.5" stroke={STROKE} strokeWidth="0.5" />
        <line x1="0" y1="7"   x2="40" y2="7"   stroke={STROKE} strokeWidth="0.3" />
      </pattern>

      {/* WOOD — fine horizontal grain, lighter (battens, hardwood, LVL) */}
      <pattern id="p-WOOD" width="30" height="5" patternUnits="userSpaceOnUse">
        <line x1="0" y1="1.5" x2="30" y2="1.5" stroke={STROKE} strokeWidth="0.45" />
        <line x1="0" y1="3.5" x2="30" y2="3.5" stroke={STROKE} strokeWidth="0.25" />
      </pattern>

      {/* INSULATION — 45° diagonal lines (standard ASHRAE hatch) */}
      <pattern id="p-INSULATION" width="8" height="8" patternUnits="userSpaceOnUse">
        <line x1="-2" y1="10" x2="10" y2="-2" stroke={STROKE} strokeWidth="0.55" />
        <line x1="-10" y1="10" x2="2" y2="-2" stroke={STROKE} strokeWidth="0.55" />
        <line x1="6" y1="10" x2="18" y2="-2" stroke={STROKE} strokeWidth="0.55" />
      </pattern>

      {/* MEMBRANE — horizontal dashes (WRB, vapor barriers, waterproofing) */}
      <pattern id="p-MEMBRANE" width="10" height="4" patternUnits="userSpaceOnUse">
        <line x1="0" y1="2" x2="6" y2="2" stroke={STROKE} strokeWidth="1.4" />
      </pattern>

      {/* METAL — 45° + 135° crosshatch (steel, aluminum, connectors) */}
      <pattern id="p-METAL" width="5" height="5" patternUnits="userSpaceOnUse">
        <line x1="0" y1="5" x2="5" y2="0" stroke={STROKE} strokeWidth="0.55" />
        <line x1="0" y1="0" x2="5" y2="5" stroke={STROKE} strokeWidth="0.55" />
      </pattern>

      {/* CONCRETE — 45° diagonal + dots (structural slab, screed, topping) */}
      <pattern id="p-CONCRETE" width="12" height="12" patternUnits="userSpaceOnUse">
        <line x1="-2" y1="14" x2="14" y2="-2" stroke={STROKE} strokeWidth="0.5" />
        <circle cx="3"  cy="3"  r="1.1" fill={FILL} />
        <circle cx="9"  cy="9"  r="1.1" fill={FILL} />
        <circle cx="9"  cy="3"  r="0.6" fill={FILL} />
        <circle cx="3"  cy="9"  r="0.6" fill={FILL} />
      </pattern>

      {/* AIR_GAP — white fill only; dashed border applied per-rect */}
      <pattern id="p-AIR_GAP" width="1" height="1" patternUnits="userSpaceOnUse">
        <rect width="1" height="1" fill={FILL_WHITE} />
      </pattern>

      {/* GLASS — fine 60° diagonals, very close spacing */}
      <pattern id="p-GLASS" width="3" height="3" patternUnits="userSpaceOnUse">
        <line x1="0" y1="3" x2="3" y2="0" stroke={STROKE} strokeWidth="0.28" />
        <line x1="-3" y1="3" x2="0" y2="0" stroke={STROKE} strokeWidth="0.28" />
        <line x1="3" y1="3" x2="6" y2="0" stroke={STROKE} strokeWidth="0.28" />
      </pattern>

      {/* GRAVEL_SOIL — scattered irregular circles (aggregate, soil, LECA) */}
      <pattern id="p-GRAVEL_SOIL" width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="2.5" cy="3.5"  r="1.6" fill={FILL} />
        <circle cx="7.5" cy="1.5"  r="1.0" fill={FILL} />
        <circle cx="11.5" cy="6.5" r="1.8" fill={FILL} />
        <circle cx="1.5" cy="10.5" r="1.2" fill={FILL} />
        <circle cx="6.5" cy="11.5" r="0.9" fill={FILL} />
        <circle cx="12"  cy="11"   r="1.4" fill={FILL} />
        <circle cx="5"   cy="6.5"  r="0.7" fill={FILL} />
        <circle cx="9.5" cy="4.5"  r="0.8" fill={FILL} />
      </pattern>

      {/* MISC — stipple dots at medium density (neoprene, cork, sealant) */}
      <pattern id="p-MISC" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="0.8" fill={FILL} />
        <circle cx="4.5" cy="4.5" r="0.8" fill={FILL} />
        <circle cx="4.5" cy="1.5" r="0.4" fill={FILL} />
        <circle cx="1.5" cy="4.5" r="0.4" fill={FILL} />
      </pattern>
    </defs>
  )
}
