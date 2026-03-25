import type { ReactNode } from 'react'
import type { BuildingDimensions, DiagramDetailLevel, FastenerDrawMode, Layer } from '../../types/system'
import { FASTENER_ICON_LABELS, resolveFastenerIcon } from '../../lib/fastenerIcons'
import { parseThickness, type LayerRect } from '../../lib/geometry'
import {
  effectiveDrawControlJoints,
  effectiveDrawModuleJoints,
  effectiveMaxModuleJoints,
  effectiveMinFeaturePx,
  effectiveShopFastenerCap,
} from '../../lib/diagramDetail'
import {
  SHEET_W,
  DIVIDER_X,
  CALLOUT_BUBBLE_X,
  CALLOUT_TEXT_X,
  PANEL_Y,
  PANEL_H,
} from '../../data/sheetLayout'
import {
  MONO,
  FASTENER_LABEL_FS,
  FASTENER_LABEL_LH,
  FASTENER_LABEL_PAD,
  WALL_CUT_X,
  WALL_CUT_Y,
  WALL_CUT_H,
  HORIZ_CUT_X,
  HORIZ_CUT_W,
  CUT_LINE_OFFSET,
  LEADER_END_X,
  CHAIN_OFFSET,
  OVERALL_OFFSET,
} from './constants'
import {
  estimateLineWidthPx,
  fastenerCharsPerLine,
  fastenerSpanInsetsPx,
  inferHorizCapOnBottom,
  inferWallCapOnRight,
  inferWallFastenerMyFrac,
  wrapText,
} from './pure'
import type { CalloutLayoutMetrics } from './pure'

/** Full fastener description: horizontal lines, white backing for contrast on hatches. */
export function FastenerDescriptionBlock({
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
export function LayerFastenerSpanOnDrawing({
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

export function LayerDetailCreases({
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

export function WallMarker({
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
export function HorizMarker({
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

export function CalloutItem({
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

// ─── Leader line from section → callout bubble ───────────────────────────────
export function Leader({
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

export function CutIndicatorLine({
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
export function CutIndicator({
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

export function DimensionLines({
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

