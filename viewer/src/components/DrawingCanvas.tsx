import { useRef, useState, useCallback, useEffect } from 'react'
import type { SystemData } from '../types/system'
import { SectionDrawing } from './SectionDrawing'
import { cn } from '../lib/utils'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

interface DrawingCanvasProps {
  system: SystemData
  systemIndex: number
  onOpenBulkEditWithLayer?: (systemId: string, layerIndex: number) => void
  className?: string
}

function exportSVG(svgEl: SVGSVGElement, system: SystemData) {
  const serializer = new XMLSerializer()
  let svgStr = serializer.serializeToString(svgEl)
  // Ensure xmlns is present for standalone SVG
  if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  svgStr = '<?xml version="1.0" encoding="utf-8"?>\n' + svgStr

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${system.id}-${system.name.replace(/[^\w]/g, '-')}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function DrawingCanvas({ system, systemIndex, onOpenBulkEditWithLayer, className }: DrawingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  const handleExport = () => {
    if (svgRef.current) {
      exportSVG(svgRef.current, system)
    }
  }

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))
  }, [])
  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))
  }, [])
  const zoomReset = useCallback(() => setZoom(1), [])

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
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold tracking-widest text-foreground">
            {system.id}
          </span>
          <span className="text-xs text-muted-foreground font-mono tracking-wide uppercase">
            {system.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono tracking-wider">
            {system.layers.length} LAYERS
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
            onClick={handleExport}
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

      {/* Drawing viewport — Ctrl/Cmd + scroll to zoom */}
      <div
        ref={viewportRef}
        className="flex-1 overflow-auto bg-[#f0ede8] p-6"
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Wrapper ensures scroll area = zoomed size; inline-block + text-align centers when zoomed out */}
        <div style={{ textAlign: 'center', minWidth: 'min-content', minHeight: 'min-content' }}>
          <div
            className="shadow-2xl bg-white transition-transform duration-150"
            style={{
              display: 'inline-block',
              width: 1200 * zoom,
              height: 820 * zoom,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: 1200,
                height: 820,
              }}
            >
              <SectionDrawing
                system={system}
                systemIndex={systemIndex}
                svgRef={svgRef as React.RefObject<SVGSVGElement>}
                onOpenBulkEditWithLayer={onOpenBulkEditWithLayer}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer strip */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border/60 bg-white shrink-0">
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
          Total THK: {system.totalThickness} in
        </span>
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
          Total R-Value: R-{system.totalR}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase ml-auto">
          Scale: 3&quot; = 1&apos;-0&quot;
        </span>
      </div>
    </div>
  )
}
