export type ActiveCatalog = 'arch' | 'mep'

export type ZoomAnchorCommit = {
  z0: number
  ux: number
  uy: number
  brBefore: DOMRectReadOnly
  scrollBefore: { l: number; t: number }
}
