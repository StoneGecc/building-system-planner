import type { SystemData } from '../types/system'
import { ELEVATION_SHEETS } from '../data/elevationSheets'
import { FLOOR1_SHEETS } from '../data/floor1Sheets'
import { PAGE_PHYSICAL_SPACE_INVENTORY, SYSTEM_PAGE_OFFSET } from '../data/pageIndices'

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
  hits.push({
    id: 'page-physical-space-inventory',
    pageIndex: PAGE_PHYSICAL_SPACE_INVENTORY,
    primary: 'Physical space inventory',
    secondary: 'Floor 1 rooms · gross sq ft from layout grid',
    haystack: norm(
      `physical space inventory psi room rooms square feet sq ft area spreadsheet sheet ${String(PAGE_PHYSICAL_SPACE_INVENTORY).padStart(2, '0')} floor 1 layout`,
    ),
  })
  for (const sheet of FLOOR1_SHEETS) {
    const isLayout = sheet.id === 'layout'
    hits.push({
      id: `page-floor1-${sheet.id}`,
      pageIndex: sheet.pageIndex,
      primary: isLayout ? 'Layout' : `${sheet.label} — Floor 1`,
      secondary: isLayout
        ? 'Floor 1 · grid sketch · architecture only (MEP on trade sheets)'
        : `Floor 1 · ${sheet.label.toLowerCase()} · filtered MEP / tools`,
      haystack: norm(
        `floor 1 ${sheet.label} ${sheet.id} layout grid sketch sheet ${String(sheet.pageIndex).padStart(2, '0')} ${isLayout ? 'arch walls floor room annotation' : 'mep trade discipline'}`,
      ),
    })
  }

  for (const sheet of ELEVATION_SHEETS) {
    hits.push({
      id: `page-elevation-${sheet.id}`,
      pageIndex: sheet.pageIndex,
      primary: `Elevation ${sheet.face}`,
      secondary: `${sheet.label} · elevation sketch (layout tools, no MEP)`,
      haystack: norm(
        `elevation ${sheet.face} ${sheet.label} ${sheet.id} sketch sheet ${String(sheet.pageIndex).padStart(2, '0')} north east south west`,
      ),
    })
  }

  for (let i = 0; i < orderedSystems.length; i++) {
    const sys = orderedSystems[i]
    const pageIndex = i + SYSTEM_PAGE_OFFSET
    const cat = sys.category?.trim() || 'Uncategorized'
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
