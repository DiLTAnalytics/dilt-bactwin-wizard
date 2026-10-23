import { useEffect } from 'react'
import { useI18n } from '@/i18n'
import { events } from '@/ipc/client'
import { useRefresh } from '@/queries'
import { useStepStore } from '@/stores/stepStore'
import { toast } from '@/ui/Toast'

/** Sequence files changed outside the app: main has reloaded them; show it, and drop drafts that now point at other steps. */
export function useSequenceFileEvents(): void {
  const { t } = useI18n()
  const refresh = useRefresh()
  useEffect(() => {
    const offGit = events.onSequenceGit(() => refresh('sequence'))
    const offFile = events.onSequenceFileChanged((e) => {
      if (e.kind === 'reloaded') {
        const dropped = useStepStore.getState().replaceSteps(e.start, e.before, e.after)
        const parts = [t('sequence.fileReloaded', { name: e.name })]
        if (dropped.length) parts.push(t('sequence.draftsDropped', { steps: dropped.map((i) => i + 1).join(', ') }))
        toast(parts.join('; '), 'info')
        refresh('sequence', 'points', 'stats', 'validOptions', 'preview', 'history')
      } else {
        toast(e.kind === 'deleted' ? t('sequence.fileDeleted', { name: e.name }) : t('sequence.fileUnreadable', { name: e.name, message: e.message ?? '' }), 'warning')
        refresh('sequence')
      }
    })
    return () => { offGit(); offFile() }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
}
