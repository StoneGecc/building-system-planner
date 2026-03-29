import type { PlanLayoutSketch } from '../types/planLayout'
import { cellKeyString } from '../types/planLayout'
import { minCellSpanFromDrawingAxes } from './connectionDetailAssemblyGridLines'

type WallMask = {
  originXIn: number
  originYIn: number
  stepIn: number
  w: number
  h: number
  wall: Uint8Array
}

const MAX_MASK_PIXELS = 450_000

function maskCacheKey(sketch: PlanLayoutSketch, xsIn: readonly number[], ysIn: readonly number[]): string {
  const cuts = sketch.annotationSectionCuts ?? []
  const cutPart = cuts
    .map((c) => `${c.id}:${c.startNode.i},${c.startNode.j}-${c.endNode.i},${c.endNode.j}`)
    .join('|')
  return `${cutPart}§${xsIn.join(',')}§${ysIn.join(',')}`
}

let wallMaskCache: { key: string; mask: WallMask } | null = null

function stampDiamond(wall: Uint8Array, bw: number, bh: number, px: number, py: number, half: number) {
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > half) continue
      const x = px + dx
      const y = py + dy
      if (x >= 0 && x < bw && y >= 0 && y < bh) wall[y * bw + x] = 1
    }
  }
}

function plotSegmentThick(
  wall: Uint8Array,
  bw: number,
  bh: number,
  x0p: number,
  y0p: number,
  x1p: number,
  y1p: number,
  half: number,
) {
  const dx = x1p - x0p
  const dy = y1p - y0p
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)))
  for (let s = 0; s <= n; s++) {
    const t = s / n
    const px = Math.floor(x0p + dx * t)
    const py = Math.floor(y0p + dy * t)
    stampDiamond(wall, bw, bh, px, py, half)
  }
}

function buildWallMask(sketch: PlanLayoutSketch, xsIn: readonly number[], ysIn: readonly number[]): WallMask | null {
  if (xsIn.length < 2 || ysIn.length < 2) return null
  const minX = xsIn[0]!
  const maxX = xsIn[xsIn.length - 1]!
  const minY = ysIn[0]!
  const maxY = ysIn[ysIn.length - 1]!
  const minCell = minCellSpanFromDrawingAxes(xsIn, ysIn) ?? Math.max(maxX - minX, maxY - minY) / 20
  const spanX = maxX - minX
  const spanY = maxY - minY
  if (spanX <= 0 || spanY <= 0) return null

  let stepIn = Math.max(spanX / 900, spanY / 900, minCell / 56, 1 / 128)
  let padIn = Math.max(minCell * 0.2, stepIn * 4)
  let w = Math.ceil((spanX + 2 * padIn) / stepIn)
  let h = Math.ceil((spanY + 2 * padIn) / stepIn)
  while (w * h > MAX_MASK_PIXELS) {
    stepIn *= 1.2
    padIn = Math.max(minCell * 0.2, stepIn * 4)
    w = Math.ceil((spanX + 2 * padIn) / stepIn)
    h = Math.ceil((spanY + 2 * padIn) / stepIn)
  }
  if (w < 3 || h < 3) return null

  const originXIn = minX - padIn
  const originYIn = minY - padIn
  const wall = new Uint8Array(w * h)

  const halfPx = Math.max(1, Math.ceil(Math.max(stepIn * 0.85, minCell * 0.045) / stepIn))

  for (let x = 0; x < w; x++) {
    wall[x] = 1
    wall[(h - 1) * w + x] = 1
  }
  for (let y = 0; y < h; y++) {
    wall[y * w] = 1
    wall[y * w + (w - 1)] = 1
  }

  const toPx = (xIn: number, yIn: number) => ({
    px: Math.floor((xIn - originXIn) / stepIn),
    py: Math.floor((yIn - originYIn) / stepIn),
  })

  for (const cut of sketch.annotationSectionCuts ?? []) {
    const x0 = xsIn[cut.startNode.i]
    const y0 = ysIn[cut.startNode.j]
    const x1 = xsIn[cut.endNode.i]
    const y1 = ysIn[cut.endNode.j]
    if (x0 == null || y0 == null || x1 == null || y1 == null) continue
    const a = toPx(x0, y0)
    const b = toPx(x1, y1)
    plotSegmentThick(wall, w, h, a.px, a.py, b.px, b.py, halfPx)
  }

  return { originXIn, originYIn, stepIn, w, h, wall }
}

function getCachedWallMask(sketch: PlanLayoutSketch, xsIn: readonly number[], ysIn: readonly number[]): WallMask | null {
  const key = maskCacheKey(sketch, xsIn, ysIn)
  if (wallMaskCache?.key === key) return wallMaskCache.mask
  const mask = buildWallMask(sketch, xsIn, ysIn)
  if (mask) wallMaskCache = { key, mask }
  return mask
}

function floodFromSeed(mask: WallMask, sx: number, sy: number): Uint8Array | null {
  const { w, h, wall } = mask
  if (sx < 0 || sx >= w || sy < 0 || sy >= h || wall[sy * w + sx]) return null
  const filled = new Uint8Array(w * h)
  const q: number[] = [sy * w + sx]
  let qi = 0
  while (qi < q.length) {
    const idx = q[qi++]!
    if (filled[idx] || wall[idx]) continue
    filled[idx] = 1
    const x = idx % w
    const y = (idx / w) | 0
    if (x > 0) q.push(idx - 1)
    if (x + 1 < w) q.push(idx + 1)
    if (y > 0) q.push(idx - w)
    if (y + 1 < h) q.push(idx + w)
  }
  return filled
}

/**
 * True if the axis-aligned cell [x0,x1]×[y0,y1] (plan inches) overlaps any filled raster pixel.
 * Point-sampling misses corner cells where thick wall strokes eat the center but a sliver of the
 * cell is still inside the flooded region.
 */
function cellPlanRectIntersectsFilled(
  filled: Uint8Array,
  mask: WallMask,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): boolean {
  const { originXIn, originYIn, stepIn, w, h } = mask
  const xa = Math.min(x0, x1)
  const xb = Math.max(x0, x1)
  const ya = Math.min(y0, y1)
  const yb = Math.max(y0, y1)
  const pxMin = Math.max(0, Math.floor((xa - originXIn) / stepIn))
  const pxMax = Math.min(w - 1, Math.ceil((xb - originXIn) / stepIn) - 1)
  const pyMin = Math.max(0, Math.floor((ya - originYIn) / stepIn))
  const pyMax = Math.min(h - 1, Math.ceil((yb - originYIn) / stepIn) - 1)
  if (pxMin > pxMax || pyMin > pyMax) return false
  for (let py = pyMin; py <= pyMax; py++) {
    const row = py * w
    for (let px = pxMin; px <= pxMax; px++) {
      if (filled[row + px]) return true
    }
  }
  return false
}

function cellKeysTouchingFilled(
  filled: Uint8Array,
  mask: WallMask,
  xsIn: readonly number[],
  ysIn: readonly number[],
): string[] {
  const nx = xsIn.length - 1
  const ny = ysIn.length - 1
  const out: string[] = []
  const seen = new Set<string>()

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const xL = xsIn[i]!
      const xR = xsIn[i + 1]!
      const yB = ysIn[j]!
      const yT = ysIn[j + 1]!
      const ck = cellKeyString({ i, j })
      if (
        cellPlanRectIntersectsFilled(filled, mask, xL, xR, yB, yT) &&
        !seen.has(ck)
      ) {
        seen.add(ck)
        out.push(ck)
      }
    }
  }
  return out
}

/**
 * All connection-detail cells whose interior overlaps the raster region flood-filled from `(xIn, yIn)`.
 * Barriers are the actual detail-line segments in plan inches (plus a closed outer frame), not grid graph edges.
 */
export function connectionDetailRasterFillCellKeysAtPlanInches(params: {
  sketch: PlanLayoutSketch
  xIn: number
  yIn: number
  xsIn: readonly number[]
  ysIn: readonly number[]
}): string[] | null {
  const { sketch, xIn, yIn, xsIn, ysIn } = params
  const mask = getCachedWallMask(sketch, xsIn, ysIn)
  if (!mask) return null
  const sx = Math.floor((xIn - mask.originXIn) / mask.stepIn)
  const sy = Math.floor((yIn - mask.originYIn) / mask.stepIn)
  const filled = floodFromSeed(mask, sx, sy)
  if (!filled) return null
  const keys = cellKeysTouchingFilled(filled, mask, xsIn, ysIn)
  return keys.length > 0 ? keys : null
}
