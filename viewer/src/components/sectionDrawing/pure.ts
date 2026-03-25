import type { Layer } from '../../types/system'
import { parseThickness } from '../../lib/geometry'
import { resolveFastenerIcon } from '../../lib/fastenerIcons'
import {
  CALLOUT_MAT_MAX_COMPACT,
  CALLOUT_MAT_MAX_DEFAULT,
  CALLOUT_NAME_MAX,
} from './constants'

/** First numeric length in cell (handles "1.5", "0.5 from tongue", "6–8" → 6). */
export function parseOptionalMinDistInches(raw: string | undefined): number | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (t === '' || t === '—' || t === '-' || /^n\/a$/i.test(t)) return null
  const m = t.match(
    /^([\d.]+\s*-\s*[\d.]+\s*\/\s*[\d.]+|[\d.]+\s*\/\s*[\d.]+|[\d.]+\s*-\s*[\d.]+\s*\/\s*[\d.]+|[\d.]+(?:\s*\/\s*[\d.]+)?)/,
  )
  const head = (m ? m[1] : t.split(/\s+/)[0]).replace(/\s/g, '')
  const n = parseThickness(head)
  return n > 0 ? n : null
}

function layerContextBlob(layer: Layer): string {
  return `${layer.name} ${layer.connection} ${layer.fastener} ${layer.notes}`.toLowerCase()
}

/** Horizontal section: cap on bottom face = bearing-side entry (typ. floor into support). */
export function inferHorizCapOnBottom(layer: Layer): boolean {
  const b = layerContextBlob(layer)
  if (/\b(roof|standing seam|zinc|membrane|underlayment|vapor|sarking|metal roof)\b/.test(b)) return false
  if (/\binsulation\b/.test(b) && /\b(screw|attach|mechanically)\b/.test(b)) return false
  if (/\b(floor|slab on|structural floor)\b/.test(b) && /\b(bearing|support|wall|beam|onto)\b/.test(b)) return true
  if (/\bclt\b.*\b(floor|deck|panel)\b|\b(floor|deck)\b.*\bclt\b/.test(b) && /\b(bearing|support)\b/.test(b)) return true
  if (/\b(bearing edge|each bearing|at bearing)\b/.test(b) && /\b(screw|lag|bolt|nail|fastener|sts|cleat)\b/.test(b)) return true
  return false
}

/** Wall section: cap on interior (right) vs exterior (left) face along thickness. */
export function inferWallCapOnRight(layer: Layer): boolean {
  const b = layerContextBlob(layer)
  if (/\b(into core|interior finish)\b/.test(b) || /structure\s*\/\s*interior/i.test(b) || /\bconcealed.*interior\b/.test(b)) {
    return true
  }
  const n = layer.name.toLowerCase()
  if (/\b(exterior|rainscreen|cladding|screen|zinc|outer)\b/.test(n)) return false
  if (/\b(interior|cavity side|warm side)\b/.test(n)) return true
  return false
}

/** Wall: vertical position of fastener line (fraction 0–1 from top of cut). */
export function inferWallFastenerMyFrac(layer: Layer): number {
  const b = layerContextBlob(layer)
  if (/\b(sill|base|foundation|bearing at bottom|post base|floor below)\b/.test(b)) return 0.88
  if (/\b(head|top|ceiling|eave|parapet)\b/.test(b) && !/\bunderside\b/.test(b)) return 0.14
  return 0.5
}

/**
 * Insets (px) from each face along the layer thickness direction, from CSV min edge/end or safe defaults.
 */
export function fastenerSpanInsetsPx(
  layer: Layer,
  thicknessPx: number,
  pxPerInch: number,
): { fromStart: number; fromEnd: number } {
  const edgeIn = parseOptionalMinDistInches(layer.fastenerMinEdgeIn)
  const endIn = parseOptionalMinDistInches(layer.fastenerMinEndIn)
  const fallback = Math.max(1.5, Math.min(thicknessPx * 0.2, thicknessPx / 2 - 3))

  if (edgeIn != null || endIn != null) {
    const fromStart = edgeIn != null ? edgeIn * pxPerInch : fallback
    const fromEnd = endIn != null ? endIn * pxPerInch : fallback
    const minLen = 5
    let s = Math.max(1, fromStart)
    let e = Math.max(1, fromEnd)
    if (thicknessPx - s - e < minLen) {
      const over = s + e + minLen - thicknessPx
      s = Math.max(1, s - over / 2)
      e = Math.max(1, e - over / 2)
    }
    return { fromStart: s, fromEnd: e }
  }

  return { fromStart: fallback, fromEnd: fallback }
}

/** Monospace-ish width estimate for layout (Courier ~0.58× fontSize per glyph at small sizes). */
export function estimateLineWidthPx(line: string, fontSize: number): number {
  return Math.max(line.length * fontSize * 0.58, fontSize * 3)
}

/** Split text into lines of ~maxLen chars, breaking at spaces when possible */
export function wrapText(text: string, maxLen: number): string[] {
  if (maxLen < 1) return text ? [text] : []
  if (text.length <= maxLen) return [text]
  const lines: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      lines.push(remaining)
      break
    }
    const chunk = remaining.slice(0, maxLen + 1)
    const lastSpace = chunk.lastIndexOf(' ')
    const breakAt = lastSpace > maxLen * 0.35 ? lastSpace : maxLen
    lines.push(remaining.slice(0, breakAt).trim())
    remaining = remaining.slice(breakAt).trim()
  }
  return lines
}

/** Chars per line from pixel budget (fastener labels on section). */
export function fastenerCharsPerLine(maxLabelPx: number, fontSize: number, pad: number): number {
  const inner = Math.max(24, maxLabelPx - pad * 2)
  return Math.max(5, Math.floor(inner / (fontSize * 0.58)))
}

/** Shared layout for one legend row: capped lines + bubble height (must match CalloutItem). */
export function getCalloutContentMetrics(layer: Layer, matMaxLines: number) {
  const nameLineHeight = 11
  const matLineHeight = 10
  const fastenerLineHeight = 9
  const nameLines = wrapText(layer.name.toUpperCase(), 50).slice(0, CALLOUT_NAME_MAX)
  const matWrapped = wrapText(layer.material, 60)
  let matLines = matWrapped.slice(0, matMaxLines)
  if (matWrapped.length > matMaxLines && matLines.length > 0) {
    const i = matLines.length - 1
    const line = matLines[i]!
    matLines = [...matLines.slice(0, i), (line.length > 52 ? `${line.slice(0, 52)}…` : `${line}…`)]
  }
  const thk = layer.thickness === '—' ? '—' : layer.thickness + ' IN'
  const iconId = resolveFastenerIcon(layer)
  const fastenerSummary = [layer.fastener, layer.fastenerSize]
    .filter((s) => s && String(s).trim() && String(s).trim() !== '—')
    .join(' · ')
  const fastenerLines = fastenerSummary ? wrapText(fastenerSummary, 52).slice(0, 2) : []
  const hasIcon = iconId !== 'none'
  const showFastenerRow = fastenerLines.length > 0
  const REF = 100
  const hitTop = REF - 14
  const matStartY = REF - 3 + nameLines.length * nameLineHeight + 5
  const thkLineY = matStartY + matLines.length * matLineHeight + 5
  const textStartY = showFastenerRow ? thkLineY + 8 : thkLineY
  const thkTail = 9
  let contentBottom = thkLineY + thkTail
  if (showFastenerRow) {
    contentBottom = Math.max(
      contentBottom,
      textStartY + (fastenerLines.length - 1) * fastenerLineHeight + thkTail,
    )
  }
  const bubbleH = Math.max(38, contentBottom - hitTop + 6)
  return {
    nameLineHeight,
    matLineHeight,
    fastenerLineHeight,
    nameLines,
    matLines,
    thk,
    iconId,
    fastenerLines,
    hasIcon,
    showFastenerRow,
    bubbleH,
    _refMatStartY: matStartY,
    _refThkY: thkLineY,
    _refTextY: textStartY,
  }
}

export type CalloutLayoutMetrics = ReturnType<typeof getCalloutContentMetrics>

export function stackCalloutYs(
  layers: Layer[],
  yStart: number,
  maxBottom: number,
): { ys: number[]; metrics: CalloutLayoutMetrics[] } {
  const tryStack = (matMax: number) => {
    const metrics = layers.map((l) => getCalloutContentMetrics(l, matMax))
    let gap = 6
    let hitTop = yStart
    const ys: number[] = []
    for (const m of metrics) {
      ys.push(hitTop + 14)
      hitTop += m.bubbleH + gap
    }
    return { ys, metrics, hitTop }
  }
  let { ys, metrics, hitTop } = tryStack(CALLOUT_MAT_MAX_DEFAULT)
  if (hitTop > maxBottom + 24 && layers.length > 0) {
    ;({ ys, metrics, hitTop } = tryStack(CALLOUT_MAT_MAX_COMPACT))
  }
  if (hitTop > maxBottom + 24 && layers.length > 1) {
    const mlist = layers.map((l) => getCalloutContentMetrics(l, CALLOUT_MAT_MAX_COMPACT))
    const sumH = mlist.reduce((s, m) => s + m.bubbleH, 0)
    const slack = maxBottom - yStart - sumH
    const gap = Math.max(2, Math.floor(slack / Math.max(1, layers.length - 1)))
    let hitTop2 = yStart
    const ys2: number[] = []
    for (const m of mlist) {
      ys2.push(hitTop2 + 14)
      hitTop2 += m.bubbleH + gap
    }
    return { ys: ys2, metrics: mlist }
  }
  return { ys, metrics }
}
