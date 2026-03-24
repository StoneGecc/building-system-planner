export interface MepItem {
  id: string
  name: string
  discipline: string
  /** Plan stroke width in inches (duct width or pipe OD), 0 = use default hairline */
  planWidthIn: number
  notes: string
}
