/** Replaying a mapping sequence against a project. */

import { applyStep } from '../apply/index.js'
import type { NameTemplate, ReferenceData } from '../reference/index.js'
import type { DataPoint } from '../types.js'
import { markDuplicateNames } from '../validate/index.js'
import type { Sequence, SequenceStep } from './format.js'

export interface ExecuteResult {
  step_index: number
  matched: number
  changed: number
  skipped: number
}

/**
 * Field to its position in the assembled name, index field directly after its base segment.
 * Fields with no name segment - flags, comment - are absent, and sort last.
 */
export function nameFieldOrder(template: NameTemplate): Map<string, number> {
  const order = new Map<string, number>()
  for (const seg of template.segments) {
    order.set(seg.id, order.size)
    if (seg.index_field) order.set(seg.index_field, order.size)
  }
  return order
}

/** Execute a single step against the given points. */
export function executeOne(
  step: SequenceStep,
  index: number,
  points: DataPoint[],
  ref: ReferenceData,
): ExecuteResult {
  // Filters can test state.duplicated_name, so it must be current before each step.
  markDuplicateNames(points)
  return { step_index: index, ...applyStep(points, step.filter, step.actions, ref) }
}

/** Replay a whole sequence in order: a later step sees what earlier ones wrote. */
export function runSequence(
  sequence: Sequence,
  points: DataPoint[],
  ref: ReferenceData,
): ExecuteResult[] {
  return sequence.steps.map((step, i) => executeOne(step, i, points, ref))
}
