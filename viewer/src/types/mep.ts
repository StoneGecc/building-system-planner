export interface MepItem {
  id: string
  name: string
  discipline: string
  /** From CSV `System_Type` (piping, equipment, valve, device, fixture, conduit, ductwork, pathway). */
  systemType: string
  /** Plan stroke width in inches (duct width or pipe OD), 0 = use default hairline */
  planWidthIn: number
  /** Equipment plan footprint length (long axis) in inches; 0 = use default circle. */
  planEquipLengthIn: number
  /** Equipment plan footprint width (short axis) in inches; 0 = use default circle. */
  planEquipWidthIn: number
  /** Optional `Plan_Color` from MEP CSV (6 hex digits, no #). */
  planColorHex?: string
  notes: string
}
