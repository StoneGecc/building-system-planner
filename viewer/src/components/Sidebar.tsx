import { useEffect, useMemo, useState } from 'react'
import type { SystemData } from '../types/system'
import { cn } from '../lib/utils'
import { DISCIPLINES, getDisciplineFromSystemId } from '../data/disciplines'
import { PAGE_IMPLEMENTATION_PLAN, systemPageIndex } from '../data/pageIndices'

/** Preserve first-seen order within a discipline list (matches sheet order). */
function orderedCategoriesForSystems(systems: SystemData[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of systems) {
    const c = s.category || 'Uncategorized'
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

const LS_SIDEBAR_COLLAPSED = 'building-system-viewer-sidebar-collapsed'

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
            onClick={() => onSelectPage(PAGE_IMPLEMENTATION_PLAN)}
            className={cn(
              'w-full flex items-start gap-2.5 px-4 py-2 text-left',
              'border-l-2 transition-colors duration-75',
              selectedPageIndex === PAGE_IMPLEMENTATION_PLAN
                ? 'border-l-foreground bg-muted'
                : 'border-l-transparent hover:bg-muted/60',
            )}
          >
            <span className={cn(
              'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
              'inline-flex items-center justify-center min-w-[2rem] h-4 px-1',
              'border',
              selectedPageIndex === PAGE_IMPLEMENTATION_PLAN
                ? 'border-foreground text-foreground'
                : 'border-border text-muted-foreground',
            )}>
              IP
            </span>
            <span className={cn(
              'font-mono text-[9px] leading-tight',
              selectedPageIndex === PAGE_IMPLEMENTATION_PLAN ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}>
              Implementation plan
            </span>
          </button>
        </div>
        <div className="h-px bg-border mx-4 my-1" aria-hidden />

        {/* Discipline dropdowns - badge only in category header */}
        {DISCIPLINES.map(({ code, label }) => {
          const systems = systemsByDiscipline.get(code) ?? []
          const isOpen = collapsed[code] !== true

          return (
            <div key={code}>
              <button
                onClick={() => toggle(code)}
                className={cn(
                  'w-full flex items-center justify-between',
                  'px-4 py-2 text-left',
                  'hover:bg-muted transition-colors duration-75',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'font-mono text-[10px] font-bold tracking-[0.15em]',
                    'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1',
                    'bg-foreground text-white',
                  )}>
                    {code}
                  </span>
                  <span className="font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
                    {label}
                  </span>
                </div>
                <svg
                  width="10" height="10" viewBox="0 0 10 10"
                  className={cn(
                    'text-muted-foreground transition-transform duration-150',
                    isOpen ? 'rotate-180' : 'rotate-0',
                  )}
                >
                  <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>

              {/* System list - with sub-categories (A Architectural) and bordered badge for system ID */}
              {isOpen && systems.length > 0 && (
                <ul className="pb-1">
                  {code === 'A' ? (
                    // A Architectural: group by CSV Category (free text)
                    orderedCategoriesForSystems(systems).map((catLabel) => {
                      const subSystems = systems
                        .filter((s) => (s.category || 'Uncategorized') === catLabel)
                        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                      if (subSystems.length === 0) return null
                      const subKey = `A::${catLabel}`
                      const isSubOpen = subCollapsed[subKey] !== true
                      return (
                        <li key={catLabel}>
                          <button
                            onClick={() => toggleSub(subKey)}
                            className={cn(
                              'w-full flex items-center justify-between',
                              'px-4 py-1.5 pl-6 text-left',
                              'hover:bg-muted/60 transition-colors duration-75',
                            )}
                          >
                            <span className="font-mono text-[8px] tracking-wide text-muted-foreground uppercase min-w-0 truncate text-left">
                              {catLabel}
                            </span>
                            <svg
                              width="8" height="8" viewBox="0 0 10 10"
                              className={cn(
                                'text-muted-foreground transition-transform duration-150',
                                isSubOpen ? 'rotate-180' : 'rotate-0',
                              )}
                            >
                              <polyline points="2,3 5,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          </button>
                          {isSubOpen && (
                            <ul className="pb-1">
                              {subSystems.map(sys => {
                                const idx = orderedSystems.findIndex(s => s.id === sys.id)
                                const sysPage = idx >= 0 ? systemPageIndex(idx) : -1
                                const isSelected = selectedPageIndex === sysPage
                                return (
                                  <li key={sys.id}>
                                    <button
                                      onClick={() => onSelect(sys)}
                                      className={cn(
                                        'w-full flex items-start gap-2.5 px-4 py-2 pl-8 text-left',
                                        'border-l-2 transition-colors duration-75',
                                        isSelected
                                          ? 'border-l-foreground bg-muted'
                                          : 'border-l-transparent hover:bg-muted/60',
                                      )}
                                    >
                                      <span className={cn(
                                        'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
                                        'inline-flex items-center justify-center min-w-[2.75rem] h-4 px-1',
                                        'border',
                                        isSelected
                                          ? 'border-foreground text-foreground'
                                          : 'border-border text-muted-foreground',
                                      )}>
                                        {sys.id}
                                      </span>
                                      <span className={cn(
                                        'font-mono text-[9px] leading-tight truncate',
                                        isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
                                      )}>
                                        {sys.name}
                                      </span>
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </li>
                      )
                    })
                  ) : (
                    // Other disciplines: flat list with bordered badge
                    [...systems]
                      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                      .map(sys => {
                      const idx = orderedSystems.findIndex(s => s.id === sys.id)
                      const sysPage = idx >= 0 ? systemPageIndex(idx) : -1
                      const isSelected = selectedPageIndex === sysPage
                      return (
                        <li key={sys.id}>
                          <button
                            onClick={() => onSelect(sys)}
                            className={cn(
                              'w-full flex items-start gap-2.5 px-4 py-2 pl-6 text-left',
                              'border-l-2 transition-colors duration-75',
                              isSelected
                                ? 'border-l-foreground bg-muted'
                                : 'border-l-transparent hover:bg-muted/60',
                            )}
                          >
                            <span className={cn(
                              'font-mono text-[9px] font-bold tracking-wider shrink-0 mt-0.5',
                              'inline-flex items-center justify-center min-w-[2.75rem] h-4 px-1',
                              'border',
                              isSelected
                                ? 'border-foreground text-foreground'
                                : 'border-border text-muted-foreground',
                            )}>
                              {sys.id}
                            </span>
                            <span className={cn(
                              'font-mono text-[9px] leading-tight truncate',
                              isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
                            )}>
                              {sys.name}
                            </span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              )}
            </div>
          )
        })}
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
