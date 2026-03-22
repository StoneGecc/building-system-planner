/**
 * Schematic section/plan frame: geometry for composite drawings.
 * Driven by BuildingDimensions (including layoutRefs and thicknessBySystem).
 */

import type { BuildingDimensions, LayoutRefs } from '../types/system'

export const DEFAULT_LAYOUT_REFS: LayoutRefs = {
  exterior_wall_assembly: 'A4-06',
  structural_clt_core: 'A4-04',
  interior_partition: 'A4-10',
  balcony_assembly: 'A4-14',
}

export interface SchematicFrame {
  SX: Record<string, number>
  SY: Record<string, number>
  PL: Record<string, number>
  /** Inner section box used to map normalized diagram zones */
  sectionRef: { ox: number; oy: number; w: number; h: number }
  /** Plan box used to map normalized plan zones */
  planRef: { ox: number; oy: number; w: number; h: number }
  SECT_SCALE: number
  PLAN_SCALE: number
}

function getThickness(d: BuildingDimensions, id: string, fallback: number): number {
  return d.thicknessBySystem[id] ?? fallback
}

export function computeSchematicFrame(d: BuildingDimensions): SchematicFrame {
  const refs = d.layoutRefs ?? DEFAULT_LAYOUT_REFS
  const SECT_SCALE = d.sectionScale
  const PLAN_SCALE = d.planScale
  const in2px = (inches: number) => Math.round(inches * SECT_SCALE)
  const planIn2px = (inches: number) => Math.round(inches * PLAN_SCALE)

  const B5_SCREEN = 15
  const B1_WALL = getThickness(d, refs.exterior_wall_assembly, 26)
  const C2_PARTITION = getThickness(d, refs.interior_partition, 11.5)
  const D2_BALCONY = getThickness(d, refs.balcony_assembly, 13.125)

  const INTERIOR_WIDTH_PX = in2px(d.footprintWidth)
  const VOID_CLEAR = d.voidClearWidth
  const STAIR_WIDTH = d.stairWidth

  const SECT_X0 = 130

  const SX = {
    screenL: SECT_X0,
    wallL: SECT_X0 + in2px(B5_SCREEN),
    intL: SECT_X0 + in2px(B5_SCREEN + B1_WALL),
    partW1: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + Math.floor(INTERIOR_WIDTH_PX * 0.35),
    partE1:
      SECT_X0 + in2px(B5_SCREEN + B1_WALL) + Math.floor(INTERIOR_WIDTH_PX * 0.35) + in2px(C2_PARTITION),
    voidW: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + Math.floor(INTERIOR_WIDTH_PX * 0.52),
    voidE: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + Math.floor(INTERIOR_WIDTH_PX * 0.52) + in2px(VOID_CLEAR),
    intR: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + INTERIOR_WIDTH_PX,
    wallR: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + INTERIOR_WIDTH_PX + in2px(B1_WALL),
    screenR: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + INTERIOR_WIDTH_PX + in2px(B1_WALL + B5_SCREEN),
    balcL: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + INTERIOR_WIDTH_PX,
    balcR: SECT_X0 + in2px(B5_SCREEN + B1_WALL) + INTERIOR_WIDTH_PX + in2px(D2_BALCONY),
    stairL:
      SECT_X0 +
      in2px(B5_SCREEN + B1_WALL) +
      Math.floor(INTERIOR_WIDTH_PX * 0.35) +
      in2px(C2_PARTITION) +
      5,
    stairR:
      SECT_X0 +
      in2px(B5_SCREEN + B1_WALL) +
      Math.floor(INTERIOR_WIDTH_PX * 0.35) +
      in2px(C2_PARTITION) +
      5 +
      in2px(STAIR_WIDTH),
  }

  const SY = {
    parapet: 55,
    roofEnv: 73,
    roofCLT: 94,
    fl3Top: 104,
    slab23Top: 289,
    slab23Bot: 307,
    fl2Top: 307,
    slab12Top: 492,
    slab12Bot: 510,
    fl1Top: 510,
    grade: 695,
    slabBot: 715,
    subgrade: 755,
    ceiling1: 685,
    ceiling2: 482,
    ceiling3: 279,
  }

  const PL = {
    ox: 80,
    oy: 60,
    bw: planIn2px(d.footprintWidth),
    bd: planIn2px(d.footprintDepth),
    wt: planIn2px(B5_SCREEN + B1_WALL),
    pt: planIn2px(C2_PARTITION),
  }

  const sectionRef = {
    ox: SX.screenL,
    oy: SY.parapet,
    w: SX.screenR - SX.screenL,
    h: SY.subgrade - SY.parapet,
  }
  const planRef = {
    ox: PL.ox,
    oy: PL.oy,
    w: PL.bw,
    h: PL.bd,
  }

  return {
    SX,
    SY,
    PL,
    sectionRef,
    planRef,
    SECT_SCALE,
    PLAN_SCALE,
  }
}

/** Map normalized diagram coords (0–1 in sectionRef / planRef) to SVG pixels */
export function denormalizeSectionZones(
  frame: SchematicFrame,
  zones: Array<{ nx: number; ny: number; nw: number; nh: number; nlx?: number; nly?: number }>,
): Array<{ x: number; y: number; w: number; h: number; leaderX?: number; leaderY?: number }> {
  const { ox, oy, w, h } = frame.sectionRef
  return zones.map((z) => ({
    x: ox + z.nx * w,
    y: oy + z.ny * h,
    w: z.nw * w,
    h: z.nh * h,
    ...(z.nlx !== undefined ? { leaderX: ox + z.nlx * w } : {}),
    ...(z.nly !== undefined ? { leaderY: oy + z.nly * h } : {}),
  }))
}

export function denormalizePlanZones(
  frame: SchematicFrame,
  zones: Array<{ nx: number; ny: number; nw: number; nh: number; nlx?: number; nly?: number }>,
): Array<{ x: number; y: number; w: number; h: number; leaderX?: number; leaderY?: number }> {
  const { ox, oy, w, h } = frame.planRef
  return zones.map((z) => ({
    x: ox + z.nx * w,
    y: oy + z.ny * h,
    w: z.nw * w,
    h: z.nh * h,
    ...(z.nlx !== undefined ? { leaderX: ox + z.nlx * w } : {}),
    ...(z.nly !== undefined ? { leaderY: oy + z.nly * h } : {}),
  }))
}

export function structuralCltThicknessPx(d: BuildingDimensions): number {
  const refs = d.layoutRefs ?? DEFAULT_LAYOUT_REFS
  const t = d.thicknessBySystem[refs.structural_clt_core] ?? 6.19
  return Math.round(t * d.sectionScale)
}
