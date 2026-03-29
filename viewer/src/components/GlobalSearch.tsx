import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingLevel } from '../types/planLayout'
import type { PlanConnection } from '../lib/planConnections'
import { buildSearchHits, filterSearchHits, type SearchHit } from '../lib/searchIndex'
import { cn } from '../lib/utils'

export interface GlobalSearchProps {
  open: boolean
  onClose: () => void
  orderedSystems: SystemData[]
  onNavigate: (pageIndex: number, options?: { layerIndex?: number; openBulkEdit?: boolean }) => void
  buildingLevels?: BuildingLevel[]
  planConnections?: readonly PlanConnection[]
}

export function GlobalSearch({
  open,
  onClose,
  orderedSystems,
  onNavigate,
  buildingLevels,
  planConnections,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(
    () => buildSearchHits(orderedSystems, buildingLevels, planConnections),
    [orderedSystems, buildingLevels, planConnections],
  )
  const filtered = useMemo(() => filterSearchHits(hits, query), [hits, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  const choose = useCallback(
    (h: SearchHit) => {
      const openBulk = h.layerIndex !== undefined
      onNavigate(h.pageIndex, {
        layerIndex: h.layerIndex,
        openBulkEdit: openBulk,
      })
      onClose()
      setQuery('')
    },
    [onNavigate, onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive(i => Math.min(i + 1, Math.max(0, filtered.length - 1)))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(i => Math.max(0, i - 1))
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault()
        choose(filtered[active])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, active, choose, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-hit-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Search pages and assemblies"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-lg border border-border bg-white shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-muted-foreground shrink-0" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sheets, systems, layers, materials, fasteners…"
            className="flex-1 min-w-0 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground outline-none py-1"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline font-mono text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">
            esc
          </kbd>
        </div>
        <p className="px-3 py-1.5 font-mono text-[8px] text-muted-foreground tracking-wide uppercase border-b border-border bg-white">
          {query.trim()
            ? `${filtered.length} result${filtered.length === 1 ? '' : 's'}`
            : 'Sheets & systems — type to search layers and notes'}
        </p>
        <div ref={listRef} className="max-h-[min(52vh,420px)] overflow-y-auto scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 font-mono text-xs text-muted-foreground text-center">No matches</p>
          ) : (
            <ul role="listbox" className="py-1">
              {filtered.map((h, i) => {
                const isLayer = h.layerIndex !== undefined
                return (
                  <li key={h.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      data-hit-index={i}
                      onClick={() => choose(h)}
                      className={cn(
                        'w-full text-left px-3 py-2 border-l-2 transition-colors',
                        i === active ? 'border-l-foreground bg-muted' : 'border-l-transparent hover:bg-muted/60',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[10px] font-bold text-foreground leading-snug">{h.primary}</span>
                        <span className="font-mono text-[8px] text-muted-foreground shrink-0 tabular-nums">
                          p.{String(h.pageIndex).padStart(2, '0')}
                        </span>
                      </div>
                      <p className="font-mono text-[9px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                        {h.secondary}
                      </p>
                      {isLayer && (
                        <p className="font-mono text-[8px] text-muted-foreground/80 mt-1 tracking-wide uppercase">
                          Layer · opens data table
                        </p>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
