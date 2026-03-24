import { splitCsvLine } from './csvSplit'
import { parseThickness } from './csvParser'
import type { MepItem } from '../types/mep'

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
  const iWidth = col('Plan_Width_in')
  const iNotes = col('Notes')

  const items: MepItem[] = []
  for (let li = 1; li < lines.length; li++) {
    const row = splitCsvLine(lines[li])
    const id = (row[iId] ?? '').trim()
    if (!id) continue
    const name = (row[iName] ?? '').trim() || id
    const discipline = iDisc >= 0 ? (row[iDisc] ?? '').trim() : ''
    const wRaw = iWidth >= 0 ? (row[iWidth] ?? '').trim() : ''
    const planWidthIn = wRaw ? parseThickness(wRaw) : 0
    const notes = iNotes >= 0 ? (row[iNotes] ?? '').trim() : ''
    items.push({ id, name, discipline, planWidthIn, notes })
  }

  return { items, errors: [] }
}
