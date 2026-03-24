import type { GridEdgeKey, PlacedGridEdge, PlanLayoutSketch } from '../types/planLayout'
import { edgeKeyString, cellKeyString, resolvedSiteInches } from '../types/planLayout'
import type { BuildingDimensions } from '../types/system'
import { gridCounts } from './gridEdges'

/** Barrier set from room-boundary segments drawn on the Room layer. */
export function roomBoundaryBarrierKeys(boundaries: readonly GridEdgeKey[] | undefined): Set<string> {
  const s = new Set<string>()
  if (!boundaries) return s
  for (const e of boundaries) s.add(edgeKeyString(e))
  return s
}

/** Grid segments that act as opaque barriers for room zoning (architectural walls only). */
export function wallBarrierKeysFromEdges(edges: readonly PlacedGridEdge[]): Set<string> {
  const s = new Set<string>()
  for (const e of edges) {
    const k = e.kind ?? 'wall'
    if (k === 'wall' || k === 'stairs') s.add(edgeKeyString(e))
  }
  return s
}

/** Barriers for enclosed-zone flood fill: room-layer boundaries plus wall/stair edges. */
export function planEnclosureBarrierKeys(
  roomBoundaryEdges: readonly GridEdgeKey[] | undefined,
  edges: readonly PlacedGridEdge[],
): Set<string> {
  const s = roomBoundaryBarrierKeys(roomBoundaryEdges)
  for (const k of wallBarrierKeysFromEdges(edges)) s.add(k)
  return s
}

function cellNeighbors(i: number, j: number, maxI: number, maxJ: number): { i: number; j: number }[] {
  const o: { i: number; j: number }[] = []
  if (i > 0) o.push({ i: i - 1, j })
  if (i < maxI) o.push({ i: i + 1, j })
  if (j > 0) o.push({ i, j: j - 1 })
  if (j < maxJ) o.push({ i, j: j + 1 })
  return o
}

/** True if a wall blocks moving between two orthogonally adjacent unit cells. */
export function wallBlocksBetweenCells(
  a: { i: number; j: number },
  b: { i: number; j: number },
  walls: Set<string>,
): boolean {
  if (a.i === b.i && Math.abs(a.j - b.j) === 1) {
    const jTop = Math.max(a.j, b.j)
    return walls.has(edgeKeyString({ axis: 'h', i: a.i, j: jTop }))
  }
  if (a.j === b.j && Math.abs(a.i - b.i) === 1) {
    const iRight = Math.max(a.i, b.i)
    return walls.has(edgeKeyString({ axis: 'v', i: iRight, j: a.j }))
  }
  return true
}

export type PlanRoomComponent = {
  cellKeys: string[]
  /** Cell-space centroid (0..nx, 0..ny) for label anchor. */
  centroid: { x: number; y: number }
}

/**
 * Cells reachable from the site grid border without crossing a barrier edge are "exterior".
 * Each orthogonal connected component of the remaining cells is one enclosed zone (room).
 */
export function computeEnclosedRoomComponents(
  nx: number,
  ny: number,
  walls: Set<string>,
): { exteriorCells: Set<string>; rooms: PlanRoomComponent[] } {
  const maxI = nx - 1
  const maxJ = ny - 1
  if (maxI < 0 || maxJ < 0) {
    return { exteriorCells: new Set(), rooms: [] }
  }

  const exterior = new Set<string>()
  const q: { i: number; j: number }[] = []
  const enqueue = (i: number, j: number) => {
    const ck = cellKeyString({ i, j })
    if (exterior.has(ck)) return
    exterior.add(ck)
    q.push({ i, j })
  }

  for (let i = 0; i <= maxI; i++) {
    enqueue(i, 0)
    enqueue(i, maxJ)
  }
  for (let j = 0; j <= maxJ; j++) {
    enqueue(0, j)
    enqueue(maxI, j)
  }

  let qi = 0
  while (qi < q.length) {
    const c = q[qi++]!
    for (const nb of cellNeighbors(c.i, c.j, maxI, maxJ)) {
      if (wallBlocksBetweenCells(c, nb, walls)) continue
      const nk = cellKeyString(nb)
      if (!exterior.has(nk)) enqueue(nb.i, nb.j)
    }
  }

  const interior = new Set<string>()
  for (let j = 0; j <= maxJ; j++) {
    for (let i = 0; i <= maxI; i++) {
      const ck = cellKeyString({ i, j })
      if (!exterior.has(ck)) interior.add(ck)
    }
  }

  const rooms: PlanRoomComponent[] = []
  const seen = new Set<string>()

  const parseCk = (s: string): { i: number; j: number } => {
    const [a, b] = s.split(':')
    return { i: Number(a), j: Number(b) }
  }

  for (const ck of interior) {
    if (seen.has(ck)) continue
    const comp: string[] = []
    const qq: { i: number; j: number }[] = []
    const start = parseCk(ck)
    seen.add(ck)
    comp.push(ck)
    qq.push(start)
    let qj = 0
    while (qj < qq.length) {
      const c = qq[qj++]!
      for (const nb of cellNeighbors(c.i, c.j, maxI, maxJ)) {
        const nck = cellKeyString(nb)
        if (!interior.has(nck)) continue
        if (wallBlocksBetweenCells(c, nb, walls)) continue
        if (!seen.has(nck)) {
          seen.add(nck)
          comp.push(nck)
          qq.push(nb)
        }
      }
    }
    comp.sort()
    let si = 0
    let sj = 0
    for (const k of comp) {
      const p = parseCk(k)
      si += p.i
      sj += p.j
    }
    const n = comp.length
    rooms.push({
      cellKeys: comp,
      centroid: { x: si / n + 0.5, y: sj / n + 0.5 },
    })
  }

  rooms.sort((a, b) => (a.cellKeys[0] ?? '').localeCompare(b.cellKeys[0] ?? ''))
  return { exteriorCells: exterior, rooms }
}

export function findRoomComponentForCellKey(
  rooms: readonly PlanRoomComponent[],
  cellKey: string,
): PlanRoomComponent | null {
  for (const r of rooms) {
    if (r.cellKeys.includes(cellKey)) return r
  }
  return null
}

/** True if any cell in the zone has a non-empty saved room name. */
export function roomZoneHasAssignedName(
  cellKeys: readonly string[],
  roomByCell: Record<string, string> | undefined,
): boolean {
  if (!roomByCell) return false
  return cellKeys.some((k) => (roomByCell[k] ?? '').trim().length > 0)
}

/** Enclosed zones for the current sketch (same rules as the plan editor). */
export function listEnclosedPlanRooms(sketch: PlanLayoutSketch, d: BuildingDimensions): PlanRoomComponent[] {
  const delta = sketch.gridSpacingIn
  const { w: siteWIn, h: siteHIn } = resolvedSiteInches(sketch, d)
  if (!(delta > 0 && siteWIn > 0 && siteHIn > 0)) return []
  const { nx, ny } = gridCounts(siteWIn, siteHIn, delta)
  const barriers = planEnclosureBarrierKeys(sketch.roomBoundaryEdges, sketch.edges)
  return computeEnclosedRoomComponents(nx, ny, barriers).rooms
}

/**
 * Assigns "Prefix 1", "Prefix 2", … to every enclosed zone (stable grid order).
 * Preserves `roomByCell` entries for cells outside enclosed zones. Prefix defaults to "Room".
 */
export function applySequentialAutoRoomNames(
  sketch: PlanLayoutSketch,
  d: BuildingDimensions,
  namePrefix: string,
): Record<string, string> | undefined {
  const rooms = listEnclosedPlanRooms(sketch, d)
  if (rooms.length === 0) return sketch.roomByCell
  const base = namePrefix.trim().length > 0 ? namePrefix.trim() : 'Room'
  const next: Record<string, string> = { ...(sketch.roomByCell ?? {}) }
  let idx = 0
  for (const room of rooms) {
    idx += 1
    const label = `${base} ${idx}`
    for (const k of room.cellKeys) next[k] = label
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function resolveRoomDisplayName(
  cellKeys: readonly string[],
  roomByCell: Record<string, string> | undefined,
  fallbackIndex1: number,
): string {
  if (cellKeys.length === 0) return `Room ${fallbackIndex1}`
  if (!roomByCell) return `Room ${fallbackIndex1}`
  const names = new Set<string>()
  for (const ck of cellKeys) {
    const n = roomByCell[ck]?.trim()
    if (n) names.add(n)
  }
  if (names.size === 1) return [...names][0]!
  if (names.size > 1) return [...names].sort()[0]!
  return `Room ${fallbackIndex1}`
}

/** Distinct fill color from room label (FNV-1a hue). */
export function planRoomFillColorForName(name: string, alpha = 0.36): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const hue = h % 360
  return `hsla(${hue}, 52%, 56%, ${alpha})`
}
