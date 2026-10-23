import { useEffect, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { emptyFilter } from '@bactwin/mapping-engine'
import { useI18n } from '@/i18n'
import { invoke, saveExport, type Result } from '@/ipc/client'
import { useStoredState } from '@/hooks/useStoredState'
import { useViewStore, viewFilter } from '@/stores/viewStore'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Section } from '@/ui/Field'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { reportError } from '@/ui/reportError'
import { toast } from '@/ui/Toast'

export type ExportKind = 'replacement' | 'table'
type TableType = 'xlsx' | 'json'
type ExportScope = 'all' | 'complete' | 'filtered'
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

/** Format and scope of an export, with how many points it takes; the file is chosen after. `kind` preselects one, else the last is kept. */
export function ExportDialog({ open, kind: preset, onClose }: { open: boolean; kind?: ExportKind; onClose: () => void }) {
  const { t, n } = useI18n()
  const [kind, setKind] = useStoredState<ExportKind>('export.kind', 'replacement')
  const [tableType, setTableType] = useStoredState<TableType>('export.tableType', 'xlsx')
  const [scope, setScope] = useStoredState<ExportScope>('export.scope', 'all')
  const format = kind === 'replacement' ? 'replacement' : tableType
  const [counts, setCounts] = useState<Counts | null>(null)
  const [saving, setSaving] = useState(false)
  // "Gefilterte" is what the table's view filter lists; without a view filter it would be all points.
  const filter = viewFilter(useViewStore.getState())
  const hasViewFilter = filter.rules.length > 0
  // The CSV holds only complete names anyway, so "Vollständige" would write the same file as "Alle".
  const shownScope: ExportScope = (scope === 'filtered' && !hasViewFilter) || (scope === 'complete' && kind === 'replacement') ? 'all' : scope

  useEffect(() => {
    if (!open) return
    if (preset) setKind(preset)
    setCounts(null)
    void invoke('export:counts', filter).then(setCounts)
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = counts?.[shownScope]
  const unnamed = format === 'replacement' ? chosen?.unnamed ?? 0 : 0
  const devices = format === 'replacement' ? chosen?.devices ?? 0 : 0
  const leftOut = unnamed + devices
  const exported = (chosen?.points ?? 0) - leftOut

  async function handleExport() {
    setSaving(true)
    try {
      const path = await saveExport(format, shownScope, shownScope === 'filtered' ? filter : emptyFilter())
      if (!path) return
      toast(t('export.done', { count: n(exported), file: path.split(/[\\/]/).pop() ?? path }))
      onClose()
    } catch (err) {
      await reportError(t('dialog.exportFailed'), err)
    } finally {
      setSaving(false)
    }
  }

  const count = (s: ExportScope) => <span className="shrink-0 text-sm tabular-nums text-fg-2">{counts ? n(counts[s].points) : '…'}</span>

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
            {kind === 'table' && (
              <Choice selected={shownScope === 'complete'} onSelect={() => setScope('complete')} title={t('export.complete')} hint={t('export.completeHint')} aside={count('complete')} />
            )}
            <Choice selected={shownScope === 'filtered'} disabled={!hasViewFilter} onSelect={() => setScope('filtered')} title={t('export.filtered')}
              hint={hasViewFilter ? t('export.filteredHint') : t('export.filteredNone')} aside={hasViewFilter ? count('filtered') : undefined} />
          </div>
          {unnamed > 0 && exported > 0 && (
            <p className="mt-3 flex items-start gap-2 text-xs text-warning-fg">
              <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
              {t('export.leftOut', { count: n(unnamed) })}
            </p>
          )}
          {devices > 0 && exported > 0 && <p className="mt-2 text-xs text-muted">{t('export.devices', { count: n(devices) })}</p>}
          {counts && exported === 0 && <p className="mt-3 text-xs text-muted">{unnamed > 0 ? t('export.allUnnamed') : t('export.nothing')}</p>}
        </Section>
      </div>
    </Dialog>
  )
}
