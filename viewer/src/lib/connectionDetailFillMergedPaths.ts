import type { ConnectionDetailLayerFillPick } from './connectionDetailManualFill'

type FillRef = ConnectionDetailLayerFillPick

function fillRefKey(r: FillRef): string {
  return `${r.source}\t${r.systemId}\t${r.layerIndex}`
}

function parseCellKey(ck: string): { i: number; j: number } | null {
  const parts = ck.split(':')
  if (parts.length !== 2) return null
  const i = Number(parts[0])
  const j = Number(parts[1])
  if (!Number.isFinite(i) || !Number.isFinite(j)) return null
  return { i, j }
}

/** 4-connected components of `byCell` where adjacent cells share the same fill ref. */
export function connectionDetailLayerFillConnectedComponents(
  byCell: Readonly<Record<string, FillRef>>,
): { ref: FillRef; cellKeys: string[] }[] {
  const visited = new Set<string>()
  const out: { ref: FillRef; cellKeys: string[] }[] = []
  for (const start of Object.keys(byCell)) {
    if (visited.has(start)) continue
    const startRef = byCell[start]!
    const rk = fillRefKey(startRef)
    const cellKeys: string[] = []
    const q: string[] = [start]
    visited.add(start)
    while (q.length) {
      const k = q.pop()!
      cellKeys.push(k)
      const p = parseCellKey(k)
      if (!p) continue
      const { i, j } = p
      for (const nk of [`${i + 1}:${j}`, `${i - 1}:${j}`, `${i}:${j + 1}`, `${i}:${j - 1}`]) {
        if (visited.has(nk)) continue
        const r = byCell[nk]
        if (!r || fillRefKey(r) !== rk) continue
        visited.add(nk)
        q.push(nk)
      }
    }
    out.push({ ref: startRef, cellKeys })
  }
  return out
}

const R6 = (x: number) => Math.round(x * 1e6) / 1e6

/** Grid-node key for irregular axes: vertex at (xsIn[i], ysIn[j]). */
type NodeK = `${number},${number}`

function nodeK(i: number, j: number): NodeK {
  return `${i},${j}`
}

function parseNodeK(k: NodeK): { i: number; j: number } {
  const [a, b] = k.split(',')
  return { i: Number(a), j: Number(b) }
}

function sortNodeKeys(a: NodeK, b: NodeK): number {
  const pa = parseNodeK(a)
  const pb = parseNodeK(b)
  return pa.i - pb.i || pa.j - pb.j
}

function addUndirectedEdge(adj: Map<NodeK, Set<NodeK>>, a: NodeK, b: NodeK) {
  if (a === b) return
  let sa = adj.get(a)
  if (!sa) {
    sa = new Set()
    adj.set(a, sa)
  }
  sa.add(b)
  let sb = adj.get(b)
  if (!sb) {
    sb = new Set()
    adj.set(b, sb)
  }
  sb.add(a)
}

function removeUndirectedEdge(adj: Map<NodeK, Set<NodeK>>, a: NodeK, b: NodeK) {
  adj.get(a)?.delete(b)
  adj.get(b)?.delete(a)
}

function cloneAdj(adj: Map<NodeK, Set<NodeK>>): Map<NodeK, Set<NodeK>> {
  const out = new Map<NodeK, Set<NodeK>>()
  for (const [k, v] of adj) {
    out.set(k, new Set(v))
  }
  return out
}

/**
 * Walk a closed loop on `sim` only; on success remove those edges from `mut`.
 * Simulating first avoids corrupting `mut` when the walk hits a dead end (should not happen with integer nodes).
 */
function extractOneClosedLoop(
  mut: Map<NodeK, Set<NodeK>>,
  start: NodeK,
  maxSteps: number,
): NodeK[] | null {
  const sim = cloneAdj(mut)
  const loop: NodeK[] = [start]
  let prev: NodeK | null = null
  let cur = start
  for (let step = 0; step < maxSteps; step++) {
    const neighbors = sim.get(cur)
    if (!neighbors || neighbors.size === 0) return null
    let next: NodeK | null = null
    for (const c of neighbors) {
      if (c !== prev) {
        next = c
        break
      }
    }
    if (next == null) next = [...neighbors][0]!
    removeUndirectedEdge(sim, cur, next)
    loop.push(next)
    if (next === start) {
      for (let i = 0; i < loop.length - 1; i++) {
        removeUndirectedEdge(mut, loop[i]!, loop[i + 1]!)
      }
      return loop
    }
    prev = cur
    cur = next
  }
  return null
}

/**
 * Boundary of the union of cells as closed polylines (plan inches), then scaled into SVG user units.
 * Uses **integer grid-node indices** so shared corners always merge — rounded inch keys could split one
 * corner into two vertices (wrong degree) and corrupt the walk, especially away from the min-i/min-j corner.
 */
export function connectionDetailFilledRegionSvgPathD(
  xsIn: readonly number[],
  ysIn: readonly number[],
  cellKeys: readonly string[],
  planScale: number,
): string | null {
  if (xsIn.length < 2 || ysIn.length < 2 || cellKeys.length === 0) return null
  const cells = new Set(cellKeys)
  const maxI = xsIn.length - 2
  const maxJ = ysIn.length - 2
  const adj = new Map<NodeK, Set<NodeK>>()

  for (const ck of cells) {
    const p = parseCellKey(ck)
    if (!p) continue
    const { i, j } = p
    if (i < 0 || j < 0 || i > maxI || j > maxJ) continue

    if (j === 0 || !cells.has(`${i}:${j - 1}`)) {
      addUndirectedEdge(adj, nodeK(i, j), nodeK(i + 1, j))
    }
    if (j === maxJ || !cells.has(`${i}:${j + 1}`)) {
      addUndirectedEdge(adj, nodeK(i, j + 1), nodeK(i + 1, j + 1))
    }
    if (i === 0 || !cells.has(`${i - 1}:${j}`)) {
      addUndirectedEdge(adj, nodeK(i, j), nodeK(i, j + 1))
    }
    if (i === maxI || !cells.has(`${i + 1}:${j}`)) {
      addUndirectedEdge(adj, nodeK(i + 1, j), nodeK(i + 1, j + 1))
    }
  }

  const work = cloneAdj(adj)
  const loops: NodeK[][] = []
  const maxSteps = Math.max(32, cells.size * 8 + 16)

  while (true) {
    let start: NodeK | null = null
    for (const k of [...work.keys()].sort(sortNodeKeys)) {
      const n = work.get(k)
      if (n && n.size > 0) {
        start = k
        break
      }
    }
    if (!start) break

    const loop = extractOneClosedLoop(work, start, maxSteps)
    if (loop && loop.length >= 5) {
      loops.push(loop)
    } else {
      /** Stuck at a spurious edge; drop it so outer loop can finish. */
      const n = work.get(start)
      const only = n ? [...n][0] : undefined
      if (only) removeUndirectedEdge(work, start, only)
    }
  }

  const toSvgNum = (planIn: number) => R6(planIn * planScale)
  const nodeToPlan = (k: NodeK): { x: number; y: number } => {
    const { i, j } = parseNodeK(k)
    const x = xsIn[i]
    const y = ysIn[j]
    if (x == null || y == null) return { x: 0, y: 0 }
    return { x, y }
  }

  const loopToD = (loop: NodeK[]): string => {
    if (loop.length < 4) return ''
    const corners = loop.slice(0, -1).map(nodeToPlan)
    const p0 = corners[0]!
    let s = `M ${toSvgNum(p0.x)} ${toSvgNum(p0.y)}`
    for (let i = 1; i < corners.length; i++) {
      const p = corners[i]!
      s += ` L ${toSvgNum(p.x)} ${toSvgNum(p.y)}`
    }
    return `${s} Z`
  }

  const parts = loops.map(loopToD).filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}
