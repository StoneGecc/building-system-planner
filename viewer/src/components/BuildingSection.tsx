import type { RefObject } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingLayout, Zone, SystemPlacement } from '../data/buildingLayout'
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
import { SCALE_NOTE_SECTION } from '../data/buildingLayout'

// ─── Section content size (designed for this, scaled to fit panel) ──────────────
const SECT_CONTENT_W = 920
const DRAWING_OFFSET_Y = 40  // vertical offset to center drawing below heading
const SECT_CONTENT_H = 910 + DRAWING_OFFSET_Y  // includes offset for vertical centering

const SECT_FIT_SCALE = Math.min(PANEL_W / SECT_CONTENT_W, PANEL_H / SECT_CONTENT_H)
const SECT_SCALED_W = SECT_CONTENT_W * SECT_FIT_SCALE
const SECT_SCALED_H = SECT_CONTENT_H * SECT_FIT_SCALE
const SECT_OFFSET_X = PANEL_X + (PANEL_W - SECT_SCALED_W) / 2
const SECT_OFFSET_Y = PANEL_Y + (PANEL_H - SECT_SCALED_H) / 2

const CALLOUT_X = CALLOUT_BUBBLE_X
const CALLOUT_Y_END = TB_Y - 20

const MONO = "'Courier New', Courier, monospace"

// ─── Floor level labels (y from layout.SY, per reference) ─────────────────────
function getFloorLevels(SY: Record<string, number>) {
  return [
    { label: "ROOF / PARAPET", y: SY.parapet, elev: "+33'-0\"" },
    { label: "FL. 3 +22'-0\"", y: SY.fl3Top, elev: "+22'-0\"" },
    { label: "FL. 2 +11'-0\"", y: SY.fl2Top, elev: "+11'-0\"" },
    { label: "FL. 1 ±0'-0\"", y: SY.fl1Top, elev: "±0'-0\"" },
    { label: "GRADE", y: SY.grade, elev: "" },
  ]
}


// ─── Dimension line helper ────────────────────────────────────────────────
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

// ─── Spacing annotation helper ─────────────────────────────────────────────
function SpacingNote({ x, y, text: t, angle = 0 }: { x: number; y: number; text: string; angle?: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angle})`} fontFamily={MONO}>
      <rect x={-28} y={-6} width={56} height={10} fill="white" stroke="#666" strokeWidth="0.4" />
      <text x={0} y={3} fontSize="6.5" textAnchor="middle" fill="#333" letterSpacing="0.2">{t}</text>
    </g>
  )
}

// ─── Graphic scale bar ─────────────────────────────────────────────────────
function ScaleBar({ x, y, lengthFt = 20, sectScale }: { x: number; y: number; lengthFt?: number; sectScale: number }) {
  const lengthPx = lengthFt * 12 * sectScale
  const tickInterval = 5 // ft
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

// ─── Ground hatching below grade ─────────────────────────────────────────────
function GroundFill({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  return (
    <g>
      {/* Grade line (drawn first so building sits on top) */}
      <line x1={0} y1={SY.grade} x2={SECT_CONTENT_W} y2={SY.grade}
            stroke="black" strokeWidth="1.8" strokeDasharray="12,4" />
      {/* Subgrade fill */}
      <rect x={SX.intL} y={SY.slabBot} width={SX.wallR - SX.intL} height={SY.subgrade - SY.slabBot}
            fill="url(#p-GRAVEL_SOIL)" stroke="none" />
    </g>
  )
}

// ─── Sky / void fill ─────────────────────────────────────────────────────────
function SkyFill({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  // Interior void of each floor (white with very light fill)
  return (
    <g>
      {/* Floor 3 interior */}
      <rect x={SX.intL} y={SY.fl3Top} width={SX.partW1 - SX.intL} height={SY.slab23Top - SY.fl3Top}
            fill="white" />
      <rect x={SX.partE1} y={SY.fl3Top} width={SX.voidW - SX.partE1} height={SY.slab23Top - SY.fl3Top}
            fill="white" />
      {/* Floor 2 interior */}
      <rect x={SX.intL} y={SY.fl2Top} width={SX.partW1 - SX.intL} height={SY.slab12Top - SY.fl2Top}
            fill="white" />
      <rect x={SX.partE1} y={SY.fl2Top} width={SX.voidW - SX.partE1} height={SY.slab12Top - SY.fl2Top}
            fill="white" />
      {/* Floor 1 interior */}
      <rect x={SX.intL} y={SY.fl1Top} width={SX.partW1 - SX.intL} height={SY.grade - SY.fl1Top}
            fill="white" />
      <rect x={SX.partE1} y={SY.fl1Top} width={SX.voidW - SX.partE1} height={SY.grade - SY.fl1Top}
            fill="white" />
    </g>
  )
}

// ─── Structural background (poche) ───────────────────────────────────────────
function BuildingPoche({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  // Heavy poche fills for cut structural elements
  // These are drawn UNDER the system hatch zones
  return (
    <g>
      {/* Parapet band */}
      <rect x={SX.wallL} y={SY.parapet} width={SX.wallR - SX.wallL} height={18}
            fill="url(#p-CLT)" stroke="black" strokeWidth="0.8" />
      {/* Floor slabs (full width) */}
      {[SY.slab23Top, SY.slab12Top].map((y, i) => (
        <rect key={i} x={SX.intL} y={y} width={SX.intR - SX.intL}
              height={SY.slab23Bot - SY.slab23Top}
              fill="url(#p-CONCRETE)" stroke="black" strokeWidth="0.8" />
      ))}
      {/* Finish layer on slabs */}
      {[SY.slab23Top - 6, SY.slab12Top - 6].map((y, i) => (
        <rect key={i} x={SX.intL} y={y} width={SX.voidW - SX.intL} height={6}
              fill="url(#p-WOOD)" stroke="none" />
      ))}
    </g>
  )
}

// ─── Window openings ─────────────────────────────────────────────────────────
function WindowOpenings({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  const windows = [
    { y: SY.fl3Top + 38 },
    { y: SY.fl2Top + 38 },
    { y: SY.fl1Top + 38 },
  ]
  return (
    <g>
      {windows.map((w, i) => (
        <g key={i}>
          {/* Clear the wall in the window zone */}
          <rect x={SX.wallL - 1} y={w.y} width={SX.intL - SX.wallL + 2} height={82}
                fill="white" />
          {/* Glazing fill */}
          <rect x={SX.wallL - 1} y={w.y} width={SX.intL - SX.wallL + 2} height={82}
                fill="url(#p-GLASS)" stroke="black" strokeWidth="0.8" />
          {/* Same on right wall */}
          <rect x={SX.intR - 1} y={w.y} width={SX.wallR - SX.intR + 2} height={82}
                fill="white" />
          <rect x={SX.intR - 1} y={w.y} width={SX.wallR - SX.intR + 2} height={82}
                fill="url(#p-GLASS)" stroke="black" strokeWidth="0.8" />
        </g>
      ))}
    </g>
  )
}

// ─── System hatch zones ───────────────────────────────────────────────────────
function SystemZones({ SYSTEM_PLACEMENTS, hoveredSystemId, onHoverSystem }: {
  SYSTEM_PLACEMENTS: SystemPlacement[]
  hoveredSystemId: string | null
  onHoverSystem?: (id: string | null) => void
}) {
  return (
    <g>
      {SYSTEM_PLACEMENTS.map(p =>
        p.sectionZones.map((z: Zone, zi: number) => {
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

// ─── Structural outlines (heavy borders) ─────────────────────────────────────
function BuildingOutlines({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  return (
    <g stroke="black" fill="none">
      {/* Left wall outer face */}
      <line x1={SX.screenL} y1={SY.parapet} x2={SX.screenL} y2={SY.grade} strokeWidth="1.8" />
      {/* Left wall CLT inner face */}
      <line x1={SX.intL} y1={SY.parapet} x2={SX.intL} y2={SY.grade} strokeWidth="1.2" />
      {/* Right wall CLT inner face */}
      <line x1={SX.intR} y1={SY.parapet} x2={SX.intR} y2={SY.grade} strokeWidth="1.2" />
      {/* Right wall outer face */}
      <line x1={SX.screenR} y1={SY.parapet} x2={SX.screenR} y2={SY.grade} strokeWidth="1.8" />
      {/* Courtyard void walls */}
      <line x1={SX.voidW} y1={SY.parapet} x2={SX.voidW} y2={SY.grade} strokeWidth="1.2" />
      <line x1={SX.voidE} y1={SY.parapet} x2={SX.voidE} y2={SY.grade} strokeWidth="1.2" />
      {/* Interior partition */}
      <line x1={SX.partW1} y1={SY.fl3Top} x2={SX.partW1} y2={SY.grade} strokeWidth="0.9" />
      <line x1={SX.partE1} y1={SY.fl3Top} x2={SX.partE1} y2={SY.grade} strokeWidth="0.9" />
      {/* Stair shaft walls */}
      <line x1={SX.stairL} y1={SY.fl3Top} x2={SX.stairL} y2={SY.grade} strokeWidth="0.8" strokeDasharray="6,3" />
      <line x1={SX.stairR} y1={SY.fl3Top} x2={SX.stairR} y2={SY.grade} strokeWidth="0.8" strokeDasharray="6,3" />
      {/* Roof line */}
      <line x1={SX.wallL} y1={SY.parapet} x2={SX.wallR} y2={SY.parapet} strokeWidth="1.8" />
      {/* Floor slab lines */}
      {[SY.slab23Top, SY.slab12Top].map((y, i) => (
        <line key={i} x1={SX.intL} y1={y} x2={SX.intR} y2={y} strokeWidth="1.2" />
      ))}
      {/* Slab bottom */}
      {[SY.slab23Bot, SY.slab12Bot].map((y, i) => (
        <line key={i} x1={SX.intL} y1={y} x2={SX.intR} y2={y} strokeWidth="0.7" />
      ))}
      {/* Balcony cantilever */}
      <rect x={SX.balcL} y={SY.slab23Top} width={SX.balcR - SX.balcL} height={SY.slab23Bot - SY.slab23Top + 10}
            strokeWidth="1" fill="none" />
      {/* Screen layer lines */}
      <line x1={SX.screenL} y1={SY.parapet} x2={SX.screenL} y2={SY.grade} strokeWidth="1" />
      <line x1={SX.screenR} y1={SY.parapet} x2={SX.screenR} y2={SY.grade} strokeWidth="1" />
    </g>
  )
}

// ─── Floor level markers (right side, to avoid dimension lines on left) ─────────
function FloorLevelMarkers({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  const floorLevels = getFloorLevels(SY)
  const datumX = SX.screenR + 45
  const labelX = datumX + 4   // left-justified at right side of datum line
  const elevX = datumX + 4    // same alignment for elevation
  return (
    <g fontFamily={MONO}>
      {floorLevels.map((fl, i) => (
        <g key={i}>
          <line x1={SX.screenR + 4} y1={fl.y} x2={datumX} y2={fl.y}
                stroke="black" strokeWidth="0.8" strokeDasharray="8,3" />
          <line x1={datumX} y1={fl.y - 3} x2={datumX} y2={fl.y + 3}
                stroke="black" strokeWidth="1.2" />
          <text x={labelX} y={fl.y - 2} fontSize="7.5" textAnchor="start" fontWeight="bold" fill="black" letterSpacing="0.3">
            {fl.label}
          </text>
          {fl.elev && (
            <text x={elevX} y={fl.y + 10} fontSize="7" textAnchor="start" fill="#666">
              {fl.elev}
            </text>
          )}
        </g>
      ))}
    </g>
  )
}

// ─── Leaders + callout items ──────────────────────────────────────────────────
interface CalloutEntry {
  systemId: string
  shortName: string
  calloutY: number
  leaderFromX: number
  leaderFromY: number
}

function buildCallouts(
  systems: SystemData[],
  SYSTEM_PLACEMENTS: SystemPlacement[],
  centerOffset: number,
  calloutSystemIds: string[],
): CalloutEntry[] {
  const n = Math.max(calloutSystemIds.length, 1)
  const span = CALLOUT_Y_END - CALLOUT_Y_START
  const spacing = span / n

  return calloutSystemIds.map((sysId, i) => {
    const placement = SYSTEM_PLACEMENTS.find(p => p.systemId === sysId)
    const sys = systems.find(s => s.id === sysId)
    const zone = placement?.sectionZones[0]
    const calloutY = CALLOUT_Y_START + (i + 0.5) * spacing

    const leaderFromX = zone
      ? (zone.leaderX !== undefined ? zone.leaderX : zone.x + zone.w / 2) + centerOffset
      : SECT_CONTENT_W / 2
    const leaderFromY = zone
      ? (zone.leaderY !== undefined ? zone.leaderY : zone.y + zone.h / 2)
      : SECT_CONTENT_H / 2

    return {
      systemId: sysId,
      shortName: sys?.name ?? (placement?.shortName ?? sysId),
      calloutY,
      leaderFromX,
      leaderFromY,
    }
  })
}

// ─── Stair treads schematic ───────────────────────────────────────────────────
function StairSchematic({ SX, SY }: { SX: Record<string, number>; SY: Record<string, number> }) {
  const stairX = SX.stairL + 2
  const treads = [
    // Floor 1 → 2
    { yTop: SY.slab12Top, count: 6, dir: 1 },
    // Floor 2 → 3
    { yTop: SY.slab23Top, count: 6, dir: 1 },
  ]
  return (
    <g stroke="black" strokeWidth="0.6" fill="none">
      {treads.map((s, i) => {
        const riserH = 20
        const treadW = 10
        return Array.from({ length: s.count }, (_, t) => (
          <g key={`${i}-${t}`}>
            <line x1={stairX + t * treadW} y1={s.yTop - t * riserH}
                  x2={stairX + (t + 1) * treadW} y2={s.yTop - t * riserH} />
            <line x1={stairX + (t + 1) * treadW} y1={s.yTop - t * riserH}
                  x2={stairX + (t + 1) * treadW} y2={s.yTop - (t + 1) * riserH} />
          </g>
        ))
      })}
    </g>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
interface BuildingSectionProps {
  systems: SystemData[]
  layout: BuildingLayout
  /** Order of systems in the legend; defaults to Sheet_Order / System_ID sort */
  calloutSystemIds?: string[]
  svgRef?: RefObject<SVGSVGElement>
  hoveredSystemId?: string | null
  onHoverSystem?: (id: string | null) => void
  onSelectSystem?: (system: SystemData) => void
  systemIndex?: number
}

export function BuildingSection({
  systems,
  layout,
  calloutSystemIds: calloutOrderProp,
  svgRef,
  hoveredSystemId = null,
  onHoverSystem,
  onSelectSystem,
  systemIndex = 0,
}: BuildingSectionProps) {
  const { SX, SY, SYSTEM_PLACEMENTS, SECT_SCALE } = layout
  const centerOffset = SECT_CONTENT_W / 2 - (SX.screenR + SX.screenL) / 2
  const calloutSystemIds = calloutOrderProp ?? calloutSystemIdsFromSystems(systems)
  const callouts = buildCallouts(systems, SYSTEM_PLACEMENTS, centerOffset, calloutSystemIds)

  // Total thicknesses derived from layout geometry (so dimensions update when layout changes)
  const screenIn = (SX.wallL - SX.screenL) / SECT_SCALE
  const wallIn = (SX.intL - SX.wallL) / SECT_SCALE
  const partitionIn = (SX.partE1 - SX.partW1) / SECT_SCALE
  const balconyIn = (SX.balcR - SX.balcL) / SECT_SCALE

  // Build unique vertical dimension zones from all systems (dedupe same location)
  // Use zone height in inches (drawn to scale) so labels match actual dimension size
  const verticalDimZones = (() => {
    const seen = new Map<string, { y1: number; y2: number; thickness: number }>()
    const key = (y1: number, y2: number) => `${Math.round(y1 / 5) * 5}-${Math.round(y2 / 5) * 5}`
    for (const p of SYSTEM_PLACEMENTS) {
      for (const z of p.sectionZones) {
        if (z.h < 5) continue
        const y1 = z.y
        const y2 = z.y + z.h
        const thicknessIn = z.h / SECT_SCALE  // zone height (px) → inches at section scale
        if (thicknessIn <= 0) continue
        const k = key(y1, y2)
        if (!seen.has(k)) seen.set(k, { y1, y2, thickness: thicknessIn })
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.y1 - b.y1)
  })()

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

      {/* Drawing panel border */}
      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H}
            fill="none" stroke="black" strokeWidth="0.5" />

      {/* Divider */}
      <line x1={DIVIDER_X} y1={PANEL_Y} x2={DIVIDER_X} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />
      <line x1={DIVIDER_X} y1={TB_Y} x2={TB_X + TB_W} y2={TB_Y}
            stroke="black" strokeWidth="0.5" />

      {/* ── System heading (matches SectionDrawing: x=45 y=46, line at y=52) ── */}
      <text x={45} y={46}
            fontSize="9" fontWeight="bold" letterSpacing="3" fill="black">
        BS — BUILDING SECTION — ALL SYSTEMS
      </text>
      <line x1={PANEL_X} y1={52} x2={PANEL_X + PANEL_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* ── Section drawing content (scaled to fit panel) ── */}
      <g transform={`translate(${SECT_OFFSET_X}, ${SECT_OFFSET_Y}) scale(${SECT_FIT_SCALE}) translate(${centerOffset}, 0)`}>
        {/* Drawing content, offset down for vertical centering */}
        <g transform={`translate(0, ${DRAWING_OFFSET_Y})`}>
        {/* Ground fill + sky backgrounds first */}
        <GroundFill SX={SX} SY={SY} />
      <SkyFill SX={SX} SY={SY} />

      {/* Building poche (structural fills) */}
      <BuildingPoche SX={SX} SY={SY} />

      {/* System hatch zones */}
      <SystemZones SYSTEM_PLACEMENTS={SYSTEM_PLACEMENTS} hoveredSystemId={hoveredSystemId} onHoverSystem={onHoverSystem} />

      {/* Window openings */}
      <WindowOpenings SX={SX} SY={SY} />

      {/* Stair treads */}
      <StairSchematic SX={SX} SY={SY} />

      {/* Structural outlines on top */}
      <BuildingOutlines SX={SX} SY={SY} />

      {/* ── General dimension lines (outside building) ── */}
      {/* Vertical dimensions: total height (far left) + unique system thicknesses */}
      {(() => {
        const dimLeftOuter = SX.screenL - 160   // 33'-0" total height
        const dimPositions = [SX.screenL - 125, SX.screenL - 100, SX.screenL - 75, SX.screenL - 50]
        return (
          <>
            <DimensionLine x1={dimLeftOuter} y1={SY.grade} x2={dimLeftOuter} y2={SY.parapet} label={'33\'-0"'} vertical />
            {verticalDimZones.map((zone, i) => (
              <DimensionLine
                key={i}
                x1={dimPositions[i % 4]}
                y1={zone.y1}
                x2={dimPositions[i % 4]}
                y2={zone.y2}
                label={formatThickness(zone.thickness)}
                vertical
              />
            ))}
          </>
        )
      })()}
      {/* Horizontal dimensions (below subgrade fill, 20px row spacing) */}
      {(() => {
        const row1 = SY.subgrade + 30   // 15'-7", screen, wall, void, balcony
        const row2 = SY.subgrade + 50   // 11-1/2" partition (20px below row1)
        const row3 = SY.subgrade + 70   // 36'-10" overall (20px below row2)
        return (
          <>
            <DimensionLine x1={SX.intL} y1={row1} x2={SX.voidW} y2={row1} label={'15\'-7"'} />
            <DimensionLine x1={SX.screenL} y1={row1} x2={SX.wallL} y2={row1} label={formatThickness(screenIn)} />
            <DimensionLine x1={SX.wallL} y1={row1} x2={SX.intL} y2={row1} label={formatThickness(wallIn)} />
            <DimensionLine x1={SX.voidW} y1={row1} x2={SX.voidE} y2={row1} label={'4\'-5"'} />
            <DimensionLine x1={SX.balcL} y1={row1} x2={SX.balcR} y2={row1} label={formatThickness(balconyIn)} />
            <DimensionLine x1={SX.partW1} y1={row2} x2={SX.partE1} y2={row2} label={formatThickness(partitionIn)} />
            <DimensionLine x1={SX.screenL} y1={row3} x2={SX.screenR} y2={row3} label={'36\'-10"'} />
          </>
        )
      })()}

      {/* ── Spacing annotations ── */}
      <SpacingNote x={SX.wallL + 12} y={SY.slab23Top - 12} text={'STS @ 6" O.C.'} />
      <SpacingNote x={SX.wallL + 12} y={SY.slab12Top - 12} text={'STS @ 6" O.C.'} />
      <SpacingNote x={SX.partW1 + 12} y={SY.fl2Top + 100} text={'Studs @ 16" O.C.'} angle={-90} />
      <SpacingNote x={SX.intL + 80} y={SY.slab23Bot + 8} text={'Furring @ 16" O.C.'} />
      <SpacingNote x={SX.voidW + 35} y={SY.fl2Top + 80} text={'10" ventilated cavity'} angle={-90} />

      {/* Floor level markers on left */}
      <FloorLevelMarkers SX={SX} SY={SY} />

      {/* Graphic scale bar (bottom-left of panel) */}
      <ScaleBar x={0} y={SY.subgrade + 115} lengthFt={20} sectScale={SECT_SCALE} />

      {/* Scale note (below scale bar) */}
      <text x={0} y={SY.subgrade + 138}
            fontSize="7" fill="#333" letterSpacing="1" fontFamily={MONO} textAnchor="start">
        SECTION — SCALE: {SCALE_NOTE_SECTION} — DIMENSIONS AS NOTED
      </text>
        </g>
      </g>

      {/* ── System legend header (matches SectionDrawing) ── */}
      <text x={DIVIDER_X + 8} y={42}
            fontSize="7.5" fontWeight="bold" letterSpacing="2.5" fill="#555">
        SYSTEM LEGEND
      </text>
      <line x1={DIVIDER_X} y1={52} x2={TB_X + TB_W} y2={52}
            stroke="black" strokeWidth="0.4" />

      {/* ── Leaders ── */}
      {callouts.map(c => (
        <line key={c.systemId}
              x1={SECT_OFFSET_X + c.leaderFromX * SECT_FIT_SCALE} y1={SECT_OFFSET_Y + (c.leaderFromY + DRAWING_OFFSET_Y) * SECT_FIT_SCALE}
              x2={DIVIDER_X} y2={c.calloutY}
              stroke={hoveredSystemId === c.systemId ? '#2563eb' : '#999'}
              strokeWidth={hoveredSystemId === c.systemId ? 0.8 : 0.4}
              strokeDasharray="3,2" />
      ))}

      {/* ── Callout items ── */}
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
            {/* Details + Sheet link */}
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
        systemId="A3"
        systemName="Building Section — All Systems"
        totalThickness="—"
        totalR="—"
        systemIndex={systemIndex}
        totalSystems={22}
      />
    </svg>
  )
}
