import type { PlacedGridEdge, PlanLayoutSketch } from '../types/planLayout'
import { strokeWidthForEdge } from '../components/planLayoutCore/planEditorGeometry'
import type { MepItem } from '../types/mep'
import type { BuildingDimensions, LayoutRefs, SystemData } from '../types/system'
import { parseThickness } from './csvParser'
import {
  detectCornerConditions,
  type CornerCondition,
  type CornerShape,
  type CornerSystemEntry,
  type SystemInfo,
} from './planCornerConditions'
import { archEdgePerpOffsetCanvasPx, edgeEndpointsCanvasPx } from './gridEdges'

export type ConnectionKind = 'grid_junction'

/** Plan compass order for D4 normalization: N, E, S, W → up, right, down, left. */
const SLOT_DIRS = ['up', 'right', 'down', 'left'] as const

export interface PlanConnectionParticipant {
  systemId: string
  source: 'arch' | 'mep'
  kind: 'wall' | 'run'
  systemName: string
  category: string
  totalThicknessIn?: number
  layerSummary?: string
}

export interface PlanConnectionOccurrence {
  nodeI: number
  nodeJ: number
  instanceId: string
}

export interface PlanConnection {
  id: string
  kind: ConnectionKind
  nodeI: number
  nodeJ: number
  shape: CornerShape
  label: string
  wallSystemIds: string[]
  systems: CornerSystemEntry[]
  arms: CornerCondition['arms']
  /**
   * Plan-true arms at the representative node (first instance in a template group).
   * `arms` may be D4-canonical for stable labeling; strips and junction sizing use this when set.
   */
  armsPhysical?: CornerCondition['arms']
  directions: CornerCondition['directions']
  participants: PlanConnectionParticipant[]
  /**
   * Merge key for connection-detail sheets. Usually D4-invariant on arm slots. Homogeneous L/T/X
   * (same system on every arm) use `L-hom|T-hom|X-hom\x1f{armSignature}`; merged rows use `…\x1fv{n}` for extra drawings.
   */
  templateKey: string
  /**
   * Populated only on rows from `buildConnectionDetailSheets`: every plan junction that shares this template.
   */
  occurrences?: readonly PlanConnectionOccurrence[]
}

function composePerms(a: readonly number[], b: readonly number[]): number[] {
  return [0, 1, 2, 3].map((i) => a[b[i]!]!)
}

/** Dihedral D4 as permutations p with newSlot[i] = oldSlot[p[i]]. */
function d4Permutations(): number[][] {
  const R = [3, 0, 1, 2]
  const id = [0, 1, 2, 3]
  const rots: number[][] = [id]
  let t = id
  for (let k = 1; k < 4; k++) {
    t = composePerms(R, t)
    rots.push(t)
  }
  const S = [0, 3, 2, 1]
  const out = new Map<string, number[]>()
  for (const r of rots) {
    out.set(r.join(','), [...r])
    const sr = composePerms(S, r)
    out.set(sr.join(','), [...sr])
  }
  return [...out.values()]
}

const D4_PERMS = d4Permutations()

function applySlotPerm(slots: readonly string[], perm: readonly number[]): string[] {
  return [0, 1, 2, 3].map((i) => slots[perm[i]!]!)
}

function armSignature(arm: CornerCondition['arms'][number] | undefined): string {
  if (!arm) return ''
  return `${arm.systemId}\t${arm.source}\t${arm.kind}`
}

/** Four slots in N,E,S,W order (up, right, down, left). */
export function connectionSlotsFromArms(arms: CornerCondition['arms']): string[] {
  return SLOT_DIRS.map((d) => {
    const arm = arms.find((a) => a.dir === d)
    return armSignature(arm)
  })
}

function parseArmSignature(sig: string): { systemId: string; source: 'arch' | 'mep'; kind: 'wall' | 'run' } | null {
  if (!sig) return null
  const parts = sig.split('\t')
  if (parts.length < 3) return null
  const [systemId, source, kind] = parts
  if (source !== 'arch' && source !== 'mep') return null
  if (kind !== 'wall' && kind !== 'run') return null
  return { systemId, source, kind }
}

/**
 * Lexicographically minimal encoding over D4; two junctions share a template iff this matches.
 */
export function connectionTemplateKeyFromSlots(slots: readonly string[]): string {
  let best = ''
  for (const p of D4_PERMS) {
    const enc = applySlotPerm(slots, p).join('\x1f')
    if (!best || enc.localeCompare(best) < 0) best = enc
  }
  return best
}

function connectionTemplateKeyFromCorner(cc: CornerCondition): string {
  return connectionTemplateKeyFromSlots(connectionSlotsFromArms(cc.arms))
}

/**
 * Same wall/run signature on every occupied arm (L → 2, T → 3, X → 4). Used to merge one detail family per uniform material.
 */
function homogeneousUniformArmSignature(
  shape: CornerShape,
  arms: CornerCondition['arms'],
): string | null {
  const expected = shape === 'L' ? 2 : shape === 'T' ? 3 : shape === 'X' ? 4 : 0
  if (expected === 0 || arms.length !== expected) return null
  const sigs = [...new Set(arms.map((a) => armSignature(a)))]
  if (sigs.length !== 1 || !sigs[0]) return null
  return sigs[0]
}

const HOMOGENEOUS_CORNER_PREFIXES = ['L-hom\x1f', 'T-hom\x1f', 'X-hom\x1f'] as const

/**
 * Instance key for homogeneous corners (same system/source/kind on every arm): one family per signature.
 * L / T / X use `L-hom`, `T-hom`, `X-hom` prefixes; otherwise D4-minimal slot key.
 */
export function connectionDetailGroupingKeyFromCorner(cc: CornerCondition): string {
  if (cc.shape === 'L' || cc.shape === 'T' || cc.shape === 'X') {
    const homo = homogeneousUniformArmSignature(cc.shape, cc.arms)
    if (homo != null) {
      const prefix = cc.shape === 'L' ? 'L-hom' : cc.shape === 'T' ? 'T-hom' : 'X-hom'
      return `${prefix}\x1f${homo}`
    }
  }
  return connectionTemplateKeyFromCorner(cc)
}

/** Plan instance / merged row family key: `L-hom|T-hom|X-hom\x1f{signature}` (exactly two `\x1f`-segments). */
export function isHomogeneousLFamilyKey(templateKey: string): boolean {
  if (templateKey.split('\x1f').length !== 2) return false
  return HOMOGENEOUS_CORNER_PREFIXES.some((p) => templateKey.startsWith(p))
}

/**
 * Every **T** and **X** plan junction gets the same multivariant connection-detail flow as homogeneous corners
 * (hover bar, per-node sketch pick, `…\x1fv{n}` sheet keys). **L** only when `L-hom` / `T-hom` / `X-hom` — mixed **L**
 * still uses a single D4 row with no variant strip.
 */
export function connectionDetailRowSupportsConnectionVariants(row: PlanConnection): boolean {
  if (isHomogeneousLFamilyKey(row.templateKey)) return true
  if (row.shape === 'T' || row.shape === 'X') return true
  return false
}

/** Pick the D4 permutation that yields the minimal slot encoding (stable tie-break: first in D4_PERMS). */
function bestD4PermForSlots(slots: readonly string[]): readonly number[] {
  let best = ''
  let bestPerm = D4_PERMS[0]!
  for (const p of D4_PERMS) {
    const enc = applySlotPerm(slots, p).join('\x1f')
    if (!best || enc.localeCompare(best) < 0) {
      best = enc
      bestPerm = p
    }
  }
  return bestPerm
}

/** FNV-1a hash → `tpl:…` id for connection-detail sketch map keys. */
export function connectionDetailStableTemplateId(templateKey: string): string {
  let h = 2166136261
  for (let i = 0; i < templateKey.length; i++) {
    h ^= templateKey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `tpl:${(h >>> 0).toString(16)}`
}

function stableTemplateId(templateKey: string): string {
  return connectionDetailStableTemplateId(templateKey)
}

/**
 * Re-orient arms/directions to the canonical D4 frame used for `templateKey` (detail SVG is consistent).
 */
export function normalizeConnectionArmsToCanonical(
  arms: CornerCondition['arms'],
): { arms: CornerCondition['arms']; directions: CornerCondition['directions'] } {
  const slots = connectionSlotsFromArms(arms)
  const perm = bestD4PermForSlots(slots)
  const canon = applySlotPerm(slots, perm)
  const newArms: CornerCondition['arms'] = []
  for (let i = 0; i < 4; i++) {
    const sig = canon[i]!
    const parsed = parseArmSignature(sig)
    if (!parsed) continue
    newArms.push({ dir: SLOT_DIRS[i]!, ...parsed })
  }
  return {
    arms: newArms,
    directions: {
      up: canon[0] !== '',
      right: canon[1] !== '',
      down: canon[2] !== '',
      left: canon[3] !== '',
    },
  }
}

function defaultLayoutRefs(): LayoutRefs {
  return {
    exterior_wall_assembly: '',
    structural_clt_core: '',
    interior_partition: '',
    balcony_assembly: '',
  }
}

function participantAbbrev(p: PlanConnectionParticipant): string {
  if (p.source === 'mep' && p.kind === 'run') {
    const t = p.category?.trim() || p.systemName
    if (/duct/i.test(t) || /hvac/i.test(p.systemName)) return 'duct'
    if (/pipe|plumb|water|waste|vent/i.test(t)) return 'pipe'
    return t.length > 14 ? `${t.slice(0, 13)}…` : t
  }
  const parts = (p.layerSummary ?? p.systemName).split('/').map((s) => s.trim()).filter(Boolean)
  const head = parts[0] ?? p.systemName
  return head.length > 16 ? `${head.slice(0, 15)}…` : head
}

/** Single-line compact list for plan labels (pipe-separated tokens). */
export function formatConnectionParticipantsCompact(c: PlanConnection): string {
  return c.participants.map((p) => `${p.systemId} · ${participantAbbrev(p)}`).join(' | ')
}

/** Full multi-line description for tooltips / detail chrome. */
export function formatConnectionParticipantsFull(c: PlanConnection): string {
  const lines = c.participants.map((p) => {
    const bits = [
      `${p.systemId} — ${p.systemName}`,
      p.category?.trim() ? `(${p.category})` : '',
      p.totalThicknessIn != null && p.totalThicknessIn > 0 ? `${p.totalThicknessIn.toFixed(2)}" THK` : '',
      p.layerSummary ? p.layerSummary : '',
    ].filter(Boolean)
    return bits.join(' · ')
  })
  const occ = c.occurrences
  const occLine =
    occ && occ.length > 0
      ? `\n${occ.length} location(s): ${occ.map((o) => `${o.nodeI}:${o.nodeJ}`).join(', ')}`
      : ''
  return [c.label, `Grid node ${c.nodeI}:${c.nodeJ} · ${c.shape}`, ...lines].join('\n') + occLine
}

export function truncateText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  if (maxChars < 4) return s.slice(0, maxChars)
  return `${s.slice(0, maxChars - 1)}…`
}

/** Connection-detail sheet code shown in the sidebar (1-based). */
export function connectionDetailSheetBadge(sheetIndex: number): string {
  return `C${sheetIndex + 1}`
}

function homogeneousConnectionVariantNavSuffix(templateKey: string): string {
  const parts = templateKey.split('\x1f')
  const tail = parts[parts.length - 1] ?? ''
  const m = /^v(\d+)$/.exec(tail)
  if (!m) return ''
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return ''
  return ` · Drawing ${n + 1}`
}

/**
 * Sidebar line for a connection-detail row (after the badge). Pass the merged row from
 * `buildConnectionDetailSheets` so location hints match the catalog entry.
 */
export function connectionDetailSheetNavSubtitle(c: PlanConnection): string {
  const n = c.occurrences?.length ?? 1
  const locHint = n > 1 ? ` · ${n} locations` : ` · ${c.nodeI}:${c.nodeJ}`
  return `${c.label} · ${c.shape}${locHint}${homogeneousConnectionVariantNavSuffix(c.templateKey)}`
}

function layerSummaryForSystem(sys: SystemData): string {
  const parts = sys.layers
    .filter((l) => l.visible !== false)
    .slice(0, 5)
    .map((l) => (l.material || l.name || '').trim())
    .filter(Boolean)
  return parts.join(' / ')
}

function resolveParticipant(
  entry: CornerSystemEntry,
  systemById: Map<string, SystemData>,
  mepById: Map<string, MepItem>,
  thicknessBySystem: Record<string, number>,
): PlanConnectionParticipant {
  if (entry.source === 'arch' && entry.kind === 'wall') {
    const sys = systemById.get(entry.systemId)
    const totalFromCsv = sys ? parseThickness(sys.totalThickness) : 0
    const t =
      totalFromCsv > 0
        ? totalFromCsv
        : thicknessBySystem[entry.systemId] > 0
          ? thicknessBySystem[entry.systemId]!
          : undefined
    return {
      systemId: entry.systemId,
      source: 'arch',
      kind: 'wall',
      systemName: sys?.name ?? entry.systemId,
      category: sys?.category ?? '',
      ...(t != null && t > 0 ? { totalThicknessIn: t } : {}),
      ...(sys ? { layerSummary: layerSummaryForSystem(sys) } : {}),
    }
  }
  const m = mepById.get(entry.systemId)
  return {
    systemId: entry.systemId,
    source: 'mep',
    kind: 'run',
    systemName: m?.name ?? entry.systemId,
    category: m?.discipline ?? m?.systemType ?? '',
  }
}

function uniqueParticipantOrder(systems: CornerSystemEntry[]): CornerSystemEntry[] {
  const seen = new Set<string>()
  const out: CornerSystemEntry[] = []
  for (const s of systems) {
    const k = `${s.source}\t${s.systemId}\t${s.kind}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function systemsFromNormalizedArms(arms: CornerCondition['arms']): CornerSystemEntry[] {
  const seen = new Set<string>()
  const out: CornerSystemEntry[] = []
  for (const a of arms) {
    const k = `${a.source}\t${a.systemId}\t${a.kind}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ systemId: a.systemId, source: a.source, kind: a.kind })
  }
  return out
}

function mergeConnectionGroup(
  group: PlanConnection[],
  mergedTemplateKey: string,
  systemById: Map<string, SystemData>,
  mepById: Map<string, MepItem>,
  thicknessBySystem: Record<string, number>,
): PlanConnection {
  const sorted = [...group].sort((a, b) => a.nodeJ - b.nodeJ || a.nodeI - b.nodeI || a.id.localeCompare(b.id))
  const first = sorted[0]!
  const templateKey = mergedTemplateKey
  const armsPhysical = first.arms.map((a) => ({ ...a }))
  const { arms, directions } = normalizeConnectionArmsToCanonical(first.arms)
  const systems = systemsFromNormalizedArms(arms)
  const wallSystemIds = [...new Set(arms.map((a) => a.systemId))]
  const participants = uniqueParticipantOrder(systems).map((e) =>
    resolveParticipant(e, systemById, mepById, thicknessBySystem),
  )
  const occurrences: PlanConnectionOccurrence[] = sorted.map((c) => ({
    nodeI: c.nodeI,
    nodeJ: c.nodeJ,
    instanceId: c.id,
  }))

  return {
    id: stableTemplateId(templateKey),
    kind: 'grid_junction',
    nodeI: first.nodeI,
    nodeJ: first.nodeJ,
    shape: first.shape,
    label: first.label,
    wallSystemIds,
    systems,
    arms,
    armsPhysical,
    directions,
    participants,
    templateKey,
    occurrences,
  }
}

export function getOrInferHomogeneousLVariantIds(
  familyKey: string,
  layoutSketch: PlanLayoutSketch,
  connectionSketchKeys: ReadonlySet<string>,
): string[] {
  const explicit = layoutSketch.connectionDetailHomogeneousLVariantIdsByFamily?.[familyKey]
  if (explicit && explicit.length > 0) return [...explicit]

  const parts = familyKey.split('\x1f')
  if (parts.length !== 2) {
    return [connectionDetailStableTemplateId(familyKey)]
  }
  const prefix = parts[0]!
  const homo = parts[1]!

  if (prefix === 'L-hom') {
    const legacyA = connectionDetailStableTemplateId(`L-hom\x1f${homo}\x1fa`)
    const legacyB = connectionDetailStableTemplateId(`L-hom\x1f${homo}\x1fb`)
    const hasA = connectionSketchKeys.has(legacyA)
    const hasB = connectionSketchKeys.has(legacyB)
    if (hasA && hasB) return [legacyA, legacyB]
    if (hasA) return [legacyA]
    if (hasB) return [legacyB]
    return [connectionDetailStableTemplateId(familyKey)]
  }

  if (prefix === 'T-hom' || prefix === 'X-hom') {
    return [connectionDetailStableTemplateId(familyKey)]
  }

  return [connectionDetailStableTemplateId(familyKey)]
}

/** New `tpl:…` when appending a homogeneous L/T/X variant (stable hash of unique salt). */
export function connectionDetailNewHomogeneousLVariantSketchId(
  familyKey: string,
  salt: string,
): string {
  return connectionDetailStableTemplateId(`${familyKey}\x1fvariant\x1f${salt}`)
}

/**
 * One row per unique junction pattern (D4-equivalent), plus extra rows per homogeneous L/T/X variant.
 * Pass `connectionSketchKeys` (e.g. `Object.keys(connectionSketches)`) so legacy Ext/Int sketch ids are inferred.
 */
export function buildConnectionDetailSheets(
  instances: readonly PlanConnection[],
  orderedSystems: readonly SystemData[],
  mepItems: readonly MepItem[],
  thicknessBySystem: Record<string, number>,
  layoutSketch: PlanLayoutSketch,
  connectionSketchKeys?: ReadonlySet<string>,
): PlanConnection[] {
  if (instances.length === 0) return []
  const systemById = new Map(orderedSystems.map((s) => [s.id, s]))
  const mepById = new Map(mepItems.map((m) => [m.id, m]))
  const keySet = connectionSketchKeys ?? new Set<string>()
  const groups = new Map<string, PlanConnection[]>()
  for (const c of instances) {
    const k = c.templateKey
    let g = groups.get(k)
    if (!g) {
      g = []
      groups.set(k, g)
    }
    g.push(c)
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  const merged = keys.map((k) =>
    mergeConnectionGroup(groups.get(k)!, k, systemById, mepById, thicknessBySystem),
  )
  const out: PlanConnection[] = []
  for (const row of merged) {
    if (connectionDetailRowSupportsConnectionVariants(row)) {
      const variantIds = getOrInferHomogeneousLVariantIds(row.templateKey, layoutSketch, keySet)
      const list = variantIds.length > 0 ? variantIds : [connectionDetailStableTemplateId(row.templateKey)]
      for (let i = 0; i < list.length; i++) {
        out.push({
          ...row,
          id: list[i]!,
          templateKey: `${row.templateKey}\x1fv${i}`,
        })
      }
    } else {
      out.push(row)
    }
  }
  return out
}

/**
 * Grid junctions from plan edges, with catalog-resolved participant rows.
 * Deterministic order: sort by j, then i, then id. Each row is one plan node (instance).
 */
export function buildPlanConnections(
  sketch: PlanLayoutSketch,
  orderedSystems: readonly SystemData[],
  mepItems: readonly MepItem[],
  layoutRefs: LayoutRefs | undefined,
  thicknessBySystem: Record<string, number>,
): PlanConnection[] {
  const systemById = new Map(orderedSystems.map((s) => [s.id, s]))
  const mepById = new Map(mepItems.map((m) => [m.id, m]))
  const systemInfoById = new Map<string, SystemInfo>()
  for (const s of orderedSystems) {
    systemInfoById.set(s.id, { name: s.name, category: s.category })
  }
  for (const m of mepItems) {
    if (!systemInfoById.has(m.id)) {
      systemInfoById.set(m.id, { name: m.name, category: m.discipline })
    }
  }

  const corners = detectCornerConditions(sketch.edges, layoutRefs ?? defaultLayoutRefs(), systemInfoById)
  const out: PlanConnection[] = []

  for (const cc of corners) {
    const templateKey = connectionDetailGroupingKeyFromCorner(cc)
    const participants = uniqueParticipantOrder(cc.systems).map((e) =>
      resolveParticipant(e, systemById, mepById, thicknessBySystem),
    )
    out.push({
      id: `junction:${cc.nodeI}:${cc.nodeJ}`,
      kind: 'grid_junction',
      nodeI: cc.nodeI,
      nodeJ: cc.nodeJ,
      shape: cc.shape,
      label: cc.label,
      wallSystemIds: cc.wallSystemIds,
      systems: cc.systems,
      arms: cc.arms,
      directions: cc.directions,
      participants,
      templateKey,
    })
  }

  out.sort((a, b) => a.nodeJ - b.nodeJ || a.nodeI - b.nodeI || a.id.localeCompare(b.id))
  return out
}

/** Plan cardinal from grid node; matches sketch Y-down. */
export type ConnectionDetailStripDir = 'up' | 'down' | 'left' | 'right'

export interface ConnectionDetailStripDescriptor {
  systemId: string
  source: 'arch' | 'mep'
  kind: 'wall' | 'run'
  dir: ConnectionDetailStripDir
}

function participantStripRank(p: PlanConnectionParticipant, layoutRefs: LayoutRefs): number {
  if (p.source === 'arch' && p.kind === 'wall') {
    if (p.systemId === layoutRefs.exterior_wall_assembly) return 0
    if (p.systemId === layoutRefs.interior_partition) return 1
    return 2
  }
  if (p.source === 'arch') return 5
  return 10
}

/**
 * One strip per occupied plan direction at the node (L → 2, T → 3, X → 4), **plan** `dir` from
 * `armsPhysical` when present (connection-detail sheet rows) so geometry matches the sketch.
 */
export function connectionDetailStripDescriptorsFromPlan(
  c: PlanConnection,
  layoutRefs: LayoutRefs,
): ConnectionDetailStripDescriptor[] {
  const arms = c.armsPhysical ?? c.arms
  if (arms.length === 0) return []

  const armParticipantRank = (arm: (typeof arms)[number]): number => {
    const p = c.participants.find(
      (x) => x.systemId === arm.systemId && x.source === arm.source && x.kind === arm.kind,
    )
    if (!p) return 50
    return participantStripRank(p, layoutRefs)
  }

  const sortedArms = [...arms].sort((a, b) => armParticipantRank(a) - armParticipantRank(b))
  const usedDir = new Set<ConnectionDetailStripDir>()
  const out: ConnectionDetailStripDescriptor[] = []
  for (const arm of sortedArms) {
    if (usedDir.has(arm.dir)) continue
    usedDir.add(arm.dir)
    out.push({
      systemId: arm.systemId,
      source: arm.source,
      kind: arm.kind,
      dir: arm.dir,
    })
  }

  return out
}

/**
 * Grid segment that owns the given arm at a junction node (plan Y-down).
 * `right`/`down` use `(nodeI, nodeJ)`; `left`/`up` use the adjacent unit edge ending at the node.
 */
export function placedGridEdgeForJunctionArm(
  nodeI: number,
  nodeJ: number,
  arm: Pick<ConnectionDetailStripDescriptor, 'dir' | 'systemId' | 'source' | 'kind'>,
): PlacedGridEdge {
  const { dir, systemId, source, kind } = arm
  if (dir === 'right') {
    return { axis: 'h', i: nodeI, j: nodeJ, systemId, source, kind }
  }
  if (dir === 'left') {
    return { axis: 'h', i: nodeI - 1, j: nodeJ, systemId, source, kind }
  }
  if (dir === 'down') {
    return { axis: 'v', i: nodeI, j: nodeJ, systemId, source, kind }
  }
  return { axis: 'v', i: nodeI, j: nodeJ - 1, systemId, source, kind }
}

/**
 * The placed edge at this junction for `arm.dir` (same grid keys as `detectCornerConditions`), or undefined.
 */
export function findPlacedEdgeForJunctionArm(
  edges: readonly PlacedGridEdge[],
  nodeI: number,
  nodeJ: number,
  arm: Pick<
    CornerCondition['arms'][number],
    'dir' | 'systemId' | 'source' | 'kind'
  >,
): PlacedGridEdge | undefined {
  const src = arm.source ?? 'arch'
  const kind = arm.kind ?? 'wall'
  const sys = arm.systemId
  const match = (e: PlacedGridEdge) =>
    (e.source ?? 'arch') === src && (e.kind ?? 'wall') === kind && e.systemId === sys

  switch (arm.dir) {
    case 'right':
      return edges.find((e) => e.axis === 'h' && e.i === nodeI && e.j === nodeJ && match(e))
    case 'left':
      return edges.find((e) => e.axis === 'h' && e.i === nodeI - 1 && e.j === nodeJ && match(e))
    case 'down':
      return edges.find((e) => e.axis === 'v' && e.i === nodeI && e.j === nodeJ && match(e))
    case 'up':
      return edges.find((e) => e.axis === 'v' && e.i === nodeI && e.j === nodeJ - 1 && match(e))
    default:
      return undefined
  }
}

/**
 * Expanded sheet template key at this plan node (`…\x1fv{n}`) when the row supports connection variants
 * (homogeneous L/T/X keys, or any **T** / **X** junction), else `c.templateKey`.
 * Uses per-node sketch pick, then legacy convex/concave → variant index 0 / 1 (L-hom only), else first variant.
 */
export function resolvedConnectionDetailTemplateKey(
  c: PlanConnection,
  junctionSketch: PlanLayoutSketch,
  connectionSketchKeys?: ReadonlySet<string>,
): string {
  const fk = c.templateKey
  if (!connectionDetailRowSupportsConnectionVariants(c)) return fk
  const keySet = connectionSketchKeys ?? new Set<string>()
  const variantIds = getOrInferHomogeneousLVariantIds(fk, junctionSketch, keySet)
  const list = variantIds.length > 0 ? variantIds : [connectionDetailStableTemplateId(fk)]
  const nodeKey = `${c.nodeI}:${c.nodeJ}`
  let sketchId = junctionSketch.connectionJunctionHomogeneousLSketchIdByNode?.[nodeKey]
  if (sketchId != null && !list.includes(sketchId)) sketchId = undefined
  if (sketchId == null) {
    if (fk.startsWith('L-hom\x1f')) {
      const leg = junctionSketch.connectionJunctionConvexConcaveByNode?.[nodeKey]
      if (leg === 'convex') sketchId = list[0]
      else if (leg === 'concave') sketchId = list[1] ?? list[0]
      else sketchId = list[0]
    } else {
      sketchId = list[0]
    }
  }
  const idx = Math.max(0, list.indexOf(sketchId!))
  return `${fk}\x1fv${idx}`
}

/**
 * Canvas center for junction “cap” boxes: matches wall strokes that use {@link archEdgePerpOffsetCanvasPx}
 * (openings / band nudge), not the raw grid node. Averages each arm’s endpoint at this junction when offsets differ.
 */
export function connectionJunctionCapCenterCanvasPx(
  cc: PlanConnection,
  d: BuildingDimensions,
  deltaIn: number,
  edges: readonly PlacedGridEdge[],
): { x: number; y: number } {
  const arms = cc.armsPhysical ?? cc.arms
  const fallback = {
    x: cc.nodeI * deltaIn * d.planScale,
    y: cc.nodeJ * deltaIn * d.planScale,
  }
  if (arms.length === 0) return fallback

  let sx = 0
  let sy = 0
  let n = 0

  for (const arm of arms) {
    const e =
      findPlacedEdgeForJunctionArm(edges, cc.nodeI, cc.nodeJ, arm) ??
      placedGridEdgeForJunctionArm(cc.nodeI, cc.nodeJ, arm)
    const base = edgeEndpointsCanvasPx(d, e, deltaIn)
    const off = archEdgePerpOffsetCanvasPx(e, d)
    let x: number
    let y: number
    if (e.axis === 'h') {
      if (e.i === cc.nodeI && e.j === cc.nodeJ) {
        x = base.x1 + off.dx
        y = base.y1 + off.dy
      } else if (e.i === cc.nodeI - 1 && e.j === cc.nodeJ) {
        x = base.x2 + off.dx
        y = base.y2 + off.dy
      } else {
        continue
      }
    } else {
      if (e.i === cc.nodeI && e.j === cc.nodeJ) {
        x = base.x1 + off.dx
        y = base.y1 + off.dy
      } else if (e.i === cc.nodeI && e.j === cc.nodeJ - 1) {
        x = base.x2 + off.dx
        y = base.y2 + off.dy
      } else {
        continue
      }
    }
    sx += x
    sy += y
    n += 1
  }

  if (n === 0) return fallback
  return { x: sx / n, y: sy / n }
}

/**
 * Plan size (inches) of the dashed junction highlight on the floor layout — same rules as the SVG `rect` in PlanLayoutEditor.
 * Horizontal arms (left/right) set depth (Y); vertical arms (up/down) set width (X). Converts stroke px → inches via `planScale`.
 */
export function connectionJunctionHighlightPlanInches(
  cc: PlanConnection,
  d: BuildingDimensions,
  mepById: Map<string, MepItem>,
): { widthIn: number; depthIn: number } {
  const arms = cc.armsPhysical ?? cc.arms
  let rwPx = 0
  let rhPx = 0
  for (const arm of arms) {
    const sw = strokeWidthForEdge(d, placedGridEdgeForJunctionArm(cc.nodeI, cc.nodeJ, arm), mepById)
    if (arm.dir === 'left' || arm.dir === 'right') {
      rhPx = Math.max(rhPx, sw)
    } else {
      rwPx = Math.max(rwPx, sw)
    }
  }
  const fallback = Math.max(2, 6 * d.planScale)
  if (rwPx < 1) rwPx = fallback
  if (rhPx < 1) rhPx = fallback

  return {
    widthIn: rwPx / d.planScale,
    depthIn: rhPx / d.planScale,
  }
}

/**
 * Max plan stroke width (px) among arms — matches PlanLayoutEditor corner cap color/thickness pick
 * and sorts junction fills with wall/MEP strokes in paint order.
 */
export function cornerConnectionPlanStrokeSortPx(
  cc: PlanConnection,
  d: BuildingDimensions,
  mepById: ReadonlyMap<string, MepItem>,
): number {
  const arms = cc.armsPhysical ?? cc.arms
  let best = 0
  for (const arm of arms) {
    best = Math.max(
      best,
      strokeWidthForEdge(d, placedGridEdgeForJunctionArm(cc.nodeI, cc.nodeJ, arm), mepById),
    )
  }
  return best
}
