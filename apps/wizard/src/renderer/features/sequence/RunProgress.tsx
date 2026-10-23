import type { RunProgress } from '../../../shared/channels'
import { useI18n } from '@/i18n'

/** The running step's label, for the panel header. */
export function RunLabel({ progress }: { progress: RunProgress }) {
  const { t } = useI18n()
  const vars = { index: progress.index + 1, total: progress.total }
  return (
    <span className="text-xs text-success-fg font-medium truncate">
      {progress.name
        ? t('sequence.runningNamed', { ...vars, description: progress.name })
        : t('sequence.running', vars)}
    </span>
  )
}

export function RunBar({ progress }: { progress: RunProgress }) {
  const pct = progress.total > 0 ? Math.min(100, (progress.index / progress.total) * 100) : 0
  return (
    <div className="h-1 bg-sunken">
      <div className="h-1 bg-success transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  )
}
