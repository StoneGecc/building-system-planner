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
import { ConnectionLayoutEditorView } from './components/ConnectionLayoutEditorView'
import { cloneSketch } from './lib/planSketchClone'
import {
  buildPlanConnections,
  buildConnectionDetailSheets,
  connectionDetailSheetBadge,
  connectionDetailSheetNavSubtitle,
} from './lib/planConnections'
import { deriveMepItemsFromSystems } from './lib/mepCsvParser'
import type { ElevationFace } from './data/elevationSheets'
import { elevationSheetFromPageIndexDynamic, isElevationSketchPageDynamic } from './data/elevationSheets'
import {
  PAGE_PHYSICAL_SPACE_INVENTORY,
  connectionDetailIndexFromPage,
  connectionDetailPageBaseDynamic,
  systemPageIndexDynamic,
  systemPageOffsetDynamic,
} from './data/pageIndices'
import { levelSheetFromPageIndex, isLevelSketchPage, SHEETS_PER_LEVEL, LEVEL_PAGES_START } from './data/floor1Sheets'
import { elevationSketchPageBaseDynamic } from './data/elevationSheets'
import {
  emptySketch,
  emptyConnectionDetailSketch,
  connectionDetailSketchHasContent,
  footprintStorageKey,
  buildingLevelsFromLines,
  type BuildingLevel,
  type PlanLayoutSketch,
  type PlanSketchCommitOptions,
} from './types/planLayout'
import {
  downloadPlanBundleJson,
  loadConnectionSketchesMapFromLocalStorage,
  loadElevationSketchFromLocalStorage,
  loadLevelSketchFromLocalStorage,
  loadSketchFromLocalStorage,
  readPlanBundleOrSketchFromFile,
  saveConnectionSketchesMapToLocalStorage,
  saveElevationSketchToLocalStorage,
  saveLevelSketchToLocalStorage,
  saveSketchToLocalStorage,
} from './lib/planLayoutStorage'
import { withPrunedOrphanRoomByCell } from './lib/planRooms'
import csvRaw from '../public/Building_Systems_Complete.csv?raw'

const ELEVATION_FACES = ['N', 'E', 'S', 'W'] as const satisfies readonly ElevationFace[]

/**
 * Seed an implSketch with default "Level 1" and "Slab / Foundation" level lines
 * when no elevation level lines exist yet. Positions are derived from the
 * building height so the lines sit at roughly sensible elevations.
 */
function ensureDefaultLevelLines(
  sk: PlanLayoutSketch,
  floorToFloor: number,
): PlanLayoutSketch {
  if (sk.elevationLevelLines && sk.elevationLevelLines.length > 0) return sk
  const delta = sk.gridSpacingIn || 12
  const heightIn = sk.buildingHeightIn ?? floorToFloor
  const ny = Math.max(4, Math.ceil(heightIn / delta))
  const level1J = Math.round(ny * 0.65)
  const foundationJ = Math.round(ny * 0.85)
  return {
    ...sk,
    elevationLevelLines: [
      { id: 'll-1', j: level1J, label: 'Level 1' },
      { id: 'll-2', j: foundationJ, label: 'Slab / Foundation' },
    ],
  }
}

/**
 * Create a new empty sketch that inherits the setup configuration (grid spacing, site
 * dimensions, building height) from a reference sketch so all levels share the same canvas.
 */
function newLevelSketch(reference: PlanLayoutSketch): PlanLayoutSketch {
  const base = emptySketch(reference.gridSpacingIn)
  return {
    ...base,
    ...(reference.siteWidthIn != null ? { siteWidthIn: reference.siteWidthIn } : {}),
    ...(reference.siteDepthIn != null ? { siteDepthIn: reference.siteDepthIn } : {}),
    ...(reference.buildingHeightIn != null ? { buildingHeightIn: reference.buildingHeightIn } : {}),
  }
}

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

const DATA_CSV_IMPORT = '../public/Building_Systems_Complete.csv'
const dataCsvFileName = decodeURIComponent(
  new URL(DATA_CSV_IMPORT, import.meta.url).pathname.split('/').pop() || 'data.csv',
)

/** Bulk show/hide CSV assembly rows (same flag as the system table “Show” checkboxes). */
function applyAssemblyLayerVisibilityAllSystems(systems: SystemData[], visible: boolean): SystemData[] {
  return systems.map((s) => {
    const layers = s.layers.map((l) => ({ ...l, visible }))
    const vis = layers.filter((l) => l.visible !== false)
    const tt = vis.reduce((sum, l) => sum + parseThickness(l.thickness), 0)
    const tr = vis.reduce((sum, l) => sum + parseThickness(l.rValue), 0)
    return {
      ...s,
      layers,
      totalThickness: tt > 0 ? tt.toFixed(3).replace(/\.?0+$/, '') : '—',
      totalR: tr > 0 ? tr.toFixed(2).replace(/\.?0+$/, '') : '—',
    }
  })
}

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

  const [selectedPageIndex, setSelectedPageIndex] = useState(3)  // Level 1 layout
  const [compositeZoom, setCompositeZoom] = useState(1)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [highlightedLayerIndex, setHighlightedLayerIndex] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [proposedChanges, setProposedChanges] = useState<SystemData[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const footprintKey = useMemo(() => footprintStorageKey(buildingDimensions), [buildingDimensions])

  const [implSketch, setImplSketch] = useState<PlanLayoutSketch>(() => {
    const raw = loadSketchFromLocalStorage(parseResult.buildingDimensions) ?? emptySketch(12)
    return ensureDefaultLevelLines(raw, parseResult.buildingDimensions.floorToFloor)
  })
  const [implUndoStack, setImplUndoStack] = useState<PlanLayoutSketch[]>([])
  const [implRedoStack, setImplRedoStack] = useState<PlanLayoutSketch[]>([])
  const implSketchRef = useRef(implSketch)
  const implUndoStackRef = useRef(implUndoStack)
  const implRedoStackRef = useRef(implRedoStack)
  implSketchRef.current = implSketch
  implUndoStackRef.current = implUndoStack
  implRedoStackRef.current = implRedoStack

  /** Per-level sketches for levels beyond Level 1 (Level 1 uses implSketch, keyed by __default_level_1). */
  const [levelSketches, setLevelSketches] = useState<Record<string, PlanLayoutSketch>>(() => {
    const ref = loadSketchFromLocalStorage(parseResult.buildingDimensions) ?? emptySketch(12)
    const levels = buildingLevelsFromLines(ref.elevationLevelLines)
    const out: Record<string, PlanLayoutSketch> = {}
    for (const level of levels) {
      if (level.id === '__default_level_1') continue // Level 1 lives in implSketch
      out[level.id] = loadLevelSketchFromLocalStorage(parseResult.buildingDimensions, level.id) ?? newLevelSketch(ref)
    }
    return out
  })
  const levelSketchesRef = useRef(levelSketches)
  levelSketchesRef.current = levelSketches

  const [levelUndoStacks, setLevelUndoStacks] = useState<Record<string, PlanLayoutSketch[]>>({})
  const [levelRedoStacks, setLevelRedoStacks] = useState<Record<string, PlanLayoutSketch[]>>({})
  const levelUndoStacksRef = useRef(levelUndoStacks)
  const levelRedoStacksRef = useRef(levelRedoStacks)
  levelUndoStacksRef.current = levelUndoStacks
  levelRedoStacksRef.current = levelRedoStacks

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

  const [connectionSketches, setConnectionSketches] = useState<Record<string, PlanLayoutSketch>>(() =>
    loadConnectionSketchesMapFromLocalStorage(parseResult.buildingDimensions),
  )

  const HISTORY_CAP = 50

  const [buildingLevels, setBuildingLevels] = useState<BuildingLevel[]>(() =>
    buildingLevelsFromLines(implSketch.elevationLevelLines),
  )
  const buildingLevelsRef = useRef(buildingLevels)
  buildingLevelsRef.current = buildingLevels
  const numLevels = buildingLevels.length
  const systemPageOff = useMemo(() => systemPageOffsetDynamic(numLevels), [numLevels])

  const levelSheetInfo = useMemo(
    () =>
      isLevelSketchPage(selectedPageIndex, numLevels)
        ? levelSheetFromPageIndex(selectedPageIndex, numLevels)
        : null,
    [selectedPageIndex, numLevels],
  )
  const activeLevelIndex = levelSheetInfo?.levelIndex ?? null
  const activeLevelId = activeLevelIndex != null ? buildingLevels[activeLevelIndex]?.id ?? null : null
  /** True when the currently-active level is Level 1 (implSketch). Identified by stable id. */
  const activeIsLevel1 = activeLevelId === '__default_level_1'

  const sketchForActiveLevelPage = useMemo((): PlanLayoutSketch | null => {
    if (activeLevelIndex == null || activeLevelId == null) return null
    if (activeLevelId === '__default_level_1') return implSketch
    return levelSketches[activeLevelId] ?? implSketch
  }, [activeLevelIndex, activeLevelId, implSketch, levelSketches])

  /**
   * Connection-detail nav + grouping must follow the same floor sketch as the plan editor.
   * Non–level pages (systems, composites, etc.) keep the last level sketch so the sidebar
   * stays aligned with the floor you were just editing.
   */
  const [connectionCatalogSketchSticky, setConnectionCatalogSketchSticky] = useState<PlanLayoutSketch | null>(null)
  useEffect(() => {
    if (sketchForActiveLevelPage != null) {
      setConnectionCatalogSketchSticky(sketchForActiveLevelPage)
    }
  }, [sketchForActiveLevelPage])

  const sketchForConnectionCatalog = useMemo(
    () => sketchForActiveLevelPage ?? connectionCatalogSketchSticky ?? implSketch,
    [sketchForActiveLevelPage, connectionCatalogSketchSticky, implSketch],
  )

  const mepItemsDerived = useMemo(() => deriveMepItemsFromSystems(orderedSystems), [orderedSystems])

  const planConnections = useMemo(
    () =>
      buildPlanConnections(
        sketchForConnectionCatalog,
        orderedSystems,
        mepItemsDerived,
        buildingDimensions.layoutRefs,
        buildingDimensions.thicknessBySystem,
      ),
    [
      sketchForConnectionCatalog,
      orderedSystems,
      mepItemsDerived,
      buildingDimensions.layoutRefs,
      buildingDimensions.thicknessBySystem,
    ],
  )

  const connectionSketchKeySet = useMemo(
    () => new Set(Object.keys(connectionSketches)),
    [connectionSketches],
  )

  const connectionDetailSheets = useMemo(
    () =>
      buildConnectionDetailSheets(
        planConnections,
        orderedSystems,
        mepItemsDerived,
        buildingDimensions.thicknessBySystem,
        sketchForConnectionCatalog,
        connectionSketchKeySet,
      ),
    [
      planConnections,
      orderedSystems,
      mepItemsDerived,
      buildingDimensions.thicknessBySystem,
      sketchForConnectionCatalog,
      connectionSketchKeySet,
    ],
  )

  const connectionDetailBase = useMemo(
    () => connectionDetailPageBaseDynamic(numLevels, orderedSystems.length),
    [numLevels, orderedSystems.length],
  )

  const totalPages = connectionDetailBase + connectionDetailSheets.length

  const connectionDetailIndex = useMemo(() => {
    const idx = connectionDetailIndexFromPage(selectedPageIndex, numLevels, orderedSystems.length)
    if (idx == null || idx < 0 || idx >= connectionDetailSheets.length) return null
    return idx
  }, [selectedPageIndex, numLevels, orderedSystems.length, connectionDetailSheets.length])

  /**
   * Before the seeding effect adds a row to `connectionSketches`, avoid passing a fresh
   * `emptyConnectionDetailSketch()` every render — that forces PlanLayoutEditor to redo all memos.
   */
  const stableEmptyConnectionSketchByIdRef = useRef(new Map<string, PlanLayoutSketch>())
  const connectionSketchForActiveDetail = useMemo(() => {
    if (connectionDetailIndex == null) return null
    const row = connectionDetailSheets[connectionDetailIndex]
    if (!row) return null
    const fromState = connectionSketches[row.id]
    if (fromState) return fromState
    let cached = stableEmptyConnectionSketchByIdRef.current.get(row.id)
    if (!cached) {
      cached = emptyConnectionDetailSketch()
      stableEmptyConnectionSketchByIdRef.current.set(row.id, cached)
    }
    return cached
  }, [connectionDetailIndex, connectionDetailSheets, connectionSketches])

  const connectionSketchPrevByIdRef = useRef<Record<string, PlanLayoutSketch | undefined>>({})
  const connectionDetailHasContentByIdRef = useRef(new Map<string, boolean>())
  const connectionDetailSketchesNonempty = useMemo(() => {
    const prevById = connectionSketchPrevByIdRef.current
    const hasContentById = connectionDetailHasContentByIdRef.current
    const validIds = new Set(connectionDetailSheets.map((c) => c.id))
    for (const id of [...hasContentById.keys()]) {
      if (!validIds.has(id)) {
        hasContentById.delete(id)
        delete prevById[id]
      }
    }
    let anyNonempty = false
    for (const c of connectionDetailSheets) {
      const s = connectionSketches[c.id]
      if (!s) {
        prevById[c.id] = undefined
        hasContentById.delete(c.id)
        continue
      }
      if (prevById[c.id] !== s) {
        prevById[c.id] = s
        hasContentById.set(c.id, connectionDetailSketchHasContent(s))
      }
      if (hasContentById.get(c.id)) anyNonempty = true
    }
    return anyNonempty
  }, [connectionDetailSheets, connectionSketches])

  const resetAllConnectionSketches = useCallback(() => {
    setConnectionSketches((prev) => {
      const next: Record<string, PlanLayoutSketch> = { ...prev }
      for (const c of connectionDetailSheets) {
        next[c.id] = emptyConnectionDetailSketch()
      }
      return next
    })
  }, [connectionDetailSheets])

  useEffect(() => {
    setConnectionSketches((prev) => {
      let next = { ...prev }
      let changed = false
      for (const c of connectionDetailSheets) {
        if (!next[c.id]) {
          next[c.id] = emptyConnectionDetailSketch()
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [connectionDetailSheets])


  const connectionNavItems = useMemo(
    () =>
      connectionDetailSheets.map((c, i) => ({
        pageIndex: connectionDetailBase + i,
        label: connectionDetailSheetNavSubtitle(c),
        badge: connectionDetailSheetBadge(i),
      })),
    [connectionDetailSheets, connectionDetailBase],
  )

  const selectedSystem = useMemo(() => {
    const n = orderedSystems.length
    const connBase = connectionDetailPageBaseDynamic(numLevels, n)
    if (connectionDetailSheets.length > 0 && selectedPageIndex >= connBase && selectedPageIndex < connBase + connectionDetailSheets.length) {
      const idx = selectedPageIndex - connBase
      const conn = connectionDetailSheets[idx]
      const firstArch = conn?.participants.find((p) => p.source === 'arch' && p.kind === 'wall')
      if (firstArch) return orderedSystems.find((s) => s.id === firstArch.systemId) ?? orderedSystems[0]
      return orderedSystems[0]
    }
    if (selectedPageIndex >= systemPageOff && selectedPageIndex < connBase) {
      return orderedSystems[selectedPageIndex - systemPageOff] ?? orderedSystems[0]
    }
    return orderedSystems[0]
  }, [selectedPageIndex, systemPageOff, numLevels, orderedSystems, connectionDetailSheets])

  useEffect(() => {
    const connBase = connectionDetailPageBaseDynamic(numLevels, orderedSystems.length)
    if (connectionDetailSheets.length === 0) {
      if (selectedPageIndex >= connBase) {
        setSelectedPageIndex(Math.max(0, connBase - 1))
      }
      return
    }
    const lastConn = connBase + connectionDetailSheets.length - 1
    if (selectedPageIndex > lastConn) setSelectedPageIndex(lastConn)
  }, [numLevels, orderedSystems.length, connectionDetailSheets.length, selectedPageIndex])

  const showCompositeSection = selectedPageIndex === 0
  const showCompositePlan = selectedPageIndex === 1
  const showPhysicalSpaceInventory = selectedPageIndex === PAGE_PHYSICAL_SPACE_INVENTORY

  const elevationSheet = useMemo(
    () => isElevationSketchPageDynamic(selectedPageIndex, numLevels)
      ? elevationSheetFromPageIndexDynamic(selectedPageIndex, numLevels)
      : null,
    [selectedPageIndex, numLevels],
  )
  const showPlanSketchPage = levelSheetInfo != null || elevationSheet != null

  /** Commit a sketch change for a specific level. */
  const commitLevelSketch = useCallback((levelIndex: number, next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
    const id = buildingLevels[levelIndex]?.id
    if (!id) return
    // Level 1 is identified by its stable synthetic id, not by being index 0,
    // because sorting may place it at any position in the array.
    if (id === '__default_level_1') {
      commitImplSketchFn(next, opts)
      return
    }
    if (!opts?.skipUndo) {
      setLevelUndoStacks((prev) => {
        const stack = prev[id] ?? []
        const pushed = [...stack.slice(-(HISTORY_CAP - 1)), cloneSketch(levelSketchesRef.current[id] ?? emptySketch(12))]
        levelUndoStacksRef.current = { ...prev, [id]: pushed }
        return { ...prev, [id]: pushed }
      })
      setLevelRedoStacks((prev) => {
        const next = { ...prev, [id]: [] }
        levelRedoStacksRef.current = next
        return next
      })
    }
    const pruned = withPrunedOrphanRoomByCell(next, buildingDimensions)
    levelSketchesRef.current = { ...levelSketchesRef.current, [id]: pruned }
    setLevelSketches((s) => ({ ...s, [id]: pruned }))
  }, [buildingDimensions, buildingLevels])

  useEffect(() => {
    const loaded = loadSketchFromLocalStorage(buildingDimensions)
    const next = withPrunedOrphanRoomByCell(
      ensureDefaultLevelLines(loaded ?? emptySketch(12), buildingDimensions.floorToFloor),
      buildingDimensions,
    )
    setImplSketch(next)
    implSketchRef.current = next
    setConnectionCatalogSketchSticky(null)
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
    const levels = buildingLevelsFromLines(next.elevationLevelLines)
    setBuildingLevels(levels)
    buildingLevelsRef.current = levels
    const ls: Record<string, PlanLayoutSketch> = {}
    // `buildingLevels` is sorted by elevation j — index 0 is topmost (often roof), not Level 1.
    // Level 1 uses `implSketch` only; skip it by id (same as initial `useState` for `levelSketches`).
    for (const level of levels) {
      if (level.id === '__default_level_1') continue
      ls[level.id] = withPrunedOrphanRoomByCell(
        loadLevelSketchFromLocalStorage(buildingDimensions, level.id) ?? newLevelSketch(next),
        buildingDimensions,
      )
    }
    levelSketchesRef.current = ls
    setLevelSketches(ls)
    setLevelUndoStacks({})
    setLevelRedoStacks({})
    levelUndoStacksRef.current = {}
    levelRedoStacksRef.current = {}
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

  /** Keep all extra-level sketches in sync with setup settings from the primary sketch. */
  useEffect(() => {
    const { gridSpacingIn, siteWidthIn, siteDepthIn, buildingHeightIn } = implSketch
    setLevelSketches((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of Object.keys(prev)) {
        const sk = prev[id]!
        const gDiff = Math.abs(sk.gridSpacingIn - gridSpacingIn) > 1e-9
        const swDiff = sk.siteWidthIn !== siteWidthIn
        const sdDiff = sk.siteDepthIn !== siteDepthIn
        const bhDiff = sk.buildingHeightIn !== buildingHeightIn
        if (gDiff || swDiff || sdDiff || bhDiff) {
          next[id] = {
            ...sk,
            gridSpacingIn,
            ...(siteWidthIn != null ? { siteWidthIn } : { siteWidthIn: undefined }),
            ...(siteDepthIn != null ? { siteDepthIn } : { siteDepthIn: undefined }),
            ...(buildingHeightIn != null ? { buildingHeightIn } : { buildingHeightIn: undefined }),
          }
          changed = true
        }
      }
      if (changed) levelSketchesRef.current = next
      return changed ? next : prev
    })
  }, [implSketch.gridSpacingIn, implSketch.siteWidthIn, implSketch.siteDepthIn, implSketch.buildingHeightIn])

  const commitImplSketchFn = useCallback(
    (next: PlanLayoutSketch, opts?: PlanSketchCommitOptions) => {
      const pruned = withPrunedOrphanRoomByCell(next, buildingDimensions)
      if (!opts?.skipUndo) {
        setImplUndoStack((stack) => {
          const pushed = [...stack.slice(-(HISTORY_CAP - 1)), cloneSketch(implSketchRef.current)]
          implUndoStackRef.current = pushed
          return pushed
        })
        setImplRedoStack([])
        implRedoStackRef.current = []
      }
      implSketchRef.current = pruned
      setImplSketch(pruned)
    },
    [buildingDimensions],
  )

  const applyPlanBundle = useCallback(
    (
      floor1: PlanLayoutSketch,
      elevations: Record<ElevationFace, PlanLayoutSketch>,
      importedLevelSketches?: Record<string, PlanLayoutSketch>,
      importedConnectionSketches?: Record<string, PlanLayoutSketch>,
    ) => {
      const prunedFloor = withPrunedOrphanRoomByCell(floor1, buildingDimensions)
      implSketchRef.current = prunedFloor
      setImplSketch(prunedFloor)
      setImplUndoStack([])
      setImplRedoStack([])
      implUndoStackRef.current = []
      implRedoStackRef.current = []
      elevSketchesRef.current = elevations
      setElevSketches(elevations)
      const emptyU = emptyElevUndoRedo()
      setElevUndoStack(emptyU)
      setElevRedoStack(emptyU)
      elevUndoStackRef.current = emptyU
      elevRedoStackRef.current = emptyU
      const lsRaw = importedLevelSketches ?? {}
      const ls: Record<string, PlanLayoutSketch> = {}
      for (const [id, sk] of Object.entries(lsRaw)) {
        ls[id] = withPrunedOrphanRoomByCell(sk, buildingDimensions)
      }
      levelSketchesRef.current = ls
      setLevelSketches(ls)
      setLevelUndoStacks({})
      setLevelRedoStacks({})
      levelUndoStacksRef.current = {}
      levelRedoStacksRef.current = {}
      const connRaw = importedConnectionSketches ?? {}
      const conn: Record<string, PlanLayoutSketch> = {}
      for (const [id, sk] of Object.entries(connRaw)) {
        conn[id] = withPrunedOrphanRoomByCell(sk, buildingDimensions)
      }
      setConnectionSketches(conn)
    },
    [buildingDimensions],
  )

  const importPlanFromFile = useCallback(
    async (file: File): Promise<boolean> => {
      const r = await readPlanBundleOrSketchFromFile(file)
      if (!r) return false
      if (r.kind === 'bundle') {
        applyPlanBundle(r.floor1, r.elevations, r.levelSketches, r.connectionSketches)
        return true
      }
      commitImplSketchFn(r.sketch)
      return true
    },
    [applyPlanBundle, commitImplSketchFn],
  )

  const commitActiveConnectionSketch = useCallback(
    (next: PlanLayoutSketch, _opts?: PlanSketchCommitOptions) => {
      if (connectionDetailIndex == null) return
      const row = connectionDetailSheets[connectionDetailIndex]
      if (!row) return
      const pruned = withPrunedOrphanRoomByCell(next, buildingDimensions)
      setConnectionSketches((prev) => ({ ...prev, [row.id]: pruned }))
    },
    [buildingDimensions, connectionDetailIndex, connectionDetailSheets],
  )

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
    commitImplSketchFn({ ...cur, buildingHeightIn: inches })
  }, [commitImplSketchFn])

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

  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const [id, sketch] of Object.entries(levelSketches)) {
        saveLevelSketchToLocalStorage(buildingDimensions, id, sketch)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [buildingDimensions, levelSketches])

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveConnectionSketchesMapToLocalStorage(buildingDimensions, connectionSketches)
    }, 400)
    return () => clearTimeout(t)
  }, [buildingDimensions, connectionSketches])

  /**
   * Sync buildingLevels from implSketch.elevationLevelLines and batch-correct
   * selectedPageIndex in the same React update to avoid one-render inconsistency
   * (which caused flicker and briefly showed the wrong level sketch).
   */
  useEffect(() => {
    const newLevels = buildingLevelsFromLines(implSketch.elevationLevelLines)
    const oldLevels = buildingLevelsRef.current
    const levelsChanged =
      oldLevels.length !== newLevels.length ||
      !oldLevels.every((l, i) => l.id === newLevels[i]?.id && l.j === newLevels[i]?.j)
    if (!levelsChanged) return

    const oldNum = oldLevels.length
    const newNum = newLevels.length
    const idsChanged =
      oldNum !== newNum || !oldLevels.every((l, i) => l.id === newLevels[i]?.id)

    setBuildingLevels(newLevels)

    if (idsChanged) {
      setSelectedPageIndex((cur) => {
        const oldInfo = levelSheetFromPageIndex(cur, oldNum)
        if (oldInfo) {
          const oldLevelId = oldLevels[oldInfo.levelIndex]?.id
          if (oldLevelId) {
            const newIdx = newLevels.findIndex((l) => l.id === oldLevelId)
            if (newIdx >= 0) {
              const sheetOff = cur - (LEVEL_PAGES_START + oldInfo.levelIndex * SHEETS_PER_LEVEL)
              return LEVEL_PAGES_START + newIdx * SHEETS_PER_LEVEL + sheetOff
            }
          }
          return LEVEL_PAGES_START
        }
        const oldElevBase = elevationSketchPageBaseDynamic(oldNum)
        if (cur >= oldElevBase) {
          return cur - oldElevBase + elevationSketchPageBaseDynamic(newNum)
        }
        return cur
      })
    }

    // Auto-create empty sketches for new levels
    if (newLevels.length > 1) {
      let sketchChanged = false
      const nextSketches = { ...levelSketchesRef.current }
      for (const level of newLevels) {
        if (level.id === '__default_level_1') continue
        if (!nextSketches[level.id]) {
          nextSketches[level.id] = newLevelSketch(implSketchRef.current)
          sketchChanged = true
        }
      }
      if (sketchChanged) {
        levelSketchesRef.current = nextSketches
        setLevelSketches(nextSketches)
      }
    }
  }, [implSketch.elevationLevelLines])

  const toggleAllSystemsAssemblyLayers = useCallback(() => {
    const allShown = systems.every(
      (s) => s.layers.length === 0 || s.layers.every((l) => l.visible !== false),
    )
    setSystems(applyAssemblyLayerVisibilityAllSystems(systems, !allShown))
  }, [systems])

  function handleSelectSystem(system: SystemData) {
    const idx = orderedSystems.findIndex(s => s.id === system.id)
    setSelectedPageIndex(idx >= 0 ? systemPageIndexDynamic(idx, numLevels) : systemPageOff)
  }

  function handleSelectPage(index: number) {
    setSelectedPageIndex(index)
  }

  // Arrow keys: flip through all pages (composite + sheets)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
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

  const undoCurrentLevelSketch = useCallback(() => {
    if (activeLevelId == null) return
    if (activeIsLevel1) { undoImplSketch(); return }
    const stack = levelUndoStacksRef.current[activeLevelId] ?? []
    if (stack.length === 0) return
    const snap = stack[stack.length - 1]!
    const nextUndo = { ...levelUndoStacksRef.current, [activeLevelId]: stack.slice(0, -1) }
    const current = cloneSketch(levelSketchesRef.current[activeLevelId] ?? emptySketch(12))
    const nextRedo = { ...levelRedoStacksRef.current, [activeLevelId]: [...(levelRedoStacksRef.current[activeLevelId] ?? []).slice(-(HISTORY_CAP - 1)), current] }
    levelUndoStacksRef.current = nextUndo
    levelRedoStacksRef.current = nextRedo
    setLevelUndoStacks(nextUndo)
    setLevelRedoStacks(nextRedo)
    levelSketchesRef.current = { ...levelSketchesRef.current, [activeLevelId]: snap }
    setLevelSketches((s) => ({ ...s, [activeLevelId!]: snap }))
  }, [activeLevelId, activeIsLevel1, undoImplSketch])

  const redoCurrentLevelSketch = useCallback(() => {
    if (activeLevelId == null) return
    if (activeIsLevel1) { redoImplSketch(); return }
    const rstack = levelRedoStacksRef.current[activeLevelId] ?? []
    if (rstack.length === 0) return
    const snap = rstack[rstack.length - 1]!
    const nextRedo = { ...levelRedoStacksRef.current, [activeLevelId]: rstack.slice(0, -1) }
    const current = cloneSketch(levelSketchesRef.current[activeLevelId] ?? emptySketch(12))
    const nextUndo = { ...levelUndoStacksRef.current, [activeLevelId]: [...(levelUndoStacksRef.current[activeLevelId] ?? []).slice(-(HISTORY_CAP - 1)), current] }
    levelUndoStacksRef.current = nextUndo
    levelRedoStacksRef.current = nextRedo
    setLevelUndoStacks(nextUndo)
    setLevelRedoStacks(nextRedo)
    levelSketchesRef.current = { ...levelSketchesRef.current, [activeLevelId]: snap }
    setLevelSketches((s) => ({ ...s, [activeLevelId!]: snap }))
  }, [activeLevelId, activeIsLevel1, redoImplSketch])

  // ⌘Z / Ctrl+Z — undo · ⌘⇧Z / Ctrl+Shift+Z or Ctrl+Y — redo (level + elevation sketch pages)
  useEffect(() => {
    if (!isLevelSketchPage(selectedPageIndex, numLevels) && !isElevationSketchPageDynamic(selectedPageIndex, numLevels)) return
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
        if (isLevelSketchPage(selectedPageIndex, numLevels)) redoCurrentLevelSketch()
        else {
          const sh = elevationSheetFromPageIndexDynamic(selectedPageIndex, numLevels)
          if (sh) redoElevationSketch(sh.face)
        }
        return
      }
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (isLevelSketchPage(selectedPageIndex, numLevels)) undoCurrentLevelSketch()
        else {
          const sh = elevationSheetFromPageIndexDynamic(selectedPageIndex, numLevels)
          if (sh) undoElevationSketch(sh.face)
        }
        return
      }
      if (e.ctrlKey && !e.metaKey && e.key === 'y') {
        e.preventDefault()
        if (isLevelSketchPage(selectedPageIndex, numLevels)) redoCurrentLevelSketch()
        else {
          const sh = elevationSheetFromPageIndexDynamic(selectedPageIndex, numLevels)
          if (sh) redoElevationSketch(sh.face)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    selectedPageIndex,
    numLevels,
    searchOpen,
    undoCurrentLevelSketch,
    redoCurrentLevelSketch,
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
        buildingLevels={buildingLevels}
        numLevels={numLevels}
        connectionNavItems={connectionNavItems}
      />

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        orderedSystems={orderedSystems}
        buildingLevels={buildingLevels}
        planConnections={connectionDetailSheets}
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
                setSelectedPageIndex(idx >= 0 ? systemPageIndexDynamic(idx, numLevels) : systemPageOff)
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
                levelSheetInfo
                  ? (activeIsLevel1 ? implSketch : (levelSketches[activeLevelId!] ?? newLevelSketch(implSketch)))
                  : elevSketches[elevationSheet!.face]
              }
              onDownloadFullPlan={() =>
                downloadPlanBundleJson({
                  floor1: implSketch,
                  elevations: elevSketches,
                  levelSketches,
                  connectionSketches,
                })
              }
              onImportFullPlan={importPlanFromFile}
              onSketchChange={
                levelSheetInfo
                  ? (next, o) => commitLevelSketch(activeLevelIndex!, next, o)
                  : (next, o) => commitElevationSketch(elevationSheet!.face, next, o)
              }
              onUndo={
                levelSheetInfo
                  ? undoCurrentLevelSketch
                  : () => undoElevationSketch(elevationSheet!.face)
              }
              canUndo={
                levelSheetInfo
                  ? (activeIsLevel1 ? implUndoStack.length > 0 : (levelUndoStacks[activeLevelId!]?.length ?? 0) > 0)
                  : elevUndoStack[elevationSheet!.face].length > 0
              }
              onRedo={
                levelSheetInfo
                  ? redoCurrentLevelSketch
                  : () => redoElevationSketch(elevationSheet!.face)
              }
              canRedo={
                levelSheetInfo
                  ? (activeIsLevel1 ? implRedoStack.length > 0 : (levelRedoStacks[activeLevelId!]?.length ?? 0) > 0)
                  : elevRedoStack[elevationSheet!.face].length > 0
              }
              planViewContext={
                levelSheetInfo
                  ? { kind: 'floor1', sheet: levelSheetInfo.sheet }
                  : { kind: 'elevation', sheet: elevationSheet! }
              }
              buildingHeightIn={resolvedBuildingHeightIn}
              onBuildingHeightInChange={onBuildingHeightInChange}
              layoutSketch={implSketch}
              onLayoutSketchChange={commitImplSketchFn}
              connectionDetailSketchesNonempty={connectionDetailSketchesNonempty}
              onResetAllConnectionSketches={resetAllConnectionSketches}
              levelSketches={levelSketches}
              buildingLevels={buildingLevels}
              onToggleAllSystemsAssemblyLayers={toggleAllSystemsAssemblyLayers}
              connectionSketches={connectionSketches}
              className="flex-1 min-h-0"
            />
          </>
        ) : connectionDetailIndex != null ? (
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
                  type="button"
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
                  type="button"
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
                  type="button"
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
            <ConnectionLayoutEditorView
              buildingDimensions={buildingDimensions}
              orderedSystems={orderedSystems}
              connection={connectionDetailSheets[connectionDetailIndex]!}
              connectionOrdinal={connectionDetailIndex}
              connectionCount={connectionDetailSheets.length}
              sketch={connectionSketchForActiveDetail ?? emptyConnectionDetailSketch()}
              onSketchChange={commitActiveConnectionSketch}
              layoutSketch={implSketch}
              onLayoutSketchChange={commitImplSketchFn}
              connectionDetailSketchesNonempty={connectionDetailSketchesNonempty}
              onResetAllConnectionSketches={resetAllConnectionSketches}
              buildingHeightIn={resolvedBuildingHeightIn}
              onBuildingHeightInChange={onBuildingHeightInChange}
              buildingLevels={buildingLevels}
              onDownloadFullPlan={() =>
                downloadPlanBundleJson({
                  floor1: implSketch,
                  elevations: elevSketches,
                  levelSketches,
                  connectionSketches,
                })
              }
              onImportFullPlan={importPlanFromFile}
              onToggleAllSystemsAssemblyLayers={toggleAllSystemsAssemblyLayers}
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
