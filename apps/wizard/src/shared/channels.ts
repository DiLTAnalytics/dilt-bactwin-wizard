/**
 * Every IPC channel the renderer may call: the preload's allowlist. None takes a file path: main
 * asks the user for files itself, so the renderer cannot name one. main/ipc.ts must implement
 * exactly these (checked by the compiler), and the renderer's call types come from there.
 */
export const CHANNELS = [
  'plugins:list', 'plugins:setDefaults',
  'reference:capabilities', 'reference:nameTemplate', 'reference:labels',
  'project:new', 'project:importEde', 'project:open', 'project:openRecent',
  'project:serialize', 'project:settings', 'project:updateSettings', 'project:close', 'project:setPlugins', 'project:setTableLayout', 'project:save',
  'project:state', 'project:setUnappliedSteps',
  'sources:list', 'sources:locate', 'sources:update', 'sources:replace', 'sources:remove',
  'points:list', 'points:byKeys', 'points:count', 'points:stats', 'step:preview', 'point:history',
  'combinations:validOptions', 'apply:set',
  'sequence:get', 'sequence:deleteStep', 'sequence:moveStep', 'sequence:setDisabled',
  'sequence:link', 'sequence:unlink', 'sequence:moveBlock', 'sequence:create', 'sequence:locate',
  'sequence:restore', 'sequence:saveAs',
  'files:confirm', 'files:showError',
  'export:counts', 'export:save',
  'app:about', 'app:appearance', 'app:setAppearance', 'app:recentProjects',
] as const

export type Channel = (typeof CHANNELS)[number]

/** Events main pushes to the renderer, for changes the renderer did not ask for itself. */
export const EVENTS = {
  menuAction: 'menu:action',
  openProject: 'app:openProject',
  /** A RunProgress per step while steps are recalculated, then null when done. */
  runProgress: 'sequence:runProgress',
  /** Whether the project has unsaved changes and where it is saved, after anything that may change it. */
  projectState: 'project:state',
  /** A SequenceFileEvent when a linked sequence file changed outside the app. */
  sequenceFileChanged: 'sequence:fileChanged',
  /** A sequence file's Git state or deleted mark changed; its steps did not. */
  sequenceGit: 'sequence:git',
  /** A SourceChangedEvent when an imported EDE file changed state on disk. */
  sourceChanged: 'sources:changed',
} as const

export interface ProjectState {
  dirty: boolean
  /** Null while the project has no file yet. */
  path: string | null
  saving: boolean
}

export interface RunProgress {
  index: number
  total: number
  name: string | null
}

export interface SourceChangedEvent {
  filename: string
  state: 'current' | 'changed' | 'missing' | 'unreadable' | 'unknown'
}

export interface SequenceFileEvent {
  /** The file's name without .json. */
  name: string
  kind: 'reloaded' | 'unreadable' | 'deleted'
  /** The file's first step in the whole sequence, and its step count before and after. */
  start: number
  before: number
  after: number
  /** Why an unreadable file could not be read. */
  message?: string
}
