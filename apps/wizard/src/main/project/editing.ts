/** Changing the project: recorded set steps, and the project's own settings. */

import { emptyFilter, toCondition, type ApplyResult, type FilterDsl, type SequenceStep, type SetAction } from '@bactwin/mapping-engine'

import { insertStep, replaceStep, type StepPosition } from './sequence.js'
import type { TableLayout } from './projectSchema.js'
import type { Session } from './session.js'

export interface SetRequest {
  filter?: FilterDsl
  actions: SetAction[]
  note: string
  /** Replace the step at this index; the data then looks as if it had always been the new step. */
  replace?: number
  /** Where a new step goes; by default at the end of the sequence. */
  insert?: StepPosition
  /** Which keys the editor offered, kept with the step. */
  combination_mode?: SequenceStep['combination_mode']
}

/** Record a set as a step (inserted, or replacing one) and recalculate. Every set is recorded: the sequence is the deliverable. */
export async function applySet(s: Session, req: SetRequest): Promise<ApplyResult> {
  s.requireReferenceData()
  s.requireProject()
  const name = req.note.trim()
  if (!name) throw new Error(s.t('error.stepNameRequired'))
  const step: SequenceStep = {
    name,
    filter: (req.filter ?? emptyFilter()).rules.map(toCondition),
    actions: req.actions,
    ...(req.combination_mode ? { combination_mode: req.combination_mode } : {}),
  }
  const summary = req.replace === undefined ? await insertStep(s, step, req.insert) : await replaceStep(s, req.replace, step)
  return { matched: summary.hits, changed: summary.changed, skipped: summary.skipped }
}

export function projectSettings(s: Session) {
  const project = s.project
  return {
    has_project: project !== null,
    project_name: project?.header.project_name ?? '',
    enabled_plugins: s.enabledPlugins,
    ede_sources: project?.header.ede_sources ?? [],
    dirty: s.dirty,
    project_path: s.projectPath,
    table_layout: project?.header.layout?.table ?? null,
  }
}

/** Store how the point table is laid out with the project. */
export function setTableLayout(s: Session, table: TableLayout): { ok: true } {
  const project = s.requireProject()
  project.header.layout = { ...project.header.layout, table }
  s.dirty = true
  return { ok: true }
}

export function updateProjectSettings(s: Session, patch: { project_name?: string }): { ok: true } {
  const project = s.requireProject()
  if (patch.project_name !== undefined) project.header.project_name = patch.project_name
  s.dirty = true
  return { ok: true }
}
