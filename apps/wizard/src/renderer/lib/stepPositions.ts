/** Where a moved step lands, as main's sequence:moveStep takes it: a block, and a position counted after the step has left its place. */

export interface BlockSpan {
  /** Index of its first step in the whole sequence. */
  start: number
  count: number
  missing: boolean
}

export interface StepPosition {
  block: number
  position: number
}

function locate(blocks: BlockSpan[], index: number): StepPosition {
  const block = blocks.findIndex((b) => index >= b.start && index < b.start + b.count)
  return { block, position: index - (blocks[block]?.start ?? 0) }
}

/** A drag from step `from` to place `to` of the whole list: it joins the block of the step it is dropped beside. */
export function dropPosition(blocks: BlockSpan[], from: number, to: number): StepPosition {
  const source = locate(blocks, from)
  const at = locate(blocks, to)
  if (to < from) return at
  return { block: at.block, position: at.position + (at.block === source.block ? 0 : 1) }
}

/**
 * Alt+↑/↓ on step `index`: one place within its block, or across the border into the next block that
 * can take it, at its near end. Null at either end of the sequence.
 */
export function keyboardPosition(blocks: BlockSpan[], index: number, down: boolean): StepPosition | null {
  const { block, position } = locate(blocks, index)
  const step = down ? 1 : -1
  if (down ? position < blocks[block]!.count - 1 : position > 0) return { block, position: position + step }
  for (let b = block + step; b >= 0 && b < blocks.length; b += step) {
    if (!blocks[b]!.missing) return { block: b, position: down ? 0 : blocks[b]!.count }
  }
  return null
}

/** The index in the whole sequence a step moved from `from` to `to` ends up at. */
export function landedIndex(blocks: BlockSpan[], from: number, to: StepPosition): number {
  const source = locate(blocks, from).block
  const start = blocks[to.block]!.start - (source < to.block ? 1 : 0)
  return start + to.position
}

/**
 * Where the new step goes, as saved by the editor: its file by path and a position there. A file that
 * is gone or missing, or no place at all, means the end of the sequence.
 */
export function resolvePlace(blocks: (BlockSpan & { path: string | null })[], place: { path: string | null; position: number } | null, total: number): { at?: StepPosition; index: number } {
  const b = place ? blocks.findIndex((x) => x.path === place.path && !x.missing) : -1
  if (b < 0) return { index: total }
  const position = Math.min(place!.position, blocks[b]!.count)
  return { at: { block: b, position }, index: blocks[b]!.start + position }
}
