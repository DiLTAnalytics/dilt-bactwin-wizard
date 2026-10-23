/**
 * The renderer's access to the main process, over the preload bridge. There is no `ipcRenderer`
 * and no `fetch` in this process; everything it can reach goes through here.
 */

import type { Handlers } from '../../main/ipc'
import type { Channel, ProjectState, RunProgress, SequenceFileEvent, SourceChangedEvent } from '../../shared/channels'
import { translate } from '../../shared/i18n'

export class ApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** A channel's arguments and result, taken from its handler in main/ipc.ts. */
export type Args<C extends Channel> = Parameters<Handlers[C]>
export type Result<C extends Channel> = Awaited<ReturnType<Handlers[C]>>

interface Bridge {
  invoke(channel: Channel, ...args: unknown[]): Promise<unknown>
  events: {
    onMenuAction(handler: (action: string) => void): () => void
    onOpenProjectFile(handler: () => void): () => void
    onRunProgress(handler: (progress: RunProgress | null) => void): () => void
    onProjectState(handler: (state: ProjectState) => void): () => void
    onSequenceFileChanged(handler: (event: SequenceFileEvent) => void): () => void
    onSequenceGit(handler: () => void): () => void
    onSourceChanged(handler: (event: SourceChangedEvent) => void): () => void
  }
}

function bridge(): Bridge {
  const b = (globalThis as unknown as { bactwin?: Bridge }).bactwin
  if (!b) {
    // Only if the preload failed to load.
    throw new ApiError(translate('error.notStarted'))
  }
  return b
}

export async function invoke<C extends Channel>(channel: C, ...args: Args<C>): Promise<Result<C>> {
  try {
    return (await bridge().invoke(channel, ...args)) as Result<C>
  } catch (e) {
    throw new ApiError((e as Error).message)
  }
}

export const events = {
  onMenuAction: (handler: (action: string) => void) => bridge().events.onMenuAction(handler),
  onOpenProjectFile: (handler: () => void) => bridge().events.onOpenProjectFile(handler),
  onRunProgress: (handler: (progress: RunProgress | null) => void) => bridge().events.onRunProgress(handler),
  onProjectState: (handler: (state: ProjectState) => void) => bridge().events.onProjectState(handler),
  onSequenceFileChanged: (handler: (event: SequenceFileEvent) => void) => bridge().events.onSequenceFileChanged(handler),
  onSequenceGit: (handler: () => void) => bridge().events.onSequenceGit(handler),
  onSourceChanged: (handler: (event: SourceChangedEvent) => void) => bridge().events.onSourceChanged(handler),
}

// --- native dialogs -------------------------------------------------------------------------

/** Main asks where to save, then writes. Null when the dialog was cancelled, so nothing counts as saved. */
export function saveExport(...args: Args<'export:save'>): Promise<string | null> {
  return invoke('export:save', ...args)
}

export const saveProject = (saveAs = false): Promise<string | null> => invoke('project:save', saveAs)

export const confirmDialog = (message: string, detail: string, confirmLabel: string): Promise<boolean> =>
  invoke('files:confirm', message, detail, confirmLabel)

export const showErrorDialog = (message: string, detail: string): Promise<void> =>
  invoke('files:showError', message, detail)
