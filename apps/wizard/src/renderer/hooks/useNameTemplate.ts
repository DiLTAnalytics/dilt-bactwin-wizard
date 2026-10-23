import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/queries'
import { FALLBACK_NAME_TEMPLATE, type NameTemplate } from '@bactwin/mapping-engine'
import { getNameTemplate } from '@/ipc/project'

/** The active name template; the engine's fallback until main has answered. */
export function useNameTemplate(): NameTemplate {
  const { data } = useQuery({
    queryKey: queryKeys.nameTemplate,
    queryFn: getNameTemplate,
    staleTime: Infinity,
  })
  return data ?? FALLBACK_NAME_TEMPLATE
}
