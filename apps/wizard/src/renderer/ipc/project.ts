import type { FilterDsl } from '@bactwin/mapping-engine'
import { invoke, type Args, type Result } from './client'

export type ImportResult = Result<'project:importEde'>
export type Settings = Result<'project:settings'>
export type PluginSummary = Result<'plugins:list'>['plugins'][number]
export type PluginIssue = Result<'plugins:list'>['issues'][number]
export type Capabilities = Result<'reference:capabilities'>
export type StatsResponse = Result<'points:stats'>

// Main shows the file dialog and reads the files; null means the dialog was cancelled.
export const importEde = (mode: 'new' | 'append' = 'new') =>
  invoke('project:importEde', { mode })
export const openProject = () => invoke('project:open')

export const newProject = () => invoke('project:new')
export const getSettings = () => invoke('project:settings')
export const updateSettings = (patch: Args<'project:updateSettings'>[0]) => invoke('project:updateSettings', patch)
export type TableLayout = Args<'project:setTableLayout'>[0]
export const setTableLayout = (layout: TableLayout) => invoke('project:setTableLayout', layout)

export const getStats = (filter: FilterDsl) => invoke('points:stats', filter)
export const getLabels = () => invoke('reference:labels')

export type SourceStatus = Result<'sources:list'>[number]
export const listSources = () => invoke('sources:list')
// Main asks where the file is now; null means the dialog was cancelled.
export const locateSource = (index: number) => invoke('sources:locate', index)
export type UpdateReport = Result<'sources:update'>['report']
export const updateSource = (index: number) => invoke('sources:update', index)
// Main asks for the new version's file; null means the dialog was cancelled.
export const replaceSource = (index: number) => invoke('sources:replace', index)
export const removeSource = (index: number) => invoke('sources:remove', index)

export const listPlugins = () => invoke('plugins:list')
export const setDefaultPlugins = (enabled: string[]) => invoke('plugins:setDefaults', enabled)
export const setProjectPlugins = (enabled: string[]) => invoke('project:setPlugins', enabled)

export const getCapabilities = () => invoke('reference:capabilities')
export const getNameTemplate = () => invoke('reference:nameTemplate')
