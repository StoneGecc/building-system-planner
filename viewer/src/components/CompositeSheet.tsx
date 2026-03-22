import type { RefObject } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingLayout } from '../data/buildingLayout'
import { calloutSystemIdsFromSystems } from '../lib/systemSort'
import { BuildingSection } from './BuildingSection'
import { BuildingPlan } from './BuildingPlan'
import { TitleBlock } from './TitleBlock'
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
  layoutCalloutSystemIdBadge,
  TB_X,
  TB_Y,
  TB_W,
  TB_H,
} from '../data/sheetLayout'

// Drawing area: left of divider, below title line
const DRAW_AREA_X = PANEL_X
const DRAW_AREA_Y = 54
const DRAW_AREA_H = TB_Y - DRAW_AREA_Y - 8  // 572

// Section: 1900×980, Plan: 1900×780. Stacked = 1760. Scale to fit 572: 572/1760 = 0.325

const MONO = "'Courier New', Courier, monospace"

interface CompositeSheetProps {
  systems: SystemData[]
  layout: BuildingLayout
  calloutSystemIds?: string[]
  svgRef?: RefObject<SVGSVGElement>
  sectionRef?: RefObject<SVGSVGElement>
  planRef?: RefObject<SVGSVGElement>
  hoveredSystemId?: string | null
  onHoverSystem?: (id: string | null) => void
  onSelectSystem?: (system: SystemData) => void
}

export function CompositeSheet({
  systems,
  layout,
  calloutSystemIds: calloutOrderProp,
  svgRef,
  sectionRef,
  planRef,
  hoveredSystemId = null,
  onHoverSystem,
  onSelectSystem,
}: CompositeSheetProps) {
  const scale = DRAW_AREA_H / (980 + 780)  // section 980 + plan 780
  const calloutSystemIds = calloutOrderProp ?? calloutSystemIdsFromSystems(systems)

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

      {/* Drawing panel border (matches A1) */}
      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H}
            fill="none" stroke="black" strokeWidth="0.5" />

      {/* Vertical divider */}
      <line x1={DIVIDER_X} y1={PANEL_Y} x2={DIVIDER_X} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />
      <line x1={DIVIDER_X} y1={TB_Y} x2={TB_X + TB_W} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />

      {/* Title at top */}
      <text x={45} y={46} fontSize="9" fontWeight="bold" letterSpacing="3" fill="black">
        00 — COMPOSITE DRAWING
      </text>
      <line x1={PANEL_X} y1={52} x2={PANEL_X + PANEL_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* Drawing area: section + plan scaled to fit */}
      <g transform={`translate(${DRAW_AREA_X}, ${DRAW_AREA_Y}) scale(${scale})`}>
        <BuildingSection
          systems={systems}
          layout={layout}
          calloutSystemIds={calloutSystemIds}
          svgRef={sectionRef}
          hoveredSystemId={hoveredSystemId}
          onHoverSystem={onHoverSystem}
          onSelectSystem={onSelectSystem}
        />
        <g transform="translate(0, 980)">
          <BuildingPlan
            systems={systems}
            layout={layout}
            calloutSystemIds={calloutSystemIds}
            svgRef={planRef}
            hoveredSystemId={hoveredSystemId}
            onHoverSystem={onHoverSystem}
            onSelectSystem={onSelectSystem}
          />
        </g>
      </g>

      {/* Legend strip at bottom */}
      <line x1={PANEL_X} y1={760} x2={PANEL_X + PANEL_W} y2={760}
            stroke="black" strokeWidth="0.4" />
      <text x={PANEL_X + 8} y={788} fontSize="7" fill="#888" letterSpacing="1">
        SCALE: 1/8&quot; = 1&apos;-0&quot;
      </text>

      {/* System legend header (matches BuildingPlan, BuildingSection) */}
      <text x={DIVIDER_X + 8} y={42} fontSize="7.5" fontWeight="bold" letterSpacing="2.5" fill="#555">
        SYSTEM LEGEND
      </text>
      <line x1={DIVIDER_X} y1={52} x2={TB_X + TB_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* System list (callouts) */}
      {calloutSystemIds.map((sysId, i) => {
        const sys = systems.find(s => s.id === sysId)
        const calloutY = 60 + i * 26
        const isHovered = hoveredSystemId === sysId
        const sheetIndex = systems.findIndex(s => s.id === sysId) + 1
        const idBadge = layoutCalloutSystemIdBadge(sysId)
        return (
          <g
            key={sysId}
            fontFamily={MONO}
            style={{ cursor: onSelectSystem ? 'pointer' : 'default' }}
            onMouseEnter={() => onHoverSystem?.(sysId)}
            onMouseLeave={() => onHoverSystem?.(null)}
            onClick={() => sys && onSelectSystem?.(sys)}
          >
            <rect
              x={idBadge.x}
              y={calloutY - 10}
              width={idBadge.w}
              height={20}
              fill={isHovered ? '#2563eb' : 'black'}
            />
            <text x={CALLOUT_BUBBLE_X} y={calloutY + 4.5} fontSize="8.5" textAnchor="middle" fill="white" fontWeight="bold">
              {sysId}
            </text>
            <text x={CALLOUT_TEXT_X} y={calloutY - 2} fontSize="9" fontWeight="bold" fill={isHovered ? '#2563eb' : 'black'} letterSpacing="0.4">
              {(sys?.name ?? sysId).toUpperCase().slice(0, 30) + ((sys?.name?.length ?? 0) > 30 ? '…' : '')}
            </text>
            {sys && (
              <text x={CALLOUT_TEXT_X} y={calloutY + 10} fontSize="7.5" fill="#555">
                THK: {sys.totalThickness} IN   R: R-{sys.totalR}
              </text>
            )}
            {onSelectSystem && sys && (
              <text x={CALLOUT_TEXT_X} y={calloutY + 20} fontSize="7" fill="#666" letterSpacing="0.5">
                Sheet {sheetIndex} →
              </text>
            )}
          </g>
        )
      })}

      {/* Title block */}
      <TitleBlock
        x={TB_X} y={TB_Y} w={TB_W} h={TB_H}
        systemId="00"
        systemName="Composite Drawing — Section + Plan"
        totalThickness="—"
        totalR="—"
        systemIndex={0}
        totalSystems={systems.length}
          scaleLabel={`1/8" = 1'-0"`}
      />
    </svg>
  )
}
