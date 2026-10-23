import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/queries'
import { getStats } from '@/ipc/project'
import { emptyFilter } from '@bactwin/mapping-engine'

/** Totals for the whole project. */
export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => getStats(emptyFilter()),
  })
}
