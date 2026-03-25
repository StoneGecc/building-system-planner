import { useEffect, useRef, useState } from 'react'
import { planPaintSwatchColor, type PlanColorCatalog, type PlanPlaceMode } from '../lib/planLayerColors'
import { cn } from '../lib/utils'
import type { ActiveCatalog } from './planLayoutCore/types'

export type PaintSystemOption = {
  value: string
  /** Left column in the picker (id — name). */
  title: string
  /** Right column, e.g. formatted thickness (right-aligned in the dropdown). */
  detail?: string
  catalog: ActiveCatalog
  id: string
}

export function PlanSystemPicker({
  options,
  value,
  placeMode,
  planColorCatalog,
  onChange,
  disabled,
}: {
  options: PaintSystemOption[]
  value: string
  placeMode: PlanPlaceMode
  planColorCatalog: PlanColorCatalog
  onChange: (raw: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [placeMode])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc, true)
    return () => document.removeEventListener('pointerdown', onDoc, true)
  }, [open])

  const effectiveValue =
    options.length === 0 ? '' : options.some((o) => o.value === value) ? value : options[0]!.value

  const current = options.find((o) => o.value === effectiveValue)

  const swatch = (o: PaintSystemOption) => planPaintSwatchColor(o.catalog, o.id, placeMode, planColorCatalog)

  const optionAriaLabel = (o: PaintSystemOption) => (o.detail ? `${o.title}, ${o.detail}` : o.title)

  if (disabled || options.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-muted/30 text-muted-foreground rounded-sm text-left"
      >
        <span className="h-2.5 w-2.5 rounded-sm border border-border shrink-0 bg-muted" />
        No systems
      </button>
    )
  }

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={current ? optionAriaLabel(current) : undefined}
        onClick={() => setOpen((x) => !x)}
        className="w-full min-w-0 flex items-center gap-2 border border-border px-1.5 py-1 font-mono text-[9px] bg-white hover:bg-muted/40 rounded-sm text-left"
      >
        <span
          className="h-2.5 w-2.5 rounded-sm border border-black/25 shrink-0"
          style={{ backgroundColor: swatch(current!) }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate min-w-0">{current?.title}</span>
          {current?.detail ? (
            <span className="shrink-0 text-right tabular-nums text-muted-foreground">{current.detail}</span>
          ) : null}
        </span>
        <span className="text-muted-foreground shrink-0 text-[8px] leading-none pt-px">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-white py-0.5 shadow-md"
        >
          {options.map((o) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="option"
                aria-selected={o.value === effectiveValue}
                aria-label={optionAriaLabel(o)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left font-mono text-[9px] hover:bg-zinc-100',
                  o.value === effectiveValue && 'bg-zinc-100',
                )}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm border border-black/25 shrink-0"
                  style={{ backgroundColor: swatch(o) }}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate min-w-0">{o.title}</span>
                  {o.detail ? (
                    <span className="shrink-0 text-right tabular-nums text-muted-foreground">{o.detail}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
