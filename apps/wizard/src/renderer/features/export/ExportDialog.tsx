import { useEffect, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { invoke, saveExport, type Result } from '@/ipc/client'
import { getSequence } from '@/ipc/sequence'
import { queryKeys } from '@/queries'
import { useStepStore } from '@/stores/stepStore'
import { useStoredState } from '@/hooks/useStoredState'
import { useViewStore, viewFilter } from '@/stores/viewStore'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Section, Select } from '@/ui/Field'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Switch } from '@/ui/Switch'
import { reportError } from '@/ui/reportError'
import { toast } from '@/ui/Toast'

export type ExportKind = 'replacement' | 'table'
type TableType = 'xlsx' | 'json'
type ExportScope = 'all' | 'view' | 'step'
type Counts = Result<'export:counts'>

/** One option of a few, as a card with a title, a line of explanation and something on the right. */
function Choice({ selected, disabled, onSelect, title, hint, aside }: {
  selected: boolean; disabled?: boolean; onSelect: () => void; title: string; hint: string; aside?: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-1.5 text-left transition-colors disabled:opacity-50 ${
        selected ? 'border-accent bg-accent-soft' : 'border-line hover:enabled:bg-subtle'}`}
    >
      <span className={`size-3.5 shrink-0 rounded-full border ${selected ? 'border-4 border-accent' : 'border-line-strong'}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      {aside}
    </button>
  )
}

/** An on/off option, laid out like a Choice with a switch in place of the radio. */
function OptionCard({ on, onChange, title, hint }: { on: boolean; onChange: (on: boolean) => void; title: string; hint: string }) {
  return (
    <div
      role="presentation"
      onClick={() => onChange(!on)}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-1.5 transition-colors ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-subtle'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  )
}

/**
 * Format, scope and options of an export, with how many points it takes; the file is chosen after.
 * What it exports depends only on these choices, never on the step open in the editor.
 */
export function ExportDialog({ open, kind: preset, onClose }: { open: boolean; kind?: ExportKind; onClose: () => void }) {
  const { t, n } = useI18n()
  const [kind, setKind] = useStoredState<ExportKind>('export.kind', 'replacement')
  const [tableType, setTableType] = useStoredState<TableType>('export.tableType', 'xlsx')
  const [scope, setScope] = useStoredState<ExportScope>('export.scope', 'all')
  const [complete, setComplete] = useStoredState('export.complete', true)
  const [ignore, setIgnore] = useStoredState('export.ignore', false)
  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence, enabled: open })
  const steps = sequence?.steps ?? []
  const [step, setStep] = useState(0)
  const format = kind === 'replacement' ? 'replacement' : tableType
  const [counts, setCounts] = useState<Counts | null>(null)
  const [saving, setSaving] = useState(false)
  const view = useViewStore.getState()
  const filter = viewFilter(view)
  const hasViewFilter = filter.rules.length > 0
  const viewSummary = [
    view.search.trim() && t('export.viewSearch', { search: view.search.trim() }),
    ...view.chips.map((c) => t(`view.${c}`)),
    view.name && t('view.name', { name: view.name }),
    view.device !== null && t('view.device', { device: view.device }),
  ].filter(Boolean).join(' · ')
  // A scope stored by an older version, or one not possible now, falls back to all.
  const shownScope: ExportScope = (scope === 'view' && hasViewFilter) || (scope === 'step' && steps.length > 0) ? scope : 'all'
  const request = { scope: shownScope, filter, step, options: { complete, ignore } }

  // The step defaults to the one open in the editor, else the last.
  useEffect(() => {
    if (!open) return
    if (preset) setKind(preset)
    const target = useStepStore.getState().target
    setStep(typeof target === 'number' ? target : Math.max(0, steps.length - 1))
  }, [open, steps.length])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    let current = true
    void invoke('export:counts', request).then((c) => { if (current) setCounts(c) })
    return () => { current = false }
  }, [open, shownScope, step, complete, ignore])  // eslint-disable-line react-hooks/exhaustive-deps

  const csv = counts?.replacement
  const leftOut = format === 'replacement' ? csv?.leftOut ?? 0 : 0
  const devices = format === 'replacement' ? csv?.devices ?? 0 : 0
  const exported = format === 'replacement' ? csv?.rows ?? 0 : counts?.table ?? 0

  async function handleExport() {
    setSaving(true)
    try {
      const path = await saveExport(format, request)
      if (!path) return
      toast(t('export.done', { count: n(exported), file: path.split(/[\\/]/).pop() ?? path }))
      onClose()
    } catch (err) {
      await reportError(t('dialog.exportFailed'), err)
    } finally {
      setSaving(false)
    }
  }

  const count = (s: ExportScope) => <span className="shrink-0 text-sm tabular-nums text-fg-2">{counts ? n(counts.scopes[s]) : '…'}</span>

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('export.title')}
      closeLabel={t('export.cancel')}
      footer={
        <>
          <Button onClick={onClose}>{t('export.cancel')}</Button>
          <Button variant="primary" busy={saving} disabled={!counts || exported === 0} onClick={() => void handleExport()}>{t('export.submit')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 divide-y divide-line-soft [&>*:not(:last-child)]:pb-5">
        <Section title={t('export.format')}>
          <div role="radiogroup" aria-label={t('export.format')} className="grid grid-cols-2 gap-2">
            <Choice selected={kind === 'replacement'} onSelect={() => setKind('replacement')} title={t('export.replacement')} hint={t('export.replacementHint')} />
            <Choice selected={kind === 'table'} onSelect={() => setKind('table')} title={t('export.table')} hint={t('export.tableHint')} />
          </div>
          {kind === 'table' && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-fg-2">{t('export.fileType')}</span>
              <SegmentedControl<TableType> size="sm" label={t('export.fileType')} value={tableType} onChange={setTableType} options={[
                { value: 'xlsx', label: 'XLSX', hint: t('export.xlsxHint') },
                { value: 'json', label: 'JSON', hint: t('export.jsonHint') },
              ]} />
            </div>
          )}
        </Section>
        <Section title={t('export.scope')}>
          <div role="radiogroup" aria-label={t('export.scope')} className="flex flex-col gap-2">
            <Choice selected={shownScope === 'all'} onSelect={() => setScope('all')} title={t('export.all')} hint={t('export.allHint')} aside={count('all')} />
            <Choice selected={shownScope === 'view'} disabled={!hasViewFilter} onSelect={() => setScope('view')} title={t('export.view')}
              hint={hasViewFilter ? viewSummary : t('export.viewNone')} aside={hasViewFilter ? count('view') : undefined} />
            <Choice selected={shownScope === 'step'} disabled={steps.length === 0} onSelect={() => setScope('step')} title={t('export.step')}
              hint={steps.length ? t('export.stepHint') : t('export.stepNone')} aside={steps.length ? count('step') : undefined} />
            {shownScope === 'step' && (
              <Select size="sm" className="ml-9 w-auto" aria-label={t('export.step')} value={step} onChange={(e) => setStep(Number(e.target.value))}>
                {steps.map((s, i) => <option key={i} value={i}>{t('export.stepOption', { step: String(i + 1).padStart(3, '0'), name: s.name })}</option>)}
              </Select>
            )}
          </div>
        </Section>
        <Section title={t('export.options')}>
          <div className="flex flex-col gap-2">
            {format === 'replacement'
              ? <OptionCard on={ignore} onChange={setIgnore} title={t('export.ignore')} hint={t('export.ignoreHint')} />
              : <OptionCard on={complete} onChange={setComplete} title={t('export.complete')} hint={t('export.completeHint')} />}
          </div>
          {leftOut > 0 && exported > 0 && (
            <p className="mt-3 flex items-start gap-2 text-xs text-warning-fg">
              <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
              {t('export.leftOut', { count: n(leftOut) })}
            </p>
          )}
          {devices > 0 && exported > 0 && <p className="mt-2 text-xs text-muted">{t('export.devices', { count: n(devices) })}</p>}
          {counts && exported === 0 && <p className="mt-3 text-xs text-muted">{leftOut > 0 ? t('export.allUnnamed') : t('export.nothing')}</p>}
        </Section>
      </div>
    </Dialog>
  )
}
