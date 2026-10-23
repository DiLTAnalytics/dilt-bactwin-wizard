import { useQuery } from '@tanstack/react-query'
import { pointKey, type DataPoint } from '@bactwin/mapping-engine'
import { useI18n } from '@/i18n'
import { invoke } from '@/ipc/client'
import { getSequence } from '@/ipc/sequence'
import { queryKeys } from '@/queries'
import { fieldLabel } from '@/lib/fieldLabel'
import { draftFromStep, useStepStore } from '@/stores/stepStore'
import { Tooltip } from '@/ui/Tooltip'

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : v === true ? '✓' : v === false ? '✗' : String(v))

/** Every step that changed the point, in order, with what it changed; a click opens the step. */
export function PointHistory({ point }: { point: DataPoint }) {
  const { t } = useI18n()
  const key = pointKey(point.ede)
  const { data: history = [] } = useQuery({ queryKey: [...queryKeys.history, key], queryFn: () => invoke('point:history', key) })
  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence })
  const { target, open } = useStepStore()

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('detail.history')}</h3>
      <ol className="ml-1 border-l-2 border-line">
        <li className="relative pb-2 pl-3 text-xs text-muted before:absolute before:top-1.5 before:-left-[5px] before:h-2 before:w-2 before:rounded-full before:bg-line-strong">
          <span className="font-mono">000</span> {t('detail.import')}
        </li>
        {history.map((entry) => {
          const step = sequence?.steps[entry.step]
          const current = target === entry.step
          return (
            <li key={entry.step} className={`relative pb-2 pl-3 before:absolute before:top-1.5 before:-left-[5px] before:h-2 before:w-2 before:rounded-full ${current ? 'before:bg-accent' : 'before:bg-line-strong'}`}>
              <Tooltip content={step ? t('detail.historyHint') : null} side="left">
              <button
                type="button"
                disabled={!step}
                onClick={() => step && open(entry.step, draftFromStep(step))}
                className={`w-full rounded px-1 py-0.5 text-left text-xs hover:bg-subtle ${current ? 'bg-accent-soft' : ''}`}
              >
                <span className="font-mono text-muted">{String(entry.step + 1).padStart(3, '0')}</span>{' '}
                <span className="text-fg">{entry.name ?? t('sequence.noName')}</span>
                {entry.changes.map((c) => (
                  <span key={c.field} className="block pl-7 font-mono text-fg-2">
                    {fieldLabel(c.field, t)}: <span className="text-muted line-through">{shown(c.before)}</span> → {shown(c.after)}
                    {c.overwrites !== null && <span className="ml-1.5 font-sans text-2xs text-muted">({t('detail.overwrites', { step: c.overwrites + 1 })})</span>}
                  </span>
                ))}
              </button>
              </Tooltip>
            </li>
          )
        })}
      </ol>
      {history.length === 0 && <p className="pl-4 text-xs text-muted">{t('detail.historyEmpty')}</p>}
    </section>
  )
}
