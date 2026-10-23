import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { BACNET_FIELDS, BACTWIN_FIELDS, EDE_FIELDS, fieldName, identityFilter, pointKey, type BACtwinData, type DataPoint, type ValidationMessage } from '@bactwin/mapping-engine'
import { useCapabilities, useCombinationMode } from '@/hooks/useCapabilities'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { useI18n } from '@/i18n'
import { applySet } from '@/ipc/bulk'
import { fetchPointsByKeys } from '@/ipc/points'
import { draftFlag, type Flag, type FlagDrafts } from '@/lib/flags'
import { queryKeys, useRefresh } from '@/queries'
import { BACtwinName } from '@/ui/BACtwinName'
import { Button, IconButton } from '@/ui/Button'
import { Input } from '@/ui/Field'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { toast } from '@/ui/Toast'
import { fieldLabel } from '@/lib/fieldLabel'
import { messageField } from '@/lib/messages'
import { DetailFieldRow } from './DetailFieldRow'
import { FieldMessages, hasError } from './FieldMessages'
import { PointHistory } from './PointHistory'

/** The point's BACtwin values with the unapplied draft laid over them. */
function draftBACtwin(point: DataPoint, draft: Record<string, string | null>): BACtwinData {
  const bt = { ...point.bactwin } as Record<string, string | null>
  for (const [field, value] of Object.entries(draft)) {
    if (field.startsWith('bactwin.')) bt[field.slice('bactwin.'.length)] = value
  }
  return bt as unknown as BACtwinData
}

/** Index numbers are edited beside their key, not as rows of their own. */
const EDITABLE_FIELDS = BACTWIN_FIELDS.filter((f) => !f.indexOf)

/** One point's fields and status, edited as a draft and applied as a recorded step addressed by its identity. */
export function DetailPanel({ point, onClose }: { point: DataPoint | null; onClose: () => void }) {
  const { t } = useI18n()
  const refresh = useRefresh()
  const combinationMode = useCombinationMode()
  const caps = useCapabilities()
  const nameTemplate = useNameTemplate()
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [flagDrafts, setFlagDrafts] = useState<FlagDrafts>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const commentId = useId()
  // The step a correction becomes is named after the point, so it can be applied without typing a name.
  const defaultNote = point ? t('detail.defaultName', { name: point.ede.object_name }) : ''

  useEffect(() => {
    setDraft({}); setFlagDrafts({}); setNote(defaultNote)
  }, [point])  // eslint-disable-line react-hooks/exhaustive-deps

  // The point as it is now, fetched again whenever the data changes (a step, a file read again). A row
  // of a step preview carries the draft's values, so the clicked row is only shown until this arrives.
  const key = point ? pointKey(point.ede) : null
  const current = useQuery({
    queryKey: [...queryKeys.points, 'inspector', key],
    queryFn: () => fetchPointsByKeys([key!]),
    enabled: key !== null,
  })
  const gone = current.data !== undefined && current.data.items.length === 0
  useEffect(() => { if (gone) onClose() }, [gone])  // eslint-disable-line react-hooks/exhaustive-deps
  const localPoint = current.data?.items[0] ?? (current.data ? null : point)

  if (!localPoint) return null

  function updateDraft(field: string, value: string | null) {
    setDraft(d => ({ ...d, [field]: value }))
  }

  const toggleFlagDraft = (flag: Flag, value: boolean) => setFlagDrafts((d) => draftFlag(d, flag, value, localPoint.state[flag]))

  async function handleApplyDraft() {
    if (!localPoint) return
    const entries = Object.entries(draft)
    const flagEntries = Object.entries(flagDrafts) as [Flag, boolean][]
    if (entries.length === 0 && flagEntries.length === 0) return
    if (note.trim() === '' || applying) return
    setError('')
    setApplying(true)
    try {
      const filter = identityFilter(localPoint.ede)
      const noteArg = note.trim()
      const res = await applySet({
        filter,
        actions: [
          ...entries.map(([field, value]) => ({ field, value: value ?? '' })),
          ...flagEntries.map(([flag, value]) => ({ field: `state.${flag}`, value })),
        ],
        note: noteArg,
      })
      const changed = res.changed, skipped = res.skipped
      setDraft({})
      setFlagDrafts({})
      setNote(defaultNote)
      toast(t('common.applyResult', { changed, skipped }))
      refresh('points', 'stats', 'sequence', 'history', 'preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  const m = localPoint.state
  // Each message goes under its field; the rest are about the point as a whole.
  const shownFields = new Set([...Object.keys(EDE_FIELDS).map((f) => `ede.${f}`), ...EDITABLE_FIELDS.map((f) => `bactwin.${f.id}`)])
  const fieldMessages = new Map<string, ValidationMessage[]>()
  const pointMessages: ValidationMessage[] = []
  for (const msg of m.messages) {
    let field = messageField(msg)
    const index = field?.startsWith('bactwin.') ? BACTWIN_FIELDS.find((f) => f.id === field!.slice(8))?.indexOf : undefined
    if (index) field = `bactwin.${index}`
    if (field && shownFields.has(field)) fieldMessages.set(field, [...(fieldMessages.get(field) ?? []), msg])
    else pointMessages.push(msg)
  }
  const messagesOf = (field: string) => fieldMessages.get(field) ?? []
  const draftBt = draftBACtwin(localPoint, draft)
  const pendingCount = Object.keys(draft).length + Object.keys(flagDrafts).length
  const noteMissing = note.trim() === ''
  const canApply = pendingCount > 0 && !noteMissing

  return (
    <aside aria-label={localPoint.ede.object_name} className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex shrink-0 items-start gap-2 border-b border-line py-1.5 pl-4 pr-1">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-semibold text-fg">{localPoint.ede.object_name}</div>
        </div>
        <IconButton size="sm" icon={X} label={t('detail.close')} onClick={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
        <FieldMessages messages={pointMessages} />
        <PointHistory point={localPoint} />

        {/* EDE */}
        <section>
          <h3 className="font-semibold text-muted mb-1 uppercase text-xs tracking-wide">EDE</h3>
          <table className="w-full table-fixed">
            <tbody>
              {[
                ...Object.keys(EDE_FIELDS).map((id) => [`ede.${id}`, localPoint.ede[id as keyof typeof EDE_FIELDS]] as const),
                ...Object.keys(BACNET_FIELDS).map((id) => [`bacnet.${id}`, localPoint.bacnet[id as keyof typeof BACNET_FIELDS]] as const),
              ].map(([field, val]) => (
                <tr key={field} className="border-b border-line-soft">
                  <td className="py-0.5 pr-3 text-muted w-32 align-top">{fieldName(field)}</td>
                  <td className="py-0.5">
                    <span className={`font-mono ${hasError(messagesOf(field)) ? 'text-danger-fg' : 'text-fg'}`}>{val === null || val === '' ? '—' : val}</span>
                    <FieldMessages messages={messagesOf(field)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* BACtwin */}
        <section>
          <h3 className="font-semibold text-muted mb-1 uppercase text-xs tracking-wide">BACtwin</h3>
          {error && <div className="mb-1.5 text-xs p-1.5 rounded-sm bg-danger-soft text-danger-fg">{error}</div>}
          <table className="w-full table-fixed">
            <colgroup><col className="w-36" /><col /><col className="w-16" /></colgroup>
            <tbody>
              {EDITABLE_FIELDS.map((f) => (
                <DetailFieldRow key={f.id} field={f} point={localPoint} draftBt={draftBt} combinationMode={combinationMode} messages={messagesOf(`bactwin.${f.id}`)} onUpdate={updateDraft} />
              ))}
              <tr>
                <td className="py-1 pr-2 text-muted align-top" colSpan={1}>{t('detail.name')}</td>
                <td colSpan={2} className="py-1">
                  <div className="bg-subtle rounded-sm p-1.5">
                    <BACtwinName bt={draftBt} template={nameTemplate} wrap />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Status */}
        <section>
          <h3 className="font-semibold text-muted mb-1 uppercase text-xs tracking-wide">{t('common.status')}</h3>
          <div className="mb-2 flex flex-col gap-1.5">
            {(['ignore', 'reminder'] as const).map((field) => (
              <div key={field} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-muted">{fieldLabel(`state.${field}`, t)}</span>
                <SegmentedControl<'yes' | 'no'>
                  size="sm"
                  label={fieldLabel(`state.${field}`, t)}
                  value={(flagDrafts[field] ?? m[field]) ? 'yes' : 'no'}
                  onChange={(v) => toggleFlagDraft(field, v === 'yes')}
                  options={[{ value: 'yes', label: t('step.yes') }, { value: 'no', label: t('step.no') }]}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <label htmlFor={commentId} className="w-32 shrink-0 text-muted">{fieldLabel('state.comment', t)}</label>
              <Input
                id={commentId}
                size="sm"
                className="min-w-0 flex-1"
                value={draft['state.comment'] ?? m.comment ?? ''}
                onChange={(e) => updateDraft('state.comment', e.target.value || null)}
              />
            </div>
          </div>
          <div className="space-y-1">
            {caps.combinations && (
              <div className={m.combinations_valid === null ? 'text-muted' : m.combinations_valid ? 'text-success-fg' : 'text-danger-fg'}>
                {t('detail.combinations', { source: caps.combinationSource ?? '' })}{' '}
                {m.combinations_valid === null ? `– ${t('common.notChecked')}` : m.combinations_valid ? `✓ ${t('common.valid')}` : `✗ ${t('common.invalid')}`}
              </div>
            )}
            <div className={m.valid_bactwin_rules ? 'text-success-fg' : 'text-danger-fg'}>
              {t('detail.rules')} {m.valid_bactwin_rules ? `✓ ${t('common.valid')}` : `✗ ${t('common.invalid')}`}
            </div>
          </div>
        </section>
      </div>

      <div className="shrink-0 space-y-2 border-t border-line px-4 py-2 text-xs">
        {/* The step's name in the sequence (required), not the comment written onto the point. Always shown, so nothing jumps. */}
        <div className="flex items-center gap-2">
          <span className="text-muted w-20 shrink-0">
            {t('detail.actionName')}<span className="text-danger-fg"> *</span>
          </span>
          <Input
            size="sm"
            invalid={noteMissing && pendingCount > 0}
            className="min-w-0 flex-1"
            placeholder={t('detail.actionNamePlaceholder')}
            aria-label={t('detail.actionName')}
            aria-required
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" busy={applying} disabled={!canApply} onClick={() => void handleApplyDraft()}>
            {t('common.set')}{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Button>
          {pendingCount > 0 && (
            <Button size="sm" onClick={() => { setDraft({}); setFlagDrafts({}); setNote(defaultNote) }}>{t('detail.discard')}</Button>
          )}
        </div>
      </div>
    </aside>
  )
}
