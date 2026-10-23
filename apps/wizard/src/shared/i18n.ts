/** The German UI texts, for renderer and main. The domain vocabulary (`gewerk`, `anlage`, ...) is the data's own keys. */

import de from './locales/de.json' with { type: 'json' }

/** Resolve a dotted key, falling back to the key itself; `{{name}}` is replaced from `vars`. */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as object)) return (acc as Record<string, unknown>)[part]
    return undefined
  }, de)
  const template = typeof value === 'string' ? value : key
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? `{{${name}}}`))
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('de-AT', options).format(value)
}
