import { keepPreviousData, useQueries } from '@tanstack/react-query'

export interface RowBlock<R, X> {
  rows: R[]
  /** Rows in the whole list. */
  filtered: number
  /** Whatever else the first block's answer carries. */
  extra?: X
}

/**
 * A long list loaded in blocks of `size` rows, only the blocks covering `first`..`last` (and the
 * first, which tells the length). `key` identifies the list; a changed key starts over.
 */
export function useRowBlocks<R, X = never>(
  key: readonly unknown[],
  size: number,
  fetchBlock: (block: number) => Promise<RowBlock<R, X>>,
  first: number,
  last: number,
  enabled = true,
) {
  const blocks = new Set([0])
  for (let b = Math.floor(first / size); b <= Math.floor(last / size); b++) blocks.add(b)
  const list = [...blocks]
  const results = useQueries({
    queries: list.map((block) => ({
      queryKey: [...key, 'block', block],
      queryFn: () => fetchBlock(block),
      enabled,
      staleTime: 2000,
      // While a changed list loads, the old rows stay instead of a blank table.
      placeholderData: keepPreviousData,
    })),
  })
  const byBlock = new Map(list.map((block, i) => [block, results[i]!.data]))
  const head = byBlock.get(0)
  return {
    rowAt: (index: number): R | undefined => byBlock.get(Math.floor(index / size))?.rows[index % size],
    filtered: head?.filtered ?? 0,
    extra: head?.extra,
    /** The first block's rows; the same array while that block is unchanged. */
    firstRows: head?.rows,
    loaded: head !== undefined,
    isFetching: results.some((r) => r.isFetching),
  }
}
