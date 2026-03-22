import { useState, useEffect } from 'react'
import type { SystemData } from '../types/system'
import { SystemDataTable, copySystemToClipboard } from './SystemDataTable'

interface BulkEditModalProps {
  systems: SystemData[]
  initialSystemId?: string
  highlightedLayerIndex?: number | null
  onClose: () => void
  onSave: (systems: SystemData[]) => void
  onOpenChat?: () => void
}

function cloneSystems(systems: SystemData[]): SystemData[] {
  return systems.map(s => {
    const cloned = JSON.parse(JSON.stringify(s))
    cloned.layers = cloned.layers.map((l: import('../types/system').Layer) => ({
      ...l,
      visible: l.visible !== false,
    }))
    return cloned
  })
}

export function BulkEditModal({ systems, initialSystemId, highlightedLayerIndex, onClose, onSave, onOpenChat }: BulkEditModalProps) {
  const [editSystems, setEditSystems] = useState<SystemData[]>(() => cloneSystems(systems))
  const [selectedSystemId, setSelectedSystemId] = useState<string>(() => {
    if (initialSystemId && systems.some(s => s.id === initialSystemId)) return initialSystemId
    return systems[0]?.id ?? ''
  })

  useEffect(() => {
    setEditSystems(cloneSystems(systems))
    setSelectedSystemId(prev => {
      if (initialSystemId && systems.some(s => s.id === initialSystemId)) return initialSystemId
      if (systems.some(s => s.id === prev)) return prev
      return systems[0]?.id ?? ''
    })
  }, [systems, initialSystemId])

  const selectedSystem = editSystems.find(s => s.id === selectedSystemId) ?? editSystems[0]
  const isDirty = JSON.stringify(editSystems) !== JSON.stringify(cloneSystems(systems))

  const handleSave = () => {
    onSave(editSystems)
    onClose()
  }

  const handleClose = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  const handleUpdateSystem = (updated: SystemData) => {
    setEditSystems(prev => prev.map(s => s.id === updated.id ? updated : s))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} aria-hidden />
      <div
        className="relative z-10 flex flex-col w-full max-w-[1400px] h-[90vh] bg-white shadow-2xl border border-border overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="font-mono text-base font-bold tracking-wider">
            Edit All Data — All Systems
          </h2>
          <div className="flex items-center gap-2">
            {onOpenChat && (
              <button
                onClick={onOpenChat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white hover:border-foreground transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                AI
              </button>
            )}
            {selectedSystem && (
              <button
                onClick={() => copySystemToClipboard(selectedSystem)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
              </button>
            )}
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleClose}
              className="inline-flex items-center justify-center w-8 h-8 border border-foreground text-foreground hover:bg-foreground hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body: sidebar + table */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: system list */}
          <div className="w-[200px] shrink-0 border-r border-border overflow-auto bg-muted/20">
            <ul className="py-2">
              {editSystems.map(sys => (
                <li key={sys.id}>
                  <button
                    onClick={() => setSelectedSystemId(sys.id)}
                    className={`w-full text-left px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
                      selectedSystemId === sys.id
                        ? 'bg-foreground text-white'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    {sys.id} {sys.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Main: editable table */}
          <div className="flex-1 overflow-auto p-4">
            {selectedSystem ? (
              <>
                <h3 className="font-mono text-sm font-bold tracking-wider mb-3">
                  {selectedSystem.id} {selectedSystem.name}
                </h3>
                <SystemDataTable
                  system={selectedSystem}
                  onUpdate={handleUpdateSystem}
                  highlightedLayerIndex={selectedSystemId === initialSystemId ? highlightedLayerIndex ?? undefined : undefined}
                />
              </>
            ) : (
              <p className="font-mono text-sm text-muted-foreground">No systems to edit.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
