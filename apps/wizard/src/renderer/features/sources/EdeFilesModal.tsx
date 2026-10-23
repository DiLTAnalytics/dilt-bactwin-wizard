import { useEffect, useState } from 'react'
import { Ellipsis, FileInput, Replace, Trash2 } from 'lucide-react'
import { useEdeImport } from '@/hooks/useEdeImport'
import { useI18n } from '@/i18n'
import { events } from '@/ipc/client'
import { listSources, locateSource, removeSource, replaceSource, updateSource, type SourceStatus, type UpdateReport } from '@/ipc/project'
import { useRefresh } from '@/queries'
import { Button, IconButton } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Menu, MenuItem } from '@/ui/Menu'
import { Tooltip } from '@/ui/Tooltip'
import { reportError } from '@/ui/reportError'

const STATE_STYLES: Record<SourceStatus['state'], string> = {
  current: 'text-success-fg',
  changed: 'text-warning-fg font-medium',
  missing: 'text-warning-fg font-medium',
  unreadable: 'text-danger-fg font-medium',
  unknown: 'text-muted',
}

/** `**text**` in a message as bold. */
const withBold = (text: string) => text.split('**').map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-fg-2">{part}</strong> : part))

/** The project's EDE files: their state on disk, reading them again, and adding more. */
export function EdeFilesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const refresh = useRefresh()
  const [sources, setSources] = useState<SourceStatus[] | null>(null)
  const [result, setResult] = useState<{ lines: string[]; warnings: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const { add, modal } = useEdeImport()

  useEffect(() => {
    if (!open) return
    setSources(null)
    setResult(null)
    void listSources().then(setSources)
    // A file changed on disk while the dialog is open.
    return events.onSourceChanged(() => void listSources().then(setSources))
  }, [open])

  const updatedLine = (file: string, r: UpdateReport) => t('sources.updated', { file, updated: r.updated, added: r.added, missing: r.missing })

  /** Run a row action; null back means a file dialog was cancelled. */
  async function run<R>(action: () => Promise<R | null>, after: (r: R) => void) {
    setBusy(true)
    try {
      const r = await action()
      if (r !== null) {
        after(r)
        refresh('points', 'stats', 'validOptions', 'preview', 'history')
      }
    } catch (err) {
      await reportError(t('dialog.actionNotPossible'), err)
    } finally {
      setBusy(false)
    }
  }

  const reread = (source: SourceStatus) => run(() => updateSource(source.index), ({ report, sources: updated }) => {
    setSources(updated)
    setResult({ lines: [updatedLine(source.filename, report)], warnings: report.warnings })
  })
  const replace = (source: SourceStatus) => run(() => replaceSource(source.index), ({ report, sources: updated }) => {
    setSources(updated)
    setResult({ lines: [updatedLine(updated[source.index]?.filename ?? source.filename, report)], warnings: report.warnings })
  })
  const locate = (source: SourceStatus) => run(() => locateSource(source.index), setSources)
  const remove = (source: SourceStatus) => run(() => removeSource(source.index), (updated) => {
    setSources(updated)
    setResult({ lines: [t('sources.removed', { file: source.filename })], warnings: [] })
  })
  const addFiles = () => run(add, (r) => {
    setResult({ lines: [...(r.imported ? [t('sources.added', { count: r.imported })] : []), ...r.reread.map((x) => updatedLine(x.file, x))], warnings: [] })
    void listSources().then(setSources)
  })

  const empty = sources?.length === 0
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('sources.title')}
      subtitle={empty ? undefined : withBold(t('sources.hint'))}
      closeLabel={t('sources.close')}
      width={empty ? 'w-[480px]' : 'w-[820px]'}
      footer={empty ? undefined : (
        <>
          <Button icon={FileInput} disabled={busy} onClick={() => void addFiles()}>{t('sources.add')}</Button>
          <Button onClick={onClose}>{t('sources.close')}</Button>
        </>
      )}
    >
      {empty && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">{t('sources.empty')}</p>
          <Button variant="primary" icon={FileInput} disabled={busy} onClick={() => void addFiles()}>{t('sources.add')}</Button>
        </div>
      )}
      {sources && sources.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="py-1 pr-2 font-medium">{t('sources.file')}</th>
              <th className="py-1 pr-3 text-right font-medium">{t('sources.points')}</th>
              <th className="py-1 pr-2 font-medium">{t('sources.imported')}</th>
              <th className="py-1 pr-2 font-medium">{t('sources.state')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.index} className="border-b border-line-soft align-middle last:border-0">
                <td className="max-w-[300px] py-1.5 pr-2">
                  <Tooltip content={source.path ?? t('sources.noLocation')}>
                    <span className="block truncate font-mono">{source.filename}</span>
                  </Tooltip>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-fg-2">{source.points}</td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-muted">
                  {source.imported_at ? new Date(source.imported_at).toLocaleString('de-DE') : '-'}
                </td>
                <td className={`whitespace-nowrap py-1.5 pr-2 ${STATE_STYLES[source.state]}`}>{t(`sources.state_${source.state}`)}</td>
                <td className="whitespace-nowrap py-1 text-right">
                  {/* What the state calls for: an older source without a checksum can still be read again or located. */}
                  {(source.state === 'changed' || (source.state === 'unknown' && source.path)) && (
                    <Button size="sm" variant={source.state === 'changed' ? 'primary' : 'secondary'} disabled={busy} onClick={() => void reread(source)}>{t('sources.reread')}</Button>
                  )}
                  {(source.state === 'missing' || (source.state === 'unknown' && !source.path)) && (
                    <Button size="sm" disabled={busy} onClick={() => void locate(source)}>{t('sources.find')}</Button>
                  )}
                  <Menu align="end" trigger={<IconButton size="sm" icon={Ellipsis} label={t('sources.more', { file: source.filename })} className="ml-1" />}>
                    <MenuItem icon={Replace} disabled={busy} onSelect={() => void replace(source)}>{t('sources.replace')}</MenuItem>
                    <MenuItem icon={Trash2} disabled={busy} onSelect={() => void remove(source)}>{t('sources.remove')}</MenuItem>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && (result.lines.length > 0 || result.warnings.length > 0) && (
        <div className="mt-4 border-t border-line pt-3 text-xs">
          {result.lines.map((line) => <p key={line} className="text-fg-2">{line}</p>)}
          {result.warnings.length > 0 && (
            <pre className="mt-2 max-h-40 overflow-y-auto select-text whitespace-pre-wrap wrap-break-word rounded-sm border border-line bg-subtle p-2 font-mono">
              {result.warnings.join('\n')}
            </pre>
          )}
        </div>
      )}
      {modal}
    </Dialog>
  )
}
