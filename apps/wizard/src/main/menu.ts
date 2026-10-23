/** The native application menu. */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

import { resourceRoot, userPluginDir } from './paths.js'
import { EVENTS } from '../shared/channels.js'
import { t } from './i18n.js'

/** Open the bundled documentation; the website is only for a dev run without `pnpm docs:build`. */
function openDocumentation(): void {
  const root = resourceRoot()
  const bundled = root && join(root, 'docs-site', 'index.html')
  if (bundled && existsSync(bundled)) {
    void shell.openPath(bundled)
    return
  }
  void shell.openExternal(`${__APP_REPOSITORY__}/tree/main/docs/user`)
}

/** Licence texts of the bundled packages; written by packaging, so absent in a dev run. */
function thirdPartyNotices(): string | null {
  const root = resourceRoot()
  const file = root && join(root, 'THIRD-PARTY-NOTICES.txt')
  return file && existsSync(file) ? file : null
}

/** Installing a plugin means dropping its folder here. Created first: opening a missing path does nothing. */
function revealPluginDirectory(): void {
  const dir = userPluginDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // If it cannot be made, opening it fails visibly below.
  }
  void shell.openPath(dir)
}

/** Build the menu. Entries send an action name to the renderer, which runs the same handler as the matching button. */
export function buildMenu(win: BrowserWindow): void {
  const send = (action: string) => () => win.webContents.send(EVENTS.menuAction, action)
  const isMac = process.platform === 'darwin'
  const notices = thirdPartyNotices()

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            // Not role 'about': ours carries the AGPL source offer and the plugin licences.
            { label: t('menu.about'), click: send('help:about') },
            { type: 'separator' as const },
            { label: t('menu.settings'), accelerator: 'CmdOrCtrl+,', click: send('app:settings') },
            { type: 'separator' as const },
            { role: 'services' as const }, { type: 'separator' as const },
            { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
            { type: 'separator' as const }, { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newProject'), accelerator: 'CmdOrCtrl+N', click: send('project:new') },
        { label: t('menu.openProject'), accelerator: 'CmdOrCtrl+O', click: send('project:open') },
        { type: 'separator' },
        { id: 'importEde', label: t('menu.importEde'), accelerator: 'CmdOrCtrl+I', click: send('import:ede') },
        { id: 'edeFiles', label: t('menu.edeFiles'), click: send('import:edeFiles') },
        { type: 'separator' },
        { id: 'save', label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: send('project:save') },
        { id: 'saveAs', label: t('menu.saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: send('project:saveAs') },
        { id: 'projectProperties', label: t('menu.projectProperties'), click: send('project:properties') },
        { type: 'separator' },
        {
          id: 'export',
          label: t('menu.export'),
          submenu: [
            { label: t('menu.exportReplacement'), click: send('export:replacement') },
            { label: t('menu.exportTable'), click: send('export:table') },
          ],
        },
        { type: 'separator' },
        { label: t('menu.installPlugin'), click: revealPluginDirectory },
        ...(isMac ? [] : [{ label: t('menu.settings'), accelerator: 'CmdOrCtrl+,', click: send('app:settings') }]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: t('menu.sequence'),
      submenu: [
        { id: 'newStep', label: t('menu.newStep'), accelerator: 'CmdOrCtrl+Shift+N', click: send('step:new') },
        { id: 'duplicateStep', label: t('menu.duplicateStep'), accelerator: 'CmdOrCtrl+D', click: send('step:duplicate') },
        { type: 'separator' },
        { id: 'newSequence', label: t('menu.newSequence'), click: send('sequence:create') },
        { id: 'linkSequence', label: t('menu.linkSequence'), click: send('sequence:link') },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      label: t('menu.help'),
      submenu: [
        { label: t('menu.documentation'), click: openDocumentation },
        { label: t('menu.sourceCode'), click: () => void shell.openExternal(__APP_REPOSITORY__) },
        { label: t('menu.reportIssue'), click: () => void shell.openExternal(`${__APP_REPOSITORY__}/issues/new/choose`) },
        ...(notices ? [{ label: t('menu.thirdPartyNotices'), click: () => void shell.openPath(notices) }] : []),
        ...(isMac ? [] : [{ type: 'separator' as const }, { label: t('menu.about'), click: send('help:about') }]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  setProjectOpen(false)
}

/** Entries that act on the open project. */
const PROJECT_ENTRIES = ['importEde', 'edeFiles', 'save', 'saveAs', 'projectProperties', 'export', 'newStep', 'duplicateStep', 'newSequence', 'linkSequence']

/** Enable the project's entries only while a project is open. */
export function setProjectOpen(open: boolean): void {
  const menu = Menu.getApplicationMenu()
  for (const id of PROJECT_ENTRIES) {
    const item = menu?.getMenuItemById(id)
    if (item) item.enabled = open
  }
}
