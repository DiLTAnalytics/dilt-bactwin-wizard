import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FilterDsl, SetAction } from '@bactwin/mapping-engine'
import { useDebounced } from '@/hooks/useDebounced'
import { invoke, type Args, type Result } from '@/ipc/client'
import { getSequence } from '@/ipc/sequence'
import { resolvePlace } from '@/lib/stepPositions'
import { queryKeys } from '@/queries'
import { actionsOf, useStepStore } from '@/stores/stepStore'

export type PreviewRequest = Args<'step:preview'>[0]
export type PreviewResponse = Result<'step:preview'>
export type PreviewRow = PreviewResponse['items'][number]

/** The open step as main previews it, settled for a moment so typing does not query per key. */
export function useStepRequest(): { index: number | null; isNew: boolean; filter: FilterDsl; actions: SetAction[] } | null {
  const target = useStepStore((s) => s.target)
  const draft = useStepStore((s) => s.draft)
  const newPlace = useStepStore((s) => s.newPlace)
  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence })
  // A new step previews on the steps before the place it goes to.
  const newIndex = sequence ? resolvePlace(sequence.blocks, newPlace, sequence.steps.length).index : null
  const request = target === null || !draft ? null : { index: target === 'new' ? newIndex : target, isNew: target === 'new', filter: { rules: draft.rules }, actions: actionsOf(draft) }
  const settled = useDebounced(JSON.stringify(request), 250)
  return JSON.parse(settled) as ReturnType<typeof useStepRequest>
}

export type SourceCheck = PreviewResponse['sources']

/**
 * Counts for the open step: per condition, hits, changes, near misses, misses; and what its sources
 * match, shown on `example` (a point key) when it is a hit.
 */
export function usePreviewCounts(example: string | null) {
  const request = useStepRequest()
  // Only a step with sources shows an example, so selecting a point does not refetch the others.
  const shown = request?.actions.some((a) => a.from) && example !== null ? { example } : {}
  return useQuery({
    queryKey: [...queryKeys.preview, 'counts', request, shown],
    queryFn: () => invoke('step:preview', { ...request!, mode: 'hits', page_size: 1, ...shown }),
    enabled: request !== null,
    placeholderData: keepPreviousData,
  })
}
