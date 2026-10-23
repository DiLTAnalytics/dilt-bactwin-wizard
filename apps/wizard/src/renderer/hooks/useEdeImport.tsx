import { useState, type ReactNode } from 'react'
import { useProjectLoaded } from '@/hooks/useProjectLoaded'
import { useI18n } from '@/i18n'
import { importEde, type ImportResult } from '@/ipc/project'
import { reportError } from '@/ui/reportError'
import { ImportErrorModal, type ImportFailure } from '@/ui/ImportErrorModal'

/** Adding EDE files: main asks for them; failures and warnings open `modal`, which the caller renders. */
export function useEdeImport(): { add: () => Promise<ImportResult | null>; modal: ReactNode } {
  const { t } = useI18n()
  const afterLoad = useProjectLoaded()
  const [errors, setErrors] = useState<{ failures: ImportFailure[]; warnings: string[]; total: number } | null>(null)

  async function add() {
    try {
      const result = await importEde('append')
      if (result && (result.failures.length || result.warnings.length)) {
        setErrors({ failures: result.failures, warnings: result.warnings, total: result.files })
      }
      return result
    } catch (err) {
      await reportError(t('dialog.importFailed'), err)
      return null
    } finally {
      await afterLoad()
    }
  }

  const modal = errors && (
    <ImportErrorModal failures={errors.failures} warnings={errors.warnings} total={errors.total} onClose={() => setErrors(null)} />
  )
  return { add, modal }
}
