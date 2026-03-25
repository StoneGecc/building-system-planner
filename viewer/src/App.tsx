import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import type { BuildingDimensions, SystemData } from './types/system'
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
import { ImplementationPlanView } from './components/ImplementationPlanView'
import { PhysicalSpaceInventoryView } from './components/PhysicalSpaceInventoryView'
import { cloneSketch } from './lib/planSketchClone'
import type { ElevationFace } from './data/elevationSheets'
import {
  PAGE_PHYSICAL_SPACE_INVENTORY,
  SYSTEM_PAGE_OFFSET,
  elevationSheetFromPageIndex,
  floor1SheetFromPageIndex,
  isElevationSketchPage,
  isFloor1SketchPage,
  systemPageIndex,
} from './data/pageIndices'
import {
  emptySketch,
  footprintStorageKey,
  type PlanLayoutSketch,
  type PlanSketchCommitOptions,
} from './types/planLayout'
import {
  loadElevationSketchFromLocalStorage,
  loadSketchFromLocalStorage,
  saveElevationSketchToLocalStorage,
  saveSketchToLocalStorage,
} from './lib/planLayoutStorage'
// server.fs.allow: ['..'] is configured in vite.config.ts
import csvRaw from '../../Building_Systems_Complete.csv?raw'

const ELEVATION_FACES = ['N', 'E', 'S', 'W'] as const satisfies readonly ElevationFace[]

function loadAllElevationSketches(
  d: BuildingDimensions,
  gridSpacingIn: number,
): Record<ElevationFace, PlanLayoutSketch> {
  return {
    N: loadElevationSketchFromLocalStorage(d, 'N') ?? emptySketch(gridSpacingIn),
    E: loadElevationSketchFromLocalStorage(d, 'E') ?? emptySketch(gridSpacingIn),
    S: loadElevationSketchFromLocalStorage(d, 'S') ?? emptySketch(gridSpacingIn),
    W: loadElevationSketchFromLocalStorage(d, 'W') ?? emptySketch(gridSpacingIn),
  }
}

const DATA_CSV_IMPORT = '../../Building_Systems_Complete.csv'
const dataCsvFileName = decodeURIComponent(
  new URL(DATA_CSV_IMPORT, import.meta.url).pathname.split('/').pop() || 'data.csv',
)

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
  const totalPages = orderedSystems.length + SYSTEM_PAGE_OFFSET

  const [selectedPageIndex, setSelectedPageIndex] = useState(SYSTEM_PAGE_OFFSET)  // first system sheet
  const [compositeZoom, setCompositeZoom] = useState(1)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [highlightedLayerIndex, setHighlightedLayerIndex] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [proposedChanges, setProposedChanges] = useState<SystemData[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const selectedSystem =
    selectedPageIndex >= SYSTEM_PAGE_OFFSET
      ? orderedSystems[selectedPageIndex - SYSTEM_PAGE_OFFSET]
      : orderedSystems[0]
  const showCompositeSection = selectedPageIndex === 0
  const showCompositePlan = selectedPageIndex === 1
  const showPhysicalSpaceInventory = selectedPageIndex === PAGE_PHYSICAL_SPACE_INVENTORY
  const floor1Sheet = isFloor1SketchPage(selectedPageIndex)
    ? floor1SheetFromPageIndex(selectedPageIndex)
    : null
  const elevationSheet = isElevationSketchPage(selectedPageIndex)
    ? elevationSheetFromPageIndex(selectedPageIndex)
    : null
  const showPlanSketchPage = floor1Sheet != null || elevationSheet != null

  const footprintKey = useMemo(() => footprintStorageKey(buildingDimensions), [buildingDimensions])

  const [implSketch, setImplSketch] = useState<PlanLayoutSketch>(() => {
    return loadSketchFromLocalStorage(parseResult.buildingDimensions) ?? emptySketch(12)
  })
  const [implUndoStack, setImplUndoStack] = useState<PlanLayoutSketch[]>([])
  const [implRedoStack, setImplRedoStack] = useState<PlanLayoutSketch[]>([])
  const implSketchRef = useRef(implSketch)
  const implUndoStackRef = useRef(implUndoStack)
  const implRedoStackRef = useRef(implRedoStack)
  implSketchRef.current = implSketch
  implUndoStackRef.current = implUndoStack
  implRedoStackRef.current = implRedoStack

  const emptyElevUndoRedo = (): Record<ElevationFace, PlanLayoutSketch[]> => ({
    N: [],
    E: [],
    S: [],
    W: [],
  })

  const [elevSketches, setElevSketches] = useState<Record<ElevationFace, PlanLayoutSketch>>(() =>
    loadAllElevationSketches(parseResult.buildingDimensions, 12),
  )
  const [elevUndoStack, setElevUndoStack] = useState<Record<ElevationFace, PlanLayoutSketch[]>>(
    emptyElevUndoRedo,
  )
  const [elevRedoStack, setElevRedoStack] = useState<Record<ElevationFace, PlanLayoutSketch[]>>(
    emptyElevUndoRedo,
  )
  const elevSketchesRef = useRef(elevSketches)
  const elevUndoStackRef = useRef(elevUndoStack)
  const elevRedoStackRef = useRef(elevRedoStack)
  elevSketchesRef.current = elevSketches
  elevUndoStackRef.current = elevUndoStack
  elevRedoStackRef.current = elevRedoStack

  const HISTORY_CAP = 50

  useEffect(() => {
    const loaded = loadSketchFromLocalStorage(buildingDimensions)
    const next = loaded ?? emptySketch(12)
    setImplSketch(next)
    implSketchRef.current = next
    setImplUndoStack([])
    implUndoStackRef.current = []
    setImplRedoStack([])
    implRedoStackRef.current = []
    const elev = loadAllElevationSketches(buildingDimensions, next.gridSpacingIn)
    setElevSketches(elev)
    elevSketchesRef.current = elev
    const emptyU = emptyElevUndoRedo()
    setElevUndoStack(emptyU)
    setElevRedoStack(emptyU)
    elevUndoStackRef.current = emptyU
    elevRedoStackRef.current = emptyU
  }, [footprintKey])

  useEffect(() => {
    const g = implSketch.gridSpacingIn
    setElevSketches((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of ELEVATION_FACES) {
        if (Math.abs(prev[f].gridSpacingIn - g) > 1e-9) {
          next[f] = { ...prev[f], gridSpacingIn: g }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [implSketch.gridSpacingIn])

  const commitImplSketch = useCallback((next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
    if (!opts?.skipUndo) {
      setImplUndoStack((stack) => {
        const pushed = [...stack.slice(-(HISTORY_CAP - 1)), cloneSketch(implSketchRef.current)]
        implUndoStackRef.current = pushed
        return pushed
      })
      setImplRedoStack([])
      implRedoStackRef.current = []
    }
    implSketchRef.current = next
    setImplSketch(next)
  }, [])

  const undoImplSketch = useCallback(() => {
    const stack = implUndoStackRef.current
    if (stack.length === 0) return
    const snap = stack[stack.length - 1]!
    const nextUndo = stack.slice(0, -1)
    const current = cloneSketch(implSketchRef.current)
    const nextRedo = [...implRedoStackRef.current.slice(-(HISTORY_CAP - 1)), current]
    implUndoStackRef.current = nextUndo
    implRedoStackRef.current = nextRedo
    setImplUndoStack(nextUndo)
    setImplRedoStack(nextRedo)
    implSketchRef.current = snap
    setImplSketch(snap)
  }, [])

  const redoImplSketch = useCallback(() => {
    const rstack = implRedoStackRef.current
    if (rstack.length === 0) return
    const snap = rstack[rstack.length - 1]!
    const nextRedo = rstack.slice(0, -1)
    const current = cloneSketch(implSketchRef.current)
    const nextUndo = [...implUndoStackRef.current.slice(-(HISTORY_CAP - 1)), current]
    implUndoStackRef.current = nextUndo
    implRedoStackRef.current = nextRedo
    setImplUndoStack(nextUndo)
    setImplRedoStack(nextRedo)
    implSketchRef.current = snap
    setImplSketch(snap)
  }, [])

  const commitElevationSketch = useCallback(
    (face: ElevationFace, next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
      const g = implSketchRef.current.gridSpacingIn
      const {
        elevationGroundPlaneJ: _sharedGround,
        elevationLevelLines: _sharedLevels,
        ...nextNoGround
      } = next
      const storedRaw = Math.abs(next.gridSpacingIn - g) < 1e-9 ? nextNoGround : { ...nextNoGround, gridSpacingIn: g }
      const stored = storedRaw as PlanLayoutSketch
      if (!opts?.skipUndo) {
        setElevUndoStack((u) => {
          const pushed = [
            ...u[face].slice(-(HISTORY_CAP - 1)),
            cloneSketch(elevSketchesRef.current[face]),
          ]
          elevUndoStackRef.current = { ...u, [face]: pushed }
          return { ...u, [face]: pushed }
        })
        setElevRedoStack((r) => {
          const nextR = { ...r, [face]: [] }
          elevRedoStackRef.current = nextR
          return nextR
        })
      }
      elevSketchesRef.current = { ...elevSketchesRef.current, [face]: stored }
      setElevSketches((s) => ({ ...s, [face]: stored }))
    },
    [],
  )

  const undoElevationSketch = useCallback((face: ElevationFace) => {
    const stack = elevUndoStackRef.current[face]
    if (stack.length === 0) return
    const snap = stack[stack.length - 1]!
    const nextUndo = { ...elevUndoStackRef.current, [face]: stack.slice(0, -1) }
    const current = cloneSketch(elevSketchesRef.current[face])
    const nextRedo = {
      ...elevRedoStackRef.current,
      [face]: [...elevRedoStackRef.current[face].slice(-(HISTORY_CAP - 1)), current],
    }
    elevUndoStackRef.current = nextUndo
    elevRedoStackRef.current = nextRedo
    setElevUndoStack(nextUndo)
    setElevRedoStack(nextRedo)
    const nextSketches = { ...elevSketchesRef.current, [face]: snap }
    elevSketchesRef.current = nextSketches
    setElevSketches(nextSketches)
  }, [])

  const redoElevationSketch = useCallback((face: ElevationFace) => {
    const rstack = elevRedoStackRef.current[face]
    if (rstack.length === 0) return
    const snap = rstack[rstack.length - 1]!
    const nextRedo = { ...elevRedoStackRef.current, [face]: rstack.slice(0, -1) }
    const current = cloneSketch(elevSketchesRef.current[face])
    const nextUndo = {
      ...elevUndoStackRef.current,
      [face]: [...elevUndoStackRef.current[face].slice(-(HISTORY_CAP - 1)), current],
    }
    elevUndoStackRef.current = nextUndo
    elevRedoStackRef.current = nextRedo
    setElevUndoStack(nextUndo)
    setElevRedoStack(nextRedo)
    const nextSketches = { ...elevSketchesRef.current, [face]: snap }
    elevSketchesRef.current = nextSketches
    setElevSketches(nextSketches)
  }, [])

  const onBuildingHeightInChange = useCallback((inches: number) => {
    const cur = implSketchRef.current
    commitImplSketch({ ...cur, buildingHeightIn: inches })
  }, [commitImplSketch])

  const resolvedBuildingHeightIn = useMemo(() => {
    const h = implSketch.buildingHeightIn
    if (h != null && Number.isFinite(h) && h > 0) return h
    return buildingDimensions.floorToFloor
  }, [implSketch.buildingHeightIn, buildingDimensions.floorToFloor])

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveSketchToLocalStorage(buildingDimensions, implSketch)
    }, 400)
    return () => clearTimeout(t)
  }, [buildingDimensions, implSketch])

  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const face of ELEVATION_FACES) {
        saveElevationSketchToLocalStorage(buildingDimensions, face, elevSketches[face])
      }
    }, 400)
    return () => clearTimeout(t)
  }, [buildingDimensions, elevSketches])

  function handleSelectSystem(system: SystemData) {
    const idx = orderedSystems.findIndex(s => s.id === system.id)
    setSelectedPageIndex(idx >= 0 ? systemPageIndex(idx) : SYSTEM_PAGE_OFFSET)
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

  // ⌘Z / Ctrl+Z — undo · ⌘⇧Z / Ctrl+Shift+Z or Ctrl+Y — redo (Floor 1 + elevation sketch pages)
  useEffect(() => {
    if (!isFloor1SketchPage(selectedPageIndex) && !isElevationSketchPage(selectedPageIndex)) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (searchOpen) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
        return
      }
      if (t instanceof HTMLElement && t.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        if (isFloor1SketchPage(selectedPageIndex)) redoImplSketch()
        else {
          const sh = elevationSheetFromPageIndex(selectedPageIndex)
          if (sh) redoElevationSketch(sh.face)
        }
        return
      }
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (isFloor1SketchPage(selectedPageIndex)) undoImplSketch()
        else {
          const sh = elevationSheetFromPageIndex(selectedPageIndex)
          if (sh) undoElevationSketch(sh.face)
        }
        return
      }
      if (e.ctrlKey && !e.metaKey && e.key === 'y') {
        e.preventDefault()
        if (isFloor1SketchPage(selectedPageIndex)) redoImplSketch()
        else {
          const sh = elevationSheetFromPageIndex(selectedPageIndex)
          if (sh) redoElevationSketch(sh.face)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    selectedPageIndex,
    searchOpen,
    undoImplSketch,
    redoImplSketch,
    undoElevationSketch,
    redoElevationSketch,
  ])

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
                  {dataCsvFileName}
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
                    'font-mono text-[10px] tracking-wide',
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
                  Data
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
                    'font-mono text-[10px] tracking-wide',
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
                  Export
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
                setSelectedPageIndex(idx >= 0 ? systemPageIndex(idx) : SYSTEM_PAGE_OFFSET)
              }}
              className="flex-1 overflow-hidden"
            />
          </>
        ) : showPhysicalSpaceInventory ? (
          <>
            <header className="flex items-center justify-between px-5 py-2.5 min-h-[50px] border-b border-border bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-foreground" />
                <span className="font-mono text-[11px] tracking-[0.25em] font-bold uppercase text-foreground">
                  {dataCsvFileName}
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
                    'font-mono text-[10px] tracking-wide',
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
                  Data
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
                    'font-mono text-[10px] tracking-wide',
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
                  Export
                </button>
              </div>
            </header>
            <PhysicalSpaceInventoryView
              buildingDimensions={buildingDimensions}
              layoutSketch={implSketch}
              className="flex-1 min-h-0"
            />
          </>
        ) : showPlanSketchPage ? (
          <>
            <header className="flex items-center justify-between px-5 py-2.5 min-h-[50px] border-b border-border bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-foreground" />
                <span className="font-mono text-[11px] tracking-[0.25em] font-bold uppercase text-foreground">
                  {dataCsvFileName}
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
                    'font-mono text-[10px] tracking-wide',
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
                  Data
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
                    'font-mono text-[10px] tracking-wide',
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
                  Export
                </button>
              </div>
            </header>
            <ImplementationPlanView
              buildingDimensions={buildingDimensions}
              orderedSystems={orderedSystems}
              sketch={
                floor1Sheet ? implSketch : elevSketches[elevationSheet!.face]
              }
              onSketchChange={
                floor1Sheet
                  ? commitImplSketch
                  : (next, o) => commitElevationSketch(elevationSheet!.face, next, o)
              }
              onUndo={
                floor1Sheet
                  ? undoImplSketch
                  : () => undoElevationSketch(elevationSheet!.face)
              }
              canUndo={
                floor1Sheet
                  ? implUndoStack.length > 0
                  : elevUndoStack[elevationSheet!.face].length > 0
              }
              onRedo={
                floor1Sheet
                  ? redoImplSketch
                  : () => redoElevationSketch(elevationSheet!.face)
              }
              canRedo={
                floor1Sheet
                  ? implRedoStack.length > 0
                  : elevRedoStack[elevationSheet!.face].length > 0
              }
              planViewContext={
                floor1Sheet
                  ? { kind: 'floor1', sheet: floor1Sheet }
                  : { kind: 'elevation', sheet: elevationSheet! }
              }
              buildingHeightIn={resolvedBuildingHeightIn}
              onBuildingHeightInChange={onBuildingHeightInChange}
              layoutSketch={implSketch}
              onLayoutSketchChange={commitImplSketch}
              className="flex-1 min-h-0"
            />
          </>
        ) : (
          <>
            {/* Top bar */}
            <header className="flex items-center justify-between px-5 py-2.5 min-h-[50px] border-b border-border bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-foreground" />
                <span className="font-mono text-[11px] tracking-[0.25em] font-bold uppercase text-foreground">
                  {dataCsvFileName}
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
                    'font-mono text-[10px] tracking-wide',
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
                  Data
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
                    'font-mono text-[10px] tracking-wide',
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
                  Export
                </button>
              </div>
            </header>

            {/* Drawing canvas fills the rest */}
            <DrawingCanvas
              system={selectedSystem}
              systemIndex={selectedPageIndex}
              buildingDimensions={buildingDimensions}
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
