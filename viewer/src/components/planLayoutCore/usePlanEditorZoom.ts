import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { clampZoom } from './planEditorGeometry'
import { ZOOM_MAX } from './constants'
import type { ZoomAnchorCommit } from './types'

export function usePlanEditorZoom(
  scrollRef: RefObject<HTMLDivElement | null>,
  planBoxRef: RefObject<HTMLDivElement | null>,
  zoomMax: number = ZOOM_MAX,
) {
  const zoomCommitRef = useRef<ZoomAnchorCommit | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const applyZoom = useCallback((targetZoom: number, anchor?: { clientX: number; clientY: number }) => {
    setZoom((z0) => {
      const z1 = clampZoom(targetZoom, zoomMax)
      if (Math.abs(z1 - z0) < 1e-9) {
        zoomCommitRef.current = null
        return z0
      }
      const scroll = scrollRef.current
      const box = planBoxRef.current
      if (scroll && box && anchor) {
        const br = box.getBoundingClientRect()
        const relX = anchor.clientX - br.left
        const relY = anchor.clientY - br.top
        zoomCommitRef.current = {
          z0,
          ux: relX / z0,
          uy: relY / z0,
          brBefore: br,
          scrollBefore: { l: scroll.scrollLeft, t: scroll.scrollTop },
        }
      } else {
        zoomCommitRef.current = null
      }
      return z1
    })
  }, [scrollRef, planBoxRef, zoomMax])

  const applyZoomRef = useRef(applyZoom)
  applyZoomRef.current = applyZoom

  useLayoutEffect(() => {
    const c = zoomCommitRef.current
    if (!c) return
    zoomCommitRef.current = null
    const scroll = scrollRef.current
    const box = planBoxRef.current
    if (!scroll || !box) return
    const brAfter = box.getBoundingClientRect()
    scroll.scrollLeft = c.scrollBefore.l + c.ux * (zoom - c.z0) + (c.brBefore.left - brAfter.left)
    scroll.scrollTop = c.scrollBefore.t + c.uy * (zoom - c.z0) + (c.brBefore.top - brAfter.top)
  }, [zoom, scrollRef, planBoxRef])

  return { zoom, setZoom, zoomRef, applyZoom, applyZoomRef, zoomCommitRef }
}
