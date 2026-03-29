import { splitCsvLine } from './csvSplit'
import { parseThickness } from './csvParser'
import type { MepItem } from '../types/mep'
import type { SystemData } from '../types/system'
import { getDisciplineFromSystemId, MEP_PLAN_DISCIPLINE_CODES } from '../data/disciplines'

const REQUIRED = ['System_ID', 'Name'] as const

export interface ParseMepResult {
  items: MepItem[]
  errors: string[]
}

/** Expected headers: System_ID, Name, Discipline, Plan_Width_in, Notes */
export function parseMepCsv(raw: string): ParseMepResult {
  const errors: string[] = []
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    return { items: [], errors: ['MEP CSV needs a header row and at least one data row.'] }
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim())
  const col = (name: string) => {
    const i = headers.indexOf(name)
    return i >= 0 ? i : -1
  }
  for (const r of REQUIRED) {
    if (!headers.includes(r)) {
      errors.push(`Missing required column: ${r}`)
    }
  }
  if (errors.length) return { items: [], errors }

  const iId = col('System_ID')
  const iName = col('Name')
  const iDisc = col('Discipline')
  const iType = col('System_Type')
  const iWidth = col('Plan_Width_in')
  const iEqL = col('Plan_Equip_Length_in')
  const iEqW = col('Plan_Equip_Width_in')
  const iNotes = col('Notes')
  const iColor = col('Plan_Color')

  const items: MepItem[] = []
  for (let li = 1; li < lines.length; li++) {
    const row = splitCsvLine(lines[li])
    const id = (row[iId] ?? '').trim()
    if (!id) continue
    const name = (row[iName] ?? '').trim() || id
    const discipline = iDisc >= 0 ? (row[iDisc] ?? '').trim() : ''
    const systemType = iType >= 0 ? (row[iType] ?? '').trim() : ''
    const wRaw = iWidth >= 0 ? (row[iWidth] ?? '').trim() : ''
    const planWidthIn = wRaw ? parseThickness(wRaw) : 0
    const elRaw = iEqL >= 0 ? (row[iEqL] ?? '').trim() : ''
    const planEquipLengthIn = elRaw ? parseThickness(elRaw) : 0
    const ewRaw = iEqW >= 0 ? (row[iEqW] ?? '').trim() : ''
    const planEquipWidthIn = ewRaw ? parseThickness(ewRaw) : 0
    const notes = iNotes >= 0 ? (row[iNotes] ?? '').trim() : ''
    const colorRaw = iColor >= 0 ? (row[iColor] ?? '').trim() : ''
    const planColorHex = /^[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw.toLowerCase() : undefined
    items.push({
      id,
      name,
      discipline,
      systemType,
      planWidthIn,
      planEquipLengthIn,
      planEquipWidthIn,
      ...(planColorHex ? { planColorHex } : {}),
      notes,
    })
  }

  return { items, errors: [] }
}

/** Derive MepItem[] from the main Building_Systems CSV data so MEP systems
 *  work on the plan layout without a separate CSV upload. */
export function deriveMepItemsFromSystems(systems: readonly SystemData[]): MepItem[] {
  return systems
    .filter((s) => MEP_PLAN_DISCIPLINE_CODES.has(getDisciplineFromSystemId(s.id)))
    .map((s) => ({
      id: s.id,
      name: s.name,
      discipline: s.category,
      systemType: s.systemType ?? '',
      planWidthIn: s.planDrawWidthIn ?? 0,
      planEquipLengthIn: s.planEquipLengthIn ?? 0,
      planEquipWidthIn: s.planEquipWidthIn ?? 0,
      ...(s.planColorHex ? { planColorHex: s.planColorHex } : {}),
      notes: s.layers[0]?.notes ?? '',
    }))
}
