import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { getSettings, listPlugins, setProjectPlugins, updateSettings, type PluginSummary } from '@/ipc/project'
import { useProjectLoaded } from '@/hooks/useProjectLoaded'
import { useProjectStore } from '@/stores/projectStore'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { FormField, Input, Section } from '@/ui/Field'
import { reportError } from '@/ui/reportError'
import { PluginList } from './PluginList'

/** The open project's name and plugins. */
export function ProjectPropertiesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const afterLoad = useProjectLoaded()
  const { setProject, hasProject } = useProjectStore()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [missing, setMissing] = useState<{ id: string; version: string }[]>([])
  const [enabled, setEnabled] = useState<string[]>([])
  const [savedEnabled, setSavedEnabled] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void Promise.all([getSettings(), listPlugins()]).then(([settings, installed]) => {
      setName(settings.project_name || '')
      setPlugins(installed.plugins)
      setMissing(installed.missing)
      const on = [...installed.plugins.filter((p) => p.enabled).map((p) => p.id), ...installed.missing.map((p) => p.id)]
      setEnabled(on)
      setSavedEnabled(on)
    })
  }, [open])

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({ project_name: name })
      if ([...enabled].sort().join() !== [...savedEnabled].sort().join()) await setProjectPlugins(enabled)
    } catch (err) {
      await reportError(t('dialog.saveFailed'), err)
      return
    } finally {
      setSaving(false)
    }
    setProject(name, true)
    // Plugins decide the template and which features exist.
    await afterLoad()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.projectTitle')}
      closeLabel={t('settings.close')}
      dismissable={false}
      footer={
        <>
          <Button onClick={onClose}>{t('settings.cancel')}</Button>
          <Button variant="primary" busy={saving} disabled={!hasProject} onClick={() => void handleSave()}>{t('settings.save')}</Button>
        </>
      }
    >
      {!hasProject ? (
        <p className="text-sm text-muted">{t('settings.noProjectHint')}</p>
      ) : (
        <div className="flex flex-col gap-5 divide-y divide-line-soft [&>*:not(:last-child)]:pb-5">
          <Section title={t('settings.general')}>
            <FormField label={t('settings.projectName')} htmlFor="project-name">
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
          </Section>
          <Section title={t('settings.plugins')} description={t('settings.projectPluginsHint')}>
            <PluginList plugins={plugins} missing={missing} checked={enabled} onChange={setEnabled} />
          </Section>
        </div>
      )}
    </Dialog>
  )
}
