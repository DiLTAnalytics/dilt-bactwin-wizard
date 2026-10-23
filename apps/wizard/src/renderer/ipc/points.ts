import type { FilterDsl } from '@bactwin/mapping-engine'
import { invoke, type Args, type Result } from './client'

export type PointsRequest = Args<'points:list'>[0]
export type PointsResponse = Result<'points:list'>

export const fetchPoints = (req: PointsRequest) => invoke('points:list', req)
export const fetchFilterCount = (filter: FilterDsl) => invoke('points:count', filter)

// Fresh values for exactly these points (by pointKey), without re-filtering.
export const fetchPointsByKeys = (keys: string[]) => invoke('points:byKeys', keys)
