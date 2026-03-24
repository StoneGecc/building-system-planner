import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { BuildingDimensions, DiagramDetailLevel, FastenerDrawMode, SystemData, Layer } from '../types/system'
import { FASTENER_ICON_LABELS, resolveFastenerIcon } from '../lib/fastenerIcons'
import { HatchDefs } from './HatchDefs'
import { TitleBlock } from './TitleBlock'
import { getSystemOrientation } from '../lib/orientation'
import {
  computeLayerSizesToScale,
  parseThickness,
  buildWallRects,
  buildHorizRects,
  DETAIL_SCALE_PX_PER_IN,
  type LayerRect,
} from '../lib/geometry'
import {
  DIAGRAM_DETAIL_DEFAULTS,
  effectiveDetailLevel,
  effectiveDrawControlJoints,
  effectiveDrawModuleJoints,
  effectiveFastenerMode,
  effectiveMaxModuleJoints,
  effectiveMinFeaturePx,
  effectiveShopFastenerCap,
} from '../lib/diagramDetail'
import { DEFAULT_LAYOUT_REFS } from '../data/schematicFrame'
import {
  SHEET_W,
  SHEET_H,
  PANEL_X,
  PANEL_Y,
  PANEL_W,
  PANEL_H,
  DIVIDER_X,
  CALLOUT_BUBBLE_X,
  CALLOUT_TEXT_X,
  CALLOUT_Y_START,
  TB_X,
  TB_Y,
  TB_W,
  TB_H,
} from '../data/sheetLayout'

/** Legend material wraps to many lines — cap rows so stacked callouts do not overlap. */
const CALLOUT_NAME_MAX = 2
const CALLOUT_MAT_MAX_DEFAULT = 2
const CALLOUT_MAT_MAX_COMPACT = 1

// Wall section cut zone — reference: 193.74–703.74 (510 wide), y 290–540
const WALL_CUT_X = 194
const WALL_CUT_W = 510
const WALL_CUT_Y = 290
const WALL_CUT_H = 250

// Horizontal section cut zone — centered in wider panel (811 - 310) / 2 ≈ 250
const HORIZ_CUT_X = PANEL_X + Math.round((PANEL_W - 310) / 2)
const HORIZ_CUT_W = 310
const HORIZ_CUT_Y_START = PANEL_Y + 55
const HORIZ_CUT_MAX_H = PANEL_H - 80

const MONO = "'Courier New', Courier, monospace"

/** First numeric length in cell (handles "1.5", "0.5 from tongue", "6–8" → 6). */
function parseOptionalMinDistInches(raw: string | undefined): number | null {
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
function inferHorizCapOnBottom(layer: Layer): boolean {
  const b = layerContextBlob(layer)
  if (/\b(roof|standing seam|zinc|membrane|underlayment|vapor|sarking|metal roof)\b/.test(b)) return false
  if (/\binsulation\b/.test(b) && /\b(screw|attach|mechanically)\b/.test(b)) return false
  if (/\b(floor|slab on|structural floor)\b/.test(b) && /\b(bearing|support|wall|beam|onto)\b/.test(b)) return true
  if (/\bclt\b.*\b(floor|deck|panel)\b|\b(floor|deck)\b.*\bclt\b/.test(b) && /\b(bearing|support)\b/.test(b)) return true
  if (/\b(bearing edge|each bearing|at bearing)\b/.test(b) && /\b(screw|lag|bolt|nail|fastener|sts|cleat)\b/.test(b)) return true
  return false
}

/** Wall section: cap on interior (right) vs exterior (left) face along thickness. */
function inferWallCapOnRight(layer: Layer): boolean {
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
function inferWallFastenerMyFrac(layer: Layer): number {
  const b = layerContextBlob(layer)
  if (/\b(sill|base|foundation|bearing at bottom|post base|floor below)\b/.test(b)) return 0.88
  if (/\b(head|top|ceiling|eave|parapet)\b/.test(b) && !/\bunderside\b/.test(b)) return 0.14
  return 0.5
}

/**
 * Insets (px) from each face along the layer thickness direction, from CSV min edge/end or safe defaults.
 */
function fastenerSpanInsetsPx(
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

const FASTENER_LABEL_FS = 6.5
const FASTENER_LABEL_LH = 9
const FASTENER_LABEL_PAD = 4

/** Monospace-ish width estimate for layout (Courier ~0.58× fontSize per glyph at small sizes). */
function estimateLineWidthPx(line: string, fontSize: number): number {
  return Math.max(line.length * fontSize * 0.58, fontSize * 3)
}

/** Full fastener description: horizontal lines, white backing for contrast on hatches. */
function FastenerDescriptionBlock({
  lines,
  boxX,
  boxY,
  maxWidth,
}: {
  lines: string[]
  boxX: number
  boxY: number
  maxWidth: number
}) {
  if (lines.length === 0) return null
  const fs = FASTENER_LABEL_FS
  const lh = FASTENER_LABEL_LH
  const pad = FASTENER_LABEL_PAD
  const innerW = Math.max(...lines.map(l => estimateLineWidthPx(l, fs)), fs * 4)
  const w = Math.min(maxWidth, innerW + pad * 2)
  const h = lines.length * lh + pad * 2
  return (
    <g pointerEvents="none">
      <rect
        x={boxX}
        y={boxY}
        width={w}
        height={h}
        rx={3}
        fill="white"
        fillOpacity={0.94}
        stroke="#bdbdbd"
        strokeWidth={0.45}
      />
      <text
        x={boxX + pad}
        y={boxY + pad + fs * 0.85}
        fontSize={fs}
        fill="#111"
        fontFamily={MONO}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={boxX + pad} dy={i === 0 ? 0 : lh}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

/** Fastener extent on the section: span matches CSV min edge/end (inches → px); cap at start, open at end. */
function LayerFastenerSpanOnDrawing({
  layer,
  r,
  isWall,
  pxPerInch,
  fastenerMode,
  detailLevel,
  buildingDimensions,
}: {
  layer: Layer
  r: LayerRect
  isWall: boolean
  pxPerInch: number
  fastenerMode: FastenerDrawMode
  detailLevel: DiagramDetailLevel
  buildingDimensions: BuildingDimensions
}) {
  if (fastenerMode === 'none') return null

  const tip = [layer.fastener, layer.fastenerSize].filter(s => s && String(s).trim() && String(s).trim() !== '—').join(' · ')
  const iconId = resolveFastenerIcon(layer)
  if (!tip && iconId === 'none') return null

  const full = tip || FASTENER_ICON_LABELS[iconId]

  const capHalf = 11
  const capStroke = 1.35
  const stroke = '#1a1a1a'
  const minWallSpanPx = detailLevel >= 2 ? 6 : 10
  const minHorizHPx = detailLevel >= 2 ? 6 : 10

  if (isWall) {
    if (r.w < minWallSpanPx) return null
    const { fromStart, fromEnd } = fastenerSpanInsetsPx(layer, r.w, pxPerInch)
    let x0 = r.x + fromStart
    let x1 = r.x + r.w - fromEnd
    if (x0 >= x1 - 4) {
      x0 = r.x + 2
      x1 = r.x + r.w - 2
    }
    let my = r.y + r.h * inferWallFastenerMyFrac(layer)
    my = Math.min(r.y + r.h - 8, Math.max(r.y + 8, my))
    const capRight = inferWallCapOnRight(layer)
    const xCap = capRight ? x1 : x0
    const cx = (x0 + x1) / 2
    const wallLabelMinLeft = WALL_CUT_X + 8
    const wallLabelMaxRight = DIVIDER_X - 16
    const halfAvail = Math.min(cx - wallLabelMinLeft, wallLabelMaxRight - cx) - 10
    const maxLabelW = Math.min(
      220,
      Math.max(48, 2 * Math.floor(Math.max(24, halfAvail))),
      wallLabelMaxRight - wallLabelMinLeft - 8,
    )
    const charsPerLine = fastenerCharsPerLine(maxLabelW, FASTENER_LABEL_FS, FASTENER_LABEL_PAD)
    const wallLines = wrapText(full, charsPerLine)
    const wallBoxW = Math.min(
      maxLabelW,
      Math.max(...wallLines.map(l => estimateLineWidthPx(l, FASTENER_LABEL_FS)), FASTENER_LABEL_FS * 4) + FASTENER_LABEL_PAD * 2,
    )
    const wallBoxH = wallLines.length * FASTENER_LABEL_LH + FASTENER_LABEL_PAD * 2
    let wallBoxX = cx - wallBoxW / 2
    wallBoxX = Math.max(wallLabelMinLeft, Math.min(wallBoxX, wallLabelMaxRight - wallBoxW))
    let wallBoxY = my - capHalf - 5 - wallBoxH
    wallBoxY = Math.max(PANEL_Y + 4, wallBoxY)
    const spacingIn = parseThickness(layer.fastenerSpacingOcIn ?? '')
    const spacingPx = spacingIn > 0 ? spacingIn * pxPerInch : 0
    const shopCap = effectiveShopFastenerCap(buildingDimensions)
    const extraWallTicks: number[] = []
    if (detailLevel >= 3 && spacingPx >= 4 && fastenerMode === 'full') {
      const lo = Math.min(x0, x1)
      const hi = Math.max(x0, x1)
      let x = lo + spacingPx
      let n = 0
      const maxExtra = Math.max(0, shopCap - 1)
      while (x < hi - 2 && n < maxExtra) {
        if (Math.abs(x - xCap) > spacingPx * 0.35) {
          extraWallTicks.push(x)
          n++
        }
        x += spacingPx
      }
    }
    return (
      <g pointerEvents="none" fontFamily={MONO}>
        {fastenerMode === 'full' ? (
          <FastenerDescriptionBlock lines={wallLines} boxX={wallBoxX} boxY={wallBoxY} maxWidth={maxLabelW} />
        ) : null}
        <line x1={x0} y1={my} x2={x1} y2={my} stroke={stroke} strokeWidth={0.7} strokeLinecap="butt" />
        <line
          x1={xCap}
          y1={my - capHalf}
          x2={xCap}
          y2={my + capHalf}
          stroke={stroke}
          strokeWidth={capStroke}
          strokeLinecap="square"
        />
        {extraWallTicks.map((xx, i) => (
          <line
            key={i}
            x1={xx}
            y1={my - capHalf * 0.55}
            x2={xx}
            y2={my + capHalf * 0.55}
            stroke={stroke}
            strokeWidth={capStroke * 0.85}
            strokeLinecap="square"
          />
        ))}
      </g>
    )
  }

  if (r.h < minHorizHPx) return null
  const { fromStart, fromEnd } = fastenerSpanInsetsPx(layer, r.h, pxPerInch)
  const topFace = r.y
  const botFace = r.y + r.h
  const capOnBottom = inferHorizCapOnBottom(layer)
  /** Cap sits on the layer face; stem runs inward using min-edge insets for the open end. */
  const minStem = 8
  let yCap: number
  let yStemEnd: number
  if (capOnBottom) {
    yCap = botFace
    yStemEnd = topFace + fromStart
    if (yStemEnd > yCap - minStem) yStemEnd = yCap - minStem
    if (yStemEnd < topFace + 1) yStemEnd = topFace + Math.min(minStem, Math.max(3, r.h * 0.25))
  } else {
    yCap = topFace
    yStemEnd = botFace - fromEnd
    if (yStemEnd < yCap + minStem) yStemEnd = yCap + minStem
    if (yStemEnd > botFace - 1) yStemEnd = botFace - Math.min(minStem, Math.max(3, r.h * 0.25))
  }

  const mx = Math.min(r.x + r.w - 5, Math.max(r.x + 5, r.x + r.w / 2))
  const midY = (yCap + yStemEnd) / 2
  const gap = 12
  const sectionInset = 10
  const sectionLeft = HORIZ_CUT_X + sectionInset
  const sectionRight = HORIZ_CUT_X + HORIZ_CUT_W - sectionInset
  const maxWRight = Math.max(36, sectionRight - mx - gap)
  const maxWLeft = Math.max(36, mx - sectionLeft - gap)
  const corridor = sectionRight - sectionLeft - 2 * gap
  const preferRight = maxWRight >= maxWLeft
  let maxLabelW = Math.min(210, corridor, preferRight ? maxWRight : maxWLeft)
  maxLabelW = Math.max(40, maxLabelW)
  const charsPerLine = fastenerCharsPerLine(maxLabelW, FASTENER_LABEL_FS, FASTENER_LABEL_PAD)
  const horizLines = wrapText(full, charsPerLine)
  const innerW = Math.max(
    ...horizLines.map(l => estimateLineWidthPx(l, FASTENER_LABEL_FS)),
    FASTENER_LABEL_FS * 4,
  )
  const boxW = Math.min(maxLabelW, innerW + FASTENER_LABEL_PAD * 2)
  const boxH = horizLines.length * FASTENER_LABEL_LH + FASTENER_LABEL_PAD * 2
  let boxX = preferRight ? mx + gap : mx - gap - boxW
  if (boxX < sectionLeft) boxX = sectionLeft
  if (boxX + boxW > sectionRight) boxX = Math.max(sectionLeft, sectionRight - boxW)
  let boxY = midY - boxH / 2
  boxY = Math.max(PANEL_Y + 4, Math.min(boxY, PANEL_Y + PANEL_H - boxH - 4))
  const vLo = Math.min(yCap, yStemEnd)
  const vHi = Math.max(yCap, yStemEnd)
  const spacingInH = parseThickness(layer.fastenerSpacingOcIn ?? '')
  const spacingPxH = spacingInH > 0 ? spacingInH * pxPerInch : 0
  const shopCapH = effectiveShopFastenerCap(buildingDimensions)
  const extraHorizTicks: number[] = []
  if (detailLevel >= 3 && spacingPxH >= 4 && fastenerMode === 'full') {
    let y = vLo + spacingPxH
    let n = 0
    const maxExtra = Math.max(0, shopCapH - 1)
    while (y < vHi - 2 && n < maxExtra) {
      if (Math.abs(y - yCap) > spacingPxH * 0.35) {
        extraHorizTicks.push(y)
        n++
      }
      y += spacingPxH
    }
  }
  return (
    <g pointerEvents="none" fontFamily={MONO}>
      <line x1={mx} y1={yCap} x2={mx} y2={yStemEnd} stroke={stroke} strokeWidth={0.7} strokeLinecap="butt" />
      <line
        x1={mx - capHalf}
        y1={yCap}
        x2={mx + capHalf}
        y2={yCap}
        stroke={stroke}
        strokeWidth={capStroke}
        strokeLinecap="square"
      />
      {extraHorizTicks.map((yy, i) => (
        <line
          key={i}
          x1={mx - capHalf * 0.55}
          y1={yy}
          x2={mx + capHalf * 0.55}
          y2={yy}
          stroke={stroke}
          strokeWidth={capStroke * 0.85}
          strokeLinecap="square"
        />
      ))}
      {fastenerMode === 'full' ? (
        <FastenerDescriptionBlock lines={horizLines} boxX={boxX} boxY={boxY} maxWidth={maxLabelW} />
      ) : null}
    </g>
  )
}

/** Module / control / element creases from CSV spacing fields and detail level. */
function LayerDetailCreases({
  layer,
  r,
  isWall,
  pxPerInch,
  detailLevel,
  buildingDimensions,
}: {
  layer: Layer
  r: LayerRect
  isWall: boolean
  pxPerInch: number
  detailLevel: DiagramDetailLevel
  buildingDimensions: BuildingDimensions
}) {
  const minPx = effectiveMinFeaturePx(layer, buildingDimensions)
  const maxMod = effectiveMaxModuleJoints(layer, buildingDimensions)
  const wantMod = effectiveDrawModuleJoints(layer, detailLevel)
  const wantCtrl = effectiveDrawControlJoints(layer, detailLevel)
  const modIn = parseThickness(layer.typModuleWidthIn ?? '')
  const ctrlFt = parseThickness(layer.controlJointSpacingFt ?? '')
  const elemIn = parseThickness(layer.elementSpacingOcIn ?? '')

  const lines: ReactNode[] = []
  let key = 0

  if (isWall) {
    if (r.w < minPx && r.h < minPx) return null
    if (wantMod && modIn > 0 && r.w >= minPx) {
      const step = modIn * pxPerInch
      if (step >= 3) {
        let x = r.x + step
        let n = 0
        while (x < r.x + r.w - 1 && n < maxMod) {
          lines.push(
            <line
              key={key++}
              x1={x}
              y1={r.y}
              x2={x}
              y2={r.y + r.h}
              stroke="#5c5c5c"
              strokeWidth={0.45}
            />,
          )
          x += step
          n++
        }
      }
    }
    if (wantCtrl && ctrlFt > 0 && r.h >= minPx) {
      const step = ctrlFt * 12 * pxPerInch
      if (step >= 4) {
        let y = r.y + step
        while (y < r.y + r.h - 1) {
          lines.push(
            <line
              key={key++}
              x1={r.x}
              y1={y}
              x2={r.x + r.w}
              y2={y}
              stroke="#777"
              strokeWidth={0.4}
              strokeDasharray="4 3"
            />,
          )
          y += step
        }
      }
    }
    if (detailLevel >= 3 && elemIn > 0 && r.h >= minPx) {
      const step = elemIn * pxPerInch
      if (step >= 4) {
        let y = r.y + step
        let n = 0
        const maxElem = maxMod * 2
        while (y < r.y + r.h - 1 && n < maxElem) {
          lines.push(
            <line
              key={key++}
              x1={r.x}
              y1={y}
              x2={r.x + r.w}
              y2={y}
              stroke="#999"
              strokeWidth={0.32}
            />,
          )
          y += step
          n++
        }
      }
    }
  } else {
    if (r.w < minPx && r.h < minPx) return null
    if (wantMod && modIn > 0 && r.h >= minPx) {
      const step = modIn * pxPerInch
      if (step >= 3) {
        let y = r.y + step
        let n = 0
        while (y < r.y + r.h - 1 && n < maxMod) {
          lines.push(
            <line
              key={key++}
              x1={r.x}
              y1={y}
              x2={r.x + r.w}
              y2={y}
              stroke="#5c5c5c"
              strokeWidth={0.45}
            />,
          )
          y += step
          n++
        }
      }
    }
    if (wantCtrl && ctrlFt > 0 && r.w >= minPx) {
      const step = ctrlFt * 12 * pxPerInch
      if (step >= 4) {
        let x = r.x + step
        while (x < r.x + r.w - 1) {
          lines.push(
            <line
              key={key++}
              x1={x}
              y1={r.y}
              x2={x}
              y2={r.y + r.h}
              stroke="#777"
              strokeWidth={0.4}
              strokeDasharray="4 3"
            />,
          )
          x += step
        }
      }
    }
    if (detailLevel >= 3 && elemIn > 0 && r.w >= minPx) {
      const step = elemIn * pxPerInch
      if (step >= 4) {
        let x = r.x + step
        let n = 0
        const maxElem = maxMod * 2
        while (x < r.x + r.w - 1 && n < maxElem) {
          lines.push(
            <line
              key={key++}
              x1={x}
              y1={r.y}
              x2={x}
              y2={r.y + r.h}
              stroke="#999"
              strokeWidth={0.32}
            />,
          )
          x += step
          n++
        }
      }
    }
  }

  if (lines.length === 0) return null
  return <g pointerEvents="none">{lines}</g>
}

/** Offset of cut indicator lines from section edge (same for wall and floor/roof sections) */
const CUT_LINE_OFFSET = 10

// ─── Layer marker (WALL only) ─────────────────────────────────────────────────
function WallMarker({
  rect, label, markerY, layerIndex, isHovered, onHover,
}: {
  rect: LayerRect
  label: number
  markerY: number
  layerIndex: number
  isHovered: boolean
  onHover: (index: number | null) => void
}) {
  const cx = rect.x + rect.w / 2
  return (
    <g
      onMouseEnter={() => onHover(layerIndex)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: 'pointer' }}
    >
      <line x1={cx} y1={WALL_CUT_Y} x2={cx} y2={markerY + 10}
            stroke={isHovered ? '#2563eb' : 'black'} strokeWidth={isHovered ? 1 : 0.6} />
      <rect x={cx - 8} y={markerY - 8} width={16} height={16}
            fill={isHovered ? '#2563eb' : 'black'} />
      <text x={cx} y={markerY + 4.5}
            fontSize="8.5" textAnchor="middle" fill="white" fontWeight="bold"
            fontFamily={MONO}>
        {label}
      </text>
    </g>
  )
}

// ─── Layer marker (FLOOR/ROOF/SLAB — vertical section, right side) ────────────
function HorizMarker({
  rect, label, markerX, layerIndex, isHovered, onHover,
}: {
  rect: LayerRect
  label: number
  markerX: number
  layerIndex: number
  isHovered: boolean
  onHover: (index: number | null) => void
}) {
  const cy = rect.y + rect.h / 2
  return (
    <g
      onMouseEnter={() => onHover(layerIndex)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: 'pointer' }}
    >
      <line x1={rect.x + rect.w} y1={cy} x2={markerX - 10} y2={cy}
            stroke={isHovered ? '#2563eb' : 'black'} strokeWidth={isHovered ? 1 : 0.6} />
      <rect x={markerX - 8} y={cy - 8} width={16} height={16}
            fill={isHovered ? '#2563eb' : 'black'} />
      <text x={markerX} y={cy + 4.5}
            fontSize="8.5" textAnchor="middle" fill="white" fontWeight="bold"
            fontFamily={MONO}>
        {label}
      </text>
    </g>
  )
}

/** Split text into lines of ~maxLen chars, breaking at spaces when possible */
function wrapText(text: string, maxLen: number): string[] {
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
function fastenerCharsPerLine(maxLabelPx: number, fontSize: number, pad: number): number {
  const inner = Math.max(24, maxLabelPx - pad * 2)
  return Math.max(5, Math.floor(inner / (fontSize * 0.58)))
}

type CalloutLayoutMetrics = ReturnType<typeof getCalloutContentMetrics>

/** Shared layout for one legend row: capped lines + bubble height (must match CalloutItem). */
function getCalloutContentMetrics(layer: Layer, matMaxLines: number) {
  const nameLineHeight = 11
  const matLineHeight = 10
  const fastenerLineHeight = 9
  const nameLines = wrapText(layer.name.toUpperCase(), 50).slice(0, CALLOUT_NAME_MAX)
  const matWrapped = wrapText(layer.material, 60)
  let matLines = matWrapped.slice(0, matMaxLines)
  if (matWrapped.length > matMaxLines && matLines.length > 0) {
    const i = matLines.length - 1
    const line = matLines[i]
    matLines = [...matLines.slice(0, i), (line.length > 52 ? `${line.slice(0, 52)}…` : `${line}…`)]
  }
  const thk = layer.thickness === '—' ? '—' : layer.thickness + ' IN'
  const iconId = resolveFastenerIcon(layer)
  const fastenerSummary = [layer.fastener, layer.fastenerSize].filter(s => s && String(s).trim() && String(s).trim() !== '—').join(' · ')
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

function stackCalloutYs(
  layers: Layer[],
  yStart: number,
  maxBottom: number,
): { ys: number[]; metrics: CalloutLayoutMetrics[] } {
  const tryStack = (matMax: number) => {
    const metrics = layers.map(l => getCalloutContentMetrics(l, matMax))
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
    const mlist = layers.map(l => getCalloutContentMetrics(l, CALLOUT_MAT_MAX_COMPACT))
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

// ─── Single callout item ──────────────────────────────────────────────────────
function CalloutItem({
  layer, drawIndex, calloutY, layerIndex, isHovered, onHover, onClick, metrics: mIn,
}: {
  layer: Layer
  drawIndex: number
  calloutY: number
  layerIndex: number
  isHovered: boolean
  onHover: (index: number | null) => void
  onClick?: () => void
  metrics: CalloutLayoutMetrics
}) {
  const REF = 100
  const deltaY = calloutY - REF
  const nameLines = mIn.nameLines
  const matLines = mIn.matLines
  const matStartY = mIn._refMatStartY + deltaY
  const thkLineY = mIn._refThkY + deltaY
  const textStartY = mIn._refTextY + deltaY
  const nameLineHeight = mIn.nameLineHeight
  const matLineHeight = mIn.matLineHeight
  const fastenerLineHeight = mIn.fastenerLineHeight
  const thk = mIn.thk
  const fastenerLines = mIn.fastenerLines
  const showFastenerRow = mIn.showFastenerRow
  const bubbleH = mIn.bubbleH

  const fastenerFull = [layer.fastener, layer.fastenerSize].filter(s => s && String(s).trim() && String(s).trim() !== '—').join(' · ')
  const svgTitle = [
    layer.name,
    '',
    layer.material,
    ...(fastenerFull ? ['', `FASTENER: ${fastenerFull}`] : []),
    ...(onClick ? ['', 'Click to edit in data table'] : []),
  ].join('\n')

  return (
    <g
      fontFamily={MONO}
      onMouseEnter={() => onHover(layerIndex)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <title>{svgTitle}</title>
      {/* Hit area for easier hover */}
      <rect
        x={CALLOUT_BUBBLE_X - 12}
        y={calloutY - 14}
        width={SHEET_W - CALLOUT_BUBBLE_X - 20}
        height={bubbleH}
        fill={isHovered ? 'rgba(37,99,235,0.08)' : 'transparent'}
        stroke="none"
      />
      {/* Black square badge */}
      <rect x={CALLOUT_BUBBLE_X - 10} y={calloutY - 10} width={20} height={20} fill={isHovered ? '#2563eb' : 'black'} />
      <text x={CALLOUT_BUBBLE_X} y={calloutY + 4.5}
            fontSize="8.5" textAnchor="middle" fill="white" fontWeight="bold">
        {drawIndex}
      </text>

      {/* Layer name (full text, wrapped) */}
      <text x={CALLOUT_TEXT_X} y={calloutY - 3}
            fontSize="9" fontWeight="bold" fill={isHovered ? '#2563eb' : 'black'} letterSpacing="0.4">
        {nameLines.map((line, i) => (
          <tspan key={i} x={CALLOUT_TEXT_X} dy={i === 0 ? 0 : nameLineHeight}>
            {line}
          </tspan>
        ))}
      </text>

      {/* Material description (full text, wrapped) */}
      <text x={CALLOUT_TEXT_X} y={matStartY}
            fontSize="7.5" fill="#333">
        {matLines.map((line, i) => (
          <tspan key={i} x={CALLOUT_TEXT_X} dy={i === 0 ? 0 : matLineHeight}>
            {line}
          </tspan>
        ))}
      </text>

      {/* THK + R-Value */}
      <text x={CALLOUT_TEXT_X} y={thkLineY}
            fontSize="7.5" fill="#666" letterSpacing="0.3">
        {`THK: ${thk}   R: ${layer.rValue}`}
      </text>

      {showFastenerRow && (
        <text x={CALLOUT_TEXT_X} y={textStartY} fontSize="7" fill="#444">
          {fastenerLines.map((line, i) => (
            <tspan key={i} x={CALLOUT_TEXT_X} dy={i === 0 ? 0 : fastenerLineHeight}>
              {i === 0 ? `Fastener: ${line}` : line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  )
}

// Leader line endpoint (reference: 862.96, just before callout bubble)
const LEADER_END_X = DIVIDER_X + 4

// ─── Leader line from section → callout bubble ───────────────────────────────
function Leader({
  startX, startY, calloutY, isWall: _isWall, isHovered,
}: { startX: number; startY: number; calloutY: number; isWall: boolean; isHovered?: boolean }) {
  const stroke = isHovered ? '#2563eb' : '#888'
  const strokeWidth = isHovered ? 0.8 : 0.45
  return (
    <line
      x1={startX} y1={startY}
      x2={LEADER_END_X} y2={calloutY}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray="3,2"
    />
  )
}

/** Draw a cut indicator line with zigzag/lightning bolt in the middle (architectural convention).
 *  First zig is perpendicular to the main line; diagonal crosses axis; second zag returns to axis. */
function CutIndicatorLine({
  x1, y1, x2, y2, horizontal,
}: { x1: number; y1: number; x2: number; y2: number; horizontal: boolean }) {
  const h = 4   // half-extent of zigzag along main axis (smaller = longer ends)
  const w = 6   // perpendicular offset (smaller zigzag)
  const mid = horizontal ? (x1 + x2) / 2 : (y1 + y2) / 2
  const d = horizontal
    ? `M ${x1} ${y1} L ${mid - h} ${y1} L ${mid - h} ${y1 - w} L ${mid + h} ${y1 + w} L ${mid + h} ${y1} L ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x1} ${mid - h} L ${x1 - w} ${mid - h} L ${x1 + w} ${mid + h} L ${x1} ${mid + h} L ${x2} ${y2}`
  return <path d={d} fill="none" stroke="#999" strokeWidth="0.6" strokeLinecap="square" strokeLinejoin="miter" />
}

// ─── Section cut annotation ───────────────────────────────────────────────────
function CutIndicator({
  isWall, layerRects, topLabel, bottomLabel,
}: {
  isWall: boolean
  layerRects: LayerRect[]
  topLabel: string
  bottomLabel: string
}) {
  if (isWall && layerRects.length > 0) {
    const leftRect = layerRects[0]
    const rightRect = layerRects[layerRects.length - 1]
    const endExtend = 24
    const cutLeft = leftRect.x - 12 - endExtend
    const cutRight = rightRect.x + rightRect.w + 12 + endExtend
    const cutTop = WALL_CUT_Y - CUT_LINE_OFFSET
    const cutBottom = WALL_CUT_Y + WALL_CUT_H + CUT_LINE_OFFSET
    return (
      <g fontFamily={MONO}>
        {/* Cut plane with zigzag top (offset above section) */}
        <CutIndicatorLine x1={cutLeft} y1={cutTop} x2={cutRight} y2={cutTop} horizontal />
        {/* Cut plane with zigzag bottom (offset below section) */}
        <CutIndicatorLine x1={cutLeft} y1={cutBottom} x2={cutRight} y2={cutBottom} horizontal />
        {/* Direction labels — outside section, vertically centered, no overlap with hatch */}
        <text x={cutLeft - 10} y={WALL_CUT_Y + WALL_CUT_H / 2}
              fontSize="8" fontWeight="bold" letterSpacing="2" fill="black"
              textAnchor="end" dominantBaseline="middle">
          ← EXTERIOR
        </text>
        <text x={cutRight + 10} y={WALL_CUT_Y + WALL_CUT_H / 2}
              fontSize="8" fontWeight="bold" letterSpacing="2" fill="black"
              textAnchor="start" dominantBaseline="middle">
          INTERIOR →
        </text>
      </g>
    )
  }

  if (layerRects.length === 0) return null
  const topRect = layerRects[0]
  const botRect = layerRects[layerRects.length - 1]
  const endExtend = 24
  const sectionLeft = topRect.x - CUT_LINE_OFFSET
  const sectionRight = topRect.x + topRect.w + CUT_LINE_OFFSET
  const sectionTop = topRect.y - endExtend
  const sectionBot = botRect.y + botRect.h + endExtend

  return (
    <g fontFamily={MONO}>
      {/* Cut plane with zigzag left */}
      <CutIndicatorLine x1={sectionLeft} y1={sectionTop} x2={sectionLeft} y2={sectionBot} horizontal={false} />
      {/* Cut plane with zigzag right */}
      <CutIndicatorLine x1={sectionRight} y1={sectionTop} x2={sectionRight} y2={sectionBot} horizontal={false} />
      {/* Top label */}
      {topLabel && (
        <text x={topRect.x} y={sectionTop - 16}
              fontSize="8" fontWeight="bold" letterSpacing="1.5" fill="black">
          {topLabel}
        </text>
      )}
      {/* Bottom label */}
      {bottomLabel && (
        <text x={topRect.x} y={sectionBot + 20}
              fontSize="8" fontWeight="bold" letterSpacing="1.5" fill="black">
          {bottomLabel}
        </text>
      )}
    </g>
  )
}

// ─── Dimension Lines ──────────────────────────────────────────────────────────
// Architectural chain dimensions: one tick per layer boundary + overall span dim.

const CHAIN_OFFSET = 38   // px away from section edge
const OVERALL_OFFSET = 66 // px away from section edge

function DimensionLines({
  layerRects,
  drawLayers,
  isWall,
  totalThickness,
  detailLevel,
}: {
  layerRects: LayerRect[]
  drawLayers: Layer[]
  isWall: boolean
  totalThickness: string
  detailLevel: DiagramDetailLevel
}) {
  if (layerRects.length === 0) return null

  const fmtThk = (raw: string) =>
    !raw || raw === '—' || raw.toLowerCase() === 'varies' ? raw : `${raw}"`

  if (isWall) {
    const sectionBot = WALL_CUT_Y + WALL_CUT_H
    const chainY = sectionBot + CHAIN_OFFSET
    const overallY = sectionBot + OVERALL_OFFSET

    // All vertical tick X positions: left edge of each layer + rightmost right edge
    const tickXs = [
      ...layerRects.map(r => r.x),
      layerRects[layerRects.length - 1].x + layerRects[layerRects.length - 1].w,
    ]
    const sectionLeft = tickXs[0]
    const sectionRight = tickXs[tickXs.length - 1]

    return (
      <g fontFamily={MONO}>
        {/* Extension lines: section bottom → chain dim */}
        {tickXs.map((x, i) => (
          <line key={i} x1={x} y1={sectionBot + 2} x2={x} y2={chainY - 2}
                stroke="#ccc" strokeWidth="0.35" />
        ))}

        {/* Chain dimension line */}
        <line x1={sectionLeft} y1={chainY} x2={sectionRight} y2={chainY}
              stroke="black" strokeWidth="0.55" />

        {/* 45° tick marks at each layer boundary */}
        {tickXs.map((x, i) => (
          <line key={i} x1={x - 2.5} y1={chainY - 2.5} x2={x + 2.5} y2={chainY + 2.5}
                stroke="black" strokeWidth="0.9" />
        ))}

        {/* Layer thickness labels */}
        {layerRects.map((rect, i) => {
          const midX = rect.x + rect.w / 2
          const thk = fmtThk(drawLayers[i].thickness)
          const isNarrow = rect.w < 20
          if (!isNarrow) {
            return (
              <text key={i} x={midX} y={chainY - 4}
                    fontSize="7" textAnchor="middle" fill="black">
                {thk}
              </text>
            )
          }
          if (detailLevel <= 0) return null
          // Narrow layer: jog leader below chain line, alternating left/right
          const side = i % 2 === 0 ? 1 : -1
          const jogX = midX + side * 18
          return (
            <g key={i}>
              <line x1={midX} y1={chainY + 2} x2={midX} y2={chainY + 8}
                    stroke="#888" strokeWidth="0.4" />
              <line x1={midX} y1={chainY + 8} x2={jogX} y2={chainY + 8}
                    stroke="#888" strokeWidth="0.4" />
              <text x={jogX + side * 2} y={chainY + 12}
                    fontSize="6" fill="#444" textAnchor={side > 0 ? 'start' : 'end'}>
                {thk}
              </text>
            </g>
          )
        })}

        {/* Extension lines: chain → overall */}
        <line x1={sectionLeft} y1={chainY + 2} x2={sectionLeft} y2={overallY - 2}
              stroke="#ccc" strokeWidth="0.35" />
        <line x1={sectionRight} y1={chainY + 2} x2={sectionRight} y2={overallY - 2}
              stroke="#ccc" strokeWidth="0.35" />

        {/* Overall dimension line */}
        <line x1={sectionLeft} y1={overallY} x2={sectionRight} y2={overallY}
              stroke="black" strokeWidth="0.8" />

        {/* Overall end ticks (heavier) */}
        <line x1={sectionLeft - 3.5} y1={overallY - 3.5}
              x2={sectionLeft + 3.5} y2={overallY + 3.5}
              stroke="black" strokeWidth="1.3" />
        <line x1={sectionRight - 3.5} y1={overallY - 3.5}
              x2={sectionRight + 3.5} y2={overallY + 3.5}
              stroke="black" strokeWidth="1.3" />

        {/* Overall label */}
        <text x={(sectionLeft + sectionRight) / 2} y={overallY - 5}
              fontSize="8" textAnchor="middle" fontWeight="bold" fill="black" letterSpacing="0.5">
          {`TOTAL ASSEMBLY: ${totalThickness} IN`}
        </text>
      </g>
    )
  }

  // ── HORIZ section (FLOOR / ROOF / SLAB / SPECIAL) ────────────────────────
  const topRect = layerRects[0]
  const botRect = layerRects[layerRects.length - 1]
  const sectionTop = topRect.y
  const sectionBot = botRect.y + botRect.h
  const chainX = HORIZ_CUT_X - CHAIN_OFFSET
  const overallX = HORIZ_CUT_X - OVERALL_OFFSET

  // Horizontal tick Y positions
  const tickYs = [
    ...layerRects.map(r => r.y),
    botRect.y + botRect.h,
  ]

  return (
    <g fontFamily={MONO}>
      {/* Extension lines: section left → chain dim */}
      {tickYs.map((y, i) => (
        <line key={i} x1={HORIZ_CUT_X - 2} y1={y} x2={chainX + 2} y2={y}
              stroke="#ccc" strokeWidth="0.35" />
      ))}

      {/* Chain dimension line (vertical) */}
      <line x1={chainX} y1={sectionTop} x2={chainX} y2={sectionBot}
            stroke="black" strokeWidth="0.55" />

      {/* 45° tick marks at each layer boundary */}
      {tickYs.map((y, i) => (
        <line key={i} x1={chainX - 2.5} y1={y - 2.5} x2={chainX + 2.5} y2={y + 2.5}
              stroke="black" strokeWidth="0.9" />
      ))}

      {/* Layer thickness labels */}
      {layerRects.map((rect, i) => {
        const midY = rect.y + rect.h / 2
        const thk = fmtThk(drawLayers[i].thickness)
        const isShort = rect.h < 18
        if (!isShort) {
          return (
            <text key={i} x={chainX - 5} y={midY + 2.5}
                  fontSize="7" textAnchor="end" fill="black">
              {thk}
            </text>
          )
        }
        if (detailLevel <= 0) return null
        // Short layer: jog leader to the left, alternating above/below midpoint
        const side = i % 2 === 0 ? -8 : 8
        const jogY = midY + side
        return (
          <g key={i}>
            <line x1={chainX - 2} y1={midY} x2={chainX - 10} y2={midY}
                  stroke="#888" strokeWidth="0.4" />
            <line x1={chainX - 10} y1={midY} x2={chainX - 10} y2={jogY}
                  stroke="#888" strokeWidth="0.4" />
            <text x={chainX - 12} y={jogY + 2.5} fontSize="6" textAnchor="end" fill="#444">
              {thk}
            </text>
          </g>
        )
      })}

      {/* Extension lines: chain → overall */}
      <line x1={chainX - 2} y1={sectionTop} x2={overallX + 2} y2={sectionTop}
            stroke="#ccc" strokeWidth="0.35" />
      <line x1={chainX - 2} y1={sectionBot} x2={overallX + 2} y2={sectionBot}
            stroke="#ccc" strokeWidth="0.35" />

      {/* Overall dimension line */}
      <line x1={overallX} y1={sectionTop} x2={overallX} y2={sectionBot}
            stroke="black" strokeWidth="0.8" />

      {/* Overall end ticks */}
      <line x1={overallX - 3.5} y1={sectionTop - 3.5}
            x2={overallX + 3.5} y2={sectionTop + 3.5}
            stroke="black" strokeWidth="1.3" />
      <line x1={overallX - 3.5} y1={sectionBot - 3.5}
            x2={overallX + 3.5} y2={sectionBot + 3.5}
            stroke="black" strokeWidth="1.3" />

      {/* Overall label (rotated -90°) */}
      {(() => {
        const midY = (sectionTop + sectionBot) / 2
        const lx = overallX - 7
        return (
          <text x={lx} y={midY}
                fontSize="8" textAnchor="middle" fontWeight="bold" fill="black"
                letterSpacing="0.5"
                transform={`rotate(-90, ${lx}, ${midY})`}>
            {`TOTAL: ${totalThickness} IN`}
          </text>
        )
      })()}
    </g>
  )
}

// ─── Layer legend at the bottom of the panel ─────────────────────────────────
const LAYER_TYPE_LABELS: Record<string, string> = {
  CLT: 'CLT PANEL', WOOD: 'WOOD / TIMBER', INSULATION: 'INSULATION',
  MEMBRANE: 'MEMBRANE / WRB', METAL: 'METAL', CONCRETE: 'CONCRETE',
  AIR_GAP: 'AIR GAP / CAVITY', GLASS: 'GLAZING', GRAVEL_SOIL: 'AGGREGATE / SOIL',
  MISC: 'SEALANT / MISC',
}

// ─── Main Component ───────────────────────────────────────────────────────────
function fallbackBuildingDimensions(): BuildingDimensions {
  return {
    footprintWidth: 360,
    footprintDepth: 480,
    floorToFloor: 132,
    voidClearWidth: 53,
    stairWidth: 48,
    sectionScale: 1.4,
    planScale: 1.2,
    thicknessBySystem: {},
    layoutRefs: { ...DEFAULT_LAYOUT_REFS },
    systemIdPrefix: 'A4-',
    defaultDiagramDetailLevel: DIAGRAM_DETAIL_DEFAULTS.defaultLevel,
    detailMaxModuleJoints: DIAGRAM_DETAIL_DEFAULTS.detailMaxModuleJoints,
    detailMinFeaturePx: DIAGRAM_DETAIL_DEFAULTS.detailMinFeaturePx,
    shopMaxFastenerMarksPerLayer: DIAGRAM_DETAIL_DEFAULTS.shopMaxFastenerMarksPerLayer,
  }
}

interface SectionDrawingProps {
  system: SystemData
  systemIndex: number
  buildingDimensions?: BuildingDimensions
  svgRef?: RefObject<SVGSVGElement>
  onOpenBulkEditWithLayer?: (systemId: string, layerIndex: number) => void
}

export function SectionDrawing({
  system,
  systemIndex,
  buildingDimensions: buildingDimensionsProp,
  svgRef,
  onOpenBulkEditWithLayer,
}: SectionDrawingProps) {
  const [hoveredLayerIndex, setHoveredLayerIndex] = useState<number | null>(null)
  const buildingDimensions = buildingDimensionsProp ?? fallbackBuildingDimensions()
  const detailLevel = effectiveDetailLevel(system, buildingDimensions)
  const config = getSystemOrientation(system)
  const isWall = config.orientation === 'WALL'

  // Filter to visible layers only, optionally reverse order
  const visibleIndices = system.layers
    .map((l, i) => (l.visible !== false ? i : -1))
    .filter(i => i >= 0)
  const orderedIndices = config.reverse ? [...visibleIndices].reverse() : visibleIndices
  const visibleLayers = orderedIndices.map(i => system.layers[i])
  const drawLayers: Layer[] = visibleLayers

  const n = drawLayers.length

  // ── Layer sizes (pixels) — drawn to scale: 3" = 1'-0" (24 px/in) ──
  const totalInches = drawLayers.reduce((a, l) => a + parseThickness(l.thickness), 0)
  const maxPx = isWall ? WALL_CUT_W : HORIZ_CUT_MAX_H
  const pxPerInch = totalInches > 0 && totalInches * DETAIL_SCALE_PX_PER_IN > maxPx
    ? maxPx / totalInches
    : DETAIL_SCALE_PX_PER_IN
  const layerSizes = computeLayerSizesToScale(drawLayers, pxPerInch)

  // Scale label: 3"=1'-0" at 24 px/in; when scaled down, show equivalent
  const scaleLabel = pxPerInch >= 23.5
    ? '3" = 1\'-0"'
    : `${(12 / pxPerInch).toFixed(1)}" = 1\'-0"`

  // ── Layer rectangles (centered in available space) ──
  let layerRects: LayerRect[]
  if (isWall) {
    const totalW = layerSizes.reduce((a, b) => a + b, 0)
    const sectionX = WALL_CUT_X + Math.max(0, (WALL_CUT_W - totalW) / 2)
    layerRects = buildWallRects(layerSizes, sectionX, WALL_CUT_Y, WALL_CUT_H)
  } else {
    const totalH = layerSizes.reduce((a, b) => a + b, 0)
    const topY = HORIZ_CUT_Y_START + Math.max(0, (HORIZ_CUT_MAX_H - totalH) / 2)
    layerRects = buildHorizRects(layerSizes, HORIZ_CUT_X, topY, HORIZ_CUT_W)
  }

  // ── Callout Y positions: stack by real block height (fixed spacing overlapped long legends) ──
  const { ys: calloutYs, metrics: calloutMetrics } = stackCalloutYs(drawLayers, CALLOUT_Y_START, TB_Y - 20)

  // ── WALL: compute staggered marker heights above section ──
  const markerYs: number[] = []
  if (isWall) {
    const BASE_Y = WALL_CUT_Y - 22
    const ALT_Y = WALL_CUT_Y - 42
    let prevMidX = -99
    for (let i = 0; i < n; i++) {
      const midX = layerRects[i].x + layerRects[i].w / 2
      const useAlt = Math.abs(midX - prevMidX) < 22
      markerYs.push(useAlt ? ALT_Y : BASE_Y)
      prevMidX = midX
    }
  }

  // ── FLOOR/ROOF/SLAB: compute staggered marker X positions to right of section ──
  const markerXs: number[] = []
  if (!isWall) {
    const BASE_X = HORIZ_CUT_X + HORIZ_CUT_W + 26
    const ALT_X = HORIZ_CUT_X + HORIZ_CUT_W + 46
    let prevMidY = -99
    for (let i = 0; i < n; i++) {
      const midY = layerRects[i].y + layerRects[i].h / 2
      const useAlt = Math.abs(midY - prevMidY) < 22
      markerXs.push(useAlt ? ALT_X : BASE_X)
      prevMidY = midY
    }
  }

  // ── Collect unique fill IDs for legend (fill override or layerType fallback) ──
  const usedTypes = [...new Set(drawLayers.map(l => l.fill || l.layerType))]

  return (
    <svg
      ref={svgRef}
      width={SHEET_W}
      height={SHEET_H}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={MONO}
    >
      <HatchDefs />

      {/* White background */}
      <rect width={SHEET_W} height={SHEET_H} fill="white" />

      {/* Drawing panel border (matches reference rect 28,28,810.96,764) */}
      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H}
            fill="none" stroke="black" strokeWidth="0.5" />

      {/* Vertical divider: drawing | legend */}
      <line x1={DIVIDER_X} y1={PANEL_Y}
            x2={DIVIDER_X} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />

      {/* Horizontal divider: legend | title block */}
      <line x1={DIVIDER_X} y1={TB_Y}
            x2={TB_X + TB_W} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />

      {/* ── System heading inside panel (reference: 44.55, 46) ── */}
      <text x={45} y={46}
            fontSize="9" fontWeight="bold" letterSpacing="3" fill="black">
        {system.id} — {system.name.toUpperCase()}
      </text>
      <line x1={PANEL_X} y1={52} x2={PANEL_X + PANEL_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* ── Cut plane indicators ── */}
      <CutIndicator
        isWall={isWall}
        layerRects={layerRects}
        topLabel={config.topLabel}
        bottomLabel={config.bottomLabel}
      />

      {/* ── Layer rectangles (hatched) — drawn BEFORE leaders so fill covers lines ── */}
      {drawLayers.map((layer, i) => {
        const r = layerRects[i]
        const isAirGap = layer.layerType === 'AIR_GAP'
        const fillId = layer.fill || layer.layerType
        const isHovered = hoveredLayerIndex === i
        const fastenerIconId = resolveFastenerIcon(layer)
        const fastenerTip = [layer.fastener, layer.fastenerSize].filter(s => s && String(s).trim() && String(s).trim() !== '—').join(' · ')
        return (
          <g key={i}>
            <rect
              x={r.x} y={r.y} width={r.w} height={r.h}
              fill={`url(#p-${fillId})`}
              stroke="black"
              strokeWidth={isAirGap ? 0.8 : 0.9}
              strokeDasharray={isAirGap ? '5,3' : undefined}
            />
            <LayerDetailCreases
              layer={layer}
              r={r}
              isWall={isWall}
              pxPerInch={pxPerInch}
              detailLevel={detailLevel}
              buildingDimensions={buildingDimensions}
            />
            <LayerFastenerSpanOnDrawing
              layer={layer}
              r={r}
              isWall={isWall}
              pxPerInch={pxPerInch}
              fastenerMode={effectiveFastenerMode(layer, detailLevel)}
              detailLevel={detailLevel}
              buildingDimensions={buildingDimensions}
            />
            {/* Hit area for hover — blue outline only, no fill change */}
            <rect
              x={r.x} y={r.y} width={r.w} height={r.h}
              fill="transparent"
              stroke={isHovered ? '#2563eb' : 'none'}
              strokeWidth={isHovered ? 2 : 0}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredLayerIndex(i)}
              onMouseLeave={() => setHoveredLayerIndex(null)}
            >
              <title>
                {[
                  `${i + 1}. ${layer.name}`,
                  fastenerIconId !== 'none' ? `${FASTENER_ICON_LABELS[fastenerIconId]}${fastenerTip ? `: ${fastenerTip}` : ''}` : null,
                  onOpenBulkEditWithLayer ? 'Click to edit in data table' : null,
                ].filter(Boolean).join('\n')}
              </title>
            </rect>
          </g>
        )
      })}

      {/* ── WALL: layer boundary lines (thicker at joints) ── */}
      {isWall && layerRects.slice(0, -1).map((r, i) => (
        <line key={i}
              x1={r.x + r.w} y1={WALL_CUT_Y}
              x2={r.x + r.w} y2={WALL_CUT_Y + WALL_CUT_H}
              stroke="black" strokeWidth="1" />
      ))}

      {/* ── WALL: numbered markers above section ── */}
      {isWall && drawLayers.map((_, i) => (
        <WallMarker
          key={i}
          rect={layerRects[i]}
          label={i + 1}
          markerY={markerYs[i]}
          layerIndex={i}
          isHovered={hoveredLayerIndex === i}
          onHover={setHoveredLayerIndex}
        />
      ))}

      {/* ── FLOOR/ROOF/SLAB: numbered markers to left of section ── */}
      {!isWall && drawLayers.map((_, i) => (
        <HorizMarker
          key={i}
          rect={layerRects[i]}
          label={i + 1}
          markerX={markerXs[i]}
          layerIndex={i}
          isHovered={hoveredLayerIndex === i}
          onHover={setHoveredLayerIndex}
        />
      ))}

      {/* ── Dimension lines ── */}
      <DimensionLines
        layerRects={layerRects}
        drawLayers={drawLayers}
        isWall={isWall}
        totalThickness={system.totalThickness}
        detailLevel={detailLevel}
      />

      {/* ── Leaders (drawn behind callout text) ── */}
      {drawLayers.map((_, i) => {
        const r = layerRects[i]
        const isHovered = hoveredLayerIndex === i
        if (isWall) {
          return (
            <Leader
              key={i}
              startX={r.x + r.w / 2}
              startY={WALL_CUT_Y}
              calloutY={calloutYs[i]}
              isWall
              isHovered={isHovered}
            />
          )
        } else {
          return (
            <Leader
              key={i}
              startX={HORIZ_CUT_X + HORIZ_CUT_W}
              startY={r.y + r.h / 2}
              calloutY={calloutYs[i]}
              isWall={false}
              isHovered={isHovered}
            />
          )
        }
      })}

      {/* ── Callout labels ── */}
      {drawLayers.map((layer, i) => (
        <CalloutItem
          key={i}
          layer={layer}
          drawIndex={i + 1}
          calloutY={calloutYs[i]}
          layerIndex={i}
          isHovered={hoveredLayerIndex === i}
          onHover={setHoveredLayerIndex}
          onClick={onOpenBulkEditWithLayer ? () => onOpenBulkEditWithLayer(system.id, orderedIndices[i]) : undefined}
          metrics={calloutMetrics[i]}
        />
      ))}

      {/* ── Legend strip at panel bottom ── */}
      <g>
        <line x1={PANEL_X} y1={PANEL_Y + PANEL_H - 32}
              x2={PANEL_X + PANEL_W} y2={PANEL_Y + PANEL_H - 32}
              stroke="black" strokeWidth="0.4" />
        {usedTypes.map((type, i) => {
          const lx = PANEL_X + 8 + i * 88
          if (lx + 82 > PANEL_X + PANEL_W) return null
          return (
            <g key={type}>
              <rect x={lx} y={PANEL_Y + PANEL_H - 25} width={12} height={12}
                    fill={`url(#p-${type})`} stroke="black" strokeWidth="0.6" />
              <text x={lx + 16} y={PANEL_Y + PANEL_H - 14}
                    fontSize="6.5" fill="#444" letterSpacing="0.3">
                {LAYER_TYPE_LABELS[type] ?? type}
              </text>
            </g>
          )
        })}
      </g>

      {/* ── Scale note (drawings are to scale) ── */}
      <text x={PANEL_X + 8} y={PANEL_Y + PANEL_H - 4}
            fontSize="7" fill="#888" letterSpacing="1">
        SCALE: {scaleLabel}
      </text>

      {/* ── Assembly legend header ── */}
      <text x={DIVIDER_X + 8} y={42}
            fontSize="7.5" fontWeight="bold" letterSpacing="2.5" fill="#555">
        ASSEMBLY LEGEND
      </text>
      <line x1={DIVIDER_X} y1={52}
            x2={TB_X + TB_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* ── Title block ── */}
      <TitleBlock
        x={TB_X} y={TB_Y} w={TB_W} h={TB_H}
        systemId={system.id}
        systemName={system.name}
        totalThickness={system.totalThickness}
        totalR={system.totalR}
        systemIndex={systemIndex}
        totalSystems={22}
        scaleLabel={scaleLabel}
        category={system.category}
      />
    </svg>
  )
}
