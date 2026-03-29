import type { PlanLayoutSketch } from '../types/planLayout'

/** Deep clone for undo stacks and history — nested arrays/objects are copied. */
export function cloneSketch(s: PlanLayoutSketch): PlanLayoutSketch {
  return {
    ...s,
    edges: s.edges.map((e) => ({ ...e })),
    cells: (s.cells ?? []).map((c) => ({ ...c })),
    columns: s.columns?.map((c) => ({ ...c })),
    measureRuns: (s.measureRuns ?? []).map((r) => ({
      ...r,
      startNode: { ...r.startNode },
      endNode: { ...r.endNode },
      edgeKeys: [...r.edgeKeys],
    })),
    annotationGridRuns: (s.annotationGridRuns ?? []).map((r) => ({ ...r, edgeKeys: [...r.edgeKeys] })),
    annotationLabels: (s.annotationLabels ?? []).map((l) => ({ ...l })),
    annotationSectionCuts: (s.annotationSectionCuts ?? []).map((c) => ({
      ...c,
      startNode: { ...c.startNode },
      endNode: { ...c.endNode },
    })),
    traceOverlay: s.traceOverlay ? { ...s.traceOverlay } : undefined,
    roomBoundaryEdges: s.roomBoundaryEdges?.map((e) => ({ ...e })),
    roomByCell: s.roomByCell ? { ...s.roomByCell } : undefined,
    elevationLevelLines: s.elevationLevelLines?.map((l) => ({ ...l })),
    connectionDetailStripLayerFlips: s.connectionDetailStripLayerFlips
      ? { ...s.connectionDetailStripLayerFlips }
      : undefined,
    connectionJunctionConvexConcaveByNode: s.connectionJunctionConvexConcaveByNode
      ? { ...s.connectionJunctionConvexConcaveByNode }
      : undefined,
    connectionDetailHomogeneousLVariantIdsByFamily: s.connectionDetailHomogeneousLVariantIdsByFamily
      ? Object.fromEntries(
          Object.entries(s.connectionDetailHomogeneousLVariantIdsByFamily).map(([k, v]) => [k, [...v]]),
        )
      : undefined,
    connectionJunctionHomogeneousLSketchIdByNode: s.connectionJunctionHomogeneousLSketchIdByNode
      ? { ...s.connectionJunctionHomogeneousLSketchIdByNode }
      : undefined,
    planArchEdgeLayerFlipped: s.planArchEdgeLayerFlipped ? { ...s.planArchEdgeLayerFlipped } : undefined,
    connectionDetailLayerFillByCell: s.connectionDetailLayerFillByCell
      ? { ...s.connectionDetailLayerFillByCell }
      : undefined,
  }
}
