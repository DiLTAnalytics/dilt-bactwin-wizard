/** Application lifecycle. */

import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'

import { EVENTS } from '../shared/channels.js'
import { cspFor } from './csp.js'
import { showError } from './dialogs.js'
import { t } from './i18n.js'
import { openProjectFile as openProject, registerIpc, resolveUnsaved, session as projectSession, watcher } from './ipc.js'
import { buildMenu } from './menu.js'
import { referenceSources } from './paths.js'
import { applyProjectPlugins } from './project/reference.js'
import { registerProtocolHandler, registerSchemeAsPrivileged } from './protocol.js'
import { readSettings } from './settings.js'
import { createWindow } from './window.js'

// Injected by the Vite plugin. Present in development, undefined in a packaged build.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined

/** Only one instance: two processes editing the same in-memory project would race. */
if (!app.requestSingleInstanceLock()) app.quit()

registerSchemeAsPrivileged()

function applyCsp(): void {
  const policy = cspFor(Boolean(devServerUrl), devServerUrl)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })

  // Only writing text to the clipboard (copy buttons), so a dependency cannot quietly acquire more.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
}

let mainWindow: BrowserWindow | null = null

/** Pending file to open, from a double-clicked document before the window existed. */
let pendingOpen: string | null = null

function boot(): void {
  applyCsp()

  const rendererRoot = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`)
  if (!devServerUrl) registerProtocolHandler(rendererRoot)

  // Load problems are reported (here and in Settings), never fatal.
  projectSession.pluginSources = referenceSources()
  projectSession.defaultPlugins = readSettings().enabledPlugins
  const { issues } = applyProjectPlugins(projectSession, undefined)!
  for (const issue of issues) process.stderr.write(`plugin ${issue.severity}: [${issue.pluginId}] ${issue.message}\n`)

  registerIpc()

  mainWindow = createMainWindow()
  if (pendingOpen) {
    void openProjectFile(pendingOpen)
    pendingOpen = null
  }
}

function createMainWindow(): BrowserWindow {
  const win = createWindow(join(__dirname, 'preload.cjs'), devServerUrl)
  buildMenu(win)
  // Unsaved changes or unapplied steps: ask first, then carry on with the close (or the quit that caused it).
  let confirmed = false
  win.on('close', (event) => {
    if (confirmed || (!projectSession.dirty && !projectSession.unappliedSteps)) return
    event.preventDefault()
    void resolveUnsaved().then((ok) => {
      if (!ok) {
        quitting = false
        return
      }
      confirmed = true
      if (quitting) app.quit()
      else win.close()
    })
  })
  // A reloaded page has no drafts left to ask about.
  win.webContents.on('did-start-loading', () => { projectSession.unappliedSteps = 0 })
  win.on('closed', () => {
    mainWindow = null
  })
  return win
}

async function openProjectFile(path: string): Promise<void> {
  if (!mainWindow) {
    pendingOpen = path
    return
  }
  if (!(await resolveUnsaved())) return
  try {
    await openProject(path)
  } catch (e) {
    await showError(t('dialog.openFailed'), (e as Error).message)
    return
  }
  mainWindow.webContents.send(EVENTS.openProject)
}

let quitting = false
app.on('before-quit', () => {
  quitting = true
})

// A commit made outside changes a file's Git state without touching the file.
app.on('browser-window-focus', () => void watcher.refreshGit())

// Signals come from the dev runner (Ctrl-C, hot restart), not from the user: a project with unsaved
// changes would otherwise hold the process open behind the save dialog, and the next start then quits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.exit(0))

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  const file = argv.find((a) => a.endsWith('.bactwin'))
  if (file) void openProjectFile(file)
})

// macOS delivers a double-clicked document this way, possibly before the app is ready.
app.on('open-file', (event, path) => {
  event.preventDefault()
  void openProjectFile(path)
})

app.whenReady().then(boot)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
})

// Windows and Linux pass a double-clicked document as an argument.
const argFile = process.argv.find((a) => a.endsWith('.bactwin'))
if (argFile) pendingOpen = argFile
