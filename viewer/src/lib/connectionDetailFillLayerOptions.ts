import type { MepItem } from '../types/mep'
import type { SystemData } from '../types/system'
import type { PlanConnection } from './planConnections'
import {
  connectionDetailManualFillSvgColor,
  type ConnectionDetailLayerFillPick,
} from './connectionDetailManualFill'
import type { PlanColorCatalog } from './planLayerColors'

export const CONNECTION_DETAIL_FILL_CLEAR_VALUE = '__clear__'

export type ConnectionDetailFillLayerOptionRow = {
  value: string
  label: string
  fillPreview: string
}

function resolveSystemById(systemId: string, orderedSystems: readonly SystemData[]): SystemData | undefined {
  const tid = systemId.trim()
  if (!tid) return undefined
  const byId = new Map(orderedSystems.map((s) => [s.id.trim(), s]))
  let s = byId.get(tid)
  if (s) return s
  const tl = tid.toLowerCase()
  s = orderedSystems.find((x) => x.id.trim().toLowerCase() === tl)
  if (s) return s
  s = orderedSystems.find((x) => tid === x.id.trim() || tid.endsWith(x.id) || x.id.endsWith(tid))
  return s
}

/** Toolbar rows: clear + each catalog layer for arch participants + one row per MEP participant. */
export function connectionDetailFillLayerOptionRows(
  connection: PlanConnection,
  orderedSystems: readonly SystemData[],
  _mepItems: readonly MepItem[],
  planColorCatalog: PlanColorCatalog,
): ConnectionDetailFillLayerOptionRow[] {
  void _mepItems
  const rows: ConnectionDetailFillLayerOptionRow[] = [
    {
      value: CONNECTION_DETAIL_FILL_CLEAR_VALUE,
      label: 'Clear fill (clicked zone)',
      fillPreview: '#e4e4e7',
    },
  ]
  const seenArch = new Set<string>()
  const seenMep = new Set<string>()
  for (const p of connection.participants) {
    if (p.source === 'arch') {
      if (seenArch.has(p.systemId)) continue
      seenArch.add(p.systemId)
      const sys = resolveSystemById(p.systemId, orderedSystems)
      const layers = sys?.layers ?? []
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li]!
        const nameBit = (layer.name ?? '').trim() || layer.layerType
        rows.push({
          value: `arch\t${p.systemId}\t${li}`,
          label: `${p.systemId} · layer ${li + 1} — ${nameBit}`,
          fillPreview: connectionDetailManualFillSvgColor(
            { source: 'arch', systemId: p.systemId, layerIndex: li },
            orderedSystems,
            planColorCatalog,
          ),
        })
      }
    } else if (p.source === 'mep') {
      if (seenMep.has(p.systemId)) continue
      seenMep.add(p.systemId)
      rows.push({
        value: `mep\t${p.systemId}\t0`,
        label: `MEP · ${p.systemName || p.systemId}`,
        fillPreview: connectionDetailManualFillSvgColor(
          { source: 'mep', systemId: p.systemId, layerIndex: 0 },
          orderedSystems,
          planColorCatalog,
        ),
      })
    }
  }
  return rows
}

export function parseConnectionDetailFillPickKey(key: string): ConnectionDetailLayerFillPick | 'clear' | null {
  if (key === CONNECTION_DETAIL_FILL_CLEAR_VALUE) return 'clear'
  const parts = key.split('\t')
  if (parts.length !== 3) return null
  const [src, sid, ixs] = parts
  const layerIndex = Number(ixs)
  if (!(src === 'arch' || src === 'mep') || !sid || !Number.isFinite(layerIndex) || layerIndex < 0) return null
  return { source: src, systemId: sid, layerIndex: Math.round(layerIndex) }
}
