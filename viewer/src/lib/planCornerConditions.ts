import type { PlacedGridEdge } from '../types/planLayout'
import type { LayoutRefs } from '../types/system'

export type CornerShape = 'L' | 'T' | 'X'

export interface CornerSystemEntry {
  systemId: string
  source: 'arch' | 'mep'
  kind: 'wall' | 'run'
}

export interface CornerCondition {
  nodeI: number
  nodeJ: number
  shape: CornerShape
  /** Auto-assigned label, e.g. "Ext. Corner", "CLT T-Junction" */
  label: string
  /** Unique system IDs meeting at this node (arch walls + MEP runs). */
  wallSystemIds: string[]
  /** Per-system source/kind so the renderer can pick correct colors. */
  systems: CornerSystemEntry[]
  /** Total number of directional edge slots occupied at this node. */
  edgeCount: number
  /** Directions occupied: which of the 4 grid-edge slots are present. */
  directions: { left: boolean; right: boolean; up: boolean; down: boolean }
  /**
   * Directions with their primary wall system IDs (for per-arm coloring).
   * Each entry: axis 'h' or 'v', toward 'left'|'right'|'up'|'down', primary systemId.
   */
  arms: Array<{ dir: 'left' | 'right' | 'up' | 'down'; systemId: string; source: 'arch' | 'mep'; kind: 'wall' | 'run' }>
}

type WallRole = 'ext' | 'int' | 'mep' | 'other'

export interface SystemInfo {
  name: string
  /** Category string from CSV e.g. "Structural System", "Interior System" */
  category: string
}

function classifyWallRole(systemId: string, source: 'arch' | 'mep', layoutRefs: LayoutRefs): WallRole {
  if (source === 'mep') return 'mep'
  if (systemId === layoutRefs.exterior_wall_assembly) return 'ext'
  if (systemId === layoutRefs.interior_partition) return 'int'
  return 'other'
}

function shortSystemLabel(systemId: string, info: SystemInfo | undefined): string {
  if (!info) return systemId
  const name = info.name
  const cat = info.category.toLowerCase()

  // Try to extract a short meaningful prefix from name
  // e.g. "CLT Wall–Floor Connection" → "CLT Wall"
  // e.g. "Exterior Wall Assembly" → "Ext. Wall"
  if (/exterior/i.test(name)) return 'Ext. Wall'
  if (/interior/i.test(name) && /partition/i.test(name)) return 'Int. Partition'
  if (/interior/i.test(name)) return 'Int. Wall'
  if (/clt/i.test(name)) {
    const m = name.match(/clt\s+\w+/i)
    if (m) return m[0]
    return 'CLT'
  }
  // Category fallback
  if (cat.includes('structural')) return 'Struct.'
  if (cat.includes('interior')) return 'Int.'
  if (cat.includes('exterior')) return 'Ext.'
  // Truncate name to ~10 chars
  return name.length > 10 ? name.slice(0, 9) + '.' : name
}

function nodeKey(i: number, j: number): string {
  return `${i}:${j}`
}

interface NodeBucket {
  left: PlacedGridEdge[]
  right: PlacedGridEdge[]
  up: PlacedGridEdge[]
  down: PlacedGridEdge[]
}

function emptyBucket(): NodeBucket {
  return { left: [], right: [], up: [], down: [] }
}

/**
 * Detect corner conditions across all placed edges (arch walls + MEP runs).
 *
 * A corner condition exists at any grid node where at least two
 * **non-collinear** edges meet (i.e. at least one H and one V).
 *
 * @param systemInfoById  Optional map of systemId → { name, category } for better labels.
 */
export function detectCornerConditions(
  edges: readonly PlacedGridEdge[],
  layoutRefs: LayoutRefs,
  systemInfoById?: Map<string, SystemInfo>,
): CornerCondition[] {
  const nodes = new Map<string, NodeBucket>()

  const ensure = (i: number, j: number): NodeBucket => {
    const k = nodeKey(i, j)
    let b = nodes.get(k)
    if (!b) {
      b = emptyBucket()
      nodes.set(k, b)
    }
    return b
  }

  for (const e of edges) {
    const src = e.source ?? 'arch'
    const kind = e.kind ?? 'wall'
    if (kind !== 'wall' && kind !== 'run') continue
    if (src !== 'arch' && src !== 'mep') continue

    if (e.axis === 'h') {
      ensure(e.i, e.j).right.push(e)
      ensure(e.i + 1, e.j).left.push(e)
    } else {
      ensure(e.i, e.j).down.push(e)
      ensure(e.i, e.j + 1).up.push(e)
    }
  }

  const results: CornerCondition[] = []

  for (const [k, bucket] of nodes) {
    const hasH = bucket.left.length > 0 || bucket.right.length > 0
    const hasV = bucket.up.length > 0 || bucket.down.length > 0
    if (!hasH || !hasV) continue

    const hCount = (bucket.left.length > 0 ? 1 : 0) + (bucket.right.length > 0 ? 1 : 0)
    const vCount = (bucket.up.length > 0 ? 1 : 0) + (bucket.down.length > 0 ? 1 : 0)
    const dirCount = hCount + vCount

    let shape: CornerShape
    if (dirCount === 4) shape = 'X'
    else if (dirCount === 3) shape = 'T'
    else shape = 'L'

    const allEdges = [...bucket.left, ...bucket.right, ...bucket.up, ...bucket.down]
    const systemIds = [...new Set(allEdges.map((e) => e.systemId))]

    const seenSys = new Set<string>()
    const systems: CornerSystemEntry[] = []
    for (const e of allEdges) {
      const skey = `${e.source ?? 'arch'}\t${e.systemId}`
      if (seenSys.has(skey)) continue
      seenSys.add(skey)
      systems.push({
        systemId: e.systemId,
        source: (e.source ?? 'arch') as 'arch' | 'mep',
        kind: (e.kind ?? 'wall') === 'run' ? 'run' : 'wall',
      })
    }

    // Per-direction arm info (primary edge from each direction)
    const arms: CornerCondition['arms'] = []
    const addArm = (dir: 'left' | 'right' | 'up' | 'down', list: PlacedGridEdge[]) => {
      if (list.length === 0) return
      const e = list[0]!
      arms.push({
        dir,
        systemId: e.systemId,
        source: (e.source ?? 'arch') as 'arch' | 'mep',
        kind: (e.kind ?? 'wall') === 'run' ? 'run' : 'wall',
      })
    }
    addArm('left', bucket.left)
    addArm('right', bucket.right)
    addArm('up', bucket.up)
    addArm('down', bucket.down)

    const archEdges = allEdges.filter((e) => (e.source ?? 'arch') === 'arch' && (e.kind ?? 'wall') === 'wall')
    const roles = archEdges.map((e) => classifyWallRole(e.systemId, 'arch', layoutRefs))
    const roleSet = new Set(roles)
    const archSystemIds = [...new Set(archEdges.map((e) => e.systemId))]

    const label = buildLabel(shape, roleSet, archSystemIds, systemInfoById)

    const parts = k.split(':')
    results.push({
      nodeI: Number(parts[0]),
      nodeJ: Number(parts[1]),
      shape,
      label,
      wallSystemIds: systemIds,
      systems,
      arms,
      edgeCount: dirCount,
      directions: {
        left: bucket.left.length > 0,
        right: bucket.right.length > 0,
        up: bucket.up.length > 0,
        down: bucket.down.length > 0,
      },
    })
  }

  return results
}

function buildLabel(
  shape: CornerShape,
  roles: Set<WallRole>,
  archSystemIds: string[],
  systemInfoById?: Map<string, SystemInfo>,
): string {
  const hasExt = roles.has('ext')
  const hasInt = roles.has('int')
  const hasMep = roles.has('mep')
  const hasOther = roles.has('other')

  const shapeSuffix = shape === 'L' ? 'Corner' : shape === 'T' ? 'T-Junction' : 'Crossing'

  // Fully classified by layoutRefs
  if (hasExt && hasInt) return `Ext/Int ${shapeSuffix}`
  if (hasExt && !hasOther && !hasMep) return `Ext. ${shapeSuffix}`
  if (hasInt && !hasOther && !hasMep) return `Int. ${shapeSuffix}`
  if (hasMep && !hasExt && !hasInt && !hasOther) return `MEP ${shapeSuffix}`
  if (hasExt && hasMep) return `Ext./MEP ${shapeSuffix}`
  if (hasInt && hasMep) return `Int./MEP ${shapeSuffix}`

  // Unclassified arch walls — use system names if available
  if (hasOther && archSystemIds.length > 0 && systemInfoById) {
    const infos = archSystemIds.map((id) => systemInfoById.get(id)).filter(Boolean) as SystemInfo[]
    if (infos.length === 1) {
      return `${shortSystemLabel(archSystemIds[0]!, infos[0])} ${shapeSuffix}`
    }
    if (infos.length > 1) {
      const labels = [...new Set(infos.map((inf) => shortSystemLabel(archSystemIds[0]!, inf)))]
      if (labels.length === 1) return `${labels[0]} ${shapeSuffix}`
      return `Mixed ${shapeSuffix}`
    }
  }

  return `Wall ${shapeSuffix}`
}
