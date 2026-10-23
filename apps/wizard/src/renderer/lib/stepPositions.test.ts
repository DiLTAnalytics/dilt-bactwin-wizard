import { describe, expect, it } from 'vitest'

import { dropPosition, keyboardPosition, landedIndex, resolvePlace } from './stepPositions'

// Steps 0-1 in block 0, none in block 1 (missing), step 2 in block 2, none in block 3.
const blocks = [
  { start: 0, count: 2, missing: false },
  { start: 2, count: 0, missing: true },
  { start: 2, count: 1, missing: false },
  { start: 3, count: 0, missing: false },
]

describe('step positions', () => {
  it('a drop joins the block of the step it lands beside', () => {
    expect(dropPosition(blocks, 0, 1)).toEqual({ block: 0, position: 1 })
    expect(dropPosition(blocks, 0, 2)).toEqual({ block: 2, position: 1 })
    expect(dropPosition(blocks, 2, 0)).toEqual({ block: 0, position: 0 })
  })

  it('Alt+arrow crosses a border into the next block that takes steps, at its near end', () => {
    expect(keyboardPosition(blocks, 0, true)).toEqual({ block: 0, position: 1 })
    expect(keyboardPosition(blocks, 1, true)).toEqual({ block: 2, position: 0 })
    expect(keyboardPosition(blocks, 2, false)).toEqual({ block: 0, position: 2 })
    expect(keyboardPosition(blocks, 2, true)).toEqual({ block: 3, position: 0 })
    expect(keyboardPosition(blocks, 0, false)).toBeNull()
  })

  it('knows where the moved step ends up', () => {
    expect(landedIndex(blocks, 1, { block: 2, position: 0 })).toBe(1)
    expect(landedIndex(blocks, 2, { block: 0, position: 2 })).toBe(2)
    expect(landedIndex(blocks, 0, { block: 0, position: 1 })).toBe(1)
  })

  it('finds where the new step goes by file path, and falls back to the end', () => {
    const files = blocks.map((b, i) => ({ ...b, path: `f${i}` }))
    expect(resolvePlace(files, { path: 'f2', position: 5 }, 3)).toEqual({ at: { block: 2, position: 1 }, index: 3 })
    expect(resolvePlace(files, { path: 'f0', position: 1 }, 3)).toEqual({ at: { block: 0, position: 1 }, index: 1 })
    expect(resolvePlace(files, { path: 'f1', position: 0 }, 3)).toEqual({ index: 3 })
    expect(resolvePlace(files, { path: 'gone', position: 0 }, 3)).toEqual({ index: 3 })
    expect(resolvePlace(files, null, 3)).toEqual({ index: 3 })
  })
})
