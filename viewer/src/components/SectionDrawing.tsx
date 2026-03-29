import { useState } from 'react'
import type { RefObject } from 'react'
import type { BuildingDimensions, Layer, LayerType, SystemData } from '../types/system'
import { FASTENER_ICON_LABELS, resolveFastenerIcon } from '../lib/fastenerIcons'
import { fillForLayerType, resolveLayerDiagramFill } from '../lib/layerDiagramFill'
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
  effectiveFastenerMode,
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
  CALLOUT_Y_START,
  TB_X,
  TB_Y,
  TB_W,
  TB_H,
} from '../data/sheetLayout'
import {
  MONO,
  WALL_CUT_X,
  WALL_CUT_Y,
  WALL_CUT_W,
  WALL_CUT_H,
  HORIZ_CUT_X,
  HORIZ_CUT_W,
  HORIZ_CUT_Y_START,
  HORIZ_CUT_MAX_H,
  LAYER_TYPE_LABELS,
} from './sectionDrawing/constants'
import { stackCalloutYs } from './sectionDrawing/pure'
import {
  CalloutItem,
  CutIndicator,
  DimensionLines,
  HorizMarker,
  LayerDetailCreases,
  LayerFastenerSpanOnDrawing,
  Leader,
  WallMarker,
} from './sectionDrawing/subcomponents'

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

  const visibleIndices = system.layers
    .map((l, i) => (l.visible !== false ? i : -1))
    .filter((i) => i >= 0)
  const orderedIndices = config.reverse ? [...visibleIndices].reverse() : visibleIndices
  const visibleLayers = orderedIndices.map((i) => system.layers[i]!)
  const drawLayers: Layer[] = visibleLayers

  const n = drawLayers.length

  const totalInches = drawLayers.reduce((a, l) => a + parseThickness(l.thickness), 0)
  const maxPx = isWall ? WALL_CUT_W : HORIZ_CUT_MAX_H
  const pxPerInch =
    totalInches > 0 && totalInches * DETAIL_SCALE_PX_PER_IN > maxPx
      ? maxPx / totalInches
      : DETAIL_SCALE_PX_PER_IN
  const layerSizes = computeLayerSizesToScale(drawLayers, pxPerInch)

  const scaleLabel =
    pxPerInch >= 23.5 ? `3" = 1'-0"` : `${(12 / pxPerInch).toFixed(1)}" = 1'-0"`

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

  const { ys: calloutYs, metrics: calloutMetrics } = stackCalloutYs(drawLayers, CALLOUT_Y_START, TB_Y - 20)

  const markerYs: number[] = []
  if (isWall) {
    const BASE_Y = WALL_CUT_Y - 22
    const ALT_Y = WALL_CUT_Y - 42
    let prevMidX = -99
    for (let i = 0; i < n; i++) {
      const midX = layerRects[i]!.x + layerRects[i]!.w / 2
      const useAlt = Math.abs(midX - prevMidX) < 22
      markerYs.push(useAlt ? ALT_Y : BASE_Y)
      prevMidX = midX
    }
  }

  const markerXs: number[] = []
  if (!isWall) {
    const BASE_X = HORIZ_CUT_X + HORIZ_CUT_W + 26
    const ALT_X = HORIZ_CUT_X + HORIZ_CUT_W + 46
    let prevMidY = -99
    for (let i = 0; i < n; i++) {
      const midY = layerRects[i]!.y + layerRects[i]!.h / 2
      const useAlt = Math.abs(midY - prevMidY) < 22
      markerXs.push(useAlt ? ALT_X : BASE_X)
      prevMidY = midY
    }
  }

  const usedTypes = [...new Set(drawLayers.map((l) => l.layerType))]

  return (
    <svg
      ref={svgRef}
      width={SHEET_W}
      height={SHEET_H}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={MONO}
    >
      <rect width={SHEET_W} height={SHEET_H} fill="white" />

      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H} fill="none" stroke="black" strokeWidth="0.5" />

      <line x1={DIVIDER_X} y1={PANEL_Y} x2={DIVIDER_X} y2={TB_Y} stroke="black" strokeWidth="0.5" />

      <line x1={DIVIDER_X} y1={TB_Y} x2={TB_X + TB_W} y2={TB_Y} stroke="black" strokeWidth="0.5" />

      <text x={45} y={46} fontSize="9" fontWeight="bold" letterSpacing="3" fill="black">
        {system.id} — {system.name.toUpperCase()}
      </text>
      <line x1={PANEL_X} y1={52} x2={PANEL_X + PANEL_W} y2={52} stroke="black" strokeWidth="0.4" />

      <CutIndicator
        isWall={isWall}
        layerRects={layerRects}
        topLabel={config.topLabel}
        bottomLabel={config.bottomLabel}
      />

      {drawLayers.map((layer, i) => {
        const r = layerRects[i]!
        const isAirGap = layer.layerType === 'AIR_GAP'
        const isHovered = hoveredLayerIndex === i
        const fastenerIconId = resolveFastenerIcon(layer)
        const fastenerTip = [layer.fastener, layer.fastenerSize]
          .filter((s) => s && String(s).trim() && String(s).trim() !== '—')
          .join(' · ')
        return (
          <g key={i}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              fill={resolveLayerDiagramFill(layer)}
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
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
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
                  fastenerIconId !== 'none'
                    ? `${FASTENER_ICON_LABELS[fastenerIconId]}${fastenerTip ? `: ${fastenerTip}` : ''}`
                    : null,
                  onOpenBulkEditWithLayer ? 'Click to edit in data table' : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </title>
            </rect>
          </g>
        )
      })}

      {isWall &&
        layerRects.slice(0, -1).map((r, i) => (
          <line
            key={i}
            x1={r.x + r.w}
            y1={WALL_CUT_Y}
            x2={r.x + r.w}
            y2={WALL_CUT_Y + WALL_CUT_H}
            stroke="black"
            strokeWidth="1"
          />
        ))}

      {isWall &&
        drawLayers.map((_, i) => (
          <WallMarker
            key={i}
            rect={layerRects[i]!}
            label={i + 1}
            markerY={markerYs[i]!}
            layerIndex={i}
            isHovered={hoveredLayerIndex === i}
            onHover={setHoveredLayerIndex}
          />
        ))}

      {!isWall &&
        drawLayers.map((_, i) => (
          <HorizMarker
            key={i}
            rect={layerRects[i]!}
            label={i + 1}
            markerX={markerXs[i]!}
            layerIndex={i}
            isHovered={hoveredLayerIndex === i}
            onHover={setHoveredLayerIndex}
          />
        ))}

      <DimensionLines
        layerRects={layerRects}
        drawLayers={drawLayers}
        isWall={isWall}
        totalThickness={system.totalThickness}
        detailLevel={detailLevel}
      />

      {drawLayers.map((_, i) => {
        const r = layerRects[i]!
        const isHovered = hoveredLayerIndex === i
        if (isWall) {
          return (
            <Leader
              key={i}
              startX={r.x + r.w / 2}
              startY={WALL_CUT_Y}
              calloutY={calloutYs[i]!}
              isWall
              isHovered={isHovered}
            />
          )
        }
        return (
          <Leader
            key={i}
            startX={HORIZ_CUT_X + HORIZ_CUT_W}
            startY={r.y + r.h / 2}
            calloutY={calloutYs[i]!}
            isWall={false}
            isHovered={isHovered}
          />
        )
      })}

      {drawLayers.map((layer, i) => (
        <CalloutItem
          key={i}
          layer={layer}
          drawIndex={i + 1}
          calloutY={calloutYs[i]!}
          layerIndex={i}
          isHovered={hoveredLayerIndex === i}
          onHover={setHoveredLayerIndex}
          onClick={onOpenBulkEditWithLayer ? () => onOpenBulkEditWithLayer(system.id, orderedIndices[i]!) : undefined}
          metrics={calloutMetrics[i]!}
        />
      ))}

      <g>
        <line
          x1={PANEL_X}
          y1={PANEL_Y + PANEL_H - 32}
          x2={PANEL_X + PANEL_W}
          y2={PANEL_Y + PANEL_H - 32}
          stroke="black"
          strokeWidth="0.4"
        />
        {usedTypes.map((type, i) => {
          const lx = PANEL_X + 8 + i * 88
          if (lx + 82 > PANEL_X + PANEL_W) return null
          return (
            <g key={type}>
              <rect
                x={lx}
                y={PANEL_Y + PANEL_H - 25}
                width={12}
                height={12}
                fill={fillForLayerType(type as LayerType)}
                stroke="black"
                strokeWidth="0.6"
              />
              <text x={lx + 16} y={PANEL_Y + PANEL_H - 14} fontSize="6.5" fill="#444" letterSpacing="0.3">
                {LAYER_TYPE_LABELS[type] ?? type}
              </text>
            </g>
          )
        })}
      </g>

      <text x={PANEL_X + 8} y={PANEL_Y + PANEL_H - 4} fontSize="7" fill="#888" letterSpacing="1">
        SCALE: {scaleLabel}
      </text>

      <text x={DIVIDER_X + 8} y={42} fontSize="7.5" fontWeight="bold" letterSpacing="2.5" fill="#555">
        ASSEMBLY LEGEND
      </text>
      <line x1={DIVIDER_X} y1={52} x2={TB_X + TB_W} y2={52} stroke="black" strokeWidth="0.4" />

      <TitleBlock
        x={TB_X}
        y={TB_Y}
        w={TB_W}
        h={TB_H}
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
