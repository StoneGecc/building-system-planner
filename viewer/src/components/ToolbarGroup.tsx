import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function ToolbarGroup({
  title,
  children,
  className,
  bodyClassName,
  hint,
}: {
  title: string
  children: ReactNode
  className?: string
  /** Default: horizontal wrap. Use e.g. flex-col w-full min-w-0 for full-width controls. */
  bodyClassName?: string
  /** Native tooltip on the panel (use for long instructions instead of inline body text). */
  hint?: string
}) {
  return (
    <div
      title={hint}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 min-w-0',
        className,
      )}
    >
      <span className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground leading-none select-none">
        {title}
      </span>
      <div className={cn('flex flex-wrap items-center gap-1.5 gap-y-1', bodyClassName)}>{children}</div>
    </div>
  )
}
