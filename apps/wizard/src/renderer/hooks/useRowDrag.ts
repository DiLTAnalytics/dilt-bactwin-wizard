import { useState, type DragEvent, type KeyboardEvent } from 'react'

/** Where the dragged row lands relative to the row under the pointer. */
export type DropTarget = 'above' | 'below' | null

export interface RowDrag {
  dragged: boolean
  dropTarget: DropTarget
  /** For the row element: it accepts the drop. */
  rowProps: {
    onDragOver: (e: DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: DragEvent) => void
  }
  /** For the handle: the only part that starts a drag, so the row's inputs stay usable. Alt+↑/↓ moves by keyboard. */
  handleProps: {
    onDragStart: (e: DragEvent) => void
    onDragEnd: () => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

/** Per row, its drag props; `from` is the row being dragged, for drop targets that are not rows. */
export type RowDrags = ((i: number) => RowDrag) & { from: number | null; end: () => void }

/** `items` with the one at `from` moved to index `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const out = [...items]
  out.splice(to, 0, out.splice(from, 1)[0]!)
  return out
}

/** Alt+↑/↓: the index a keyboard move goes to, or null for any other key or past either end. */
export function keyboardMove(e: KeyboardEvent, i: number, count: number): number | null {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return null
  const to = i + (e.key === 'ArrowUp' ? -1 : 1)
  return to >= 0 && to < count ? to : null
}

/**
 * Drag-to-reorder for a list of `count` rows; `onMove(from, to)` moves the row at `from` to index `to`.
 * `onKeyMove`, when given, takes Alt+↑/↓ on the handle instead.
 */
export function useRowDrag(onMove: (from: number, to: number) => void, count: number, onKeyMove?: (i: number, down: boolean) => void): RowDrags {
  const [from, setFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const end = () => { setFrom(null); setOver(null) }

  const rows = (i: number): RowDrag => ({
    dragged: from === i,
    dropTarget: from === null || over !== i || from === i ? null : from < i ? 'below' : 'above',
    rowProps: {
      onDragOver: (e) => { e.preventDefault(); if (from !== null) setOver(i) },
      onDragLeave: () => setOver((o) => (o === i ? null : o)),
      onDrop: (e) => {
        e.preventDefault()
        if (from !== null && from !== i) onMove(from, i)
        end()
      },
    },
    handleProps: {
      onDragStart: (e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setFrom(i) },
      onDragEnd: end,
      onKeyDown: (e) => {
        if (onKeyMove && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          e.stopPropagation()
          onKeyMove(i, e.key === 'ArrowDown')
          return
        }
        const to = keyboardMove(e, i, count)
        if (to === null) return
        e.preventDefault()
        e.stopPropagation()
        onMove(i, to)
      },
    },
  })
  return Object.assign(rows, { from, end })
}

/** Border classes marking the drop position; the row needs `border-y-2 border-transparent` or its own borders. */
export const dropLineClass = (target: DropTarget) =>
  target === 'above' ? 'border-t-accent' : target === 'below' ? 'border-b-accent' : ''
