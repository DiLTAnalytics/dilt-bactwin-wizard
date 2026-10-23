import { invoke, type Args, type Result } from './client'

// Fields and flags from one "Setzen" travel together and are recorded as one step.
export type SetRequest = Args<'apply:set'>[0]
export const applySet = (req: SetRequest) => invoke('apply:set', req)

export type ValidOptionsRequest = Args<'combinations:validOptions'>[0]
export type ValidOptionsResponse = Result<'combinations:validOptions'>
export const fetchValidOptions = (req: ValidOptionsRequest) => invoke('combinations:validOptions', req)
