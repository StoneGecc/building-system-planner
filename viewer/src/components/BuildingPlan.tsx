import type { RefObject } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingLayout, SystemPlacement } from '../data/buildingLayout'
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
  layoutCalloutSystemIdBadge,
  TB_X,
  TB_Y,
  TB_W,
  TB_H,
} from '../data/sheetLayout'
import { formatThickness } from '../lib/csvParser'
import { calloutSystemIdsFromSystems } from '../lib/systemSort'
import { HatchDefs } from './HatchDefs'
import { TitleBlock } from './TitleBlock'
import { SCALE_NOTE_PLAN } from '../data/buildingLayout'

// ─── Plan content size (matches Section: scaled to fit panel) ──────────────────
const PLAN_CONTENT_W = 860
const PLAN_CONTENT_H = 710
const PLAN_DRAWING_OFFSET_Y = 40  // vertical offset to center drawing below heading
const PLAN_CONTENT_TOTAL_H = PLAN_CONTENT_H + PLAN_DRAWING_OFFSET_Y

const PLAN_FIT_SCALE = Math.min(PANEL_W / PLAN_CONTENT_W, PANEL_H / PLAN_CONTENT_TOTAL_H)
const PLAN_SCALED_W = PLAN_CONTENT_W * PLAN_FIT_SCALE
const PLAN_SCALED_H = PLAN_CONTENT_TOTAL_H * PLAN_FIT_SCALE
const PLAN_OFFSET_X = PANEL_X + (PANEL_W - PLAN_SCALED_W) / 2
const PLAN_OFFSET_Y = PANEL_Y + (PANEL_H - PLAN_SCALED_H) / 2

const CALLOUT_X = CALLOUT_BUBBLE_X
const CALLOUT_Y_END = TB_Y - 20

const MONO = "'Courier New', Courier, monospace"

// ─── Graphic scale bar (matches Section ScaleBar) ─────────────────────────────
function ScaleBar({ x, y, lengthFt = 20, planScale }: { x: number; y: number; lengthFt?: number; planScale: number }) {
  const lengthPx = lengthFt * 12 * planScale
  const tickInterval = 5
  const ticks = Array.from({ length: lengthFt / tickInterval + 1 }, (_, i) => i * tickInterval)
  return (
    <g fontFamily={MONO} fontSize="7" fill="#333">
      <line x1={x} y1={y} x2={x + lengthPx} y2={y} stroke="black" strokeWidth="0.8" />
      {ticks.map((ft) => {
        const px = (ft / lengthFt) * lengthPx
        return (
          <g key={ft}>
            <line x1={x + px} y1={y} x2={x + px} y2={y + 6} stroke="black" strokeWidth="0.8" />
            <text x={x + px} y={y + 14} textAnchor="middle">{ft}'</text>
          </g>
        )
      })}
      <text x={x + lengthPx / 2} y={y - 8} textAnchor="middle" fontSize="6.5" fill="#555">
        SCALE (FT)
      </text>
    </g>
  )
}

// ─── North arrow ─────────────────────────────────────────────────────────────
function NorthArrow({ x, y }: { x: number; y: number }) {
  return (
    <g fontFamily={MONO} transform={`translate(${x}, ${y})`}>
      <circle cx={0} cy={0} r={18} fill="none" stroke="black" strokeWidth="1" />
      {/* North pointer */}
      <polygon points="0,-14 -5,8 0,3 5,8" fill="black" />
      <text x={0} y={-18} fontSize="9" textAnchor="middle" fontWeight="bold" dy={-2}>N</text>
    </g>
  )
}

// ─── Cut line indicator (plan content coords: 0,0 to 860,710) ───────────────────
function CutLine() {
  const y = 8
  const x0 = 10
  const x1 = PLAN_CONTENT_W - 10
  return (
    <g>
      <line x1={x0} y1={y} x2={x1} y2={y} stroke="black" strokeWidth="0.6" strokeDasharray="6,4,2,4" />
      <circle cx={x0} cy={y} r={7} fill="none" stroke="black" strokeWidth="1.2" />
      <text x={x0} y={y + 4} fontSize="7" textAnchor="middle" fontWeight="bold">A</text>
      <circle cx={x1} cy={y} r={7} fill="none" stroke="black" strokeWidth="1.2" />
      <text x={x1} y={y + 4} fontSize="7" textAnchor="middle" fontWeight="bold">A</text>
    </g>
  )
}

// ─── Plan grid (column grid lines) ───────────────────────────────────────────
function ColumnGrid({ PL }: { PL: Record<string, number> }) {
  // Column bays: 10 ft = 144px at 1.2 px/in
  const bayW = 144
  const cols = [0, 1, 2, 3]
  const { ox, oy, bd } = PL
  const letters = ['①', '②', '③', '④']
  return (
    <g stroke="black" strokeWidth="0.5" strokeDasharray="8,4" fill="black" fontFamily={MONO}>
      {cols.map((c, i) => {
        const cx = ox + c * bayW
        return (
          <g key={i}>
            <line x1={cx} y1={oy - 20} x2={cx} y2={oy + bd + 20} stroke="#bbb" />
            <circle cx={cx} cy={oy - 24} r={10} fill="none" stroke="#999" strokeWidth="0.8" />
            <text x={cx} y={oy - 20} fontSize="8" textAnchor="middle" fill="#999">{letters[i]}</text>
          </g>
        )
      })}
    </g>
  )
}

// ─── Room labels ──────────────────────────────────────────────────────────────
function RoomLabels({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd, wt } = PL
  const rooms = [
    { label: 'LIVING / OPEN PLAN',  x: ox + wt + 20, y: oy + wt + 100 },
    { label: 'STAIR CORE',          x: ox + wt + 193, y: oy + wt + 80 },
    { label: 'COURTYARD / VOID',    x: ox + bw - 2 * wt - 56, y: oy + wt + 140 },
    { label: 'KITCHEN',             x: ox + wt + 20, y: oy + bd / 2 + 60 },
    { label: 'BALCONY',             x: ox + bw - wt + 12, y: oy + wt + 60, rotate: -90 },
  ]
  return (
    <g fontFamily={MONO} fontSize="7.5" fill="#666" letterSpacing="1.5">
      {rooms.map((r, i) => (
        <text key={i}
              x={r.x} y={r.y}
              transform={r.rotate ? `rotate(${r.rotate}, ${r.x}, ${r.y})` : undefined}
              textAnchor="middle">
          {r.label}
        </text>
      ))}
    </g>
  )
}

// ─── Exterior walls (B1 hatch) ────────────────────────────────────────────────
function ExteriorWalls({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd, wt } = PL
  return (
    <g>
      {/* Left wall */}
      <rect x={ox} y={oy} width={wt} height={bd} fill="url(#p-INSULATION)" stroke="black" strokeWidth="1.2" />
      {/* Top wall */}
      <rect x={ox} y={oy} width={bw} height={wt} fill="url(#p-INSULATION)" stroke="black" strokeWidth="1.2" />
      {/* Right wall — main body only (leave balcony open) */}
      <rect x={ox + bw - wt} y={oy} width={wt} height={bd} fill="url(#p-INSULATION)" stroke="black" strokeWidth="1.2" />
      {/* Bottom wall */}
      <rect x={ox} y={oy + bd - wt} width={bw} height={wt} fill="url(#p-INSULATION)" stroke="black" strokeWidth="1.2" />
    </g>
  )
}

// ─── Window openings ──────────────────────────────────────────────────────────
function WindowOpenings({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bd, wt } = PL
  const winH = 64  // plan width of window
  const windows = [
    // Left wall windows
    { x: ox, y: oy + 100, w: wt, h: winH },
    { x: ox, y: oy + 260, w: wt, h: winH },
    { x: ox, y: oy + 420, w: wt, h: winH },
    // Top wall windows
    { x: ox + 100, y: oy, w: winH, h: wt },
    { x: ox + 260, y: oy, w: winH, h: wt },
    // Bottom wall windows
    { x: ox + 100, y: oy + bd - wt, w: winH, h: wt },
    { x: ox + 260, y: oy + bd - wt, w: winH, h: wt },
  ]
  return (
    <g>
      {windows.map((w, i) => (
        <g key={i}>
          {/* Clear wall */}
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="white" />
          {/* Glass fill */}
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="url(#p-GLASS)" stroke="black" strokeWidth="0.8" />
        </g>
      ))}
    </g>
  )
}

// ─── Interior elements (partitions, stair, void) ──────────────────────────────
function InteriorElements({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd, wt, pt } = PL
  // Stair core bounds
  const stairX = ox + wt + 165
  const stairY = oy + wt + 10
  const stairW = 88
  const stairH = 130
  // Courtyard void
  const voidX = ox + bw - 2 * wt - 58
  const voidY = oy + wt
  const voidW = 56
  const voidH = bd - 2 * wt

  return (
    <g>
      {/* Cross partition */}
      <rect x={ox + wt + 155} y={oy + wt} width={pt} height={bd / 2 - wt}
            fill="url(#p-INSULATION)" stroke="black" strokeWidth="0.8" />
      {/* Long partition */}
      <rect x={ox + wt} y={oy + bd / 2} width={bw - 2 * wt - 80} height={pt}
            fill="url(#p-INSULATION)" stroke="black" strokeWidth="0.8" />

      {/* Stair core walls */}
      <rect x={stairX} y={stairY} width={stairW} height={stairH}
            fill="url(#p-CLT)" stroke="black" strokeWidth="0.9" />
      {/* Stair treads in plan */}
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i}
              x1={stairX + 4} y1={stairY + 14 * i + 10}
              x2={stairX + stairW - 4} y2={stairY + 14 * i + 10}
              stroke="black" strokeWidth="0.4" />
      ))}
      {/* Stair direction arrow */}
      <line x1={stairX + stairW / 2} y1={stairY + 10} x2={stairX + stairW / 2} y2={stairY + stairH - 10}
            stroke="black" strokeWidth="0.5" markerEnd="url(#arrowhead)" />

      {/* Courtyard void — clear opening */}
      <rect x={voidX} y={voidY} width={voidW} height={voidH} fill="white" stroke="black" strokeWidth="1.2" />
      <rect x={voidX} y={voidY} width={voidW} height={voidH} fill="url(#p-AIR_GAP)" opacity="0.5" />
      {/* X-through for void / open-to-sky */}
      <line x1={voidX} y1={voidY} x2={voidX + voidW} y2={voidY + voidH} stroke="black" strokeWidth="0.5" />
      <line x1={voidX + voidW} y1={voidY} x2={voidX} y2={voidY + voidH} stroke="black" strokeWidth="0.5" />
      <text x={voidX + voidW / 2} y={voidY + voidH / 2} fontSize="6.5" textAnchor="middle"
            fill="#555" fontFamily={MONO} transform={`rotate(-90,${voidX + voidW / 2},${voidY + voidH / 2})`}>
        VOID
      </text>

      {/* Balcony cantilever */}
      <rect x={ox + bw - wt} y={oy + wt} width={80} height={100}
            fill="url(#p-WOOD)" stroke="black" strokeWidth="0.9" strokeDasharray="4,2" />
    </g>
  )
}

// ─── Screen layer on south facade ─────────────────────────────────────────────
function ScreenLayer({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd } = PL
  return (
    <g>
      <rect x={ox} y={oy + bd} width={bw} height={28}
            fill="url(#p-METAL)" stroke="black" strokeWidth="0.8" />
      {/* Vertical slat lines */}
      {Array.from({ length: 18 }, (_, i) => (
        <line key={i}
              x1={ox + i * 24} y1={oy + bd}
              x2={ox + i * 24} y2={oy + bd + 28}
              stroke="black" strokeWidth="0.3" />
      ))}
    </g>
  )
}

// ─── Floor fill (CLT slab) ────────────────────────────────────────────────────
function FloorFill({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd, wt } = PL
  return (
    <rect x={ox + wt} y={oy + wt} width={bw - 2 * wt} height={bd - 2 * wt}
          fill="white" />
  )
}

// ─── System hatch zones (matches Section SystemZones) ──────────────────────────
function PlanSystemZones({ SYSTEM_PLACEMENTS, hoveredSystemId, onHoverSystem }: {
  SYSTEM_PLACEMENTS: SystemPlacement[]
  hoveredSystemId: string | null
  onHoverSystem?: (id: string | null) => void
}) {
  return (
    <g>
      {SYSTEM_PLACEMENTS.map(p =>
        p.planZones.map((z, zi) => {
          const isAirGap = p.hatchId === 'p-AIR_GAP'
          const isHovered = hoveredSystemId === p.systemId
          return (
            <g
              key={`${p.systemId}-${zi}`}
              onMouseEnter={() => onHoverSystem?.(p.systemId)}
              onMouseLeave={() => onHoverSystem?.(null)}
              style={{ cursor: onHoverSystem ? 'pointer' : 'default' }}
            >
              <rect
                x={z.x} y={z.y} width={z.w} height={z.h}
                fill={p.fillColor}
                stroke="black"
                strokeWidth={isAirGap ? 0.7 : 0.8}
                strokeDasharray={isAirGap ? '4,2' : undefined}
                opacity={isHovered ? 1 : 0.92}
              />
              {isHovered && (
                <rect
                  x={z.x - 2} y={z.y - 2} width={z.w + 4} height={z.h + 4}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2.5"
                  opacity="0.9"
                />
              )}
            </g>
          )
        })
      )}
    </g>
  )
}

// ─── Building outline (heavy border) ─────────────────────────────────────────
function BuildingOutline({ PL }: { PL: Record<string, number> }) {
  const { ox, oy, bw, bd } = PL
  return (
    <rect x={ox} y={oy} width={bw} height={bd}
          fill="none" stroke="black" strokeWidth="2" />
  )
}

// ─── Callouts (matches Section buildCallouts) ──────────────────────────────────
interface PlanCalloutEntry {
  systemId: string
  shortName: string
  calloutY: number
  leaderFromX: number
  leaderFromY: number
}

function buildPlanCallouts(
  systems: SystemData[],
  SYSTEM_PLACEMENTS: SystemPlacement[],
  centerOffset: number,
  calloutSystemIds: string[],
): PlanCalloutEntry[] {
  const n = Math.max(calloutSystemIds.length, 1)
  const span = CALLOUT_Y_END - CALLOUT_Y_START
  const spacing = span / n

  return calloutSystemIds.map((sysId, i) => {
    const placement = SYSTEM_PLACEMENTS.find(p => p.systemId === sysId)
    const sys = systems.find(s => s.id === sysId)
    const zone = placement?.planZones[0]
    const calloutY = CALLOUT_Y_START + (i + 0.5) * spacing

    const leaderFromX = zone
      ? (zone.leaderX !== undefined ? zone.leaderX : zone.x + zone.w / 2) + centerOffset
      : PLAN_CONTENT_W / 2 + centerOffset
    const leaderFromY = zone
      ? (zone.leaderY !== undefined ? zone.leaderY : zone.y + zone.h / 2)
      : PLAN_CONTENT_H / 2

    return {
      systemId: sysId,
      shortName: sys?.name ?? (placement?.shortName ?? sysId),
      calloutY,
      leaderFromX,
      leaderFromY,
    }
  })
}

// ─── Main component ────────────────────────────────────────────────────────────
interface BuildingPlanProps {
  systems: SystemData[]
  layout: BuildingLayout
  calloutSystemIds?: string[]
  svgRef?: RefObject<SVGSVGElement>
  hoveredSystemId?: string | null
  onHoverSystem?: (id: string | null) => void
  onSelectSystem?: (system: SystemData) => void
  systemIndex?: number
}

// Arrowhead marker def
function ArrowheadDef() {
  return (
    <defs>
      <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="black" />
      </marker>
    </defs>
  )
}

export function BuildingPlan({
  systems,
  layout,
  calloutSystemIds: calloutOrderProp,
  svgRef,
  hoveredSystemId = null,
  onHoverSystem,
  onSelectSystem,
  systemIndex = 1,
}: BuildingPlanProps) {
  const { PL, PLAN_SCALE, SYSTEM_PLACEMENTS } = layout
  const centerOffset = PLAN_CONTENT_W / 2 - (PL.ox + PL.bw / 2)
  const calloutSystemIds = calloutOrderProp ?? calloutSystemIdsFromSystems(systems)
  const callouts = buildPlanCallouts(systems, SYSTEM_PLACEMENTS, centerOffset, calloutSystemIds)

  // Total thicknesses derived from layout geometry (so dimensions update when layout changes)
  const wallTotalIn = PL.wt / PLAN_SCALE
  const partitionIn = PL.pt / PLAN_SCALE

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
      <ArrowheadDef />

      {/* White background */}
      <rect width={SHEET_W} height={SHEET_H} fill="white" />

      {/* Drawing panel border (matches SectionDrawing, BuildingSection) */}
      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H}
            fill="none" stroke="black" strokeWidth="0.5" />

      {/* Divider */}
      <line x1={DIVIDER_X} y1={PANEL_Y} x2={DIVIDER_X} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />
      <line x1={DIVIDER_X} y1={TB_Y} x2={TB_X + TB_W} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />

      {/* ── System heading (matches BuildingSection) ── */}
      <text x={45} y={46}
            fontSize="9" fontWeight="bold" letterSpacing="3" fill="black">
        BP — BUILDING PLAN — LEVEL 2 ALL SYSTEMS
      </text>
      <line x1={PANEL_X} y1={52} x2={PANEL_X + PANEL_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* ── Plan drawing content (scaled to fit panel, matches Section structure) ── */}
      <g transform={`translate(${PLAN_OFFSET_X}, ${PLAN_OFFSET_Y}) scale(${PLAN_FIT_SCALE}) translate(${centerOffset}, 0)`}>
        <g transform={`translate(0, ${PLAN_DRAWING_OFFSET_Y})`}>
          {/* Plan heading (inside drawing) */}
          <text x={8} y={22} fontSize="9.5" fontWeight="bold" letterSpacing="2.5" fill="black" fontFamily={MONO}>
            FLOOR PLAN — LEVEL 2 (+11'-0")
          </text>
          <text x={8} y={34} fontSize="7.5" fill="#555" letterSpacing="1.5" fontFamily={MONO}>
            2ND FLOOR PLAN — 3-STORY CLT MASS TIMBER BUILDING
          </text>

          {/* Floor fill (white interior) */}
          <FloorFill PL={PL} />

          {/* Column grid (background) */}
          <ColumnGrid PL={PL} />

          {/* Plan system zones */}
          <PlanSystemZones SYSTEM_PLACEMENTS={SYSTEM_PLACEMENTS} hoveredSystemId={hoveredSystemId} onHoverSystem={onHoverSystem} />

          {/* Exterior walls */}
          <ExteriorWalls PL={PL} />

          {/* Window openings */}
          <WindowOpenings PL={PL} />

          {/* Interior elements */}
          <InteriorElements PL={PL} />

          {/* Screen layer */}
          <ScreenLayer PL={PL} />

          {/* Building outline (heavy) */}
          <BuildingOutline PL={PL} />

          {/* Room labels */}
          <RoomLabels PL={PL} />

          {/* ── General dimension lines (real dimensions) ── */}
          <DimensionLine x1={PL.ox} y1={PL.oy + PLAN_CONTENT_H - 18} x2={PL.ox + PL.bw} y2={PL.oy + PLAN_CONTENT_H - 18} label={'30\'-0"'} />
          <DimensionLine x1={PL.ox + PL.bw + 25} y1={PL.oy} x2={PL.ox + PL.bw + 25} y2={PL.oy + PL.bd} label={'40\'-0"'} vertical />
          <DimensionLine x1={PL.ox} y1={PL.oy - 18} x2={PL.ox + PL.wt} y2={PL.oy - 18} label={formatThickness(wallTotalIn)} />
          <DimensionLine x1={PL.ox + PL.wt + 155} y1={PL.oy + PL.wt + PL.bd / 2 - 25} x2={PL.ox + PL.wt + 155 + PL.pt} y2={PL.oy + PL.wt + PL.bd / 2 - 25} label={formatThickness(partitionIn)} />
          <DimensionLine x1={PL.ox} y1={PL.oy - 38} x2={PL.ox + 144} y2={PL.oy - 38} label={'10\'-0"'} />
          <DimensionLine x1={PL.ox + 144} y1={PL.oy - 38} x2={PL.ox + 288} y2={PL.oy - 38} label={'10\'-0"'} />
          <DimensionLine x1={PL.ox + 288} y1={PL.oy - 38} x2={PL.ox + 432} y2={PL.oy - 38} label={'10\'-0"'} />

          {/* Section cut reference */}
          <CutLine />

          {/* North arrow */}
          <NorthArrow x={PLAN_CONTENT_W - 30} y={PLAN_CONTENT_H - 30} />

          {/* Graphic scale bar (bottom-left, matches Section) */}
          <ScaleBar x={0} y={PLAN_CONTENT_H - 55} lengthFt={20} planScale={PLAN_SCALE} />

          {/* Scale note (below scale bar) */}
          <text x={0} y={PLAN_CONTENT_H - 4} fontSize="7" fill="#333" letterSpacing="1" fontFamily={MONO} textAnchor="start">
            PLAN — SCALE: {SCALE_NOTE_PLAN} — DIMENSIONS AS NOTED
          </text>
        </g>
      </g>

      {/* ── System legend header (matches BuildingSection, SectionDrawing) ── */}
      <text x={DIVIDER_X + 8} y={42}
            fontSize="7.5" fontWeight="bold" letterSpacing="2.5" fill="#555">
        SYSTEM LEGEND
      </text>

      {/* ── Leaders (matches Section: transform content coords to sheet coords) ── */}
      {callouts.map(c => (
        <line key={c.systemId}
              x1={PLAN_OFFSET_X + c.leaderFromX * PLAN_FIT_SCALE}
              y1={PLAN_OFFSET_Y + (c.leaderFromY + PLAN_DRAWING_OFFSET_Y) * PLAN_FIT_SCALE}
              x2={DIVIDER_X} y2={c.calloutY}
              stroke={hoveredSystemId === c.systemId ? '#2563eb' : '#999'}
              strokeWidth={hoveredSystemId === c.systemId ? 0.8 : 0.4}
              strokeDasharray="3,2" />
      ))}

      {/* ── Callout items (matches Section) ── */}
      {callouts.map(c => {
        const sys = systems.find(s => s.id === c.systemId)
        const displayName = sys?.name ?? c.shortName
        const truncated = displayName.length > 36 ? displayName.substring(0, 34) + '…' : displayName
        const isHovered = hoveredSystemId === c.systemId
        const sheetIndex = systems.findIndex(s => s.id === c.systemId) + 2  // 00=Section, 01=Plan, 02+=systems
        const idBadge = layoutCalloutSystemIdBadge(c.systemId)
        const hitX = Math.min(CALLOUT_X - 12, idBadge.x - 2)
        return (
          <g
            key={c.systemId}
            fontFamily={MONO}
            style={{ cursor: onSelectSystem ? 'pointer' : 'default' }}
            onMouseEnter={() => onHoverSystem?.(c.systemId)}
            onMouseLeave={() => onHoverSystem?.(null)}
            onClick={() => sys && onSelectSystem?.(sys)}
          >
            {/* Hit area for easier hover/click */}
            <rect
              x={hitX}
              y={c.calloutY - 14}
              width={SHEET_W - hitX - 20}
              height={36}
              fill={isHovered ? 'rgba(37,99,235,0.08)' : 'transparent'}
              stroke="none"
            />
            {/* ID badge */}
            <rect
              x={idBadge.x}
              y={c.calloutY - 10}
              width={idBadge.w}
              height={20}
              fill={isHovered ? '#2563eb' : 'black'}
            />
            <text x={CALLOUT_X} y={c.calloutY + 5}
                  fontSize="8" textAnchor="middle" fill="white" fontWeight="bold">
              {c.systemId}
            </text>
            {/* Name */}
            <text x={CALLOUT_TEXT_X} y={c.calloutY - 2}
                  fontSize="9" fontWeight="bold" fill={isHovered ? '#2563eb' : 'black'} letterSpacing="0.4">
              {truncated.toUpperCase()}
            </text>
            {/* Details */}
            {sys && (
              <text x={CALLOUT_TEXT_X} y={c.calloutY + 9}
                    fontSize="7" fill="#555" letterSpacing="0.3">
                {`THK: ${sys.totalThickness} IN   R: R-${sys.totalR}`}
              </text>
            )}
            {/* Sheet link */}
            {onSelectSystem && sys && (
              <text
                x={CALLOUT_TEXT_X + 180}
                y={c.calloutY + 5}
                fontSize="7"
                fill={isHovered ? '#2563eb' : '#666'}
                textDecoration="underline"
                letterSpacing="0.5"
              >
                Sheet {sheetIndex} →
              </text>
            )}
          </g>
        )
      })}

      {/* ── Title block ── */}
      <TitleBlock
        x={TB_X} y={TB_Y} w={TB_W} h={TB_H}
        systemId="A1"
        systemName="Building Plan — Level 2 All Systems"
        totalThickness="—"
        totalR="—"
        systemIndex={systemIndex}
        totalSystems={22}
      />
    </svg>
  )
}

// ─── Dimension line helper (matches Section) ───────────────────────────────────
function DimensionLine({
  x1, y1, x2, y2, label, vertical = false, tickSize = 6,
}: {
  x1: number; y1: number; x2: number; y2: number; label: string
  vertical?: boolean; tickSize?: number
}) {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  return (
    <g stroke="black" fill="black" fontFamily={MONO}>
      {vertical ? (
        <>
          <line x1={x1 - tickSize} y1={y1} x2={x1 + tickSize} y2={y1} strokeWidth="0.8" />
          <line x1={x2 - tickSize} y1={y2} x2={x2 + tickSize} y2={y2} strokeWidth="0.8" />
          <line x1={midX} y1={y1} x2={midX} y2={y2} strokeWidth="0.5" />
          <text x={midX} y={midY + 4} fontSize="7" textAnchor="middle" letterSpacing="0.3">{label}</text>
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - tickSize} x2={x1} y2={y1 + tickSize} strokeWidth="0.8" />
          <line x1={x2} y1={y2 - tickSize} x2={x2} y2={y2 + tickSize} strokeWidth="0.8" />
          <line x1={x1} y1={midY} x2={x2} y2={midY} strokeWidth="0.5" />
          <text x={midX} y={midY + 12} fontSize="7" textAnchor="middle" letterSpacing="0.5">{label}</text>
        </>
      )}
    </g>
  )
}
