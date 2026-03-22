import type { SystemData } from '../types/system'

interface ApplyChangesModalProps {
  proposedSystems: SystemData[]
  existingSystems: SystemData[]
  onConfirm: (merged: SystemData[]) => void
  onCancel: () => void
}

function mergeProposed(existing: SystemData[], proposed: SystemData[]): SystemData[] {
  const byId = new Map<string, SystemData>()
  for (const s of existing) byId.set(s.id, s)
  for (const s of proposed) byId.set(s.id, s)
  const existingIds = new Set(existing.map(s => s.id))
  const result: SystemData[] = []
  for (const s of existing) {
    result.push(byId.get(s.id) ?? s)
  }
  for (const s of proposed) {
    if (!existingIds.has(s.id)) result.push(s)
  }
  return result
}

export function ApplyChangesModal({
  proposedSystems,
  existingSystems,
  onConfirm,
  onCancel,
}: ApplyChangesModalProps) {
  const existingIds = new Set(existingSystems.map(s => s.id))
  const newSystems = proposedSystems.filter(s => !existingIds.has(s.id))
  const updatedSystems = proposedSystems.filter(s => existingIds.has(s.id))

  const handleApply = () => {
    onConfirm(mergeProposed(existingSystems, proposedSystems))
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden />
      <div
        className="relative z-10 flex flex-col w-full max-w-md bg-white shadow-2xl border border-border overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-mono text-base font-bold tracking-wider">
            Apply AI-Proposed Changes
          </h2>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            Review and confirm the following changes before applying.
          </p>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {newSystems.length > 0 && (
            <div>
              <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                New systems ({newSystems.length})
              </h3>
              <ul className="space-y-1.5">
                {newSystems.map(s => (
                  <li key={s.id} className="font-mono text-xs border border-border rounded px-3 py-2 bg-muted/30">
                    <span className="font-bold">{s.id}</span> {s.name} — {s.layers.length} layers
                  </li>
                ))}
              </ul>
            </div>
          )}
          {updatedSystems.length > 0 && (
            <div>
              <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                Updated systems ({updatedSystems.length})
              </h3>
              <ul className="space-y-1.5">
                {updatedSystems.map(s => (
                  <li key={s.id} className="font-mono text-xs border border-border rounded px-3 py-2 bg-muted/30">
                    <span className="font-bold">{s.id}</span> {s.name} — {s.layers.length} layers
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-foreground text-foreground bg-white font-mono text-[10px] tracking-widest uppercase hover:bg-foreground hover:text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
