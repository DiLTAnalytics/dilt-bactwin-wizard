import type { KeyboardEvent } from 'react'
import { Copy, Trash2, X } from 'lucide-react'
import type { SequenceStep } from '@bactwin/mapping-engine'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { dropLineClass, type RowDrag } from '@/hooks/useRowDrag'
import { useI18n } from '@/i18n'
import { IconButton } from '@/ui/Button'
import { DragHandle } from '@/ui/DragHandle'
import { Switch } from '@/ui/Switch'
import { Tooltip } from '@/ui/Tooltip'
import { actionsVerbose, filterSummary } from '@/lib/describeStep'

export interface StepRowProps {
  step: SequenceStep
  index: number
  /** What the step did on the current data; null before it ran. */
  outcome: { hits: number; changed: number; overwrites: [number, number][]; overwrittenBy: [number, number][]; noEffect: boolean } | null
  /** Open in the editor. */
  selected: boolean
  /** Has unsaved edits. */
  hasDraft: boolean
  /** A recalculation is running; changes wait. */
  busy: boolean
  onSelect: () => void
  /** Open another step, from a collision chip. */
  onJump: (index: number) => void
  onToggle: (disabled: boolean) => void
  onDelete: () => void
  onDuplicate: () => void
  drag: RowDrag
  onKeyDown: (e: KeyboardEvent) => void
}

/** A small switch: on = the step runs. */
function StepSwitch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled: boolean }) {
  return (
    <Tooltip content={label}>
      <Switch on={on} onChange={onChange} label={label} disabled={disabled} className="mt-0.5" />
    </Tooltip>
  )
}

/** The new step at the place it will go, until it is saved: dashed, unnumbered, marked unsaved. */
export function NewStepRow({ step, selected, onSelect, onDrop }: {
  step: SequenceStep
  selected: boolean
  onSelect: () => void
  /** Throw the new step away. */
  onDrop: () => void
}) {
  const { t } = useI18n()
  const template = useNameTemplate()
  const actions = actionsVerbose(step, template, t)
  return (
    <li
      onClick={onSelect}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() } }}
      tabIndex={0}
      data-new-step-row
      aria-current={selected ? 'step' : undefined}
      className={`group mx-1 my-0.5 flex cursor-pointer gap-1.5 rounded border border-dashed border-accent py-1 pr-0.5 pl-1.5 ${selected ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
    >
      <span className="w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xs text-accent-fg">{t('sequence.newStepTag')}</span>
          <span className={`truncate text-sm ${step.name ? 'text-fg' : 'italic text-muted'}`}>{step.name || t('step.new')}</span>
          <Tooltip content={t('sequence.newStepHint')}><span className="shrink-0 text-warning-fg" aria-label={t('step.unsaved')}>●</span></Tooltip>
        </div>
        <div className="truncate text-xs text-muted"><span className="font-medium text-fg-2">{t('sequence.when')}</span> {filterSummary(step, t)}</div>
        <div className="truncate text-xs text-muted"><span className="font-medium text-fg-2">{t('sequence.then')}</span> {actions || '–'}</div>
      </div>
      <IconButton size="sm" icon={X} label={t('sequence.dropNewStep')} onClick={(e) => { e.stopPropagation(); onDrop() }} />
    </li>
  )
}

/** One step in the sequence column: name and counts, then what it filters on and what it sets. */
export function StepRow({ step, index, outcome, selected, hasDraft, busy, onSelect, onJump, onToggle, onDelete, onDuplicate, drag, onKeyDown }: StepRowProps) {
  const { t, n } = useI18n()
  const template = useNameTemplate()
  const filter = filterSummary(step, t)
  const actions = actionsVerbose(step, template, t)
  const tone = selected ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-subtle'

  return (
    <li
      {...drag.rowProps}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      tabIndex={0}
      data-step-row={index}
      aria-current={selected ? 'step' : undefined}
      className={`group relative flex cursor-pointer gap-1.5 border-y-2 border-transparent py-1.5 pr-1 pl-1.5 ${dropLineClass(drag.dropTarget)} ${drag.dragged ? 'opacity-40' : tone}`}
    >
      <DragHandle drag={drag} disabled={busy} className="mt-0.5" title={t('common.dragHint')} />
      <div className={`min-w-0 flex-1 ${step.disabled ? 'opacity-50' : ''}`}>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xs text-muted tabular-nums">{String(index + 1).padStart(3, '0')}</span>
          <span className="truncate text-sm text-fg">{step.name}</span>
          {hasDraft && <Tooltip content={t('step.unsaved')}><span className="shrink-0 text-warning-fg" aria-label={t('step.unsaved')}>●</span></Tooltip>}
          {outcome && !step.disabled && (
            <Tooltip content={t('sequence.countsHint', { hits: n(outcome.hits), changed: n(outcome.changed) })}>
              <span className="ml-auto shrink-0 text-2xs text-muted tabular-nums">{n(outcome.changed)}/{n(outcome.hits)}</span>
            </Tooltip>
          )}
        </div>
        <Tooltip content={filter} side="right">
          <div className="truncate text-xs text-muted">
            <span className="font-medium text-fg-2">{t('sequence.when')}</span> {filter}
          </div>
        </Tooltip>
        <Tooltip content={actions} side="right">
          <div className="truncate text-xs text-muted">
            <span className="font-medium text-fg-2">{t('sequence.then')}</span> {actions}
          </div>
        </Tooltip>
        {outcome && !step.disabled && (outcome.overwrites.length > 0 || outcome.overwrittenBy.length > 0) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {outcome.overwrites.length > 0 && <CollisionChip label={t('sequence.overwrites')} steps={outcome.overwrites} tone="neutral" onJump={onJump} />}
            {outcome.overwrittenBy.length > 0 && (
              <CollisionChip label={t('sequence.overwrittenBy')} steps={outcome.overwrittenBy} tone={outcome.noEffect ? 'danger' : 'warning'} onJump={onJump}
                note={outcome.noEffect ? t('sequence.noEffect') : undefined} />
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StepSwitch on={!step.disabled} onChange={(on) => onToggle(!on)} disabled={busy} label={step.disabled ? t('sequence.enableStep') : t('sequence.disableStep')} />
        <div className={`flex gap-0.5 ${selected ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <IconButton size="sm" icon={Copy} onClick={(e) => { e.stopPropagation(); onDuplicate() }} disabled={busy} label={t('sequence.duplicateStep')} />
          <IconButton size="sm" icon={Trash2} tone="danger" onClick={(e) => { e.stopPropagation(); onDelete() }} disabled={busy} label={t('sequence.deleteStep')} />
        </div>
      </div>
    </li>
  )
}

const CHIP_TONE = { neutral: 'bg-sunken text-fg-2', warning: 'bg-warning-soft text-warning-fg', danger: 'bg-danger-soft text-danger-fg' } as const
const SHOWN_STEPS = 3

/** "überschreibt 3, 5": other steps changing the same values, each a link to that step. */
function CollisionChip({ label, steps, tone, note, onJump }: { label: string; steps: [number, number][]; tone: keyof typeof CHIP_TONE; note?: string; onJump: (index: number) => void }) {
  const { t, n } = useI18n()
  const hint = [note, ...steps.map(([s, count]) => t('sequence.collisionValues', { step: s + 1, count: n(count) })), t('sequence.collisionHint')].filter(Boolean).join('\n')
  return (
    <Tooltip content={<span className="whitespace-pre-line">{hint}</span>} side="right">
      <span className={`inline-flex items-center gap-1 rounded px-1.5 text-2xs leading-5 ${CHIP_TONE[tone]}`}>
        {label}
        {steps.slice(0, SHOWN_STEPS).map(([s]) => (
          <button key={s} type="button" className="font-mono tabular-nums hover:underline" onClick={(e) => { e.stopPropagation(); onJump(s) }}>{s + 1}</button>
        ))}
        {steps.length > SHOWN_STEPS && <span>+{steps.length - SHOWN_STEPS}</span>}
      </span>
    </Tooltip>
  )
}
