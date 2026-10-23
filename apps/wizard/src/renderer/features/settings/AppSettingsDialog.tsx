import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { invoke, type Result } from '@/ipc/client'
import { listPlugins, setDefaultPlugins, type PluginIssue, type PluginSummary } from '@/ipc/project'
import { useProjectLoaded } from '@/hooks/useProjectLoaded'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Section } from '@/ui/Field'
import { reportError } from '@/ui/reportError'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { PluginList } from './PluginList'

type Appearance = Result<'app:appearance'>

/** Settings of this installation, not of a project: appearance and the plugins new projects start with. Applied on save. */
export function AppSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const afterLoad = useProjectLoaded()
  const { t } = useI18n()
  const [appearance, setAppearance] = useState<Appearance>('system')
  // Every installed plugin, so one the user installed can be switched on.
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [enabled, setEnabled] = useState<string[]>([])
  const [issues, setIssues] = useState<PluginIssue[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [current, installed] = await Promise.all([invoke('app:appearance'), listPlugins()])
      setAppearance(current)
      setPlugins(installed.plugins)
      setIssues(installed.issues)
      setEnabled(installed.defaults)
    })()
  }, [open])

  async function handleSave() {
    setSaving(true)
    try {
      await invoke('app:setAppearance', appearance)
      await setDefaultPlugins(enabled)
    } catch (err) {
      await reportError(t('dialog.saveFailed'), err)
      return
    } finally {
      setSaving(false)
    }
    // Without a project the defaults apply at once, and decide the template and which features exist.
    await afterLoad()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.title')}
      closeLabel={t('settings.close')}
      dismissable={false}
      footer={
        <>
          <Button onClick={onClose}>{t('settings.cancel')}</Button>
          <Button variant="primary" busy={saving} onClick={() => void handleSave()}>{t('settings.save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 divide-y divide-line-soft [&>*:not(:last-child)]:pb-5">
        <Section title={t('settings.appearance')} description={t('settings.appearanceHint')}>
          <div>
            <SegmentedControl<Appearance>
              label={t('settings.appearance')}
              value={appearance}
              onChange={setAppearance}
              options={[
                { value: 'system', label: t('settings.appearanceSystem') },
                { value: 'light', label: t('settings.appearanceLight') },
                { value: 'dark', label: t('settings.appearanceDark') },
              ]}
            />
          </div>
        </Section>

        <Section title={t('settings.defaultPlugins')} description={t('settings.defaultPluginsHint')}>
          <PluginList plugins={plugins} checked={enabled} onChange={setEnabled} />
          {/* Skipped plugins and why. */}
          {issues.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {issues.map((i, n) => (
                <li key={n} className={i.severity === 'error' ? 'text-danger-fg' : 'text-warning-fg'}>
                  {t(`settings.issue.${i.severity}`)} [{i.pluginId}] {i.message}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Dialog>
  )
}
