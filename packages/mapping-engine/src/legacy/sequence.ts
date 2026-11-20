/**
 * Older sequence files, brought to the current format before they are parsed. Each step is a pure
 * JSON transform; the current format and anything that is no sequence pass through untouched.
 */

import { isNewer } from '../sequence/version.js'

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const matches = (regex: string, text: string) => {
  try {
    return new RegExp(regex, 'i').test(text)
  } catch {
    return null
  }
}

/**
 * A regex on `state.ignore` ("true"/"false") as the same test on `state.replacement_command`: 1.0 had no
 * doNotParse, so ignore was "true" and everything else "false". Null: the condition always holds.
 */
function commandRegex(regex: string): string | null {
  const onTrue = matches(regex, 'true')
  const onFalse = matches(regex, 'false')
  if (onTrue === null || onFalse === null) return regex
  if (onTrue && onFalse) return null
  if (onTrue) return '^ignore$'
  if (onFalse) return '^(?!ignore$)'
  return '(?!)'
}

/** `state.reminder` was renamed to `state.review`; its values stay. */
const renamed = <T>(item: T): T => (isObject(item) && item.field === 'state.reminder' ? { ...item, field: 'state.review' } : item)

function upgradeTests(list: unknown): unknown {
  if (!Array.isArray(list)) return list
  return list.map(renamed).flatMap((c) => {
    if (!isObject(c) || c.field !== 'state.ignore' || typeof c.regex !== 'string') return [c]
    const regex = commandRegex(c.regex)
    return regex === null ? [] : [{ ...c, field: 'state.replacement_command', regex }]
  })
}

function upgradeAction(action: unknown): unknown {
  const a = renamed(action)
  if (!isObject(a)) return a
  if (a.field === 'state.ignore' && typeof a.value === 'boolean') return { field: 'state.replacement_command', value: a.value ? 'ignore' : 'replace' }
  // An emptied source list would turn a template into a fixed value, so a source always stays.
  if (!Array.isArray(a.from)) return a
  return { ...a, from: a.from.map(renamed).map((s) => (isObject(s) && s.field === 'state.ignore' && typeof s.regex === 'string' ? { ...s, field: 'state.replacement_command', regex: commandRegex(s.regex) ?? '' } : s)) }
}

/** 1.0 -> 1.1: the `state.ignore` flag became `state.replacement_command` (replace, ignore or doNotParse), `state.reminder` became `state.review`. */
function v10ToV11(data: Json): Json {
  const steps = Array.isArray(data.steps)
    ? data.steps.map((s) => (isObject(s) ? { ...s, ...('filter' in s ? { filter: upgradeTests(s.filter) } : {}), actions: Array.isArray(s.actions) ? s.actions.map(upgradeAction) : s.actions } : s))
    : data.steps
  return { ...data, schema_version: '1.1', steps }
}

/** A sequence file's JSON in the current format; files already current, newer or no sequence at all come back as they are. */
export function upgradeLegacySequence(data: unknown): unknown {
  if (!isObject(data) || typeof data.schema_version !== 'string') return data
  let out = data
  if (isNewer('1.1', out.schema_version as string)) out = v10ToV11(out)
  return out
}
