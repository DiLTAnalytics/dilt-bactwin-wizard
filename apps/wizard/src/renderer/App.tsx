import { useCallback, useEffect, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { DataPoint } from '@bactwin/mapping-engine'
import { DetailPanel } from './features/detail/DetailPanel'
import { MappingSequencePanel } from './features/sequence/MappingSequencePanel'
import { StepEditor } from './features/step/StepEditor'
import { AboutModal } from './features/settings/AboutModal'
import { AppSettingsDialog } from './features/settings/AppSettingsDialog'
import { ProjectPropertiesDialog } from './features/settings/ProjectPropertiesDialog'
import { EdeFilesModal } from './features/sources/EdeFilesModal'
import { ExportDialog, type ExportKind } from './features/export/ExportDialog'
import { StartScreen } from './features/start/StartScreen'
import { StatusBar } from './features/stats/StatusBar'
import { DataTable } from './features/table/DataTable'
import { TopBar } from './features/topbar/TopBar'
import { useProjectLoaded } from './hooks/useProjectLoaded'
import { useSequenceFileEvents } from './hooks/useSequenceFileEvents'
import { useUnappliedStepsSync } from './hooks/useUnappliedStepsSync'
import { useI18n } from './i18n'
import { events, invoke } from './ipc/client'
import { dispatchMenuAction, useMenuAction } from './menuActions'
import { useProjectStore } from './stores/projectStore'
import { useViewStore } from './stores/viewStore'
import { reportError } from './ui/reportError'
import { Toaster, toast } from './ui/Toast'

/** A thin drag line between columns; the hit area is wider than what is drawn. */
const ColumnSeparator = () => (
  <Separator className="relative w-px bg-line outline-none transition-colors hover:bg-accent data-[separator-state=drag]:bg-accent focus-visible:bg-accent" />
)

/** Sequence on the left, editor and table in the middle, the selected point docked on the right. */
function Workspace({ selected, onSelect }: { selected: DataPoint | null; onSelect: (point: DataPoint | null) => void }) {
  const inspectorOpen = selected !== null
  const layout = useDefaultLayout({
    id: 'bactwin.workspace',
    panelIds: inspectorOpen ? ['sequence', 'main', 'inspector'] : ['sequence', 'main'],
    storage: localStorage,
  })
  return (
    <Group orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <Panel id="sequence" defaultSize={300} minSize={220} maxSize="40%" groupResizeBehavior="preserve-pixel-size">
        <MappingSequencePanel />
      </Panel>
      <ColumnSeparator />
      <Panel id="main" minSize={480}>
        <div className="flex h-full min-h-0 flex-col">
          {/* The step editor takes what it needs, up to half the height; the table gets the rest. */}
          <div className="max-h-[50%] shrink-0 overflow-y-auto">
            <StepEditor selected={selected} />
          </div>
          <div className="min-h-0 flex-1">
            <DataTable selected={selected} onSelect={onSelect} />
          </div>
        </div>
      </Panel>
      {inspectorOpen && (
        <>
          <ColumnSeparator />
          <Panel id="inspector" defaultSize={380} minSize={300} maxSize="50%" groupResizeBehavior="preserve-pixel-size">
            <DetailPanel point={selected} onClose={() => onSelect(null)} />
          </Panel>
        </>
      )}
    </Group>
  )
}

export default function App() {
  const [selectedPoint, setSelectedPoint] = useState<DataPoint | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showProject, setShowProject] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showEdeFiles, setShowEdeFiles] = useState(false)
  // Open with a format from the menu, or with the last one ('last').
  const [showExport, setShowExport] = useState<ExportKind | 'last' | null>(null)
  const { hasProject, projectReplaced } = useProjectStore()
  const afterLoad = useProjectLoaded()
  const { t } = useI18n()
  useUnappliedStepsSync()
  useSequenceFileEvents()

  // Dialogs close themselves on Escape; this is for the inspector, unless a dialog is on top of it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setSelectedPoint(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // A different project has different points: nothing selected, nothing filtered.
  const projectLoads = useProjectStore((s) => s.projectLoads)
  useEffect(() => {
    setSelectedPoint(null)
    useViewStore.getState().reset()
  }, [projectLoads, hasProject])

  // Every menu entry arrives here and is handed to whichever component registered it.
  useEffect(() => events.onMenuAction(dispatchMenuAction), [])
  useMenuAction('help:about', () => setShowAbout(true))
  useMenuAction('app:settings', () => setShowSettings(true))
  useMenuAction('project:properties', () => setShowProject(true))
  useMenuAction('import:edeFiles', () => { if (hasProject) setShowEdeFiles(true) })
  useMenuAction('export:replacement', () => { if (hasProject) setShowExport('replacement') })
  useMenuAction('export:table', () => { if (hasProject) setShowExport('table') })

  // An imported EDE file changed on disk; it is read again only when the user says so.
  useEffect(() => events.onSourceChanged(({ filename, state }) => {
    if (state !== 'changed' && state !== 'missing') return
    toast(t(state === 'changed' ? 'sources.changedToast' : 'sources.missingToast', { file: filename }), 'warning', { label: t('sources.show'), run: () => setShowEdeFiles(true) })
  }), [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function openRecent(index: number) {
    try {
      if (!(await invoke('project:openRecent', index))) return
      projectReplaced()
    } catch (err) {
      await reportError(t('dialog.openFailed'), err)
    }
    await afterLoad()
  }

  const select = useCallback((point: DataPoint | null) => setSelectedPoint(point), [])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar onSettingsClick={() => setShowSettings(true)} onProjectClick={() => setShowProject(true)} onEdeFilesClick={() => setShowEdeFiles(true)} onExportClick={() => setShowExport('last')} />
      {hasProject ? (
        <>
          <Workspace selected={selectedPoint} onSelect={select} />
          <StatusBar />
        </>
      ) : (
        <StartScreen onOpenRecent={(i) => void openRecent(i)} />
      )}

      <AppSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <ProjectPropertiesDialog open={showProject} onClose={() => setShowProject(false)} />
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <EdeFilesModal open={showEdeFiles && hasProject} onClose={() => setShowEdeFiles(false)} />
      <ExportDialog open={showExport !== null && hasProject} kind={showExport === 'last' ? undefined : showExport ?? undefined} onClose={() => setShowExport(null)} />
      <Toaster closeLabel={t('common.close')} />
    </div>
  )
}
