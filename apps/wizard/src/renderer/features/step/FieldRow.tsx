import { Plus, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { BACTWIN_FIELDS, fieldName, numericDigits, type FilterDsl } from '@bactwin/mapping-engine'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { dropLineClass, useRowDrag, type RowDrag } from '@/hooks/useRowDrag'
import { useI18n } from '@/i18n'
import { fetchValidOptions } from '@/ipc/bulk'
import { queryKeys } from '@/queries'
import type { CombinationMode } from '@/stores/stepStore'
import { Button, IconButton } from '@/ui/Button'
import { DragHandle } from '@/ui/DragHandle'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { KeySelect } from '@/ui/KeySelect'
import { fieldLabel } from '@/lib/fieldLabel'
import { Tooltip } from '@/ui/Tooltip'
import {
  TRANSFER_SOURCE_FIELDS, canTransfer, emptySource, moveSource, removeSource, sourceGroups, usedGroups, type RowCheck, type SetMode, type SetRow, type SourceRow,
} from '@/lib/stepRows'

const inputClass = 'h-7 min-w-0 rounded border border-line bg-surface px-2 text-xs hover:border-line-strong'

/**
 * One "Dann" row: which field, and the value it gets. A field that can take its value from fields by
 * regex ("aus Feld") has the template as its value and one indented line per source below, so a row
 * never grows wider than its column.
 */
export function FieldRow({ row, combinationMode, dsl, overrides, onChange, onFieldChange, onRemove, drag, check }: {
  row: SetRow
  combinationMode: CombinationMode
  dsl: FilterDsl
  overrides: Record<string, string>
  onChange: (patch: Partial<SetRow>) => void
  onFieldChange: (id: string) => void
  onRemove: () => void
  drag: RowDrag
  /** What the preview says about the sources; undefined while it is not known. */
  check?: RowCheck
}) {
  const { t } = useI18n()
  const { field } = row
  const digits = numericDigits(useNameTemplate(), field.id) ?? 2
  const transfer = row.mode === 'transfer'
  const transferable = field.kind === 'number' || canTransfer(field) || transfer

  const { data: options, isFetching } = useQuery({
    queryKey: [...queryKeys.validOptions, field.id, dsl, combinationMode, JSON.stringify(overrides)],
    queryFn: () => fetchValidOptions({ field: field.id, filter: dsl, mode: combinationMode, overrides }),
    staleTime: 30_000,
    enabled: field.kind === 'key',
  })

  let value
  if (field.kind === 'key' && !transfer) {
    value = (
      <KeySelect
        block={field.id}
        value={row.value}
        onChange={(v) => onChange({ value: v })}
        valid={options?.valid_for_all ?? []}
        // Combination mode offers only what holds for the whole selection.
        someOnly={combinationMode === 'combination' ? [] : options?.valid_for_some ?? []}
        mode={combinationMode}
        placeholder={(count) => (isFetching ? t('set.loadingOptions') : t('set.optionsCount', { count }))}
        markOutside
        disabled={isFetching}
        className="min-w-0 flex-1"
      />
    )
  } else if (!transfer) {
    value = field.kind === 'number' ? (
      <input type="text" inputMode="numeric" className={`${inputClass} flex-1 font-mono`} placeholder={'#'.repeat(digits)} maxLength={digits} aria-label={fieldLabel(`bactwin.${field.id}`, t)}
        value={row.value ?? ''} onChange={(e) => onChange({ value: e.target.value.replace(/[^\d#]/g, '') || null })} />
    ) : (
      <input type="text" className={`${inputClass} flex-1`} placeholder={t('set.valuePlaceholder')} aria-label={fieldLabel(`bactwin.${field.id}`, t)}
        value={row.value ?? ''} onChange={(e) => onChange({ value: e.target.value || null })} />
    )
  } else {
    // In both modes the value sits beside the field; taken from fields, it is the template.
    value = (
      <Tooltip content={t('set.templateHint')}>
        <input type="text" className={`${inputClass} min-w-0 flex-1 font-mono`} placeholder="$1" aria-label={t('set.templateLabel')}
          value={row.template} onChange={(e) => onChange({ template: e.target.value })} />
      </Tooltip>
    )
  }

  return (
    <div {...drag.rowProps} className={`flex min-w-0 flex-col gap-1 border-y-2 border-transparent ${dropLineClass(drag.dropTarget)} ${drag.dragged ? 'opacity-40' : ''}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <DragHandle drag={drag} title={t('common.dragHint')} />
        <select className={`${inputClass} w-36 shrink-0`} value={field.id} aria-label={t('set.field')} onChange={(e) => onFieldChange(e.target.value)}>
          {BACTWIN_FIELDS.map((f) => <option key={f.id} value={f.id}>{fieldLabel(`bactwin.${f.id}`, t)}</option>)}
        </select>
        {transferable && (
          <SegmentedControl<SetMode>
            size="sm"
            label={t('set.modeLabel')}
            value={row.mode}
            onChange={(mode) => onChange({ mode })}
            options={[
              { value: 'set', label: t('set.modeSetShort'), hint: t('set.modeSetHint') },
              { value: 'transfer', label: t('set.modeTransferShort'), hint: field.kind === 'number' ? t('set.transferHintIndex') : t('set.transferHintValue') },
            ]}
          />
        )}
        {value}
        <IconButton size="sm" icon={X} tone="danger" label={t('set.removeField')} onClick={onRemove} />
      </div>
      {transfer && <Sources row={row} check={check} onChange={onChange} />}
    </div>
  )
}

/**
 * The sources of an "aus Feld" row, each led by the group numbers it fills in the template and followed
 * by how many hits it does not match, then what they take from one point.
 */
function Sources({ row, check, onChange }: { row: SetRow; check: RowCheck | undefined; onChange: (patch: Partial<SetRow>) => void }) {
  const { t, n } = useI18n()
  const self = `bactwin.${row.field.id}`
  const groups = sourceGroups(row.sources)
  const used = usedGroups(row.template)
  const several = row.sources.length > 1
  const drag = useRowDrag((from, to) => onChange(moveSource(row, from, to)), row.sources.length)
  const setSource = (i: number, patch: Partial<SourceRow>) => onChange({ sources: row.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  return (
    <div className="flex min-w-0 flex-col gap-1 pl-[22px]">
      {row.sources.map((source, i) => {
        const g = groups[i]
        const offered = [self, ...TRANSFER_SOURCE_FIELDS]
        const label = !g ? '!' : g.last < g.first ? '–' : g.first === g.last ? `$${g.first}` : `$${g.first}-$${g.last}`
        const misses = check?.misses[i] ?? 0
        const unused = !!g && g.last >= g.first && ![...Array(g.last - g.first + 1).keys()].some((k) => used.has(g.first + k))
        return (
          <div key={source.key} {...drag(i).rowProps}
            className={`flex min-w-0 items-center gap-1.5 border-y-2 border-transparent ${dropLineClass(drag(i).dropTarget)} ${drag(i).dragged ? 'opacity-40' : ''}`}>
            {several ? <DragHandle drag={drag(i)} title={t('common.dragHint')} /> : <span className="w-3.5 shrink-0" />}
            <Tooltip content={!g ? t('set.groupsUnknown') : g.last < g.first ? t('set.noGroup') : unused ? t('set.unusedGroupHint') : t('set.groupsHint')}>
              <span className={`w-16 shrink-0 truncate text-right font-mono text-xs ${!g ? 'font-semibold text-danger-fg' : unused ? 'text-faint' : 'text-fg-2'}`}>{label} ←</span>
            </Tooltip>
            <select className={`${inputClass} w-48 shrink-0`} aria-label={t('set.sourceLabel')} value={source.field} onChange={(e) => setSource(i, { field: e.target.value })}>
              <option value={self}>{t('set.sourceSelf')}</option>
              {TRANSFER_SOURCE_FIELDS.map((field) => <option key={field} value={field}>EDE: {fieldName(field)}</option>)}
              {/* A field from the file the editor does not offer stays shown as it is. */}
              {!offered.includes(source.field) && <option value={source.field}>{fieldLabel(source.field, t)}</option>}
            </select>
            <input type="text" className={`${inputClass} min-w-0 flex-1 font-mono`} placeholder={t('set.regexPlaceholder')} aria-label={t('set.regexPlaceholder')}
              value={source.pattern} onChange={(e) => setSource(i, { pattern: e.target.value })} />
            {misses > 0 && (
              <Tooltip content={t('set.missesHint', { count: n(misses) })}>
                <span className="shrink-0 text-2xs text-warning-fg">{t('set.misses', { count: n(misses) })}</span>
              </Tooltip>
            )}
            {several
              ? <IconButton size="sm" icon={X} tone="danger" label={t('set.removeSource')} onClick={() => onChange(removeSource(row, i))} />
              : <span className="w-6 shrink-0" />}
          </div>
        )
      })}
      <div>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange({ sources: [...row.sources, emptySource()] })}>{t('set.addSource')}</Button>
      </div>
      {check?.example && <Example example={check.example} groups={groups} used={used} />}
    </div>
  )
}

/** What each source takes from one point, numbered as in the template, and the value written. */
function Example({ example, groups, used }: { example: NonNullable<RowCheck['example']>; groups: ReturnType<typeof sourceGroups>; used: Set<number> }) {
  const { t } = useI18n()
  const shown = (v: string) => (v === '' ? t('set.exampleEmpty') : v)
  return (
    <Tooltip content={t('set.exampleHint')}>
      <div className="mr-[1.875rem] flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded bg-subtle px-2 py-1 text-2xs">
        <span className="text-muted">{t('set.example')}</span>
        <span className="truncate font-mono text-fg-2">{example.name}</span>
        {example.sources.map((values, i) => {
          const first = groups[i]?.first
          if (values === null) return <span key={i} className="text-warning-fg">{t('set.exampleMiss', { source: i + 1 })}</span>
          return values.map((v, j) => {
            const unused = first !== undefined && !used.has(first + j)
            return (
              <span key={`${i}-${j}`} className={`font-mono ${unused ? 'text-faint' : ''}`}>
                <span className={unused ? '' : 'text-muted'}>{first === undefined ? '?' : `$${first + j}`}</span>{' '}
                <span className={unused ? '' : 'text-fg'}>{shown(v)}</span>
              </span>
            )
          })
        })}
        <span className="font-mono">
          <span className="text-muted">→ </span>
          {example.value === null ? <span className="text-warning-fg">{t('set.exampleSkipped')}</span> : <span className="font-semibold text-fg">{shown(example.value)}</span>}
        </span>
      </div>
    </Tooltip>
  )
}

