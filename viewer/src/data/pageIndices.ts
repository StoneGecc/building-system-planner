/** Central map: sidebar / search / keyboard nav must stay aligned. */
export const PAGE_COMPOSITE_SECTION = 0
export const PAGE_COMPOSITE_PLAN = 1
export const PAGE_IMPLEMENTATION_PLAN = 2
/** First per-system sheet index in `orderedSystems` */
export const SYSTEM_PAGE_OFFSET = 3

export function systemPageIndex(orderIndex: number): number {
  return orderIndex + SYSTEM_PAGE_OFFSET
}

export function systemOrderIndexFromPage(pageIndex: number): number | null {
  if (pageIndex < SYSTEM_PAGE_OFFSET) return null
  return pageIndex - SYSTEM_PAGE_OFFSET
}
