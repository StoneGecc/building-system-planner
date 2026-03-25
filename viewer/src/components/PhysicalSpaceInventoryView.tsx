import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BuildingDimensions } from '../types/system'
import type { PlanLayoutSketch } from '../types/planLayout'
import { footprintStorageKey } from '../types/planLayout'
import { physicalSpaceInventoryRows } from '../lib/planRooms'
import { cn } from '../lib/utils'

const sqFtFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

const DELETE_COLUMN_CONFIRM_WORD = 'delete'

type CustomColumn = { id: string; label: string }

type StoredInventoryExtras = {
  columns: CustomColumn[]
  /** rowId → columnId → text */
  cells: Record<string, Record<string, string>>
}

function storageKeyForFootprint(fp: string): string {
  return `psi-inventory-extras|${fp}`
}

function loadStored(fp: string): StoredInventoryExtras {
  try {
    const raw = localStorage.getItem(storageKeyForFootprint(fp))
    if (!raw) return { columns: [], cells: {} }
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return { columns: [], cells: {} }
    const o = p as Record<string, unknown>
    const columns = Array.isArray(o.columns) ? o.columns : []
    const cells = o.cells && typeof o.cells === 'object' ? o.cells : {}
    const safeCols: CustomColumn[] = []
    for (const c of columns) {
      if (!c || typeof c !== 'object') continue
      const r = c as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const label = typeof r.label === 'string' ? r.label : ''
      if (id) safeCols.push({ id, label: label || 'Column' })
    }
    const safeCells: Record<string, Record<string, string>> = {}
    for (const [rk, row] of Object.entries(cells as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') continue
      const rowObj: Record<string, string> = {}
      for (const [ck, cv] of Object.entries(row as Record<string, unknown>)) {
        if (typeof cv === 'string') rowObj[ck] = cv
      }
      safeCells[rk] = rowObj
    }
    return { columns: safeCols, cells: safeCells }
  } catch {
    return { columns: [], cells: {} }
  }
}

type PhysicalSpaceInventoryViewProps = {
  buildingDimensions: BuildingDimensions
  layoutSketch: PlanLayoutSketch
  className?: string
}

export function PhysicalSpaceInventoryView({
  buildingDimensions,
  layoutSketch,
  className,
}: PhysicalSpaceInventoryViewProps) {
  const fp = useMemo(() => footprintStorageKey(buildingDimensions), [buildingDimensions])
  const rows = useMemo(
    () => physicalSpaceInventoryRows(layoutSketch, buildingDimensions),
    [layoutSketch, buildingDimensions],
  )
  const totalSqFt = useMemo(() => rows.reduce((s, r) => s + r.sqFt, 0), [rows])
  const delta = layoutSketch.gridSpacingIn

  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([])
  const [cellValues, setCellValues] = useState<Record<string, Record<string, string>>>({})
  const [columnDeleteTarget, setColumnDeleteTarget] = useState<{ columnId: string; label: string } | null>(null)
  const [columnDeleteInput, setColumnDeleteInput] = useState('')
  const columnDeleteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const { columns, cells } = loadStored(fp)
    setCustomColumns(columns)
    setCellValues(cells)
  }, [fp])

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          storageKeyForFootprint(fp),
          JSON.stringify({ columns: customColumns, cells: cellValues }),
        )
      } catch {
        /* ignore quota */
      }
    }, 350)
    return () => window.clearTimeout(t)
  }, [fp, customColumns, cellValues])

  useEffect(() => {
    if (!columnDeleteTarget) return
    setColumnDeleteInput('')
    const id = requestAnimationFrame(() => columnDeleteInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [columnDeleteTarget])

  useEffect(() => {
    if (!columnDeleteTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setColumnDeleteTarget(null)
        setColumnDeleteInput('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [columnDeleteTarget])

  const addColumn = useCallback(() => {
    setCustomColumns((cols) => {
      const n = cols.length + 1
      const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      return [...cols, { id, label: `Column ${n}` }]
    })
  }, [])

  const setColumnLabel = useCallback((columnId: string, label: string) => {
    setCustomColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, label } : c)))
  }, [])

  const removeColumn = useCallback((columnId: string) => {
    setCustomColumns((cols) => cols.filter((c) => c.id !== columnId))
    setCellValues((prev) => {
      const next: Record<string, Record<string, string>> = {}
      for (const [rk, row] of Object.entries(prev)) {
        const copy = { ...row }
        delete copy[columnId]
        if (Object.keys(copy).length > 0) next[rk] = copy
      }
      return next
    })
  }, [])

  const openDeleteColumnModal = useCallback((columnId: string, label: string) => {
    setColumnDeleteTarget({ columnId, label })
  }, [])

  const closeDeleteColumnModal = useCallback(() => {
    setColumnDeleteTarget(null)
    setColumnDeleteInput('')
  }, [])

  const deleteColumnInputMatches =
    columnDeleteInput.trim().toLowerCase() === DELETE_COLUMN_CONFIRM_WORD

  const commitDeleteColumn = useCallback(() => {
    if (!columnDeleteTarget || !deleteColumnInputMatches) return
    removeColumn(columnDeleteTarget.columnId)
    closeDeleteColumnModal()
  }, [columnDeleteTarget, deleteColumnInputMatches, removeColumn, closeDeleteColumnModal])

  const setCell = useCallback((rowId: string, columnId: string, value: string) => {
    setCellValues((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? {}), [columnId]: value },
    }))
  }, [])

  const colSpanEmpty = 2 + customColumns.length + 1

  return (
    <div
      className={cn('flex flex-col flex-1 min-h-0 overflow-auto bg-muted/20 p-6', className)}
    >
      <div className="max-w-5xl mx-auto w-full space-y-4">
        <div>
          <h1 className="font-mono text-sm font-bold tracking-wide text-foreground uppercase">
            Physical space inventory
          </h1>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 leading-relaxed">
            Floor 1 enclosed rooms from the Layout sketch. Area = grid cells × ({delta.toFixed(2)} in)² per cell
            (ft²). Use Add column to add custom fields; removing a column opens a confirmation step. Data is saved
            for this building footprint.
          </p>
        </div>

        <div className="border border-border bg-white overflow-x-auto">
          <table className="w-full min-w-[min(100%,24rem)] border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-muted/80 border-b border-border text-left">
                <th className="px-3 py-2 font-semibold tracking-wide min-w-[8rem]">Room</th>
                <th className="px-3 py-2 font-semibold tracking-wide text-right whitespace-nowrap min-w-[4.5rem]">
                  Sq ft
                </th>
                {customColumns.map((col) => (
                  <th key={col.id} className="px-2 py-2 font-semibold tracking-wide min-w-[6.5rem] border-l border-border">
                    <div className="flex items-center gap-0.5 min-w-0">
                      <input
                        type="text"
                        value={col.label}
                        onChange={(e) => setColumnLabel(col.id, e.target.value)}
                        className={cn(
                          'flex-1 min-w-0 bg-transparent border border-transparent rounded px-1 py-0.5',
                          'font-semibold tracking-wide text-foreground placeholder:text-muted-foreground',
                          'focus:border-border focus:outline-none focus:ring-0',
                        )}
                        aria-label={`Column header ${col.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => openDeleteColumnModal(col.id, col.label)}
                        className={cn(
                          'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-sm',
                          'border border-transparent bg-transparent text-muted-foreground/70',
                          'font-mono text-xs leading-none',
                          'hover:text-foreground hover:bg-muted/60 hover:border-border/50',
                          'transition-colors duration-100',
                        )}
                        title="Remove column"
                        aria-label={`Remove column ${col.label}`}
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
                <th className="min-w-[5.5rem] px-2 py-2 text-center border-l border-border align-middle">
                  <button
                    type="button"
                    onClick={addColumn}
                    className={cn(
                      'inline-flex items-center justify-center gap-1 px-2 py-1.5 min-h-[28px]',
                      'border border-gray-300 text-foreground bg-white',
                      'font-mono text-[10px] tracking-wide font-semibold',
                      'hover:bg-foreground hover:text-white hover:border-foreground',
                      'transition-colors duration-100',
                    )}
                    title="Add column"
                    aria-label="Add custom column"
                  >
                    + Add
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpanEmpty} className="px-3 py-8 text-center text-muted-foreground leading-relaxed">
                    No enclosed rooms yet. On Floor 1 → Layout, draw walls and room boundaries so each space is
                    fully bounded; names come from the Room layer or default to Room 1, Room 2, …
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.rowId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-3 py-2 text-foreground">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {sqFtFmt.format(r.sqFt)}
                    </td>
                    {customColumns.map((col) => (
                      <td key={col.id} className="px-2 py-1 border-l border-border align-middle">
                        <input
                          type="text"
                          value={cellValues[r.rowId]?.[col.id] ?? ''}
                          onChange={(e) => setCell(r.rowId, col.id, e.target.value)}
                          className={cn(
                            'w-full min-w-0 bg-transparent border border-transparent rounded px-1 py-1',
                            'text-foreground placeholder:text-muted-foreground',
                            'focus:border-border focus:outline-none focus:ring-0',
                          )}
                          aria-label={`${col.label} for ${r.name}`}
                        />
                      </td>
                    ))}
                    <td className="border-l border-border bg-muted/10" aria-hidden />
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-muted/60 border-t border-border font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sqFtFmt.format(totalSqFt)}</td>
                  {customColumns.map((col) => (
                    <td key={col.id} className="border-l border-border px-2 py-2" aria-hidden />
                  ))}
                  <td className="border-l border-border" aria-hidden />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {columnDeleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="psi-delete-column-title"
        >
          <div className="absolute inset-0 bg-black/30" aria-hidden onClick={closeDeleteColumnModal} />
          <div
            className="relative z-10 w-full max-w-md border border-border bg-white shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="psi-delete-column-title"
              className="font-mono text-sm font-bold tracking-wide uppercase text-foreground"
            >
              Remove column
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
              You are about to remove the column{' '}
              <span className="text-foreground font-semibold">
                {columnDeleteTarget.label.trim() || 'Column'}
              </span>{' '}
              and all hand-entered values stored in it. This cannot be undone.
            </p>
            <div>
              <label htmlFor="psi-delete-column-confirm" className="block font-mono text-[10px] text-foreground mb-1.5">
                Type <span className="font-semibold">{DELETE_COLUMN_CONFIRM_WORD}</span> to confirm
              </label>
              <input
                ref={columnDeleteInputRef}
                id="psi-delete-column-confirm"
                type="text"
                autoComplete="off"
                value={columnDeleteInput}
                onChange={(e) => setColumnDeleteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && deleteColumnInputMatches) {
                    e.preventDefault()
                    commitDeleteColumn()
                  }
                }}
                className={cn(
                  'w-full font-mono text-[11px] px-2.5 py-2 border border-gray-300 bg-white text-foreground',
                  'focus:outline-none focus:border-foreground',
                )}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeDeleteColumnModal}
                className={cn(
                  'inline-flex items-center px-3 py-1.5 border border-gray-300 text-foreground bg-white',
                  'font-mono text-[10px] tracking-wide',
                  'hover:bg-foreground hover:text-white hover:border-foreground transition-colors duration-100',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!deleteColumnInputMatches}
                onClick={commitDeleteColumn}
                className={cn(
                  'inline-flex items-center px-3 py-1.5 border text-foreground bg-white',
                  'font-mono text-[10px] tracking-wide',
                  'border-foreground hover:bg-foreground hover:text-white transition-colors duration-100',
                  'disabled:opacity-40 disabled:pointer-events-none disabled:hover:bg-white disabled:hover:text-foreground',
                )}
              >
                Remove column
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
