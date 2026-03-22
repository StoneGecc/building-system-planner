import type { ReactNode } from 'react'

/** CSV / UI values — keep lowercase with underscores */
export type FastenerIconId =
  | 'none'
  | 'wood_screw'
  | 'bolt'
  | 'adhesive'
  | 'rivet'
  | 'plate'
  | 'clip'

export const FASTENER_ICON_IDS: FastenerIconId[] = [
  'none',
  'wood_screw',
  'bolt',
  'adhesive',
  'rivet',
  'plate',
  'clip',
]

export const FASTENER_ICON_LABELS: Record<FastenerIconId, string> = {
  none: '—',
  wood_screw: 'Wood screw',
  bolt: 'Bolt / lag',
  adhesive: 'Adhesive',
  rivet: 'Rivet',
  plate: 'Plate / angle',
  clip: 'Clip',
}

const VALID = new Set<string>(FASTENER_ICON_IDS)

export function normalizeFastenerIcon(raw: string | undefined): FastenerIconId {
  const t = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (t === '' || t === '—' || t === '-' || t === 'n/a') return 'none'
  if (VALID.has(t)) return t as FastenerIconId
  return 'none'
}

/** Use stored CSV/UI value when set; otherwise infer from fastener text. */
export function resolveFastenerIcon(layer: {
  fastenerIcon?: FastenerIconId | null
  fastener: string
  fastenerSize: string
}): FastenerIconId {
  if (layer.fastenerIcon !== undefined && layer.fastenerIcon !== null) return layer.fastenerIcon
  return inferFastenerIcon(layer.fastener, layer.fastenerSize)
}

const CALLOUT_STROKE = '#374151'
const CALLOUT_FILL = '#374151'

/** When CSV `Fastener_Icon` is empty, pick a simple symbol from fastener description. */
export function inferFastenerIcon(fastener: string, fastenerSize: string): FastenerIconId {
  const t = `${fastener} ${fastenerSize}`.toLowerCase()
  if (!t.trim()) return 'none'

  const noDiscrete =
    /\b(n\/a|cast in place|poured|factory(-|\s)set|mechanical compaction|brush|roller|caulk gun|taped seams|staples only|press fit|loose[- ]laid|fully adhered)\b/i.test(t) &&
    !/\b(screw|bolt|rivet|nail|lag|clip|plate|angle)\b/i.test(t)
  if (noDiscrete) return 'none'

  if (/\brivets?\b/.test(t)) return 'rivet'
  if (/\b(bolts?|lags?|hex[- ]head|anchor bolts?|through[- ]bolts?|machine screws?)\b/.test(t)) return 'bolt'
  if (/\b(screws?|sts|cleats?|nails?|staples?)\b/.test(t)) return 'wood_screw'
  if (/\bclips?\b/.test(t)) return 'clip'
  if (/\b(plate|plates|angles?|brackets?|connectors?|splines?)\b/.test(t)) return 'plate'
  if (/\b(adhesive|sealant|caulk|tape|thin-set|epoxy|glued)\b/.test(t)) return 'adhesive'

  return 'none'
}

/** Inline SVG content (viewBox 0 0 24 24) for callouts and previews */
function iconPaths(id: FastenerIconId, stroke: string, fill: string): ReactNode {
  switch (id) {
    case 'none':
      return null
    case 'wood_screw':
      return (
        <>
          <line x1="4" y1="18" x2="18" y2="6" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7 15l2-2 M9 13l2-2 M11 11l2-2" fill="none" stroke={stroke} strokeWidth="0.9" strokeLinecap="round" />
          <polygon points="18,6 20,4 20,8 16,8" fill={fill} stroke="none" />
        </>
      )
    case 'bolt':
      return (
        <>
          <path d="M9 4h6l1 2v3H8V6z" fill="none" stroke={stroke} strokeWidth="1.2" />
          <line x1="12" y1="9" x2="12" y2="19" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </>
      )
    case 'adhesive':
      return (
        <>
          <path d="M5 14 Q12 8 19 14 Q12 18 5 14" fill="none" stroke={stroke} strokeWidth="1.3" />
          <path d="M6 17 Q12 20 18 17" fill="none" stroke={stroke} strokeWidth="1" opacity="0.7" />
        </>
      )
    case 'rivet':
      return (
        <>
          <path d="M12 5 C15 5 17 7 17 9 C17 11 12 12 12 12 C12 12 7 11 7 9 C7 7 9 5 12 5" fill="none" stroke={stroke} strokeWidth="1.2" />
          <line x1="12" y1="12" x2="12" y2="19" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )
    case 'plate':
      return (
        <>
          <path d="M6 18 L6 10 L14 10 L14 6 L18 6 L18 18 Z" fill="none" stroke={stroke} strokeWidth="1.3" strokeLinejoin="miter" />
          <circle cx="10" cy="14" r="1.2" fill={fill} stroke="none" />
          <circle cx="15" cy="14" r="1.2" fill={fill} stroke="none" />
        </>
      )
    case 'clip':
      return (
        <>
          <path d="M5 8 C5 8 8 6 12 8 C16 10 19 14 19 18" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8 12 C10 10 14 12 16 16" fill="none" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" />
        </>
      )
  }
}

export function FastenerIconSvg({
  id,
  size = 24,
  className,
  title,
}: {
  id: FastenerIconId
  size?: number
  className?: string
  title?: string
}) {
  if (id === 'none') {
    return (
      <span className={`inline-flex items-center justify-center text-muted-foreground ${className ?? ''}`} style={{ width: size, height: size }} title={title}>
        —
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-700" stroke="currentColor">
        {iconPaths(id, 'currentColor', 'currentColor')}
      </g>
    </svg>
  )
}

/** SVG fragment positioned for section callouts (y = top of icon box) */
export function FastenerCalloutGraphic({
  id,
  x,
  y,
  size = 14,
}: {
  id: FastenerIconId
  x: number
  y: number
  size?: number
}) {
  if (id === 'none') return null
  const scale = size / 24
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {iconPaths(id, CALLOUT_STROKE, CALLOUT_FILL)}
    </g>
  )
}
