interface TitleBlockProps {
  x: number
  y: number
  w: number
  h: number
  systemId: string
  systemName: string
  totalThickness: string
  totalR: string
  systemIndex: number
  totalSystems: number
  scaleLabel?: string
  /** From CSV `Category`; shown on title block (uppercased). */
  category?: string
}

const MONO = "'Courier New', Courier, monospace"

export function TitleBlock({
  x, y, w, h,
  systemId, systemName,
  totalThickness, totalR,
  systemIndex, totalSystems,
  scaleLabel = '3" = 1\'-0"',
  category: categoryProp,
}: TitleBlockProps) {
  const raw = categoryProp?.trim() ?? ''
  const catLabel = raw
    ? (raw.length > 44 ? `${raw.slice(0, 42)}…` : raw).toUpperCase()
    : 'BUILDING SYSTEM'

  const ruleH = 0.5
  const padX = 8
  const row = (n: number) => y + n * (h / 5)

  const date = '03.2026'
  const sheetNum = String(systemIndex).padStart(2, '0')
  const totalNum = String(totalSystems).padStart(2, '0')

  // Truncate long names for display
  const truncName = systemName.length > 32 ? systemName.substring(0, 30) + '…' : systemName

  return (
    <g fontFamily={MONO}>
      {/* Outer border */}
      <rect x={x} y={y} width={w} height={h} fill="white" stroke="black" strokeWidth="1.5" />

      {/* Row 1: Project name + location */}
      <text x={x + padX} y={y + 16} fontSize="9" fontWeight="bold" letterSpacing="1.5" fill="black">
        MASS TIMBER BUILDING SYSTEM
      </text>
      <text x={x + padX} y={y + 27} fontSize="7.5" fill="#333" letterSpacing="1">
        HIGHLAND PARK / DETROIT, MI  —  ASHRAE ZONE 5
      </text>
      <line x1={x} y1={row(1)} x2={x + w} y2={row(1)} stroke="black" strokeWidth={ruleH} />

      {/* Row 2: System ID + Name — spacing for A4-XX format (5 chars) */}
      <text x={x + padX} y={row(1) + 14} fontSize="12" fontWeight="bold" letterSpacing="2" fill="black">
        {systemId}
      </text>
      <text x={x + padX + 52} y={row(1) + 14} fontSize="8.5" fontWeight="bold" fill="black" letterSpacing="0.5">
        {truncName.toUpperCase()}
      </text>
      <text x={x + padX} y={row(1) + 26} fontSize="7.5" fill="#555" letterSpacing="0.5">
        {catLabel}
      </text>
      <line x1={x} y1={row(2)} x2={x + w} y2={row(2)} stroke="black" strokeWidth={ruleH} />

      {/* Row 3: Total thickness + R-value */}
      <text x={x + padX} y={row(2) + 14} fontSize="8" fontWeight="bold" fill="black" letterSpacing="0.5">
        TOTAL THK:
      </text>
      <text x={x + padX + 72} y={row(2) + 14} fontSize="8" fill="black">
        {totalThickness.toUpperCase()} IN
      </text>
      <text x={x + padX} y={row(2) + 26} fontSize="8" fontWeight="bold" fill="black" letterSpacing="0.5">
        TOTAL R-VALUE:
      </text>
      <text x={x + padX + 88} y={row(2) + 26} fontSize="8" fill="black">
        R-{totalR}
      </text>
      <line x1={x} y1={row(3)} x2={x + w} y2={row(3)} stroke="black" strokeWidth={ruleH} />

      {/* Row 4: Connection note excerpt */}
      <text x={x + padX} y={row(3) + 13} fontSize="7" fill="#555" letterSpacing="0.3">
        CONNECTION: PER ENGINEER OF RECORD
      </text>
      <text x={x + padX} y={row(3) + 24} fontSize="7" fill="#555" letterSpacing="0.3">
        MATERIAL: LOW-VOC, SUSTAINABLY SOURCED
      </text>
      <line x1={x} y1={row(4)} x2={x + w} y2={row(4)} stroke="black" strokeWidth={ruleH} />

      {/* Row 5: Scale / Date / Sheet */}
      <text x={x + padX} y={row(4) + 14} fontSize="7.5" fill="black" letterSpacing="0.5">
        SCALE: {scaleLabel}
      </text>
      <text x={x + padX + 82} y={row(4) + 14} fontSize="7.5" fill="black" letterSpacing="0.5">
        DATE: {date}
      </text>
      <text x={x + w - padX} y={row(4) + 14} fontSize="7.5" fill="black" textAnchor="end" letterSpacing="0.5">
        SHEET {sheetNum}/{totalNum}
      </text>

      {/* Decorative corner mark — wider for A4-XX format */}
      <rect x={x + w - 38} y={y} width={38} height={22} fill="black" />
      <text x={x + w - 19} y={y + 14} fontSize="8" fill="white" textAnchor="middle" fontWeight="bold">
        {systemId}
      </text>
    </g>
  )
}
