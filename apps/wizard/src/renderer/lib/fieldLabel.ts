/** How a field reads in the UI: data fields by their name, flags and notes by a translated label. */

import { fieldName } from '@bactwin/mapping-engine'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** A field's area, the part before the dot. */
export const areaOf = (field: string) => field.slice(0, field.indexOf('.'))

const translated = (field: string) => areaOf(field) === 'state' || areaOf(field) === 'source'

export function fieldLabel(field: string, t: Translate): string {
  return translated(field) ? t(`field.${field}`) : fieldName(field)
}
