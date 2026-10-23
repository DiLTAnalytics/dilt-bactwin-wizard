import { useEffect, useState } from 'react'
import { Check, FileInput, FileOutput, FilePlus, FolderOpen, LoaderCircle, Save, Settings, SlidersHorizontal } from 'lucide-react'
import { useI18n } from '@/i18n'
import { events, invoke, saveProject } from '@/ipc/client'
import type { ProjectState } from '../../../shared/channels'
import { newProject, openProject } from '@/ipc/project'
import { useEdeImport } from '@/hooks/useEdeImport'
import { useProjectLoaded } from '@/hooks/useProjectLoaded'
import { useMenuAction } from '@/menuActions'
import { useProjectStore } from '@/stores/projectStore'
import { AppMark } from '@/ui/AppMark'
import { Button, IconButton } from '@/ui/Button'
import { reportError } from '@/ui/reportError'
import { toast } from '@/ui/Toast'
import { Tooltip } from '@/ui/Tooltip'

/** Project, save and export actions, and the way into the EDE files, the settings and project properties. */
export function TopBar({ onSettingsClick, onProjectClick, onEdeFilesClick, onExportClick }: {
  onSettingsClick: () => void; onProjectClick: () => void; onEdeFilesClick: () => void; onExportClick: () => void
}) {
  const [saveState, setSaveState] = useState<ProjectState | null>(null)
  useEffect(() => {
    void invoke('project:state').then(setSaveState)
    return events.onProjectState(setSaveState)
  }, [])
  // Saving is shown only when it takes a while; a quick autosave should not make the bar blink.
  const [slowSave, setSlowSave] = useState(false)
  useEffect(() => {
    if (!saveState?.saving) { setSlowSave(false); return }
    const timer = setTimeout(() => setSlowSave(true), 500)
    return () => clearTimeout(timer)
  }, [saveState?.saving])
  const edeImport = useEdeImport()

  const { t } = useI18n()
  const { projectName, hasProject, projectReplaced } = useProjectStore()

  const afterLoad = useProjectLoaded()

  // Also on mount, so a window reload does not lose the project name and labels.
  useEffect(() => { void afterLoad() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // A .bactwin opened from the OS (double-click, dock) is loaded by main; refresh when it lands.
  async function goHome() {
    try {
      if (!(await invoke('project:close'))) return
    } catch (err) {
      await reportError(t('dialog.closeFailed'), err)
      return
    }
    projectReplaced()
    await afterLoad()
  }

  useEffect(() => events.onOpenProjectFile(() => { projectReplaced(); void afterLoad() }), [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleNew() {
    // Main asks about unsaved changes; null means the user stayed.
    if (!(await newProject())) return
    projectReplaced()
    await afterLoad()
  }

  /** From the menu, straight to the file picker; a file the project already lists is read again. */
  async function handleAddEDE() {
    const result = await edeImport.add()
    for (const r of result?.reread ?? []) toast(t('sources.updated', { file: r.file, updated: r.updated, added: r.added, missing: r.missing }), 'info')
  }

  async function handleOpen() {
    try {
      if (!(await openProject())) return
      projectReplaced()
    } catch (err) {
      await reportError(t('dialog.openFailed'), err)
    }
    await afterLoad()
  }

  /** "Save as" is menu-only; the toolbar button always saves over the current file. */
  async function handleSave(saveAs = false) {
    try {
      await saveProject(saveAs)
    } catch (err) {
      await reportError(t('dialog.saveFailed'), err)
    }
  }

  // The menu runs the toolbar's handlers.
  useMenuAction('project:new', handleNew)
  useMenuAction('project:open', handleOpen)
  useMenuAction('project:save', () => handleSave())
  useMenuAction('project:saveAs', () => handleSave(true))
  useMenuAction('import:ede', handleAddEDE)

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 bg-chrome px-3 text-chrome-fg">
      <Tooltip content={hasProject ? t('topbar.home') : t('app.name')}>
        <button type="button" aria-label={t('topbar.home')} onClick={() => void goHome()} disabled={!hasProject}
          className="mr-1 flex h-8 w-8 items-center justify-center rounded hover:enabled:bg-chrome-line">
          <AppMark size={20} />
        </button>
      </Tooltip>
      {hasProject ? (
        <Tooltip content={t('topbar.projectProperties')}>
          <button
            type="button"
            onClick={onProjectClick}
            className="group inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded px-2 text-sm text-chrome-fg/80 hover:bg-chrome-line hover:text-chrome-fg"
          >
            <span className="truncate">{projectName || t('topbar.untitled')}</span>
            <SlidersHorizontal size={13} className="shrink-0 opacity-60 group-hover:opacity-100" aria-hidden />
          </button>
        </Tooltip>
      ) : (
        <span className="px-2 text-sm text-chrome-fg/60">{t('topbar.noProject')}</span>
      )}

      <div className="mx-1 h-5 w-px bg-chrome-line" />
      <Tooltip content={t('topbar.newHint')} side="bottom">
        <Button variant="chrome" icon={FilePlus} onClick={() => void handleNew()}>{t('topbar.new')}</Button>
      </Tooltip>
      <Button variant="chrome" icon={FolderOpen} onClick={() => void handleOpen()}>{t('topbar.open')}</Button>
      {hasProject && saveState && (saveState.path === null ? (
        // Autosave needs a file; a project without one asks for it.
        <Button variant="chrome" icon={Save} onClick={() => void handleSave(true)}>{t('topbar.saveAs')}</Button>
      ) : (
        <Tooltip content={saveState.path} side="bottom">
          <span className="inline-flex items-center gap-1.5 px-2 text-xs text-chrome-fg/70">
            {slowSave ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {slowSave ? t('topbar.saving') : t('topbar.saved')}
          </span>
        </Tooltip>
      ))}

      <div className="mx-1 h-5 w-px bg-chrome-line" />
      <Tooltip content={t('topbar.edeFilesHint')} side="bottom">
        <Button variant="chrome" icon={FileInput} disabled={!hasProject} onClick={onEdeFilesClick}>{t('topbar.edeFiles')}</Button>
      </Tooltip>
      <Button variant="chrome" icon={FileOutput} disabled={!hasProject} onClick={onExportClick}>{t('topbar.export')}</Button>

      <div className="ml-auto">
        <IconButton icon={Settings} label={t('topbar.settings')} tone="chrome" onClick={onSettingsClick} />
      </div>

      {edeImport.modal}
    </header>
  )
}
