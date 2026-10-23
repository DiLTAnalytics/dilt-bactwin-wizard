import { GripVertical } from 'lucide-react'
import type { RowDrag } from '@/hooks/useRowDrag'
import { Tooltip } from './Tooltip'

/** The grip that starts a row drag; focused, Alt+↑/↓ moves the row. */
export function DragHandle({ drag, title, disabled = false, className = '' }: {
  drag: RowDrag
  title: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        draggable={!disabled}
        disabled={disabled}
        {...drag.handleProps}
        onClick={(e) => e.stopPropagation()}
        aria-label={title}
        className={`inline-flex rounded text-faint select-none ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing hover:text-muted'} ${className}`}
      ><GripVertical size={14} aria-hidden /></button>
    </Tooltip>
  )
}
