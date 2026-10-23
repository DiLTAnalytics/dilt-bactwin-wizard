/**
 * The renderer's only way into main: `invoke` on the channels in shared/channels.ts, and the
 * pushed events. `{ ok: false, error }` replies are rethrown as Errors.
 */

import { contextBridge, ipcRenderer } from 'electron'

import { CHANNELS, EVENTS, type Channel, type ProjectState, type RunProgress, type SequenceFileEvent, type SourceChangedEvent } from '../shared/channels.js'

const allowed = new Set<string>(CHANNELS)

async function invoke<T>(channel: Channel, ...args: unknown[]): Promise<T> {
  if (!allowed.has(channel)) throw new Error(`Unknown channel: ${channel}`)
  const result = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T }
    | { ok: false; error: string }
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Events the main process pushes, for things the renderer cannot know on its own. */
const events = {
  onMenuAction(handler: (action: string) => void): () => void {
    const listener = (_e: unknown, action: string) => handler(action)
    ipcRenderer.on(EVENTS.menuAction, listener)
    return () => ipcRenderer.removeListener(EVENTS.menuAction, listener)
  },
  onOpenProjectFile(handler: () => void): () => void {
    const listener = () => handler()
    ipcRenderer.on(EVENTS.openProject, listener)
    return () => ipcRenderer.removeListener(EVENTS.openProject, listener)
  },
  onRunProgress(handler: (progress: RunProgress | null) => void): () => void {
    const listener = (_e: unknown, progress: RunProgress | null) => handler(progress)
    ipcRenderer.on(EVENTS.runProgress, listener)
    return () => ipcRenderer.removeListener(EVENTS.runProgress, listener)
  },
  onProjectState(handler: (state: ProjectState) => void): () => void {
    const listener = (_e: unknown, state: ProjectState) => handler(state)
    ipcRenderer.on(EVENTS.projectState, listener)
    return () => ipcRenderer.removeListener(EVENTS.projectState, listener)
  },
  onSequenceFileChanged(handler: (event: SequenceFileEvent) => void): () => void {
    const listener = (_e: unknown, event: SequenceFileEvent) => handler(event)
    ipcRenderer.on(EVENTS.sequenceFileChanged, listener)
    return () => ipcRenderer.removeListener(EVENTS.sequenceFileChanged, listener)
  },
  onSequenceGit(handler: () => void): () => void {
    const listener = () => handler()
    ipcRenderer.on(EVENTS.sequenceGit, listener)
    return () => ipcRenderer.removeListener(EVENTS.sequenceGit, listener)
  },
  onSourceChanged(handler: (event: SourceChangedEvent) => void): () => void {
    const listener = (_e: unknown, event: SourceChangedEvent) => handler(event)
    ipcRenderer.on(EVENTS.sourceChanged, listener)
    return () => ipcRenderer.removeListener(EVENTS.sourceChanged, listener)
  },
}

contextBridge.exposeInMainWorld('bactwin', { invoke, events })

export type Bridge = { invoke: typeof invoke; events: typeof events }
