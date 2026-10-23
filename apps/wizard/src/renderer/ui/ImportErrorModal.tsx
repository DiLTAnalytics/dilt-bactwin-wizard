import { useState } from 'react'
import { Copy } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from './Button'
import { Dialog, ToneIcon } from './Dialog'

export interface ImportFailure {
  file: string
  error: string
}

interface ImportErrorModalProps {
  failures: ImportFailure[]
  warnings: string[]
  total: number
  onClose: () => void
}

/** Files that failed to import, and warnings about those that did, copyable as text. */
export function ImportErrorModal({ failures, warnings, total, onClose }: ImportErrorModalProps) {
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  const okCount = total - failures.length
  const sections = [
    { tone: 'error' as const, heading: t('importErrors.failedHeading', { count: failures.length }), lines: failures.map((f) => `${f.file}: ${f.error}`) },
    { tone: 'warning' as const, heading: t('importErrors.warningsHeading', { count: warnings.length }), lines: warnings },
  ].filter((section) => section.lines.length > 0)
  // With one kind only, the title already says which it is.
  const showHeadings = sections.length > 1
  const text = sections
    .map((section) => (showHeadings ? [`${section.heading}:`, ...section.lines] : section.lines).join('\n'))
    .join('\n\n')

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      tone={failures.length > 0 ? 'error' : 'warning'}
      width="w-[640px]"
      closeLabel={t('importErrors.close')}
      title={failures.length > 0
        ? t('importErrors.title', { failed: failures.length, total })
        : t('importErrors.warningsTitle', { count: warnings.length })}
      subtitle={failures.length > 0 && okCount > 0 ? t('importErrors.someSucceeded', { count: okCount }) : undefined}
      footer={
        <>
          <Button icon={Copy} onClick={() => void handleCopy()}>{copied ? t('importErrors.copied') : t('importErrors.copy')}</Button>
          <Button variant="primary" onClick={onClose}>{t('importErrors.close')}</Button>
        </>
      }
    >
      <div className="select-text space-y-3 rounded border border-line bg-subtle p-3 font-mono text-xs">
        {sections.map((section) => (
          <section key={section.tone}>
            {showHeadings && (
              <h3 className={`mb-1 flex items-center gap-1.5 font-sans font-semibold uppercase tracking-wide ${section.tone === 'error' ? 'text-danger-fg' : 'text-warning-fg'}`}>
                <ToneIcon tone={section.tone} size={16} />
                {section.heading}
              </h3>
            )}
            <pre className="whitespace-pre-wrap wrap-break-word">{section.lines.join('\n')}</pre>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
