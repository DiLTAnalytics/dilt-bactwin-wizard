/**
 * The context and hook, in a module without components: mixed with the provider, Fast Refresh
 * would recreate the context on edit and every consumer would read null.
 */

import { createContext, useContext } from 'react'

export interface I18nValue {
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Locale-aware number formatting. Never hardcode a locale at a call site. */
  n: (value: number, options?: Intl.NumberFormatOptions) => string
}

export const I18nContext = createContext<I18nValue | null>(null)

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
