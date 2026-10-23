/** The main window, and the security posture it is created with. */

import { BrowserWindow, nativeTheme, screen, shell } from 'electron'

import { ORIGIN, SCHEME } from './protocol.js'
import { readSettings, writeSettings } from './settings.js'

const MIN_WIDTH = 1280
const MIN_HEIGHT = 720

/** A remembered position on a monitor that is no longer attached would open off-screen. */
function visibleBounds(saved: NonNullable<ReturnType<typeof readSettings>['windowBounds']>) {
  if (saved.x === undefined || saved.y === undefined) return { width: saved.width, height: saved.height }
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return saved.x! < a.x + a.width && saved.x! + saved.width > a.x && saved.y! < a.y + a.height && saved.y! + saved.height > a.y
  })
  return fits ? saved : { width: saved.width, height: saved.height }
}

export function createWindow(preloadPath: string, devServerUrl: string | undefined): BrowserWindow {
  const settings = readSettings()
  // Also sets prefers-color-scheme in the renderer, which is all the stylesheet looks at.
  nativeTheme.themeSource = settings.appearance ?? 'system'
  const saved = settings.windowBounds
  const bounds = saved ? visibleBounds(saved) : { width: 1440, height: 900 }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // The page's canvas colour, so the window does not flash before the first paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1419' : '#f5f7f9',
    title: 'BACtwin Wizard',
    webPreferences: {
      preload: preloadPath,
      // The security posture: the renderer shows imported file content, so it is untrusted.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // `electron-forge start` shows only main's output; forward the renderer's in development.
  if (devServerUrl) {
    win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      process.stderr.write(`[renderer ${level}] ${message}  (${sourceId}:${lineNumber})\n`)
    })
    win.webContents.on('did-fail-load', (_e, code, description, url) => {
      process.stderr.write(`[renderer] failed to load ${url}: ${description} (${code})\n`)
    })
    // On the first load after `pnpm start` the entry module is sometimes fetched but never run, leaving
    // the window blank. Module scripts run before the load event, so a missing marker means it was dropped.
    win.webContents.once('did-finish-load', () => {
      void win.webContents.executeJavaScript("'started' in document.documentElement.dataset").then((started) => {
        if (started) return
        process.stderr.write('[renderer] the entry module did not run; reloading\n')
        win.webContents.reload()
      })
    })
  }

  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // No navigation away from the bundle.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`) && url !== devServerUrl) event.preventDefault()
  })
  // External links open in the real browser, never in a window with a preload attached.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const persist = () => {
    const b = win.getNormalBounds()
    writeSettings({ ...readSettings(), windowBounds: { ...b, maximized: win.isMaximized() } })
  }
  win.on('resized', persist)
  win.on('moved', persist)
  win.on('maximize', persist)
  win.on('unmaximize', persist)

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadURL(`${ORIGIN}/index.html`)

  return win
}
