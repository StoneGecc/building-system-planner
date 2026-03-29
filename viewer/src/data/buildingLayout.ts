/**
 * Building layout geometry for the composite section and plan drawings.
 * Schematic frame (SX/SY/PL) from BuildingDimensions; system highlights from CSV zone JSON.
 */

import type { BuildingDimensions, SystemData } from '../types/system'
import { resolveDiagramHatchFill } from '../lib/layerDiagramFill'
import { planHexFromFirstLayer } from '../lib/planLayerColors'
import {
  computeSchematicFrame,
  denormalizePlanZones,
  denormalizeSectionZones,
  structuralCltThicknessPx,
  type SchematicFrame,
} from './schematicFrame'

export const SCALE_NOTE_SECTION = '1/8" = 1\'-0"'
export const SCALE_NOTE_PLAN = '1/8" = 1\'-0"'

export interface Zone {
  x: number
  y: number
  w: number
  h: number
  leaderX?: number
  leaderY?: number
}

export interface SystemPlacement {
  systemId: string
  shortName: string
  hatchId: string
  /** Solid fill for composite section/plan zones (from CSV diagram color / hatch palette). */
  fillColor: string
  sectionZones: Zone[]
  planZones: Zone[]
}

export interface BuildingLayout {
  SX: Record<string, number>
  SY: Record<string, number>
  PL: Record<string, number>
  SYSTEM_PLACEMENTS: SystemPlacement[]
  SECT_SCALE: number
  PLAN_SCALE: number
}

export type NormalizedDiagramZone = {
  nx: number
  ny: number
  nw: number
  nh: number
  nlx?: number
  nly?: number
}

export function parseDiagramZonesJson(raw: string | undefined): NormalizedDiagramZone[] {
  const s = (raw ?? '').trim()
  if (!s || s === '[]') return []
  try {
    const arr = JSON.parse(s) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((z) => {
        if (!z || typeof z !== 'object') return null
        const o = z as Record<string, unknown>
        const nx = Number(o.nx)
        const ny = Number(o.ny)
        const nw = Number(o.nw)
        const nh = Number(o.nh)
        if (![nx, ny, nw, nh].every((n) => Number.isFinite(n))) return null
        const nlx = o.nlx !== undefined ? Number(o.nlx) : undefined
        const nly = o.nly !== undefined ? Number(o.nly) : undefined
        return {
          nx,
          ny,
          nw,
          nh,
          ...(nlx !== undefined && Number.isFinite(nlx) ? { nlx } : {}),
          ...(nly !== undefined && Number.isFinite(nly) ? { nly } : {}),
        } as NormalizedDiagramZone
      })
      .filter((z): z is NormalizedDiagramZone => z !== null)
  } catch {
    return []
  }
}

export function buildLayout(d: BuildingDimensions, systems: SystemData[]): BuildingLayout {
  const frame = computeSchematicFrame(d)
  const { SX, SY, PL, SECT_SCALE, PLAN_SCALE } = frame

  const SYSTEM_PLACEMENTS: SystemPlacement[] = systems.map((sys) => {
    const sectionN = parseDiagramZonesJson(sys.diagramSectionZonesJson)
    const planN = parseDiagramZonesJson(sys.diagramPlanZonesJson)
    const sectionZones = denormalizeSectionZones(frame, sectionN)
    const planZones = denormalizePlanZones(frame, planN)
    const shortName = (sys.diagramLabel ?? sys.name).toUpperCase()
    const hatchId = (sys.diagramHatch ?? 'p-MISC').trim() || 'p-MISC'
    /** Same rule as implementation plan: first CSV layer row `Layer_Color` / `Layer_Type` palette. */
    const fillColor = planHexFromFirstLayer(sys)
    return {
      systemId: sys.id,
      shortName,
      hatchId,
      fillColor,
      sectionZones,
      planZones,
    }
  })

  return {
    SX,
    SY,
    PL,
    SYSTEM_PLACEMENTS,
    SECT_SCALE,
    PLAN_SCALE,
  }
}

/**
 * One-time seed: legacy absolute placements → use only from scripts/patch-csv.ts
 * @deprecated Remove after CSV is fully populated
 */
export function computeDiagramSeedPlacements(frame: SchematicFrame, d: BuildingDimensions): SystemPlacement[] {
  const { SX, SY, PL } = frame
  const cltPx = structuralCltThicknessPx(d)

  return [
    {
      systemId: 'A4-01',
      shortName: 'CLT WALL–FLOOR CONNECTION',
      hatchId: 'p-METAL',
      fillColor: resolveDiagramHatchFill('p-METAL'),
      sectionZones: [
        { x: SX.wallL, y: SY.slab23Top - 4, w: SX.intL - SX.wallL, h: 8, leaderX: SX.wallL + 25, leaderY: SY.slab23Top },
        { x: SX.wallL, y: SY.slab12Top - 4, w: SX.intL - SX.wallL, h: 8, leaderX: SX.wallL + 25, leaderY: SY.slab12Top },
        { x: SX.wallL, y: SY.grade - 4, w: SX.intL - SX.wallL, h: 8, leaderX: SX.wallL + 25, leaderY: SY.grade },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-02',
      shortName: 'CLT FLOOR ACOUSTIC ASSEMBLY',
      hatchId: 'p-CLT',
      fillColor: resolveDiagramHatchFill('p-CLT'),
      sectionZones: [
        { x: SX.intL, y: SY.slab23Top, w: SX.voidW - SX.intL, h: SY.slab23Bot - SY.slab23Top },
        { x: SX.intL, y: SY.slab12Top, w: SX.voidW - SX.intL, h: SY.slab12Bot - SY.slab12Top },
        { x: SX.intL, y: SY.slab23Top - 6, w: SX.voidW - SX.intL, h: 6, leaderX: (SX.intL + SX.voidW) / 2, leaderY: SY.slab23Top - 3 },
        { x: SX.intL, y: SY.slab12Top - 6, w: SX.voidW - SX.intL, h: 6 },
      ],
      planZones: [
        { x: PL.ox + PL.wt, y: PL.oy + PL.wt, w: PL.bw - 2 * PL.wt - PL.pt - 60, h: PL.bd - 2 * PL.wt, leaderX: PL.ox + PL.wt + 80, leaderY: PL.oy + PL.wt + 80 },
        { x: PL.ox + PL.wt + 10, y: PL.oy + PL.wt + 10, w: 80, h: 60, leaderX: PL.ox + PL.wt + 50, leaderY: PL.oy + PL.wt + 40 },
      ],
    },
    {
      systemId: 'A4-03',
      shortName: 'CLT ROOF ASSEMBLY',
      hatchId: 'p-CLT',
      fillColor: resolveDiagramHatchFill('p-CLT'),
      sectionZones: [
        { x: SX.intL, y: SY.roofEnv, w: SX.intR - SX.intL, h: SY.roofCLT - SY.roofEnv, leaderX: (SX.intL + SX.intR) / 2, leaderY: SY.roofEnv + 5 },
        { x: SX.intL, y: SY.roofCLT, w: SX.intR - SX.intL, h: SY.fl3Top - SY.roofCLT, leaderX: (SX.intL + SX.intR) / 2, leaderY: SY.roofCLT + 5 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-04',
      shortName: 'CLT WALL PANEL (STRUCTURAL)',
      hatchId: 'p-CLT',
      fillColor: resolveDiagramHatchFill('p-CLT'),
      sectionZones: [
        { x: SX.intL - cltPx, y: SY.parapet, w: cltPx, h: SY.grade - SY.parapet, leaderX: SX.intL - cltPx / 2, leaderY: 240 },
        { x: SX.intR, y: SY.parapet, w: cltPx, h: SY.grade - SY.parapet, leaderX: SX.intR + cltPx / 2, leaderY: 380 },
      ],
      planZones: [
        { x: PL.ox + 20, y: PL.oy + PL.wt, w: 20, h: PL.bd - 2 * PL.wt, leaderX: PL.ox + 30, leaderY: PL.oy + PL.wt + 100 },
      ],
    },
    {
      systemId: 'A4-05',
      shortName: 'CLT PANEL-TO-PANEL CONNECTIONS',
      hatchId: 'p-MISC',
      fillColor: resolveDiagramHatchFill('p-MISC'),
      sectionZones: [
        { x: SX.intL, y: SY.slab23Top + 2, w: 8, h: 8, leaderX: SX.intL + 4, leaderY: SY.slab23Top + 6 },
        { x: SX.intL, y: SY.slab12Top + 2, w: 8, h: 8 },
      ],
      planZones: [
        { x: PL.ox + PL.wt + 140, y: PL.oy + PL.wt, w: 6, h: PL.bd - 2 * PL.wt, leaderX: PL.ox + PL.wt + 143, leaderY: PL.oy + PL.wt + 200 },
      ],
    },
    {
      systemId: 'A4-06',
      shortName: 'EXTERIOR WALL (PRIMARY + OPERABLE SCREEN)',
      hatchId: 'p-INSULATION',
      fillColor: resolveDiagramHatchFill('p-INSULATION'),
      sectionZones: [
        { x: SX.wallL + 6, y: SY.parapet, w: 30, h: SY.grade - SY.parapet, leaderX: SX.wallL + 20, leaderY: 180 },
        { x: SX.intR + 4, y: SY.parapet, w: 30, h: SY.grade - SY.parapet, leaderX: SX.intR + 18, leaderY: 180 },
        { x: SX.screenL, y: SY.parapet, w: SX.wallL - SX.screenL, h: SY.grade - SY.parapet, leaderX: SX.screenL + 20, leaderY: 340 },
        { x: SX.wallR, y: SY.parapet, w: SX.screenR - SX.wallR, h: SY.grade - SY.parapet, leaderX: SX.wallR + 20, leaderY: 340 },
      ],
      planZones: [
        { x: PL.ox, y: PL.oy, w: PL.wt, h: PL.bd, leaderX: PL.ox + PL.wt / 2, leaderY: PL.oy + 80 },
        { x: PL.ox, y: PL.oy, w: PL.bw, h: PL.wt, leaderX: PL.ox + 200, leaderY: PL.oy + PL.wt / 2 },
        { x: PL.ox + PL.bw - PL.wt, y: PL.oy, w: PL.wt, h: PL.bd },
        { x: PL.ox, y: PL.oy + PL.bd - PL.wt, w: PL.bw, h: PL.wt },
        { x: PL.ox, y: PL.oy + PL.bd, w: PL.bw, h: 28, leaderX: PL.ox + 100, leaderY: PL.oy + PL.bd + 14 },
      ],
    },
    {
      systemId: 'A4-07',
      shortName: 'GROUND / SLAB ON GRADE',
      hatchId: 'p-CONCRETE',
      fillColor: resolveDiagramHatchFill('p-CONCRETE'),
      sectionZones: [
        { x: SX.intL, y: SY.grade, w: SX.voidW - SX.intL, h: SY.slabBot - SY.grade, leaderX: (SX.intL + SX.voidW) / 2, leaderY: SY.grade + 10 },
        { x: SX.intL, y: SY.slabBot, w: SX.voidW - SX.intL, h: SY.subgrade - SY.slabBot, leaderX: (SX.intL + SX.voidW) / 2, leaderY: SY.slabBot + 15 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-08',
      shortName: 'WINDOW / OPENING ASSEMBLY',
      hatchId: 'p-GLASS',
      fillColor: resolveDiagramHatchFill('p-GLASS'),
      sectionZones: [
        { x: SX.wallL - 2, y: SY.fl3Top + 40, w: SX.intL - SX.wallL + 4, h: 80, leaderX: SX.wallL, leaderY: SY.fl3Top + 80 },
        { x: SX.wallL - 2, y: SY.fl2Top + 40, w: SX.intL - SX.wallL + 4, h: 80, leaderX: SX.wallL, leaderY: SY.fl2Top + 80 },
      ],
      planZones: [
        { x: PL.ox, y: PL.oy + 120, w: PL.wt, h: 60, leaderX: PL.ox + PL.wt / 2, leaderY: PL.oy + 150 },
        { x: PL.ox, y: PL.oy + 300, w: PL.wt, h: 60 },
      ],
    },
    {
      systemId: 'A4-09',
      shortName: 'CEILING SYSTEM (CLT + BATTEN GRID)',
      hatchId: 'p-WOOD',
      fillColor: resolveDiagramHatchFill('p-WOOD'),
      sectionZones: [
        { x: SX.intL + 10, y: SY.slab23Bot, w: SX.voidW - SX.intL - 20, h: 10, leaderX: SX.intL + 80, leaderY: SY.slab23Bot + 5 },
        { x: SX.intL + 10, y: SY.slab12Bot, w: SX.voidW - SX.intL - 20, h: 10, leaderX: SX.intL + 80, leaderY: SY.slab12Bot + 5 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-10',
      shortName: 'INTERIOR PARTITION WALL',
      hatchId: 'p-INSULATION',
      fillColor: resolveDiagramHatchFill('p-INSULATION'),
      sectionZones: [
        { x: SX.partW1, y: SY.fl3Top, w: SX.partE1 - SX.partW1, h: SY.slab23Top - SY.fl3Top, leaderX: SX.partW1 + 10, leaderY: 200 },
        { x: SX.partW1, y: SY.fl2Top, w: SX.partE1 - SX.partW1, h: SY.slab12Top - SY.fl2Top, leaderX: SX.partW1 + 10, leaderY: 380 },
      ],
      planZones: [
        { x: PL.ox + PL.wt + 160, y: PL.oy + PL.wt, w: PL.pt, h: PL.bd / 2 - PL.wt, leaderX: PL.ox + PL.wt + 160 + PL.pt / 2, leaderY: PL.oy + PL.wt + 80 },
        { x: PL.ox + PL.wt, y: PL.oy + PL.bd / 2, w: PL.bw - 2 * PL.wt - 80, h: PL.pt },
      ],
    },
    {
      systemId: 'A4-11',
      shortName: 'STAIR SYSTEM ASSEMBLY',
      hatchId: 'p-CLT',
      fillColor: resolveDiagramHatchFill('p-CLT'),
      sectionZones: [
        { x: SX.stairL, y: SY.fl3Top, w: SX.stairR - SX.stairL, h: SY.grade - SY.fl3Top, leaderX: (SX.stairL + SX.stairR) / 2, leaderY: 400 },
      ],
      planZones: [
        { x: PL.ox + PL.wt + 180, y: PL.oy + PL.wt + 20, w: 80, h: 120, leaderX: PL.ox + PL.wt + 220, leaderY: PL.oy + PL.wt + 80 },
      ],
    },
    {
      systemId: 'A4-12',
      shortName: 'GUARDRAIL / EDGE CONDITION',
      hatchId: 'p-METAL',
      fillColor: resolveDiagramHatchFill('p-METAL'),
      sectionZones: [
        { x: SX.balcR - 6, y: SY.slab23Top - 48, w: 6, h: 48, leaderX: SX.balcR - 3, leaderY: SY.slab23Top - 30 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - PL.wt - 6, y: PL.oy + PL.wt, w: 6, h: 100, leaderX: PL.ox + PL.bw - PL.wt - 3, leaderY: PL.oy + PL.wt + 50 },
      ],
    },
    {
      systemId: 'A4-13',
      shortName: 'VERTICAL VOID / COURTYARD WALL',
      hatchId: 'p-CLT',
      fillColor: resolveDiagramHatchFill('p-CLT'),
      sectionZones: [
        { x: SX.voidW, y: SY.parapet, w: SX.voidE - SX.voidW, h: SY.grade - SY.parapet, leaderX: (SX.voidW + SX.voidE) / 2, leaderY: 250 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - 2 * PL.wt - 60, y: PL.oy + PL.wt, w: PL.wt, h: PL.bd - 2 * PL.wt, leaderX: PL.ox + PL.bw - 2 * PL.wt - 50, leaderY: PL.oy + PL.wt + 120 },
      ],
    },
    {
      systemId: 'A4-14',
      shortName: 'BALCONY / TERRACE ASSEMBLY',
      hatchId: 'p-WOOD',
      fillColor: resolveDiagramHatchFill('p-WOOD'),
      sectionZones: [
        { x: SX.balcL, y: SY.slab23Top, w: SX.balcR - SX.balcL, h: SY.slab23Bot - SY.slab23Top + 10, leaderX: (SX.balcL + SX.balcR) / 2, leaderY: SY.slab23Top + 8 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - PL.wt, y: PL.oy + PL.wt, w: 80, h: 100, leaderX: PL.ox + PL.bw - PL.wt + 40, leaderY: PL.oy + PL.wt + 50 },
      ],
    },
    {
      systemId: 'A4-15',
      shortName: 'RAINWATER (ROOF TO CISTERN)',
      hatchId: 'p-GRAVEL_SOIL',
      fillColor: resolveDiagramHatchFill('p-GRAVEL_SOIL'),
      sectionZones: [
        { x: SX.intL + 30, y: SY.slabBot + 5, w: 120, h: SY.subgrade - SY.slabBot - 10, leaderX: SX.intL + 90, leaderY: SY.slabBot + 20 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-16',
      shortName: 'GREEN / PLANTING WELL SYSTEM',
      hatchId: 'p-GRAVEL_SOIL',
      fillColor: resolveDiagramHatchFill('p-GRAVEL_SOIL'),
      sectionZones: [
        { x: SX.intL + 80, y: SY.parapet, w: 180, h: 18, leaderX: SX.intL + 170, leaderY: SY.parapet + 9 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - 2 * PL.wt - 58, y: PL.oy + PL.bd / 2, w: 56, h: 80, leaderX: PL.ox + PL.bw - 2 * PL.wt - 30, leaderY: PL.oy + PL.bd / 2 + 40 },
      ],
    },
    {
      systemId: 'A4-17',
      shortName: 'PASSIVE VENTILATION STRATEGY',
      hatchId: 'p-AIR_GAP',
      fillColor: resolveDiagramHatchFill('p-AIR_GAP'),
      sectionZones: [
        { x: SX.voidW + 4, y: SY.parapet + 20, w: SX.voidE - SX.voidW - 8, h: SY.grade - SY.parapet - 20, leaderX: (SX.voidW + SX.voidE) / 2, leaderY: 160 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - 2 * PL.wt - 58, y: PL.oy + PL.wt + 20, w: 56, h: PL.bd / 2 - PL.wt - 40, leaderX: PL.ox + PL.bw - 2 * PL.wt - 30, leaderY: PL.oy + PL.wt + 80 },
      ],
    },
    {
      systemId: 'A4-18',
      shortName: 'COURTYARD TREE SYSTEM',
      hatchId: 'p-GRAVEL_SOIL',
      fillColor: resolveDiagramHatchFill('p-GRAVEL_SOIL'),
      sectionZones: [
        { x: SX.voidW + 10, y: SY.grade - 28, w: SX.voidE - SX.voidW - 20, h: 24, leaderX: (SX.voidW + SX.voidE) / 2, leaderY: SY.grade - 16 },
      ],
      planZones: [
        { x: PL.ox + PL.bw - 2 * PL.wt - 58, y: PL.oy + PL.bd / 2 + 10, w: 56, h: 70, leaderX: PL.ox + PL.bw - 2 * PL.wt - 30, leaderY: PL.oy + PL.bd / 2 + 45 },
      ],
    },
    {
      systemId: 'A4-19',
      shortName: 'PODIUM / TRANSFER SLAB',
      hatchId: 'p-CONCRETE',
      fillColor: resolveDiagramHatchFill('p-CONCRETE'),
      sectionZones: [
        { x: SX.intL, y: SY.grade - 2, w: SX.voidW - SX.intL, h: 6, leaderX: (SX.intL + SX.voidW) / 2, leaderY: SY.grade + 1 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-20',
      shortName: 'FOOTING SYSTEM',
      hatchId: 'p-CONCRETE',
      fillColor: resolveDiagramHatchFill('p-CONCRETE'),
      sectionZones: [
        { x: SX.intL - 8, y: SY.subgrade - 6, w: SX.voidW - SX.intL + 16, h: 8, leaderX: SX.intL + 40, leaderY: SY.subgrade - 2 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-21',
      shortName: 'FOUNDATION WALL',
      hatchId: 'p-MEMBRANE',
      fillColor: resolveDiagramHatchFill('p-MEMBRANE'),
      sectionZones: [
        { x: SX.wallL - 4, y: SY.slabBot, w: 6, h: SY.grade - SY.slabBot, leaderX: SX.wallL - 1, leaderY: SY.grade - 40 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-22',
      shortName: 'WALL BASE (CLT TO CONCRETE)',
      hatchId: 'p-WOOD',
      fillColor: resolveDiagramHatchFill('p-WOOD'),
      sectionZones: [
        { x: SX.wallL, y: SY.grade - 10, w: SX.intL - SX.wallL, h: 10, leaderX: SX.wallL + 20, leaderY: SY.grade - 5 },
      ],
      planZones: [],
    },
    {
      systemId: 'A4-23',
      shortName: 'ACOUSTIC CEILING BELOW CLT',
      hatchId: 'p-MISC',
      fillColor: resolveDiagramHatchFill('p-MISC'),
      sectionZones: [],
      planZones: [],
    },
    {
      systemId: 'A4-24',
      shortName: 'GLT BEAM (LONG-SPAN ROOMS)',
      hatchId: 'p-WOOD',
      fillColor: resolveDiagramHatchFill('p-WOOD'),
      sectionZones: [
        {
          x: SX.partE1 + 8,
          y: SY.slab12Top + 4,
          w: Math.max(24, SX.voidW - SX.partE1 - 16),
          h: 10,
          leaderX: SX.partE1 + (SX.voidW - SX.partE1) / 2,
          leaderY: SY.slab12Top + 9,
        },
        {
          x: SX.partE1 + 8,
          y: SY.slab23Top + 4,
          w: Math.max(24, SX.voidW - SX.partE1 - 16),
          h: 10,
          leaderX: SX.partE1 + (SX.voidW - SX.partE1) / 2,
          leaderY: SY.slab23Top + 9,
        },
      ],
      planZones: [
        {
          x: PL.ox + PL.wt + PL.pt + 12,
          y: PL.oy + PL.wt + PL.bd / 2 - 40,
          w: Math.max(40, PL.bw - 2 * PL.wt - 2 * PL.pt - 80),
          h: 14,
          leaderX: PL.ox + PL.wt + PL.pt + 60,
          leaderY: PL.oy + PL.wt + PL.bd / 2 - 33,
        },
      ],
    },
  ]
}

function zoneToNormalized(
  z: Zone,
  ox: number,
  oy: number,
  rw: number,
  rh: number,
): NormalizedDiagramZone {
  return {
    nx: (z.x - ox) / rw,
    ny: (z.y - oy) / rh,
    nw: z.w / rw,
    nh: z.h / rh,
    ...(z.leaderX !== undefined ? { nlx: (z.leaderX - ox) / rw } : {}),
    ...(z.leaderY !== undefined ? { nly: (z.leaderY - oy) / rh } : {}),
  }
}

/** Export for patch-csv script: normalized JSON strings per system id */
export function diagramSeedJsonForCsv(frame: SchematicFrame, d: BuildingDimensions): Map<string, { section: string; plan: string; label: string; hatch: string }> {
  const placements = computeDiagramSeedPlacements(frame, d)
  const { ox: sox, oy: soy, w: srw, h: srh } = frame.sectionRef
  const { ox: pox, oy: poy, w: prw, h: prh } = frame.planRef
  const map = new Map<string, { section: string; plan: string; label: string; hatch: string }>()
  for (const p of placements) {
    const section = JSON.stringify(p.sectionZones.map((z) => zoneToNormalized(z, sox, soy, srw, srh)))
    const plan = JSON.stringify(p.planZones.map((z) => zoneToNormalized(z, pox, poy, prw, prh)))
    map.set(p.systemId, { section, plan, label: p.shortName, hatch: p.hatchId })
  }
  return map
}
