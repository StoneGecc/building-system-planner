import type { BuildingDimensions } from '../../types/system'
import type { MepItem } from '../../types/mep'
import type { PlacedGridEdge } from '../../types/planLayout'
import {
  edgeKeyString,
  layerIdentityFromEdge,
  placedEdgeKey,
} from '../../types/planLayout'
import { archEdgePerpOffsetCanvasPx, edgeEndpointsCanvasPx, placedArchEdgeEndpointsCanvasPx } from '../../lib/gridEdges'
import {
  planEdgeStroke,
  planEdgeStrokeDasharray,
  planPlacedEdgeOpacity,
  type PlanColorCatalog,
  type PlanVisualProfile,
} from '../../lib/planLayerColors'
import { computeMepRunOffsets, strokeWidthForEdge } from './planEditorGeometry'

export type MepRunLaneInfo = { segmentKey: string; laneIndex: number; laneCount: number }

/** Same segment ordering as `computeMepRunOffsets` (for lane pairing at nodes). */
export function buildMepRunLaneIndexMap(edges: readonly PlacedGridEdge[]): Map<string, MepRunLaneInfo> {
  const out = new Map<string, MepRunLaneInfo>()
  const bySegment = new Map<string, PlacedGridEdge[]>()
  for (const e of edges) {
    if (e.source !== 'mep' || e.kind !== 'run') continue
    const gk = edgeKeyString(e)
    let arr = bySegment.get(gk)
    if (!arr) {
      arr = []
      bySegment.set(gk, arr)
    }
    arr.push(e)
  }
  for (const [gk, group] of bySegment) {
    const sorted = [...group].sort((a, b) => layerIdentityFromEdge(a).localeCompare(layerIdentityFromEdge(b)))
    const n = sorted.length
    for (let idx = 0; idx < n; idx++) {
      out.set(placedEdgeKey(sorted[idx]!), { segmentKey: gk, laneIndex: idx, laneCount: n })
    }
  }
  return out
}

type GridNode = { i: number; j: number }

function nodeKey(n: GridNode): string {
  return `${n.i},${n.j}`
}

function parseNodeKey(k: string): GridNode {
  const [a, b] = k.split(',')
  return { i: Number(a), j: Number(b) }
}

function gridEndpoints(e: PlacedGridEdge): [GridNode, GridNode] {
  if (e.axis === 'h') {
    return [
      { i: e.i, j: e.j },
      { i: e.i + 1, j: e.j },
    ]
  }
  return [
    { i: e.i, j: e.j },
    { i: e.i, j: e.j + 1 },
  ]
}

function otherEnd(e: PlacedGridEdge, n: GridNode): GridNode {
  const [a, b] = gridEndpoints(e)
  return a.i === n.i && a.j === n.j ? b : a
}

function touchesNode(e: PlacedGridEdge, ni: number, nj: number): boolean {
  const [a, b] = gridEndpoints(e)
  return (a.i === ni && a.j === nj) || (b.i === ni && b.j === nj)
}

function collinearThroughNode(ni: number, nj: number, e1: PlacedGridEdge, e2: PlacedGridEdge): boolean {
  if (e1.axis !== e2.axis) return false
  if (e1.axis === 'h') {
    const ok1 = e1.i === ni - 1 && e1.j === nj && e2.i === ni && e2.j === nj
    const ok2 = e2.i === ni - 1 && e2.j === nj && e1.i === ni && e1.j === nj
    return ok1 || ok2
  }
  const ok1 = e1.i === ni && e1.j === nj - 1 && e2.i === ni && e2.j === nj
  const ok2 = e2.i === ni && e2.j === nj - 1 && e1.i === ni && e1.j === nj
  return ok1 || ok2
}

function mepMergeKey(
  e: PlacedGridEdge,
  d: BuildingDimensions,
  mepById: Map<string, MepItem>,
  catalog: PlanColorCatalog | undefined,
  profile: PlanVisualProfile | undefined,
): string {
  const stroke = planEdgeStroke(e, catalog)
  const dash = planEdgeStrokeDasharray(e.kind ?? 'wall') ?? ''
  const sw = strokeWidthForEdge(d, e, mepById)
  const op = planPlacedEdgeOpacity(e, profile, mepById)
  return `${stroke}\t${dash}\t${sw.toFixed(4)}\t${op.toFixed(4)}`
}

class UnionFind {
  private parent = new Map<string, string>()

  find(x: string): string {
    const p = this.parent.get(x)
    if (p == null) {
      this.parent.set(x, x)
      return x
    }
    if (p === x) return x
    const r = this.find(p)
    this.parent.set(x, r)
    return r
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

function collectGridNodes(mepEdges: PlacedGridEdge[]): Set<string> {
  const s = new Set<string>()
  for (const e of mepEdges) {
    const [a, b] = gridEndpoints(e)
    s.add(nodeKey(a))
    s.add(nodeKey(b))
  }
  return s
}

function incidentMepEdges(ni: number, nj: number, mepEdges: PlacedGridEdge[]): PlacedGridEdge[] {
  return mepEdges.filter((e) => touchesNode(e, ni, nj))
}

function unionAdjacentMepEdges(
  mepEdges: PlacedGridEdge[],
  laneMap: Map<string, MepRunLaneInfo>,
  d: BuildingDimensions,
  mepById: Map<string, MepItem>,
  catalog: PlanColorCatalog | undefined,
  profile: PlanVisualProfile | undefined,
): UnionFind {
  const uf = new UnionFind()
  const nodes = collectGridNodes(mepEdges)
  for (const nk of nodes) {
    const { i: ni, j: nj } = parseNodeKey(nk)
    const inc = incidentMepEdges(ni, nj, mepEdges)
    for (let a = 0; a < inc.length; a++) {
      for (let b = a + 1; b < inc.length; b++) {
        const e1 = inc[a]!
        const e2 = inc[b]!
        const k1 = mepMergeKey(e1, d, mepById, catalog, profile)
        const k2 = mepMergeKey(e2, d, mepById, catalog, profile)
        if (k1 !== k2) continue
        const l1 = laneMap.get(placedEdgeKey(e1))
        const l2 = laneMap.get(placedEdgeKey(e2))
        const lane1 = l1?.laneIndex ?? 0
        const lane2 = l2?.laneIndex ?? 0
        if (lane1 !== lane2) continue
        if (e1.axis === e2.axis) {
          if (!collinearThroughNode(ni, nj, e1, e2)) continue
        }
        uf.union(placedEdgeKey(e1), placedEdgeKey(e2))
      }
    }
  }
  return uf
}

function componentBuckets(uf: UnionFind, mepEdges: PlacedGridEdge[]): Map<string, PlacedGridEdge[]> {
  const m = new Map<string, PlacedGridEdge[]>()
  for (const e of mepEdges) {
    const pk = placedEdgeKey(e)
    const root = uf.find(pk)
    let arr = m.get(root)
    if (!arr) {
      arr = []
      m.set(root, arr)
    }
    arr.push(e)
  }
  return m
}

function buildNodeToEdges(edges: PlacedGridEdge[]): Map<string, PlacedGridEdge[]> {
  const m = new Map<string, PlacedGridEdge[]>()
  const add = (nk: string, e: PlacedGridEdge) => {
    let arr = m.get(nk)
    if (!arr) {
      arr = []
      m.set(nk, arr)
    }
    arr.push(e)
  }
  for (const e of edges) {
    const [a, b] = gridEndpoints(e)
    add(nodeKey(a), e)
    add(nodeKey(b), e)
  }
  return m
}

/** Walk away from `v` through unused edges, never using `avoidEdge`, while each step has a unique continuation. */
function collectBackwardChain(
  v: GridNode,
  avoidEdge: PlacedGridEdge,
  unused: Set<string>,
  nodeToAll: Map<string, PlacedGridEdge[]>,
): PlacedGridEdge[] {
  const acc: PlacedGridEdge[] = []
  let curV = v
  let avoid: PlacedGridEdge = avoidEdge
  while (true) {
    const inc = (nodeToAll.get(nodeKey(curV)) ?? []).filter(
      (ed) => unused.has(placedEdgeKey(ed)) && ed !== avoid,
    )
    if (inc.length !== 1) break
    const e = inc[0]!
    acc.unshift(e)
    unused.delete(placedEdgeKey(e))
    curV = otherEnd(e, curV)
    avoid = e
  }
  return acc
}

/** Start at `v`, first traverse `firstEdge` (must be incident), then follow unused edges (pick first branch). */
function collectForwardChain(
  v: GridNode,
  firstEdge: PlacedGridEdge,
  unused: Set<string>,
  nodeToAll: Map<string, PlacedGridEdge[]>,
): PlacedGridEdge[] {
  const acc: PlacedGridEdge[] = []
  let curV = v
  let curE: PlacedGridEdge | null = firstEdge
  let prev: PlacedGridEdge | null = null
  while (curE && unused.has(placedEdgeKey(curE))) {
    acc.push(curE)
    unused.delete(placedEdgeKey(curE))
    const w = otherEnd(curE, curV)
    const opts = (nodeToAll.get(nodeKey(w)) ?? []).filter(
      (ed) => unused.has(placedEdgeKey(ed)) && ed !== prev,
    )
    if (opts.length === 0) break
    curV = w
    prev = curE
    curE = opts[0]!
  }
  return acc
}

/** Extract edge-disjoint paths covering `edges` (trees, cycles, T-junctions). */
function extractEdgeChains(edges: PlacedGridEdge[]): PlacedGridEdge[][] {
  const unused = new Set(edges.map((e) => placedEdgeKey(e)))
  const nodeToAll = buildNodeToEdges(edges)
  const chains: PlacedGridEdge[][] = []

  const edgesAt = (nk: string): PlacedGridEdge[] =>
    (nodeToAll.get(nk) ?? []).filter((e) => unused.has(placedEdgeKey(e)))

  while (unused.size > 0) {
    let startEdge: PlacedGridEdge | null = null
    let anchor: GridNode | null = null

    for (const nk of nodeToAll.keys()) {
      const es = edgesAt(nk)
      if (es.length === 1) {
        startEdge = es[0]!
        anchor = parseNodeKey(nk)
        break
      }
    }

    if (!startEdge) {
      const pk = unused.values().next().value as string
      startEdge = edges.find((e) => placedEdgeKey(e) === pk) ?? null
      if (!startEdge) break
      const [a] = gridEndpoints(startEdge)
      const left = collectBackwardChain(a, startEdge, unused, nodeToAll)
      const forward = collectForwardChain(a, startEdge, unused, nodeToAll)
      const chain = [...left, ...forward]
      if (chain.length > 0) chains.push(chain)
      continue
    }

    const [a0, b0] = gridEndpoints(startEdge)
    const fromA = anchor!.i === a0.i && anchor!.j === a0.j
    const stem = fromA ? collectForwardChain(a0, startEdge, unused, nodeToAll) : collectForwardChain(b0, startEdge, unused, nodeToAll)
    if (stem.length > 0) chains.push(stem)
  }

  return chains
}

function canvasWithOffset(
  d: BuildingDimensions,
  e: PlacedGridEdge,
  deltaIn: number,
  off: Map<string, { dx: number; dy: number }>,
  end: 0 | 1,
): { x: number; y: number } {
  const base =
    (e.source ?? 'arch') === 'arch'
      ? placedArchEdgeEndpointsCanvasPx(d, e, deltaIn)
      : edgeEndpointsCanvasPx(d, e, deltaIn)
  const o = off.get(placedEdgeKey(e)) ?? { dx: 0, dy: 0 }
  return end === 0
    ? { x: base.x1 + o.dx, y: base.y1 + o.dy }
    : { x: base.x2 + o.dx, y: base.y2 + o.dy }
}

function pointAtNodeForEdge(
  d: BuildingDimensions,
  e: PlacedGridEdge,
  deltaIn: number,
  off: Map<string, { dx: number; dy: number }>,
  n: GridNode,
): { x: number; y: number } {
  const [a] = gridEndpoints(e)
  const end: 0 | 1 = a.i === n.i && a.j === n.j ? 0 : 1
  return canvasWithOffset(d, e, deltaIn, off, end)
}

function cornerPoint(
  d: BuildingDimensions,
  deltaIn: number,
  off: Map<string, { dx: number; dy: number }>,
  ni: number,
  nj: number,
  ea: PlacedGridEdge,
  eb: PlacedGridEdge,
): { x: number; y: number } {
  const nx = ni * deltaIn * d.planScale
  const ny = nj * deltaIn * d.planScale
  const h = ea.axis === 'h' ? ea : eb.axis === 'h' ? eb : null
  const v = ea.axis === 'v' ? ea : eb.axis === 'v' ? eb : null
  if (!h || !v) {
    return pointAtNodeForEdge(d, ea, deltaIn, off, { i: ni, j: nj })
  }
  const oh = off.get(placedEdgeKey(h)) ?? { dx: 0, dy: 0 }
  const ov = off.get(placedEdgeKey(v)) ?? { dx: 0, dy: 0 }
  const ah = archEdgePerpOffsetCanvasPx(h, d)
  const av = archEdgePerpOffsetCanvasPx(v, d)
  return { x: nx + ov.dx + av.dx, y: ny + oh.dy + ah.dy }
}

function collinearEdges(ea: PlacedGridEdge, eb: PlacedGridEdge): boolean {
  return ea.axis === eb.axis
}

function commonNodeOfChain(chain: PlacedGridEdge[], index: number): GridNode {
  const ePrev = chain[index - 1]!
  const eNext = chain[index]!
  const [a1, b1] = gridEndpoints(ePrev)
  const [a2, b2] = gridEndpoints(eNext)
  if (a1.i === a2.i && a1.j === a2.j) return a1
  if (a1.i === b2.i && a1.j === b2.j) return a1
  if (b1.i === a2.i && b1.j === a2.j) return b1
  return b1
}

function chainStartVertex(chain: PlacedGridEdge[]): GridNode {
  if (chain.length === 1) {
    const [a] = gridEndpoints(chain[0]!)
    return a
  }
  const e0 = chain[0]!
  const e1 = chain[1]!
  const [a0, b0] = gridEndpoints(e0)
  const [a1, b1] = gridEndpoints(e1)
  for (const n of [a0, b0]) {
    if ((n.i !== a1.i || n.j !== a1.j) && (n.i !== b1.i || n.j !== b1.j)) return n
  }
  return a0
}

function chainToPoints(
  chain: PlacedGridEdge[],
  d: BuildingDimensions,
  deltaIn: number,
  off: Map<string, { dx: number; dy: number }>,
): { x: number; y: number }[] {
  if (chain.length === 0) return []
  if (chain.length === 1) {
    const e = chain[0]!
    return [canvasWithOffset(d, e, deltaIn, off, 0), canvasWithOffset(d, e, deltaIn, off, 1)]
  }

  const v0 = chainStartVertex(chain)

  const pts: { x: number; y: number }[] = []
  pts.push(pointAtNodeForEdge(d, chain[0]!, deltaIn, off, v0))

  for (let i = 1; i < chain.length; i++) {
    const vn = commonNodeOfChain(chain, i)
    const ePrev = chain[i - 1]!
    const eCur = chain[i]!
    if (collinearEdges(ePrev, eCur)) {
      const p = pointAtNodeForEdge(d, ePrev, deltaIn, off, vn)
      const last = pts[pts.length - 1]!
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.25) pts.push(p)
    } else {
      pts.push(cornerPoint(d, deltaIn, off, vn.i, vn.j, ePrev, eCur))
    }
  }

  const lastE = chain[chain.length - 1]!
  const vJoint = commonNodeOfChain(chain, chain.length - 1)
  const vEnd = otherEnd(lastE, vJoint)
  pts.push(pointAtNodeForEdge(d, lastE, deltaIn, off, vEnd))

  const dedup: { x: number; y: number }[] = []
  for (const p of pts) {
    const prev = dedup[dedup.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.2) dedup.push(p)
  }
  return dedup
}

function pointsToPathD(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  const [p0, ...rest] = pts
  const parts = [`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`]
  for (const p of rest) {
    parts.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
  }
  return parts.join(' ')
}

export type MepJoinedPathLayer = {
  stroke: string
  dash: string | undefined
  strokeWidth: number
  opacity: number
  paths: { d: string; edgeKeys: string[] }[]
}

export type MepJoinedDrawModel = {
  /** Placed edge keys drawn as joined paths (omit from per-edge `<line>` pass). */
  joinedPlacedEdgeKeys: ReadonlySet<string>
  /** Back-to-front paint order (thick first). */
  pathLayers: MepJoinedPathLayer[]
  /** Map placed edge key → SVG path `d` for hover / highlight (first path containing the edge). */
  pathDByPlacedKey: ReadonlyMap<string, string>
}

export function buildMepJoinedDrawModel(
  edges: readonly PlacedGridEdge[],
  d: BuildingDimensions,
  deltaIn: number,
  mepById: Map<string, MepItem>,
  catalog: PlanColorCatalog | undefined,
  profile: PlanVisualProfile | undefined,
): MepJoinedDrawModel {
  const mepEdges = edges.filter((e) => e.source === 'mep' && e.kind === 'run')
  const joinedPlacedEdgeKeys = new Set<string>()
  const pathDByPlacedKey = new Map<string, string>()
  const pathLayers: MepJoinedPathLayer[] = []

  if (mepEdges.length === 0) {
    return { joinedPlacedEdgeKeys, pathLayers, pathDByPlacedKey }
  }

  const laneMap = buildMepRunLaneIndexMap(edges)
  const off = computeMepRunOffsets(edges, d, mepById)
  const uf = unionAdjacentMepEdges(mepEdges, laneMap, d, mepById, catalog, profile)
  const buckets = componentBuckets(uf, mepEdges)

  for (const compEdges of buckets.values()) {
    if (compEdges.length < 2) continue

    const sample = compEdges[0]!
    const stroke = planEdgeStroke(sample, catalog)
    const dash = planEdgeStrokeDasharray(sample.kind ?? 'wall')
    const strokeWidth = strokeWidthForEdge(d, sample, mepById)
    const opacity = planPlacedEdgeOpacity(sample, profile, mepById)

    const chains = extractEdgeChains(compEdges)
    const paths: { d: string; edgeKeys: string[] }[] = []
    for (const chain of chains) {
      const pts = chainToPoints(chain, d, deltaIn, off)
      const pathD = pointsToPathD(pts)
      if (!pathD) continue
      const edgeKeys = chain.map((e) => placedEdgeKey(e))
      paths.push({ d: pathD, edgeKeys })
      for (const e of chain) {
        const pk = placedEdgeKey(e)
        if (!pathDByPlacedKey.has(pk)) pathDByPlacedKey.set(pk, pathD)
      }
    }

    if (paths.length === 0) continue

    for (const e of compEdges) joinedPlacedEdgeKeys.add(placedEdgeKey(e))
    pathLayers.push({ stroke, dash, strokeWidth, opacity, paths })
  }

  pathLayers.sort((a, b) => b.strokeWidth - a.strokeWidth)

  return { joinedPlacedEdgeKeys, pathLayers, pathDByPlacedKey }
}

/** Corner intersection for hover/debug: H–V meeting at `(ni,nj)` with MEP offsets. */
export function mepCornerCanvasPoint(
  ni: number,
  nj: number,
  eH: PlacedGridEdge,
  eV: PlacedGridEdge,
  d: BuildingDimensions,
  deltaIn: number,
  off: Map<string, { dx: number; dy: number }>,
): { x: number; y: number } {
  return cornerPoint(d, deltaIn, off, ni, nj, eH, eV)
}
