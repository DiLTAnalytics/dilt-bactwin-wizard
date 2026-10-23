/** Per-data-point validation, and the project-wide duplicate-name check. */

import { combinationConflict, combinationViolated, bactwinToState } from '../combinations/index.js'
import { fieldName } from '../naming/registry.js'
import { buildBACtwinDescription, buildBACtwinName, isNameComplete } from '../naming/name.js'
import { COMBINATION_COLUMNS, isStructuralMarker, type ReferenceData } from '../reference/index.js'
import { parseEdeCell } from '../parse/edeSchema.js'
import type { DataPoint, ValidationMessage } from '../types.js'

/** The catalogue check applies once something identifying is set, so a fresh import is not all violations. */
export function combinationsCheckable(point: DataPoint, ref: ReferenceData): boolean {
  const bt = point.bactwin
  return ref.hasCombinations && Boolean(bt.gewerk || bt.anlage || bt.betriebsmittel)
}

export function validatePoint(
  point: DataPoint,
  ref: ReferenceData,
  combinationCache?: Map<string, boolean>,
): ValidationMessage[] {
  const messages: ValidationMessage[] = []
  const bt = point.bactwin as unknown as Record<string, string>

  // Library keys; the not-present markers are not keys and are exempt, as in the catalogue check.
  for (const field of COMBINATION_COLUMNS) {
    const value = bt[field]
    if (!value || isStructuralMarker(value)) continue
    const entry = ref.entry(field, value)
    if (!entry) {
      messages.push({
        level: 'error',
        code: 'UNKNOWN_KEY',
        params: { value, block: field },
      })
    } else if (entry.deprecated) {
      // A warning: existing projects legitimately contain deprecated keys.
      messages.push({
        level: 'warning',
        code: 'DEPRECATED_KEY',
        params: { value, block: field },
      })
    }
  }

  if (combinationsCheckable(point, ref)) {
    const state = bactwinToState(point, ref)
    if (combinationViolated(state, ref, combinationCache)) {
      // Only failing points pay for finding the culprit.
      const conflict = combinationConflict(state, ref)
      messages.push({
        level: 'error',
        code: 'COMBINATION_VIOLATION',
        params: conflict
          ? { field: fieldName(conflict.field), value: conflict.value, with: conflict.with.map(([f, v]) => `${fieldName(f)} ${v}`).join(', ') }
          : {},
      })
    }
  }

  // Cells refused on import: the source is wrong, and the point lacks that value.
  for (const [column, value] of Object.entries(point.source.invalid)) {
    const cell = parseEdeCell(column, value)
    messages.push({ level: 'error', code: 'issue' in cell ? cell.issue : 'INVALID_VALUE', params: { column, value } })
  }

  if (point.source.missing_from_source) {
    messages.push({ level: 'warning', code: 'MISSING_FROM_SOURCE', params: { file: point.source.filename } })
  }

  // Source plausibility: about the imported data, not the engineer's work, hence warnings.
  const objectType = point.ede.object_type
  if (objectType !== null && !(String(objectType) in ref.bacnetTypes)) {
    messages.push({
      level: 'warning',
      code: 'UNKNOWN_OBJECT_TYPE',
      params: { value: String(objectType) },
    })
  }
  const unitCode = point.ede.unit_code
  if (unitCode !== null && !(String(unitCode) in ref.bacnetUnits)) {
    messages.push({
      level: 'warning',
      code: 'UNKNOWN_UNIT_CODE',
      params: { value: String(unitCode) },
    })
  }

  return messages
}

/** Flag points whose assembled name occurs more than once in the project, among complete names only. */
export function markDuplicateNames(points: DataPoint[]): void {
  const counts = new Map<string, number>()
  for (const p of points) {
    if (!p.state.translation_complete) continue
    const name = p.bactwin.bactwin_name
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const p of points) {
    const name = p.bactwin.bactwin_name
    p.state.duplicated_name = Boolean(p.state.translation_complete && name && (counts.get(name) ?? 0) > 1)
  }
}

/** Revalidate the given points in place and rebuild their name and description. */
export function validateAndUpdate(points: DataPoint[], ref: ReferenceData): void {
  const combinationCache = new Map<string, boolean>()
  for (const point of points) {
    const messages = validatePoint(point, ref, combinationCache)
    point.state.messages = messages

    const codes = new Set(messages.map((m) => m.code))
    point.state.valid_bactwin_rules = !codes.has('UNKNOWN_KEY')
    point.state.combinations_valid = combinationsCheckable(point, ref) ? !codes.has('COMBINATION_VIOLATION') : null

    // Complete means every visible segment is filled, valid or not; validity is filtered separately.
    point.state.translation_complete = isNameComplete(ref.nameTemplate, point.bactwin)
    point.bactwin.bactwin_name = buildBACtwinName(ref.nameTemplate, point.bactwin)
    point.bactwin.bactwin_description = buildBACtwinDescription(ref.nameTemplate, point.bactwin, ref.library)
  }
}
