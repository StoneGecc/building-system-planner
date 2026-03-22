import { useRef, useState, useCallback, useEffect } from 'react'
import type { SystemData } from '../types/system'
import type { BuildingLayout } from '../data/buildingLayout'
import { BuildingSection } from './BuildingSection'
import { BuildingPlan } from './BuildingPlan'
import { cn } from '../lib/utils'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

interface CompositeViewProps {
  pageType: 'section' | 'plan'
  systems: SystemData[]
  layout: BuildingLayout
  zoom?: number
  onZoomChange?: (zoom: number) => void
  onSelectSystem?: (system: SystemData) => void
  className?: string
}

function exportSvg(svgEl: SVGSVGElement | null, filename: string) {
  if (!svgEl) return
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(clone)
  const blob = new Blob(['<?xml version="1.0" encoding="utf-8"?>\n' + source], {
    type: 'image/svg+xml',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const SHEET_W = 1200
const SHEET_H = 820

export function CompositeView({ pageType, systems, layout, zoom: zoomProp, onZoomChange, onSelectSystem, className }: CompositeViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null)
  const [localZoom, setLocalZoom] = useState(1)
  const zoom = zoomProp ?? localZoom
  const setZoom = onZoomChange ?? setLocalZoom

  const isSection = pageType === 'section'
  const pageId = isSection ? '00' : '01'
  const pageName = isSection ? 'Building Section' : 'Building Plan'

  const zoomIn = useCallback(() => {
    setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))
  }, [zoom, setZoom])
  const zoomOut = useCallback(() => {
    setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))
  }, [zoom, setZoom])
  const zoomReset = useCallback(() => setZoom(1), [setZoom])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (e.deltaY < 0) zoomIn()
        else zoomOut()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomIn, zoomOut])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          zoomIn()
        } else if (e.key === '-') {
          e.preventDefault()
          zoomOut()
        } else if (e.key === '0') {
          e.preventDefault()
          zoomReset()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomIn, zoomOut, zoomReset])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar — matches DrawingCanvas */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold tracking-widest text-foreground">
            {pageId}
          </span>
          <span className="text-xs text-muted-foreground font-mono tracking-wide uppercase">
            {pageName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono tracking-wider">
            {isSection ? 'SECTION' : 'PLAN'}
          </span>
          <div className="w-px h-4 bg-border/60" />
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              className={cn(
                'inline-flex items-center justify-center w-8 h-7',
                'border-[0.5px] border-border text-foreground bg-white',
                'font-mono text-[10px] font-bold',
                'hover:bg-foreground hover:text-white hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-colors duration-100',
              )}
              title="Zoom out (Ctrl−)"
            >
              −
            </button>
            <button
              onClick={zoomReset}
              className={cn(
                'inline-flex items-center justify-center min-w-[3rem] h-7 px-2',
                'border-[0.5px] border-border text-foreground bg-white',
                'font-mono text-[10px] tracking-wider',
                'hover:bg-foreground hover:text-white hover:border-foreground',
                'transition-colors duration-100',
              )}
              title="Reset zoom (Ctrl+0)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              className={cn(
                'inline-flex items-center justify-center w-8 h-7',
                'border-[0.5px] border-border text-foreground bg-white',
                'font-mono text-[10px] font-bold',
                'hover:bg-foreground hover:text-white hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-colors duration-100',
              )}
              title="Zoom in (Ctrl+)"
            >
              +
            </button>
          </div>
          <div className="w-px h-4 bg-border/60" />
          <button
            onClick={() => exportSvg(svgRef.current, isSection ? 'building-section.svg' : 'building-plan.svg')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-7',
              'border-[0.5px] border-border text-foreground bg-white',
              'font-mono text-[10px] tracking-widest uppercase',
              'hover:bg-foreground hover:text-white hover:border-foreground',
              'transition-colors duration-100',
            )}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export SVG
          </button>
        </div>
      </div>

      {/* Drawing viewport — same 1200×820 sheet size as system sheets */}
      <div
        ref={viewportRef}
        className="flex-1 overflow-auto bg-[#f0ede8] p-6"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div style={{ textAlign: 'center', minWidth: 'min-content', minHeight: 'min-content' }}>
          <div
            className="shadow-2xl bg-white transition-transform duration-150"
            style={{
              display: 'inline-block',
              width: SHEET_W * zoom,
              height: SHEET_H * zoom,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: SHEET_W,
                height: SHEET_H,
              }}
            >
            {isSection ? (
              <BuildingSection
                systems={systems}
                layout={layout}
                svgRef={svgRef}
                hoveredSystemId={hoveredSystemId}
                onHoverSystem={setHoveredSystemId}
                onSelectSystem={onSelectSystem}
                systemIndex={0}
              />
            ) : (
              <BuildingPlan
                systems={systems}
                layout={layout}
                svgRef={svgRef}
                hoveredSystemId={hoveredSystemId}
                onHoverSystem={setHoveredSystemId}
                onSelectSystem={onSelectSystem}
                systemIndex={1}
              />
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer strip — same format as DrawingCanvas */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border bg-white shrink-0">
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
          Scale: 1/8&quot; = 1&apos;-0&quot;
        </span>
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
          Footprint: 30&apos;-0&quot; × 40&apos;-0&quot;
        </span>
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
          Floor-to-floor: 11&apos;-0&quot;
        </span>
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase ml-auto">
          Total height: 33&apos;-0&quot;
        </span>
      </div>
    </div>
  )
}
