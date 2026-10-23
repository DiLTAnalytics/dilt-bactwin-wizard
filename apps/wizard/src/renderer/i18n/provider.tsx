/** Exports one component and nothing else, so React Fast Refresh can hot-swap it. */

import type { ReactNode } from 'react'
import { formatNumber, translate } from '../../shared/i18n'
import { I18nContext, type I18nValue } from './context'

const value: I18nValue = { t: translate, n: formatNumber }

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
