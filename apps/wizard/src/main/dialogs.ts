/** Native dialogs, and the file writes that follow a save dialog. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'

import { t } from './i18n.js'
import { lastFolder, rememberFolder } from './settings.js'

export interface SaveOptions {
  /** Stable per-action id, so each action remembers its own folder. */
  id: string
  suggestedName: string
  /** Opens here instead of the folder the action used last. */
  folder?: string
  description: string
  extensions: string[]
}

export interface OpenOptions {
  id: string
  description: string
  extensions: string[]
  multiple?: boolean
}

function parent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** Ask where to save. Null when cancelled, so a dismissed dialog never marks a project saved. */
export async function pickSavePath(options: SaveOptions): Promise<string | null> {
  const folder = options.folder ?? lastFolder(options.id)
  const result = await dialog.showSaveDialog(parent() as BrowserWindow, {
    defaultPath: folder ? join(folder, options.suggestedName) : options.suggestedName,
    filters: [{ name: options.description, extensions: options.extensions }],
  })
  if (result.canceled || !result.filePath) return null
  rememberFolder(options.id, result.filePath)
  return result.filePath
}

/** Ask where to save, then write. */
export async function saveBytes(bytes: Uint8Array, options: SaveOptions): Promise<string | null> {
  const path = await pickSavePath(options)
  if (path) await writeFile(path, bytes)
  return path
}

export async function pickFiles(options: OpenOptions): Promise<string[]> {
  const win = parent()
  const folder = lastFolder(options.id)
  const result = await dialog.showOpenDialog(win as BrowserWindow, {
    ...(folder ? { defaultPath: folder } : {}),
    properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: options.description, extensions: options.extensions }],
  })
  if (result.canceled || result.filePaths.length === 0) return []
  rememberFolder(options.id, result.filePaths[0] as string)
  return result.filePaths
}

/** Ask for a folder. Null when cancelled. */
export async function pickFolder(id: string): Promise<string | null> {
  const folder = lastFolder(id)
  const result = await dialog.showOpenDialog(parent() as BrowserWindow, {
    ...(folder ? { defaultPath: folder } : {}),
    properties: ['openDirectory'],
  })
  const [path] = result.filePaths
  if (result.canceled || !path) return null
  rememberFolder(id, path)
  return path
}

export async function confirm(message: string, detail: string, confirmLabel: string): Promise<boolean> {
  const win = parent()
  const { response } = await dialog.showMessageBox(win as BrowserWindow, {
    type: 'warning',
    buttons: [confirmLabel, t('common.cancel')],
    defaultId: 1,
    cancelId: 1,
    message,
    detail,
  })
  return response === 0
}

/** Save / Don't save / Cancel, for unsaved changes. */
export async function askToSave(): Promise<'save' | 'discard' | 'cancel'> {
  const { response } = await dialog.showMessageBox(parent() as BrowserWindow, {
    type: 'warning',
    buttons: [t('dialog.save'), t('dialog.dontSave'), t('common.cancel')],
    defaultId: 0,
    cancelId: 2,
    message: t('dialog.unsavedTitle'),
    detail: t('dialog.unsavedDetail'),
  })
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
}

/** Steps edited but not applied; true means discard them. */
export async function askToDiscardSteps(count: number): Promise<boolean> {
  const { response } = await dialog.showMessageBox(parent() as BrowserWindow, {
    type: 'warning',
    buttons: [t('dialog.discardSteps'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('dialog.unappliedTitle', { count }),
    detail: t('dialog.unappliedDetail'),
  })
  return response === 0
}

/** The project file was changed outside the app: load that version, or keep this one and save over it. */
export async function askProjectChanged(name: string): Promise<'reload' | 'keep'> {
  const { response } = await dialog.showMessageBox(parent() as BrowserWindow, {
    type: 'warning',
    buttons: [t('dialog.reloadProject'), t('dialog.keepMine')],
    defaultId: 0,
    cancelId: 1,
    message: t('dialog.projectChangedTitle'),
    detail: t('dialog.projectChangedDetail', { name }),
  })
  return response === 0 ? 'reload' : 'keep'
}

/** The project file was deleted outside the app; Escape writes it back. */
export async function askProjectDeleted(name: string): Promise<'restore' | 'saveAs' | 'close'> {
  const { response } = await dialog.showMessageBox(parent() as BrowserWindow, {
    type: 'warning',
    buttons: [t('dialog.restoreProject'), t('dialog.saveProjectAs'), t('dialog.closeProject')],
    defaultId: 0,
    cancelId: 0,
    message: t('dialog.projectDeletedTitle'),
    detail: t('dialog.projectDeletedDetail', { name }),
  })
  return (['restore', 'saveAs', 'close'] as const)[response] ?? 'restore'
}

export async function showInfo(message: string, detail: string): Promise<void> {
  await dialog.showMessageBox(parent() as BrowserWindow, { type: 'info', buttons: ['OK'], message, detail })
}

export async function showError(message: string, detail: string): Promise<void> {
  const win = parent()
  await dialog.showMessageBox(win as BrowserWindow, { type: 'error', buttons: ['OK'], message, detail })
}
