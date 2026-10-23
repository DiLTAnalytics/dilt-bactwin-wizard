/** React Query keys for data owned by main, and a helper to refetch them after a change. */

import { useQueryClient } from '@tanstack/react-query'

export const queryKeys = {
  points: ['points'],
  stats: ['stats'],
  sequence: ['sequence'],
  validOptions: ['validOptions'],
  capabilities: ['capabilities'],
  nameTemplate: ['name-template'],
  preview: ['preview'],
  history: ['history'],
} as const

export type QueryName = keyof typeof queryKeys

/** Returns `refresh(...names)`, which refetches everything under those keys. */
export function useRefresh(): (...names: QueryName[]) => void {
  const qc = useQueryClient()
  return (...names) => {
    for (const name of names) void qc.invalidateQueries({ queryKey: queryKeys[name] })
  }
}
