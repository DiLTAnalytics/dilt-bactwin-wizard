import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/queries'
import { getCapabilities, type Capabilities } from '@/ipc/project'
import { useStepStore, type CombinationMode } from '@/stores/stepStore'

const NONE: Capabilities = { combinations: false, combinationSource: null }

/** Optional features the loaded plugins enable. Off until main has answered. */
export function useCapabilities(): Capabilities {
  const { data } = useQuery({ queryKey: queryKeys.capabilities, queryFn: getCapabilities, staleTime: Infinity })
  return data ?? NONE
}

/** The open step's combination mode: "custom" needs a catalogue, so without one it is "typical for trade". */
export function useCombinationMode(): CombinationMode {
  const mode = useStepStore((s) => s.draft?.mode ?? 'combination')
  const { combinations } = useCapabilities()
  return mode === 'combination' && !combinations ? 'gewerk_specific' : mode
}
