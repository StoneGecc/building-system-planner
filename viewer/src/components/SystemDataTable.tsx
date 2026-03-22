import { useEffect, useRef } from 'react'
import type { SystemData, Layer, LayerType } from '../types/system'
import { parseThickness } from '../lib/csvParser'
import { FILL_OPTIONS } from './HatchDefs'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import type { FastenerIconId } from '../lib/fastenerIcons'
import { FASTENER_ICON_IDS, FASTENER_ICON_LABELS, FastenerIconSvg, resolveFastenerIcon } from '../lib/fastenerIcons'
import { ChevronUp, ChevronDown, Trash2, Plus, Check } from 'lucide-react'

const CSV_COLUMNS = ['#', 'Layer', 'Material', 'Thickness_in', 'Approx_R_Value', 'Connection', 'Fastener', 'Fastener_Size', 'Layer_Type', 'Fill', 'Fastener_Icon', 'Notes']

function computeTotalsFromLayers(layers: Layer[]): { totalThickness: string; totalR: string } {
  const visible = layers.filter(l => l.visible !== false)
  const totalThickness = visible.reduce((sum, l) => sum + parseThickness(l.thickness), 0)
  const totalR = visible.reduce((sum, l) => sum + parseThickness(l.rValue), 0)
  return {
    totalThickness: totalThickness > 0 ? totalThickness.toFixed(3).replace(/\.?0+$/, '') : '—',
    totalR: totalR > 0 ? totalR.toFixed(2).replace(/\.?0+$/, '') : '—',
  }
}

function reindexLayers(layers: Layer[]): Layer[] {
  return layers.map((l, i) => ({ ...l, index: i + 1 }))
}

function createDefaultLayer(index: number): Layer {
  return {
    index,
    name: '',
    material: '',
    thickness: '0',
    rValue: '0',
    connection: '',
    fastener: '',
    fastenerSize: '',
    fastenerIcon: 'none',
    layerType: 'MISC' as LayerType,
    notes: '',
    visible: true,
  }
}

export function copySystemToClipboard(system: SystemData): void {
  const escape = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s)
  const headerRow = CSV_COLUMNS.join(',')
  const layerRows = system.layers.map((l, i) =>
    [i + 1, l.name, l.material, l.thickness, l.rValue, l.connection, l.fastener, l.fastenerSize, l.layerType, l.fill ?? '', resolveFastenerIcon(l), l.notes].map(v => escape(String(v))).join(',')
  )
  const totalRow = ['TOTAL', '—', '—', system.totalThickness, system.totalR, '—', '—', '—', '—', '—', 'none', ''].map(escape).join(',')
  const csv = [headerRow, ...layerRows, totalRow].join('\n')
  navigator.clipboard.writeText(csv)
}

interface SystemDataTableProps {
  system: SystemData
  onUpdate: (updated: SystemData) => void
  highlightedLayerIndex?: number
}

const textareaClass = 'w-full min-w-0 px-3 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground resize-y overflow-visible whitespace-pre-wrap break-words block'

export function SystemDataTable({ system, onUpdate, highlightedLayerIndex }: SystemDataTableProps) {
  const updateLayer = (layerIndex: number, field: keyof Layer, value: string | boolean | FastenerIconId) => {
    const layers = [...system.layers]
    layers[layerIndex] = { ...layers[layerIndex], [field]: value }
    const totals = (field === 'thickness' || field === 'rValue' || field === 'visible')
      ? computeTotalsFromLayers(layers)
      : { totalThickness: system.totalThickness, totalR: system.totalR }
    onUpdate({ ...system, layers, ...totals })
  }

  const updateTotal = (field: 'totalThickness' | 'totalR', value: string) => {
    onUpdate({ ...system, [field]: value })
  }

  const moveLayer = (fromIndex: number, direction: 'up' | 'down') => {
    const layers = [...system.layers]
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
    if (toIndex < 0 || toIndex >= layers.length) return
    ;[layers[fromIndex], layers[toIndex]] = [layers[toIndex], layers[fromIndex]]
    const reindexed = reindexLayers(layers)
    const totals = computeTotalsFromLayers(reindexed)
    onUpdate({ ...system, layers: reindexed, ...totals })
  }

  const addLayer = () => {
    const newLayer = createDefaultLayer(system.layers.length + 1)
    const layers = reindexLayers([...system.layers, newLayer])
    const totals = computeTotalsFromLayers(layers)
    onUpdate({ ...system, layers, ...totals })
  }

  const removeLayer = (layerIndex: number) => {
    if (system.layers.length <= 1) return
    const layers = system.layers.filter((_, i) => i !== layerIndex)
    const reindexed = reindexLayers(layers)
    const totals = computeTotalsFromLayers(reindexed)
    onUpdate({ ...system, layers: reindexed, ...totals })
  }

  const btnClass = 'p-1 border border-border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors'
  const iconSize = 12
  const highlightedRowRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (highlightedLayerIndex != null && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedLayerIndex])

  return (
    <div className="space-y-2">
    <table className="font-mono text-xs border-collapse w-full min-w-[1000px] table-fixed">
      <colgroup>
        <col style={{ width: '5.5em' }} />
        <col style={{ width: '2.5em' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '5%' }} />
        <col style={{ width: '4%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '6%' }} />
        <col style={{ width: '14%' }} />
      </colgroup>
      <thead>
        <tr className="bg-muted/50">
          <th className="border border-border px-2 py-2 text-center font-bold text-xs" title="Show/hide layer and reorder or remove">
            Show / Actions
          </th>
          {CSV_COLUMNS.map(h => (
            <th key={h} className="border border-border px-3 py-2 text-left font-bold text-xs">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {system.layers.map((layer, ri) => {
          const resolvedFastenerIcon = resolveFastenerIcon(layer)
          return (
          <tr
            key={ri}
            ref={ri === highlightedLayerIndex ? highlightedRowRef : undefined}
            className={`${layer.visible === false ? 'opacity-50 bg-muted/30' : ''} ${ri === highlightedLayerIndex ? 'bg-blue-100 ring-2 ring-blue-400 ring-inset' : ''}`}
          >
            <td className="border border-border px-1 py-1 align-top">
              <div className="flex flex-col gap-0.5 items-center">
                <button
                  type="button"
                  onClick={() => updateLayer(ri, 'visible', !(layer.visible !== false))}
                  className={`${btnClass} ${layer.visible !== false ? 'bg-black text-white hover:bg-black/90' : ''}`}
                  title={layer.visible !== false ? 'Hide layer in drawing' : 'Show layer in drawing'}
                >
                  <Check size={iconSize} className={layer.visible !== false ? '' : 'opacity-40'} />
                </button>
                <button
                  type="button"
                  onClick={() => moveLayer(ri, 'up')}
                  disabled={ri === 0}
                  className={btnClass}
                  title="Move layer up"
                >
                  <ChevronUp size={iconSize} />
                </button>
                <button
                  type="button"
                  onClick={() => moveLayer(ri, 'down')}
                  disabled={ri === system.layers.length - 1}
                  className={btnClass}
                  title="Move layer down"
                >
                  <ChevronDown size={iconSize} />
                </button>
                <button
                  type="button"
                  onClick={() => removeLayer(ri)}
                  disabled={system.layers.length <= 1}
                  className={btnClass}
                  title="Remove layer"
                >
                  <Trash2 size={iconSize} />
                </button>
              </div>
            </td>
            <td className="border border-border px-3 py-1 align-top">{ri + 1}</td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.name} onChange={e => updateLayer(ri, 'name', e.target.value)}
                minRows={2} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.material} onChange={e => updateLayer(ri, 'material', e.target.value)}
                minRows={2} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.thickness} onChange={e => updateLayer(ri, 'thickness', e.target.value)}
                minRows={1} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.rValue} onChange={e => updateLayer(ri, 'rValue', e.target.value)}
                minRows={1} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.connection} onChange={e => updateLayer(ri, 'connection', e.target.value)}
                minRows={2} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.fastener} onChange={e => updateLayer(ri, 'fastener', e.target.value)}
                minRows={2} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.fastenerSize} onChange={e => updateLayer(ri, 'fastenerSize', e.target.value)}
                minRows={2} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.layerType} onChange={e => updateLayer(ri, 'layerType', e.target.value)}
                minRows={1} className={textareaClass} />
            </td>
            <td className="border border-border p-0 align-top">
              <select
                value={layer.fill ?? ''}
                onChange={e => updateLayer(ri, 'fill', e.target.value)}
                className="w-full min-w-0 px-3 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground font-mono text-xs"
              >
                <option value="">(default: {layer.layerType})</option>
                {FILL_OPTIONS.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </td>
            <td className="border border-border p-0 align-top">
              <div className="flex items-start gap-2 px-2 py-1">
                <FastenerIconSvg id={resolvedFastenerIcon} size={28} className="shrink-0 mt-0.5" title={FASTENER_ICON_LABELS[resolvedFastenerIcon]} />
                <select
                  value={resolvedFastenerIcon}
                  onChange={e => updateLayer(ri, 'fastenerIcon', e.target.value as FastenerIconId)}
                  className="w-full min-w-0 px-1 py-1 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground font-mono text-[10px] leading-tight"
                >
                  {FASTENER_ICON_IDS.map(id => (
                    <option key={id} value={id}>{FASTENER_ICON_LABELS[id]}</option>
                  ))}
                </select>
              </div>
            </td>
            <td className="border border-border p-0 align-top overflow-visible">
              <AutoResizeTextarea value={layer.notes} onChange={e => updateLayer(ri, 'notes', e.target.value)}
                minRows={3} placeholder="Notes" className={textareaClass} />
            </td>
          </tr>
          )
        })}
        <tr className="bg-muted/30 font-bold">
          <td className="border border-border px-3 py-1.5" />
          <td className="border border-border px-3 py-1.5">TOTAL</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border p-0 align-top overflow-visible">
            <AutoResizeTextarea value={system.totalThickness} onChange={e => updateTotal('totalThickness', e.target.value)}
              minRows={1} className={textareaClass} />
          </td>
          <td className="border border-border p-0 align-top overflow-visible">
            <AutoResizeTextarea value={system.totalR} onChange={e => updateTotal('totalR', e.target.value)}
              minRows={1} className={textareaClass} />
          </td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5">—</td>
          <td className="border border-border px-3 py-1.5" />
        </tr>
      </tbody>
    </table>
    <button
      type="button"
      onClick={addLayer}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border font-mono text-xs tracking-wider hover:bg-muted/50 transition-colors"
    >
      <Plus size={14} />
      Add layer
    </button>
    </div>
  )
}
