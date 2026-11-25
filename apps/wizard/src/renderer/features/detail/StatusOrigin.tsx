import { useQuery } from '@tanstack/react-query'
import { getSequence } from '@/ipc/sequence'
import { useI18n } from '@/i18n'
import { queryKeys } from '@/queries'
import { draftFromStep, useStepStore } from '@/stores/stepStore'

/** Where a status value comes from: no step changed it (the default), or the last step that did, which a click opens. */
export function StatusOrigin({ step }: { step: number | null }) {
  const { t } = useI18n()
  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence })
  const open = useStepStore((s) => s.open)
  if (step === null) return <span className="shrink-0 text-2xs text-faint">{t('common.default')}</span>
  const saved = sequence?.steps[step]
  return (
    <button type="button" disabled={!saved} onClick={() => saved && open(step, draftFromStep(saved))}
      className="shrink-0 rounded px-1 text-2xs text-muted hover:bg-subtle hover:text-fg">
      {t('common.step', { step: String(step + 1).padStart(3, '0') })}
    </button>
  )
}
