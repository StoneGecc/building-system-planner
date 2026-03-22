import { useState, useMemo, useEffect } from 'react'
import type { SystemData } from './types/system'
import { parseCSV, parseThickness } from './lib/csvParser'
import { sortSystemsForDisplay } from './lib/systemSort'
import { buildLayout } from './data/buildingLayout'
import { exportAllSheets } from './lib/exportAll'
import { DrawingCanvas } from './components/DrawingCanvas'
import { Sidebar } from './components/Sidebar'
import { GlobalSearch } from './components/GlobalSearch'
import { CompositeView } from './components/CompositeView'
import { BulkEditModal } from './components/BulkEditModal'
import { ChatPanel } from './components/ChatPanel'
import { ApplyChangesModal } from './components/ApplyChangesModal'
// server.fs.allow: ['..'] is configured in vite.config.ts
import csvRaw from '../../Building_Systems_Complete.csv?raw'

export default function App() {
  const [parseResult] = useMemo(() => [parseCSV(csvRaw)], [])
  const [systems, setSystems] = useState<SystemData[]>(() => parseResult.systems)

  // Merge current system thicknesses into building dimensions so layout updates when CSV data changes
  const buildingDimensions = useMemo(() => {
    const base = parseResult.buildingDimensions
    const thicknessBySystem = { ...base.thicknessBySystem }
    for (const sys of systems) {
      const thk = parseThickness(sys.totalThickness)
      if (thk > 0) thicknessBySystem[sys.id] = thk
    }
    return { ...base, thicknessBySystem }
  }, [parseResult.buildingDimensions, systems])

  const orderedSystems = useMemo(() => sortSystemsForDisplay(systems), [systems])

  const layout = useMemo(
    () => buildLayout(buildingDimensions, orderedSystems),
    [buildingDimensions, orderedSystems],
  )
  const totalPages = orderedSystems.length + 2

  const [selectedPageIndex, setSelectedPageIndex] = useState(2)  // start on A1 (page 2)
  const [compositeZoom, setCompositeZoom] = useState(1)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [highlightedLayerIndex, setHighlightedLayerIndex] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [proposedChanges, setProposedChanges] = useState<SystemData[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const selectedSystem = selectedPageIndex >= 2 ? orderedSystems[selectedPageIndex - 2] : orderedSystems[0]
  const showCompositeSection = selectedPageIndex === 0
  const showCompositePlan = selectedPageIndex === 1

  function handleSelectSystem(system: SystemData) {
    const idx = orderedSystems.findIndex(s => s.id === system.id)
    setSelectedPageIndex(idx >= 0 ? idx + 2 : 2)
  }

  function handleSelectPage(index: number) {
    setSelectedPageIndex(index)
  }

  // Arrow keys: flip through all pages (composite + sheets)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (searchOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedPageIndex(i => (i - 1 + totalPages) % totalPages)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedPageIndex(i => (i + 1) % totalPages)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [totalPages, searchOpen])

  // ⌘K / Ctrl+K — search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar navigation */}
      <Sidebar
        orderedSystems={orderedSystems}
        selectedPageIndex={selectedPageIndex}
        onSelect={handleSelectSystem}
        onSelectPage={handleSelectPage}
        onOpenSearch={() => setSearchOpen(true)}
      />

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        orderedSystems={orderedSystems}
        onNavigate={(pageIndex, options) => {
          setSelectedPageIndex(pageIndex)
          setHighlightedLayerIndex(options?.layerIndex ?? null)
          if (options?.openBulkEdit) setBulkEditOpen(true)
        }}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {(showCompositeSection || showCompositePlan) ? (
          /* Composite drawing: same format as individual sheets */
          <>
            <header className="flex items-center justify-between px-5 py-2.5 min-h-[50px] border-b border-border bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-foreground" />
                <span className="font-mono text-[11px] tracking-[0.25em] font-bold uppercase text-foreground">
                  Mass Timber Building System
                </span>
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                  Highland Park / Detroit
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  {String(selectedPageIndex).padStart(2, '0')} / {totalPages} Sheets
                </span>
                <div className="w-px h-4 bg-border" />
                <button
                  onClick={() => { setHighlightedLayerIndex(null); setBulkEditOpen(true) }}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-gray-300 text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white hover:border-foreground',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  Edit Data
                </button>
                <button
                  onClick={() => setChatOpen(true)}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-gray-300 text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white hover:border-foreground',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  AI
                </button>
                <button
                  onClick={() => exportAllSheets(orderedSystems, layout, buildingDimensions).catch(err => alert('Export failed: ' + (err instanceof Error ? err.message : String(err))))}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-foreground text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export All
                </button>
              </div>
            </header>
            <CompositeView
              pageType={showCompositeSection ? 'section' : 'plan'}
              systems={orderedSystems}
              layout={layout}
              zoom={compositeZoom}
              onZoomChange={setCompositeZoom}
              onSelectSystem={(system) => {
                const idx = orderedSystems.findIndex(s => s.id === system.id)
                setSelectedPageIndex(idx >= 0 ? idx + 2 : 2)
              }}
              className="flex-1 overflow-hidden"
            />
          </>
        ) : (
          <>
            {/* Top bar */}
            <header className="flex items-center justify-between px-5 py-2.5 min-h-[50px] border-b border-border bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-foreground" />
                <span className="font-mono text-[11px] tracking-[0.25em] font-bold uppercase text-foreground">
                  Mass Timber Building System
                </span>
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                  Highland Park / Detroit
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  {String(selectedPageIndex).padStart(2, '0')} / {totalPages} Sheets
                </span>
                <div className="w-px h-4 bg-border" />
                <button
                  onClick={() => { setHighlightedLayerIndex(null); setBulkEditOpen(true) }}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-gray-300 text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white hover:border-foreground',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  Edit Data
                </button>
                <button
                  onClick={() => setChatOpen(true)}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-gray-300 text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white hover:border-foreground',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  AI
                </button>
                <button
                  onClick={() => exportAllSheets(orderedSystems, layout, buildingDimensions).catch(err => alert('Export failed: ' + (err instanceof Error ? err.message : String(err))))}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    'border border-foreground text-foreground bg-white',
                    'font-mono text-[10px] tracking-widest uppercase',
                    'hover:bg-foreground hover:text-white',
                    'transition-colors duration-100',
                  ].join(' ')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export All
                </button>
              </div>
            </header>

            {/* Drawing canvas fills the rest */}
            <DrawingCanvas
              system={selectedSystem}
              systemIndex={selectedPageIndex}
              onOpenBulkEditWithLayer={(_, layerIndex) => {
                setHighlightedLayerIndex(layerIndex)
                setBulkEditOpen(true)
              }}
              className="flex-1 overflow-hidden"
            />
          </>
        )}
      </div>

      {bulkEditOpen && (
        <BulkEditModal
          systems={orderedSystems}
          initialSystemId={selectedSystem?.id}
          highlightedLayerIndex={highlightedLayerIndex}
          onClose={() => { setBulkEditOpen(false); setHighlightedLayerIndex(null) }}
          onSave={(updated) => {
            setSystems(updated)
            setBulkEditOpen(false)
            setHighlightedLayerIndex(null)
          }}
          onOpenChat={() => setChatOpen(true)}
        />
      )}

      {chatOpen && (
        <ChatPanel
          systems={orderedSystems}
          buildingDimensions={buildingDimensions}
          onClose={() => setChatOpen(false)}
          onProposedChanges={(proposed) => setProposedChanges(proposed)}
        />
      )}

      {proposedChanges && (
        <ApplyChangesModal
          proposedSystems={proposedChanges}
          existingSystems={orderedSystems}
          onConfirm={(merged) => {
            setSystems(merged)
            setProposedChanges(null)
          }}
          onCancel={() => setProposedChanges(null)}
        />
      )}
    </div>
  )
}
