import type { SystemData } from '../types/system'
import { CATEGORY_LABELS } from '../types/system'

export interface SearchHit {
  id: string
  pageIndex: number
  /** Present for layer-level hits (0-based index in `system.layers`) */
  layerIndex?: number
  primary: string
  secondary: string
  haystack: string
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** All navigable pages + systems + per-layer rows for full-text search */
export function buildSearchHits(orderedSystems: SystemData[]): SearchHit[] {
  const hits: SearchHit[] = []

  hits.push({
    id: 'page-0',
    pageIndex: 0,
    primary: 'A3 — Building Section',
    secondary: 'Composite sheet · all systems',
    haystack: norm('A3 sheet 00 building section composite elevation all systems'),
  })
  hits.push({
    id: 'page-1',
    pageIndex: 1,
    primary: 'A1 — Building Plan',
    secondary: 'Composite plan · all systems',
    haystack: norm('A1 sheet 01 building plan level floor composite all systems'),
  })

  for (let i = 0; i < orderedSystems.length; i++) {
    const sys = orderedSystems[i]
    const pageIndex = i + 2
    const cat = CATEGORY_LABELS[sys.category]
    hits.push({
      id: `sys-${sys.id}`,
      pageIndex,
      primary: `${sys.id} — ${sys.name}`,
      secondary: `${cat} · THK ${sys.totalThickness} in · R ${sys.totalR}`,
      haystack: norm(
        `${sys.id} ${sys.name} ${cat} ${sys.totalThickness} ${sys.totalR} sheet ${String(pageIndex).padStart(2, '0')}`,
      ),
    })

    for (let li = 0; li < sys.layers.length; li++) {
      const layer = sys.layers[li]
      hits.push({
        id: `layer-${sys.id}-${layer.index}`,
        pageIndex,
        layerIndex: li,
        primary: layer.name,
        secondary: `${sys.id} · ${layer.material}`,
        haystack: norm(
          [
            sys.id,
            sys.name,
            layer.name,
            layer.material,
            layer.thickness,
            layer.rValue,
            layer.connection,
            layer.fastener,
            layer.fastenerSize,
            layer.notes,
            layer.layerType,
            layer.fill,
          ]
            .filter(Boolean)
            .join(' '),
        ),
      })
    }
  }

  return hits
}

export function filterSearchHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return hits.filter(h => h.layerIndex === undefined).slice(0, 40)
  }
  const tokens = q.split(/\s+/).filter(Boolean)
  return hits.filter(h => tokens.every(t => h.haystack.includes(t))).slice(0, 120)
}
