import { ChevronRight, Info, Plus, RotateCcw, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BACTWIN_FIELDS, pointKey, toCondition, type DataPoint, type SequenceStep } from '@bactwin/mapping-engine'
import { useState } from 'react'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { moveItem, useRowDrag } from '@/hooks/useRowDrag'
import { useStoredState } from '@/hooks/useStoredState'
import { useI18n } from '@/i18n'
import { applySet } from '@/ipc/bulk'
import { getSequence } from '@/ipc/sequence'
import type { Flag } from '@/lib/flags'
import { resolvePlace } from '@/lib/stepPositions'
import { queryKeys, useRefresh } from '@/queries'
import { actionsOf, draftFromStep, isDirty, useStepStore, type CombinationMode } from '@/stores/stepStore'
import { Button, IconButton } from '@/ui/Button'
import { Input } from '@/ui/Field'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/ui/Menu'
import { reportError } from '@/ui/reportError'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { toast } from '@/ui/Toast'
import { Tooltip } from '@/ui/Tooltip'
import { actionsVerbose, filterSummary } from '@/lib/describeStep'
import { ConditionRow, newRule } from './ConditionRow'
import { fieldLabel } from '@/lib/fieldLabel'
import { FieldRow } from './FieldRow'
import { emptyRow, fieldById, overridesBefore, rowReady, sourceCheckOf, type SetRow } from '@/lib/stepRows'
import { markColor } from '@/lib/highlight'
import { usePreviewCounts } from '@/hooks/usePreview'

const FLAGS: Flag[] = ['ignore', 'reminder']

/**
 * The open step: "Wenn" (conditions, each with how many points it selects) next to "Dann" (what it
 * writes). Edits are a draft, previewed in the table; "Übernehmen" saves the step and recalculates.
 */
/** The open step's Wenn and Dann; `selected` is the table's point, shown as the example of a row's sources. */
export function StepEditor({ selected }: { selected: DataPoint | null }) {
  const { t, n } = useI18n()
  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence })
  const stepCount = sequence?.steps.length ?? 0
  const refresh = useRefresh()
  const qc = useQueryClient()
  const caps = useCapabilities()
  const template = useNameTemplate()
  const { target, draft, saved, newPlace, edit, discard, close, open, committed } = useStepStore()
  const dirty = useStepStore(isDirty)
  const { data: preview } = usePreviewCounts(selected ? pointKey(selected.ede) : null)
  const [collapsed, setCollapsed] = useStoredState('editor.collapsed', false)
  const [saving, setSaving] = useState(false)
  const rowDrag = useRowDrag((from, to) => draft && edit({ rows: moveItem(draft.rows, from, to) }), draft?.rows.length ?? 0)
  const ruleDrag = useRowDrag((from, to) => draft && edit({ rules: moveItem(draft.rules, from, to) }), draft?.rules.length ?? 0)

  if (target === null || !draft) {
    return (
      <div className="flex h-10 items-center gap-3 border-b border-line bg-surface px-3">
        <span className="text-sm text-muted">{t('step.none')}</span>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => open('new', null)}>{t('step.new')}</Button>
      </div>
    )
  }

  const actions = actionsOf(draft)
  const asStep: SequenceStep = { name: draft.name, filter: draft.rules.map(toCondition), actions }
  const mode: CombinationMode = draft.mode === 'combination' && !caps.combinations ? 'gewerk_specific' : draft.mode
  const counts = preview?.counts
  const usedFlags = new Set(Object.keys(draft.flags))

  // The action each ready row becomes, for what the preview says about its sources.
  let next = 0
  const actionOf = draft.rows.map((r) => (rowReady(r) ? next++ : null))
  const setRow = (i: number, patch: Partial<SetRow>) => edit({ rows: draft.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const blocks = sequence?.blocks ?? []
  const place = resolvePlace(blocks, newPlace, stepCount)
  const later = target === 'new' ? stepCount - place.index : stepCount - target - 1
  const name = draft.name.trim()

  async function handleSave() {
    if (!draft || actions.length === 0 || !name) return
    setSaving(true)
    try {
      const res = await applySet({
        filter: { rules: draft.rules },
        actions,
        note: name,
        combination_mode: draft.mode,
        ...(target === 'new' ? (place.at ? { insert: place.at } : {}) : { replace: target as number }),
      })
      const index = target === 'new' ? place.index : (target as number)
      committed()
      open(index, draftFromStep({ ...asStep, name, combination_mode: draft.mode }))
      toast(t(target === 'new' ? 'step.added' : 'step.updated', { changed: n(res.changed), matched: n(res.matched) }))
      refresh('sequence', 'points', 'stats', 'validOptions', 'history')
      void qc.invalidateQueries({ queryKey: queryKeys.preview })
    } catch (err) {
      await reportError(t('dialog.saveFailed'), err)
    } finally {
      setSaving(false)
    }
  }

  const newIn = place.at && blocks.length > 1 ? blocks[place.at.block]!.name : null
  const title = target === 'new' ? (newIn ? t('step.newTitleIn', { name: newIn }) : t('step.newTitle')) : t('step.title', { step: String(target + 1).padStart(3, '0') })

  return (
    <section className="@container border-b border-line bg-surface">
      <div className={`flex min-h-11 flex-wrap items-center gap-2 px-2 py-1 ${collapsed ? '' : 'border-b border-line-soft'}`}>
        <IconButton size="sm" icon={ChevronRight} label={collapsed ? t('common.expand') : t('common.collapse')}
          className={collapsed ? '' : '[&>svg]:rotate-90'} onClick={() => setCollapsed(!collapsed)} />
        <span className="shrink-0 font-mono text-xs text-muted">{title}</span>
        {dirty && <Tooltip content={t('step.unsavedHint')}><span className="shrink-0 cursor-default text-warning-fg" aria-label={t('step.unsaved')}>●</span></Tooltip>}
        <Input size="sm" className="min-w-48 flex-1" aria-label={t('step.name')} placeholder={t('step.namePlaceholder')} required
          invalid={!name && actions.length > 0} value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button size="sm" icon={RotateCcw} onClick={discard} disabled={!dirty}>{t('step.discard')}</Button>
          <Tooltip content={!name ? t('step.nameMissing') : later > 0 ? t('step.saveHintLater', { count: later }) : t('step.saveHint')}>
            <Button size="sm" variant="primary" busy={saving} disabled={actions.length === 0 || !name || (!dirty && target !== 'new')} onClick={() => void handleSave()}>
              {t('step.save')}
              {/* How many points the step hits, so the effect is visible before applying. */}
              {counts && <span className="tabular-nums opacity-80">· {n(counts.hits)}</span>}
            </Button>
          </Tooltip>
          <IconButton size="sm" icon={X} label={t('step.close')} onClick={close} />
        </div>
      </div>

      {collapsed ? (
        <p className="truncate px-4 pb-2 text-xs text-muted">
          <span className="font-medium text-fg-2">{t('sequence.when')}</span> {filterSummary(asStep, t)}
          {' → '}
          <span className="font-medium text-fg-2">{t('sequence.then')}</span> {actionsVerbose(asStep, template, t) || '–'}
        </p>
      ) : (
        // Side by side when there is room, stacked when the inspector makes it narrow.
        <div className="grid grid-cols-1 px-4 pt-2 pb-3 @5xl:grid-cols-2">
          {/* Wenn */}
          <div className="flex min-w-0 flex-col gap-1.5 pb-3 @5xl:pr-6 @5xl:pb-0">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-fg">
              {t('sequence.when')}
              <Tooltip content={t('step.syntaxHint')}><Info size={13} className="text-muted" aria-label={t('step.syntaxHint')} /></Tooltip>
            </h3>
            {draft.rules.map((rule, i) => (
              <ConditionRow
                key={i}
                rule={rule}
                count={counts?.conditions[i]}
                color={markColor(rule, i)}
                drag={ruleDrag(i)}
                onChange={(r) => edit({ rules: draft.rules.map((x, j) => (j === i ? r : x)) })}
                onRemove={() => edit({ rules: draft.rules.filter((_, j) => j !== i) })}
              />
            ))}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => edit({ rules: [...draft.rules, newRule()] })}>{t('filter.addCondition')}</Button>
              <span className="ml-auto text-xs text-fg-2 tabular-nums">
                {counts && (draft.rules.length ? t('step.allHold', { count: n(counts.hits) }) : t('step.allPoints', { count: n(counts.hits) }))}
              </span>
            </div>
          </div>

          {/* Dann */}
          {/* A rule between Wenn and Dann: beside each other a vertical one, stacked a horizontal one. */}
          <div className="flex min-w-0 flex-col gap-1.5 border-t border-line-soft pt-3 @5xl:border-t-0 @5xl:border-l @5xl:pt-0 @5xl:pl-6">
            {/* Which keys the Dann dropdowns offer; stored with the step. */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-fg">{t('sequence.then')}</h3>
              <span className="ml-auto text-xs text-muted">{t('set.combinationMode')}</span>
              <SegmentedControl<CombinationMode>
                size="sm"
                label={t('set.combinationMode')}
                value={mode}
                onChange={(m) => edit({ mode: m })}
                options={[
                  ...(caps.combinations ? [{ value: 'combination' as const, label: t('set.mode.custom'), hint: t('set.mode.customHint') }] : []),
                  { value: 'gewerk_specific', label: t('set.mode.gewerkSpecific'), hint: t('set.mode.gewerkSpecificHint') },
                  { value: 'free', label: t('set.mode.free'), hint: t('set.mode.freeHint') },
                ]}
              />
            </div>
            {draft.rows.map((row, i) => (
              <FieldRow
                key={row.key}
                row={row}
                combinationMode={mode}
                dsl={{ rules: draft.rules }}
                overrides={overridesBefore(draft.rows, i)}
                onChange={(patch) => setRow(i, patch)}
                onFieldChange={(id) => setRow(i, { ...emptyRow(fieldById(id)!), key: row.key })}
                onRemove={() => edit({ rows: draft.rows.filter((_, j) => j !== i) })}
                drag={rowDrag(i)}
                check={actionOf[i] === null || !preview ? undefined : sourceCheckOf(preview.sources, actionOf[i]!, row.sources.length)}
              />
            ))}
            {FLAGS.filter((flag) => usedFlags.has(flag)).map((flag) => (
              <div key={flag} className="flex items-center gap-2">
                <span className="w-44 shrink-0 pl-5 text-xs text-fg-2">{fieldLabel(`state.${flag}`, t)}</span>
                <SegmentedControl<'yes' | 'no'>
                  size="sm"
                  label={fieldLabel(`state.${flag}`, t)}
                  value={draft.flags[flag] ? 'yes' : 'no'}
                  onChange={(v) => edit({ flags: { ...draft.flags, [flag]: v === 'yes' } })}
                  options={[{ value: 'yes', label: t('step.yes') }, { value: 'no', label: t('step.no') }]}
                />
                <IconButton size="sm" className="ml-auto" icon={X} tone="danger" label={t('set.removeField')}
                  onClick={() => { const { [flag]: _, ...flags } = draft.flags; edit({ flags }) }} />
              </div>
            ))}
            {draft.comment !== null && (
              <div className="flex items-center gap-2">
                <span className="w-44 shrink-0 pl-5 text-xs text-fg-2">{fieldLabel('state.comment', t)}</span>
                <Input size="sm" className="min-w-0 flex-1" placeholder={t('set.commentPlaceholder')} value={draft.comment}
                  onChange={(e) => edit({ comment: e.target.value })} />
                <IconButton size="sm" icon={X} tone="danger" label={t('set.removeField')} onClick={() => edit({ comment: null })} />
              </div>
            )}
            <div>
              <Menu trigger={<Button size="sm" variant="ghost" icon={Plus}>{t('step.addField')}</Button>}>
                <MenuLabel>{t('step.bactwinFields')}</MenuLabel>
                {BACTWIN_FIELDS.map((f) => (
                  <MenuItem key={f.id} onSelect={() => edit({ rows: [...draft.rows, emptyRow(f)] })}>{fieldLabel(`bactwin.${f.id}`, t)}</MenuItem>
                ))}
                <MenuSeparator />
                <MenuLabel>{t('common.status')}</MenuLabel>
                {FLAGS.map((flag) => (
                  <MenuItem key={flag} disabled={usedFlags.has(flag)} onSelect={() => edit({ flags: { ...draft.flags, [flag]: true } })}>{fieldLabel(`state.${flag}`, t)}</MenuItem>
                ))}
                <MenuItem disabled={draft.comment !== null} onSelect={() => edit({ comment: '' })}>{fieldLabel('state.comment', t)}</MenuItem>
              </Menu>
            </div>
          </div>

        </div>
      )}
    </section>
  )
}
