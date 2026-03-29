import type { BuildingDimensions, LayoutRefs, SystemData } from '../types/system'
import type { PlanLayoutSketch } from '../types/planLayout'
import {
  CONNECTION_DETAIL_DEFAULT_SITE_IN,
  planArchAssemblyLayerOrderFlipped,
  resolvedConnectionDetailBoundaryCells,
  resolvedConnectionDetailGridSpacingIn,
} from '../types/planLayout'
import type { MepItem } from '../types/mep'
import {
  connectionDetailStripDescriptorsFromPlan,
  connectionJunctionHighlightPlanInches,
  findPlacedEdgeForJunctionArm,
  placedGridEdgeForJunctionArm,
  type PlanConnection,
} from '@/lib/planConnections'
import { planInchesToCanvasPx } from './planCoordinates'
import {
  connectionDetailAssemblyWorldRectsPx,
  connectionDetailDrawingAxesPlanInches,
} from './connectionDetailAssemblyGridLines'

/** Plan Y-down; one 90° CW step moves +X → +Y (right → down). Matches SVG `rotate(90)`. */
const PLAN_ARM_DIR_ORDER_CW = ['right', 'down', 'left', 'up'] as const

type PlanArmDir = (typeof PLAN_ARM_DIR_ORDER_CW)[number]

function rotatePlanArmDirCw90(dir: PlanArmDir, steps90: number): PlanArmDir {
  const i = PLAN_ARM_DIR_ORDER_CW.indexOf(dir)
  if (i < 0) return dir
  const s = ((steps90 % 4) + 4) % 4
  return PLAN_ARM_DIR_ORDER_CW[(i + s) % 4]!
}

function dirToUnitVec(d: PlanArmDir): { x: number; y: number } {
  if (d === 'right') return { x: 1, y: 0 }
  if (d === 'left') return { x: -1, y: 0 }
  if (d === 'down') return { x: 0, y: 1 }
  return { x: 0, y: -1 }
}

function unitVecToDir(x: number, y: number): PlanArmDir | null {
  if (x === 1 && y === 0) return 'right'
  if (x === -1 && y === 0) return 'left'
  if (x === 0 && y === 1) return 'down'
  if (x === 0 && y === -1) return 'up'
  return null
}

function applyOverlayTransformToDir(
  templateDir: PlanArmDir,
  rotSteps90: number,
  scaleX: number,
  scaleY: number,
): PlanArmDir {
  const v = dirToUnitVec(templateDir)
  const wx = scaleX * v.x
  const wy = scaleY * v.y
  const scaled = unitVecToDir(wx, wy)
  if (!scaled) return rotatePlanArmDirCw90(templateDir, rotSteps90)
  return rotatePlanArmDirCw90(scaled, rotSteps90)
}

function multisetArmDirKey(dirs: readonly string[]): string {
  return [...dirs].sort().join('|')
}

function overlayRefArmsMatchInstance(
  refArms: readonly { dir: string }[],
  actArms: readonly { dir: string }[],
  rotSteps90: number,
  scaleX: number,
  scaleY: number,
): boolean {
  if (refArms.length !== actArms.length) return false
  const projected = refArms.map((a) =>
    applyOverlayTransformToDir(a.dir as PlanArmDir, rotSteps90, scaleX, scaleY),
  )
  return multisetArmDirKey(projected) === multisetArmDirKey(actArms.map((a) => a.dir))
}

export interface ConnectionDetailPlanOverlayAlignment {
  rotSteps90: number
  scaleX: number
  scaleY: number
}

/**
 * Rotation + optional axis flip so the representative sheet's physical arms match this junction.
 * Template merge keys use full D4 (reflections); rotation-only alignment fails for mirror pairs
 * (e.g. left+down vs right+down).
 */
export function connectionDetailPlanOverlayAlignment(
  representativeConnection: PlanConnection,
  instanceAtNode: PlanConnection,
): ConnectionDetailPlanOverlayAlignment {
  const refArms = representativeConnection.armsPhysical ?? representativeConnection.arms
  const actArms = instanceAtNode.armsPhysical ?? instanceAtNode.arms
  if (refArms.length === 0) {
    return { rotSteps90: 0, scaleX: 1, scaleY: 1 }
  }

  for (let rot = 0; rot < 4; rot++) {
    for (const sx of [1, -1] as const) {
      for (const sy of [1, -1] as const) {
        if (overlayRefArmsMatchInstance(refArms, actArms, rot, sx, sy)) {
          return { rotSteps90: rot, scaleX: sx, scaleY: sy }
        }
      }
    }
  }

  return { rotSteps90: 0, scaleX: 1, scaleY: 1 }
}

/**
 * Strip layer flips for the floor-plan overlay — reproduces the **same visual** as the
 * connection-detail editor for the representative (authoring) junction, then maps the result
 * to this instance via the overlay alignment transform.
 *
 * The editor computes effective flips as `layoutFlip XOR detailToggle` per arm at the
 * **representative** node. We replicate that here for the representative, then rotate/reflect
 * the result into instance dirs so every plan junction matches the authored sheet.
 */
export function connectionDetailOverlayStripFlips(
  detailSketch: PlanLayoutSketch,
  layoutSketch: PlanLayoutSketch,
  representativeConnection: PlanConnection,
  planConnectionAtNode: PlanConnection,
  layoutRefs: LayoutRefs,
): Partial<Record<PlanArmDir, true>> | undefined {
  const layoutFlipMap = layoutSketch.planArchEdgeLayerFlipped
  const detailToggles = detailSketch.connectionDetailStripLayerFlips ?? {}
  const edges = layoutSketch.edges ?? []
  const rep = representativeConnection
  const descriptors = connectionDetailStripDescriptorsFromPlan(rep, layoutRefs)

  const repFlips: Partial<Record<PlanArmDir, true>> = {}
  for (const desc of descriptors) {
    const armDir: PlanArmDir = desc.dir
    const e =
      findPlacedEdgeForJunctionArm(edges, rep.nodeI, rep.nodeJ, desc) ??
      placedGridEdgeForJunctionArm(rep.nodeI, rep.nodeJ, desc)
    const layoutFlip = planArchAssemblyLayerOrderFlipped(layoutFlipMap, e, 'edge')
    if (layoutFlip !== Boolean(detailToggles[armDir])) {
      repFlips[armDir] = true
    }
  }

  if (Object.keys(repFlips).length === 0) return undefined

  const align = connectionDetailPlanOverlayAlignment(representativeConnection, planConnectionAtNode)
  if (align.rotSteps90 === 0 && align.scaleX === 1 && align.scaleY === 1) {
    return repFlips
  }
  const out: Partial<Record<PlanArmDir, true>> = {}
  for (const templateDir of PLAN_ARM_DIR_ORDER_CW) {
    if (!repFlips[templateDir]) continue
    const instDir = applyOverlayTransformToDir(templateDir, align.rotSteps90, align.scaleX, align.scaleY)
    out[instDir] = true
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * @deprecated Prefer {@link connectionDetailPlanOverlayAlignment}.
 */
export function connectionDetailPlanOverlayRotationCwSteps90(
  representativeConnection: PlanConnection,
  instanceAtNode: PlanConnection,
): number {
  return connectionDetailPlanOverlayAlignment(representativeConnection, instanceAtNode).rotSteps90
}

/** Measure / grid / section / text on a connection-detail sheet (not wall edges). */
export function connectionDetailSketchHasLineAnnotations(s: PlanLayoutSketch): boolean {
  return (
    (s.measureRuns?.length ?? 0) +
      (s.annotationGridRuns?.length ?? 0) +
      (s.annotationSectionCuts?.length ?? 0) +
      (s.annotationLabels?.length ?? 0) >
    0
  )
}

/** True if anything should be composited from a connection-detail sketch onto the floor plan. */
export function connectionDetailSketchHasPlanOverlayContent(s: PlanLayoutSketch): boolean {
  return (
    connectionDetailSketchHasLineAnnotations(s) ||
    Boolean(
      s.connectionDetailLayerFillByCell && Object.keys(s.connectionDetailLayerFillByCell).length > 0,
    )
  )
}

/**
 * Junction core in connection-detail SVG px — same as PlanLayoutEditor `connectionDetailCorePx`
 * for the representative merged row (outline inset + core, or full junction-sized canvas when no pad).
 */
export function connectionDetailRepresentativeCorePx(
  representativeConnection: PlanConnection,
  layoutSketch: PlanLayoutSketch,
  d: BuildingDimensions,
  mepById: ReadonlyMap<string, MepItem>,
): { x0: number; y0: number; rw: number; rh: number } {
  const map = mepById instanceof Map ? mepById : new Map(mepById)
  const g = resolvedConnectionDetailGridSpacingIn(layoutSketch)
  const padIn = resolvedConnectionDetailBoundaryCells(layoutSketch) * g
  const j = connectionJunctionHighlightPlanInches(representativeConnection, d, map)
  const coreW = Math.max(j.widthIn, g)
  const coreH = Math.max(j.depthIn, g)
  const s = d.planScale
  if (padIn > 0) {
    return { x0: padIn * s, y0: padIn * s, rw: coreW * s, rh: coreH * s }
  }
  return { x0: 0, y0: 0, rw: coreW * s, rh: coreH * s }
}

/**
 * Node axes for compositing connection-detail linework on the plan — same construction as the
 * connection-detail editor (assembly strip edges + junction core). Strip flips reproduce the
 * editor's merged XOR at the **representative** node, then map through the overlay alignment,
 * so the overlay matches the authored sheet exactly.
 *
 * Assembly edges and junction size use `planConnectionAtNode`. Site bounds use this sheet's
 * `siteWidthIn` / `siteDepthIn`.
 */
export function connectionDetailOverlayIrregularAxesPlanInches(params: {
  planConnectionAtNode: PlanConnection
  representativeConnection: PlanConnection
  layoutSketch: PlanLayoutSketch
  detailSketch: PlanLayoutSketch
  d: BuildingDimensions
  orderedSystems: readonly SystemData[]
  mepById: ReadonlyMap<string, MepItem>
}): { xsIn: readonly number[]; ysIn: readonly number[] } | null {
  const {
    planConnectionAtNode,
    representativeConnection,
    layoutSketch,
    detailSketch,
    d,
    orderedSystems,
    mepById,
  } = params
  const map = mepById instanceof Map ? mepById : new Map(mepById)
  const core = connectionDetailRepresentativeCorePx(planConnectionAtNode, layoutSketch, d, map)
  const stripLayerFlips = connectionDetailOverlayStripFlips(
    detailSketch,
    layoutSketch,
    representativeConnection,
    planConnectionAtNode,
    d.layoutRefs,
  )
  const layerRects = connectionDetailAssemblyWorldRectsPx({
    connection: planConnectionAtNode,
    d,
    orderedSystems,
    mepById: map,
    core,
    stripLayerFlips,
  })
  const sw0 = detailSketch.siteWidthIn
  const sh0 = detailSketch.siteDepthIn
  const siteWIn =
    sw0 != null && Number.isFinite(sw0) && sw0 > 0 ? sw0 : CONNECTION_DETAIL_DEFAULT_SITE_IN
  const siteHIn =
    sh0 != null && Number.isFinite(sh0) && sh0 > 0 ? sh0 : CONNECTION_DETAIL_DEFAULT_SITE_IN
  const axes = connectionDetailDrawingAxesPlanInches({
    core,
    layerRects,
    siteWIn,
    siteHIn,
    planScale: d.planScale,
  })
  if (axes.xsIn.length < 2 || axes.ysIn.length < 2) return null
  return axes
}

/**
 * Junction core center on the connection-detail SVG (px), matching `connectionDetailCanvasPackage`
 * / `connectionDetailCorePx` geometry for the representative merged sheet row.
 */
export function connectionDetailJunctionCenterCanvasPx(
  representativeConnection: PlanConnection,
  layoutSketch: PlanLayoutSketch,
  d: BuildingDimensions,
  mepById: ReadonlyMap<string, MepItem>,
): { x: number; y: number } {
  const g = resolvedConnectionDetailGridSpacingIn(layoutSketch)
  const padIn = resolvedConnectionDetailBoundaryCells(layoutSketch) * g
  const j = connectionJunctionHighlightPlanInches(
    representativeConnection,
    d,
    mepById instanceof Map ? mepById : new Map(mepById),
  )
  const coreW = Math.max(j.widthIn, g)
  const coreH = Math.max(j.depthIn, g)
  return planInchesToCanvasPx(d, padIn + coreW / 2, padIn + coreH / 2)
}

/**
 * Junction core in connection-detail canvas px — same box as the grey dashed outline on the
 * connection-detail sheet. Use to clip composited annotations on the floor plan to that area only.
 */
export function connectionDetailJunctionCoreClipRectCanvasPx(
  representativeConnection: PlanConnection,
  layoutSketch: PlanLayoutSketch,
  d: BuildingDimensions,
  mepById: ReadonlyMap<string, MepItem>,
): { x: number; y: number; width: number; height: number } {
  const g = resolvedConnectionDetailGridSpacingIn(layoutSketch)
  const padIn = resolvedConnectionDetailBoundaryCells(layoutSketch) * g
  const j = connectionJunctionHighlightPlanInches(
    representativeConnection,
    d,
    mepById instanceof Map ? mepById : new Map(mepById),
  )
  const coreW = Math.max(j.widthIn, g)
  const coreH = Math.max(j.depthIn, g)
  const s = d.planScale
  return {
    x: padIn * s,
    y: padIn * s,
    width: coreW * s,
    height: coreH * s,
  }
}

/**
 * Clip for pasting a connection-detail sketch onto the floor plan: entire sheet (site), not
 * only the small junction core.
 */
export function connectionDetailPlanOverlayClipRectCanvasPx(
  detailSketch: PlanLayoutSketch,
  d: BuildingDimensions,
): { x: number; y: number; width: number; height: number } {
  const sw0 = detailSketch.siteWidthIn
  const sh0 = detailSketch.siteDepthIn
  const siteWIn =
    sw0 != null && Number.isFinite(sw0) && sw0 > 0 ? sw0 : CONNECTION_DETAIL_DEFAULT_SITE_IN
  const siteHIn =
    sh0 != null && Number.isFinite(sh0) && sh0 > 0 ? sh0 : CONNECTION_DETAIL_DEFAULT_SITE_IN
  const s = d.planScale
  return { x: 0, y: 0, width: siteWIn * s, height: siteHIn * s }
}

/** Grid intersection center on the floor layout (px). */
export function planGridNodeCenterCanvasPx(
  nodeI: number,
  nodeJ: number,
  gridSpacingIn: number,
  d: BuildingDimensions,
): { x: number; y: number } {
  return planInchesToCanvasPx(d, nodeI * gridSpacingIn, nodeJ * gridSpacingIn)
}
