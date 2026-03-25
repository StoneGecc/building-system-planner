import { useEffect, useMemo, useRef, useState } from 'react'
import type { SystemData } from '../types/system'
import { cn } from '../lib/utils'
import { DISCIPLINES, getDisciplineFromSystemId, SIDEBAR_DISCIPLINE_ROWS } from '../data/disciplines'
import {
  OTHER_SUBGROUP_KEY,
  orderedSubgroupKeysForDiscipline,
  sheetSubgroupKeyForSystem,
  sheetSubgroupTitle,
} from '../data/disciplineSheetSubgroups'
import { PAGE_PHYSICAL_SPACE_INVENTORY, systemPageIndex } from '../data/pageIndices'
import { ELEVATION_SHEETS } from '../data/elevationSheets'
import { FLOOR1_SHEETS } from '../data/floor1Sheets'

const SIDEBAR_FLOOR1_GROUP_KEY = 'composite::floor1'
const SIDEBAR_ELEVATIONS_GROUP_KEY = 'composite::elevations'

/** First-seen CSV `Category` order within a sheet subgroup. */
function orderedCategoriesForSystems(systems: SystemData[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of systems) {
    const c = (s.category || 'Uncategorized').trim() || 'Uncategorized'
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

const LS_SIDEBAR_COLLAPSED = 'building-system-viewer-sidebar-collapsed'
const LS_SIDEBAR_HIDDEN_DISCIPLINES = 'building-system-viewer-sidebar-hidden-disciplines'

function loadHiddenDisciplines(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_SIDEBAR_HIDDEN_DISCIPLINES)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveHiddenDisciplines(hidden: Set<string>) {
  try {
    localStorage.setItem(LS_SIDEBAR_HIDDEN_DISCIPLINES, JSON.stringify([...hidden]))
  } catch {
    /* ignore */
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === '1'
  } catch {
    return false
  }
}

function saveSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(LS_SIDEBAR_COLLAPSED, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

interface SidebarProps {
  orderedSystems: SystemData[]
  selectedPageIndex: number
  onSelect: (system: SystemData) => void
  onSelectPage: (index: number) => void
  onOpenSearch?: () => void
}

export function Sidebar({ orderedSystems, selectedPageIndex, onSelect, onSelectPage, onOpenSearch }: SidebarProps) {
  const [railCollapsed, setRailCollapsed] = useState(loadSidebarCollapsed)
  useEffect(() => {
    saveSidebarCollapsed(railCollapsed)
  }, [railCollapsed])

  // Default: A (Architectural) open, others collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const c: Record<string, boolean> = {}
    for (const d of DISCIPLINES) c[d.code] = d.code !== 'A'
    return c
  })
  const [subCollapsed, setSubCollapsed] = useState<Record<string, boolean>>({})
  const [hiddenDisciplines, setHiddenDisciplines] = useState(loadHiddenDisciplines)
  const [discMenuOpen, setDiscMenuOpen] = useState(false)
  const discMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saveHiddenDisciplines(hiddenDisciplines)
  }, [hiddenDisciplines])

  useEffect(() => {
    if (!discMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = discMenuRef.current
      if (el && !el.contains(e.target as Node)) setDiscMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [discMenuOpen])

  const toggleDisciplineHidden = (code: string) => {
    setHiddenDisciplines((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggle = (code: string) => {
    setCollapsed(prev => ({ ...prev, [code]: !prev[code] }))
  }
  const toggleSub = (key: string) => {
    setSubCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Group systems by discipline (A4-01 → A, etc.)
  const systemsByDiscipline = useMemo(() => {
    const map = new Map<string, SystemData[]>()
    for (const sys of orderedSystems) {
      const code = getDisciplineFromSystemId(sys.id)
      if (!map.has(code)) map.set(code, [])
      map.get(code)!.push(sys)
    }
    return map
  }, [orderedSystems])

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col border-r border-border bg-white overflow-hidden',
        'transition-[width] duration-200 ease-out',
        railCollapsed ? 'w-11' : 'w-60',
      )}
      aria-label="Systems index"
    >
      {railCollapsed ? (
        <div className="flex flex-col items-center gap-1 py-2 border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-sm',
              'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            )}
            title="Expand sidebar"
            aria-expanded="false"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-sm',
                'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
              )}
              title="Search (⌘K)"
              aria-label="Search pages and data"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-border space-y-2 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                  Mass Timber Building System
                </p>
                <p className="font-mono text-[11px] font-bold tracking-widest text-foreground mt-0.5 uppercase">
                  Systems Index
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRailCollapsed(true)}
                className={cn(
                  'shrink-0 flex items-center justify-center w-8 h-8 rounded-sm -mr-1 -mt-0.5',
                  'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                )}
                title="Collapse sidebar"
                aria-expanded="true"
                aria-controls="sidebar-nav-panel"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-sm border border-border',
                  'font-mono text-[9px] tracking-wide text-muted-foreground text-left',
                  'hover:bg-muted hover:text-foreground transition-colors',
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 opacity-70" aria-hidden>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span className="flex-1 truncate">Search pages & data…</span>
                <kbd className="hidden sm:inline font-mono text-[8px] px-1 py-0.5 border border-border bg-muted/50 text-muted-foreground shrink-0" title="Ctrl+K on Windows/Linux">
                  ⌘K
                </kbd>
              </button>
            )}
          </div>
        </>
      )}

      {/* Scrollable nav — omitted when rail collapsed (avoids hidden focusables) */}
      {!railCollapsed && (
      <nav
        id="sidebar-nav-panel"
        className="flex-1 overflow-y-auto scrollbar-thin py-2 min-h-0"
      >
        {/* Composite pages: A3 Building Section, A1 Building Plan (per sheet prefix standards) */}
        <div className="space-y-0">
          <button
            onClick={() => onSelectPage(0)}
            className={cn(
              'w-full flex items-start gap-2.5 px-4 py-2 text-left',
              'border-l-2 transition-colors duration-75',
              selectedPageIndex === 0
                ? 'border-l-foreground bg-muted'
                : 'border-l-transparent hover:bg-muted/60',
            )}
          >
            <span className={cn(
              'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
              'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
              'border',
              selectedPageIndex === 0
                ? 'border-foreground text-foreground'
                : 'border-border text-muted-foreground',
            )}>
              A3
            </span>
            <span className={cn(
              'font-mono text-[9px] leading-tight',
              selectedPageIndex === 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}>
              Building Section
            </span>
          </button>
          <button
            onClick={() => onSelectPage(1)}
            className={cn(
              'w-full flex items-start gap-2.5 px-4 py-2 text-left',
              'border-l-2 transition-colors duration-75',
              selectedPageIndex === 1
                ? 'border-l-foreground bg-muted'
                : 'border-l-transparent hover:bg-muted/60',
            )}
          >
            <span className={cn(
              'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
              'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
              'border',
              selectedPageIndex === 1
                ? 'border-foreground text-foreground'
                : 'border-border text-muted-foreground',
            )}>
              A1
            </span>
            <span className={cn(
              'font-mono text-[9px] leading-tight',
              selectedPageIndex === 1 ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}>
              Building Plan
            </span>
          </button>
          <button
            onClick={() => onSelectPage(PAGE_PHYSICAL_SPACE_INVENTORY)}
            className={cn(
              'w-full flex items-start gap-2.5 px-4 py-2 text-left',
              'border-l-2 transition-colors duration-75',
              selectedPageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
                ? 'border-l-foreground bg-muted'
                : 'border-l-transparent hover:bg-muted/60',
            )}
          >
            <span className={cn(
              'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
              'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
              'border',
              selectedPageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
                ? 'border-foreground text-foreground'
                : 'border-border text-muted-foreground',
            )}>
              PSI
            </span>
            <span className={cn(
              'font-mono text-[9px] leading-tight',
              selectedPageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
                ? 'text-foreground font-medium'
                : 'text-muted-foreground',
            )}>
              Physical space inventory
            </span>
          </button>
          <div>
            <button
              type="button"
              onClick={() => toggleSub(SIDEBAR_FLOOR1_GROUP_KEY)}
              className={cn(
                'w-full flex items-center justify-between gap-2',
                'px-4 py-1.5 text-left',
                'hover:bg-muted/60 transition-colors duration-75',
              )}
            >
              <span className="font-mono text-[8px] tracking-wide text-muted-foreground min-w-0 flex-1 text-left leading-snug truncate">
                Floor 1
              </span>
              <svg
                width="8"
                height="8"
                viewBox="0 0 10 10"
                className={cn(
                  'text-muted-foreground shrink-0 transition-transform duration-150',
                  subCollapsed[SIDEBAR_FLOOR1_GROUP_KEY] !== true ? 'rotate-180' : 'rotate-0',
                )}
                aria-hidden
              >
                <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            {subCollapsed[SIDEBAR_FLOOR1_GROUP_KEY] !== true && (
              <ul className="pb-0.5">
                {FLOOR1_SHEETS.map((sheet) => (
                  <li key={sheet.id}>
                    <button
                      type="button"
                      onClick={() => onSelectPage(sheet.pageIndex)}
                      className={cn(
                        'w-full flex items-center gap-2.5 py-2 pr-4 pl-6 text-left',
                        'border-l-2 transition-colors duration-75',
                        selectedPageIndex === sheet.pageIndex
                          ? 'border-l-foreground bg-muted'
                          : 'border-l-transparent hover:bg-muted/60',
                      )}
                    >
                      <span
                        className={cn(
                          'font-mono text-[9px] font-bold tracking-wider shrink-0',
                          'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
                          'border',
                          selectedPageIndex === sheet.pageIndex
                            ? 'border-foreground text-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {sheet.badge}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[9px] leading-none',
                          selectedPageIndex === sheet.pageIndex ? 'text-foreground font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {sheet.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => toggleSub(SIDEBAR_ELEVATIONS_GROUP_KEY)}
              className={cn(
                'w-full flex items-center justify-between gap-2',
                'px-4 py-1.5 text-left',
                'hover:bg-muted/60 transition-colors duration-75',
              )}
            >
              <span className="font-mono text-[8px] tracking-wide text-muted-foreground min-w-0 flex-1 text-left leading-snug truncate">
                Elevations
              </span>
              <svg
                width="8"
                height="8"
                viewBox="0 0 10 10"
                className={cn(
                  'text-muted-foreground shrink-0 transition-transform duration-150',
                  subCollapsed[SIDEBAR_ELEVATIONS_GROUP_KEY] !== true ? 'rotate-180' : 'rotate-0',
                )}
                aria-hidden
              >
                <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            {subCollapsed[SIDEBAR_ELEVATIONS_GROUP_KEY] !== true && (
              <ul className="pb-0.5">
                {ELEVATION_SHEETS.map((sheet) => (
                  <li key={sheet.id}>
                    <button
                      type="button"
                      onClick={() => onSelectPage(sheet.pageIndex)}
                      className={cn(
                        'w-full flex items-center gap-2.5 py-2 pr-4 pl-6 text-left',
                        'border-l-2 transition-colors duration-75',
                        selectedPageIndex === sheet.pageIndex
                          ? 'border-l-foreground bg-muted'
                          : 'border-l-transparent hover:bg-muted/60',
                      )}
                    >
                      <span
                        className={cn(
                          'font-mono text-[9px] font-bold tracking-wider shrink-0',
                          'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
                          'border',
                          selectedPageIndex === sheet.pageIndex
                            ? 'border-foreground text-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {sheet.badge}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[9px] leading-none',
                          selectedPageIndex === sheet.pageIndex ? 'text-foreground font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {sheet.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="h-px bg-border mx-4 my-1" aria-hidden />

        {/* Discipline dropdowns — order + light separators from SIDEBAR_DISCIPLINE_ROWS */}
        {SIDEBAR_DISCIPLINE_ROWS.map((row, rowIdx) => {
          if (row.kind === 'separator') {
            return (
              <div
                key={`disc-sep-${rowIdx}`}
                className="h-px bg-border/80 mx-4 my-1.5"
                aria-hidden
              />
            )
          }
          const { code, label } = row
          if (hiddenDisciplines.has(code)) return null
          const systems = systemsByDiscipline.get(code) ?? []
          const isOpen = collapsed[code] !== true

          return (
            <div key={code}>
              <button
                type="button"
                onClick={() => toggle(code)}
                className={cn(
                  'w-full flex items-center justify-between gap-2',
                  'px-4 py-2 text-left',
                  'hover:bg-muted transition-colors duration-75',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={cn(
                    'font-mono text-[10px] font-bold tracking-[0.15em]',
                    'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1 shrink-0',
                    'bg-foreground text-white',
                  )}>
                    {code}
                  </span>
                  <span className="font-mono text-[9px] tracking-wide text-muted-foreground leading-snug min-w-0 truncate">
                    {label}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {systems.length > 0 && (
                    <span
                      className="font-mono text-[7px] tabular-nums text-muted-foreground/65 min-w-[0.875rem] text-right"
                      title={`${systems.length} sheet${systems.length === 1 ? '' : 's'}`}
                    >
                      {systems.length}
                    </span>
                  )}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    className={cn(
                      'text-muted-foreground transition-transform duration-150',
                      isOpen ? 'rotate-180' : 'rotate-0',
                    )}
                    aria-hidden
                  >
                    <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
              </button>

              {/* System list — NCS-style sheet sub-groups (always listed; may be empty) */}
              {isOpen && (
                <ul className="pb-1">
                  {(() => {
                    const bySubgroup = new Map<string, SystemData[]>()
                    for (const s of systems) {
                      const sk = sheetSubgroupKeyForSystem(s.id, code)
                      if (!bySubgroup.has(sk)) bySubgroup.set(sk, [])
                      bySubgroup.get(sk)!.push(s)
                    }
                    const keysToShow = orderedSubgroupKeysForDiscipline(code).filter((sk) => {
                      if (sk === OTHER_SUBGROUP_KEY) {
                        return (bySubgroup.get(sk)?.length ?? 0) > 0
                      }
                      return true
                    })
                    return keysToShow.map((subKey) => {
                      const subSystems = [...(bySubgroup.get(subKey) ?? [])].sort((a, b) =>
                        a.id.localeCompare(b.id, undefined, { numeric: true }),
                      )
                      const title = sheetSubgroupTitle(code, subKey)
                      const heading =
                        subKey === OTHER_SUBGROUP_KEY
                          ? title
                          : `${subKey}  ${title}`
                      const rowKey = `${code}::${subKey}`
                      const isSubOpen = subCollapsed[rowKey] !== true
                      return (
                        <li key={subKey}>
                          <button
                            type="button"
                            onClick={() => toggleSub(rowKey)}
                            className={cn(
                              'w-full flex items-center justify-between gap-2',
                              'px-4 py-1.5 text-left',
                              'hover:bg-muted/60 transition-colors duration-75',
                            )}
                          >
                            <span className="font-mono text-[8px] tracking-wide text-muted-foreground min-w-0 flex-1 text-left leading-snug truncate">
                              {heading}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {subSystems.length > 0 && (
                                <span
                                  className="font-mono text-[7px] tabular-nums text-muted-foreground/65 min-w-[0.875rem] text-right"
                                  title={`${subSystems.length} sheet${subSystems.length === 1 ? '' : 's'}`}
                                >
                                  {subSystems.length}
                                </span>
                              )}
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 10 10"
                                className={cn(
                                  'text-muted-foreground shrink-0 transition-transform duration-150',
                                  isSubOpen ? 'rotate-180' : 'rotate-0',
                                )}
                                aria-hidden
                              >
                                <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            </span>
                          </button>
                          {isSubOpen && (
                            <ul className="pb-0.5">
                              {(() => {
                                const categories = orderedCategoriesForSystems(subSystems)
                                const hasCategoryLayer =
                                  categories.length > 1 ||
                                  (categories.length === 1 && categories[0] !== 'Uncategorized')
                                const sheetPad = hasCategoryLayer ? 'pl-6' : 'pl-4'
                                const sheetBtn = (sys: SystemData) => {
                                  const idx = orderedSystems.findIndex((s) => s.id === sys.id)
                                  const sysPage = idx >= 0 ? systemPageIndex(idx) : -1
                                  const isSelected = selectedPageIndex === sysPage
                                  return (
                                    <li key={sys.id}>
                                      <button
                                        type="button"
                                        onClick={() => onSelect(sys)}
                                        className={cn(
                                          'w-full flex items-start gap-2.5 py-2 pr-4 text-left',
                                          sheetPad,
                                          'border-l-2 transition-colors duration-75',
                                          isSelected
                                            ? 'border-l-foreground bg-muted'
                                            : 'border-l-transparent hover:bg-muted/60',
                                        )}
                                      >
                                        <span
                                          className={cn(
                                            'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
                                            'inline-flex items-center justify-center min-w-[2.75rem] h-4 px-1',
                                            'border',
                                            isSelected
                                              ? 'border-foreground text-foreground'
                                              : 'border-border text-muted-foreground',
                                          )}
                                        >
                                          {sys.id}
                                        </span>
                                        <span
                                          className={cn(
                                            'font-mono text-[9px] leading-tight truncate',
                                            isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
                                          )}
                                        >
                                          {sys.name}
                                        </span>
                                      </button>
                                    </li>
                                  )
                                }

                                if (categories.length === 1) {
                                  const only = categories[0]!
                                  const sorted = subSystems
                                    .slice()
                                    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                                  const showCsvLabel = only !== 'Uncategorized'
                                  return (
                                    <>
                                      {showCsvLabel && (
                                        <li className="pl-6 pr-4 py-0.5 font-mono text-[8px] text-muted-foreground/85 select-none border-l-2 border-transparent list-none">
                                          <span className="flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate">{only}</span>
                                            {sorted.length > 0 && (
                                              <span
                                                className="shrink-0 font-mono text-[7px] tabular-nums text-muted-foreground/60"
                                                title={`${sorted.length} sheet${sorted.length === 1 ? '' : 's'}`}
                                              >
                                                {sorted.length}
                                              </span>
                                            )}
                                          </span>
                                        </li>
                                      )}
                                      {sorted.map(sheetBtn)}
                                    </>
                                  )
                                }

                                return categories.map((catLabel) => {
                                  const inCat = subSystems
                                    .filter((s) => ((s.category || 'Uncategorized').trim() || 'Uncategorized') === catLabel)
                                    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                                  if (inCat.length === 0) return null
                                  const csvKey = `${code}::${subKey}::cat::${catLabel}`
                                  const csvOpen = subCollapsed[csvKey] !== true
                                  return (
                                    <li key={catLabel}>
                                      <button
                                        type="button"
                                        onClick={() => toggleSub(csvKey)}
                                        className={cn(
                                          'w-full flex items-center justify-between gap-2',
                                          'pl-6 pr-4 py-1 text-left',
                                          'hover:bg-muted/40 transition-colors duration-75',
                                        )}
                                      >
                                        <span className="font-mono text-[8px] tracking-wide text-muted-foreground/90 min-w-0 flex-1 truncate text-left">
                                          {catLabel}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1">
                                          {inCat.length > 0 && (
                                            <span
                                              className="font-mono text-[7px] tabular-nums text-muted-foreground/60 min-w-[0.875rem] text-right"
                                              title={`${inCat.length} sheet${inCat.length === 1 ? '' : 's'}`}
                                            >
                                              {inCat.length}
                                            </span>
                                          )}
                                          <svg
                                            width="7"
                                            height="7"
                                            viewBox="0 0 10 10"
                                            className={cn(
                                              'text-muted-foreground/80 shrink-0 transition-transform duration-150',
                                              csvOpen ? 'rotate-180' : 'rotate-0',
                                            )}
                                            aria-hidden
                                          >
                                            <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                                          </svg>
                                        </span>
                                      </button>
                                      {csvOpen && <ul className="pb-0.5">{inCat.map(sheetBtn)}</ul>}
                                    </li>
                                  )
                                })
                              })()}
                            </ul>
                          )}
                        </li>
                      )
                    })
                  })()}
                </ul>
              )}
            </div>
          )
        })}

        <div className="h-px bg-border mx-4 my-2 shrink-0" aria-hidden />
        <div ref={discMenuRef} className="relative px-4 pb-2">
          <button
            type="button"
            onClick={() => setDiscMenuOpen((o) => !o)}
            aria-expanded={discMenuOpen}
            aria-haspopup="menu"
            className={cn(
              'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border border-border',
              'font-mono text-[9px] tracking-wide text-muted-foreground text-left',
              'hover:bg-muted hover:text-foreground transition-colors',
            )}
          >
            <span>Disciplines</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className={cn(
                'text-muted-foreground shrink-0 transition-transform duration-150',
                discMenuOpen ? 'rotate-180' : 'rotate-0',
              )}
              aria-hidden
            >
              <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          {discMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 bottom-full z-50 mb-1 max-h-[min(70vh,22rem)] overflow-y-auto rounded-sm border border-border bg-white py-1 shadow-md"
            >
              {SIDEBAR_DISCIPLINE_ROWS.map((row, rowIdx) => {
                if (row.kind === 'separator') {
                  return (
                    <div
                      key={`menu-sep-${rowIdx}`}
                      className="h-px bg-border/70 mx-2 my-0.5"
                      aria-hidden
                    />
                  )
                }
                const { code, label } = row
                const visible = !hiddenDisciplines.has(code)
                return (
                  <label
                    key={code}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1.5 font-mono text-[9px] hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 shrink-0 rounded-sm border-border accent-foreground"
                      checked={visible}
                      onChange={() => toggleDisciplineHidden(code)}
                    />
                    <span className="shrink-0 font-bold tabular-nums text-foreground">{code}</span>
                    <span className="min-w-0 truncate text-muted-foreground leading-snug">{label}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </nav>
      )}

      {/* Footer */}
      {!railCollapsed && (
        <div className="px-4 py-2 border-t border-border shrink-0">
          <p className="font-mono text-[8px] text-muted-foreground tracking-wide uppercase">
            Highland Park / Detroit, MI
          </p>
          <p className="font-mono text-[8px] text-muted-foreground tracking-wide">
            ASHRAE Zone 5 — {orderedSystems.length} Systems
          </p>
        </div>
      )}
    </aside>
  )
}
