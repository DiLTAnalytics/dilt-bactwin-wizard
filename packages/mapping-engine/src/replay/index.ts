/**
 * The data as the import plus every step in order, kept incrementally: each step records which
 * values it changed, so editing step k undoes the steps from the end back to k and runs them again,
 * instead of replaying everything from the import.
 */

import { applyActions } from '../apply/index.js'
import { selectPoints } from '../filter/index.js'
import { BACTWIN_FIELDS } from '../naming/registry.js'
import type { ReferenceData } from '../reference/index.js'
import type { SequenceStep } from '../sequence/format.js'
import type { DataPoint } from '../types.js'
import { markDuplicateNames, validateAndUpdate } from '../validate/index.js'

/** Every value a step can write, as [area, field]; everything else is imported or derived from these. */
const JOURNALED: readonly (readonly [string, string])[] = [
  ...BACTWIN_FIELDS.map((f) => ['bactwin', f.id] as const),
  ['state', 'comment'],
  ['state', 'ignore'],
  ['state', 'reminder'],
]

const FIELD_INDEX = new Map(JOURNALED.map(([a, f], i) => [`${a}.${f}`, i]))

/** Whose values a step overwrote, and who overwrote its own, as [step, values] in step order. */
export interface StepCollisions {
  overwrites: [number, number][]
  overwrittenBy: [number, number][]
  /** Values it changed, and how many of them a later step changed again. */
  changed: number
  overwritten: number
}

/** One value a step changed on one point. */
export interface Change {
  point: number
  field: string
  before: unknown
  after: unknown
}

/** What one step did. */
export interface StepOutcome {
  /** Indices of the points the filter selected. */
  hits: Uint32Array
  changes: Change[]
  /** Points with at least one changed value. */
  changedPoints: number
  skipped: number
}

const DISABLED: StepOutcome = { hits: new Uint32Array(), changes: [], changedPoints: 0, skipped: 0 }

const area = (point: DataPoint, name: string) => (point as unknown as Record<string, Record<string, unknown>>)[name]!

function snapshot(point: DataPoint): unknown[] {
  return JOURNALED.map(([a, f]) => area(point, a)[f])
}

export interface RunOptions {
  /** Called before each step; resolve to yield to the event loop (progress, stop requests). */
  onStep?: (index: number, total: number) => void | Promise<void>
  /** Checked before each step; true stops the run where it is. */
  shouldStop?: () => boolean
}

export class Replay {
  private readonly outcomes: StepOutcome[] = []
  private readonly indexOf = new Map<DataPoint, number>()
  /** Goes up whenever the points change, so anything derived from them knows when to recompute. */
  version = 0
  private cells: { version: number; applied: number; writers: Map<number, number[]> } | null = null

  /** `points` are the imported points; the replay changes them in place. */
  constructor(readonly points: DataPoint[], private readonly ref: ReferenceData) {
    points.forEach((p, i) => this.indexOf.set(p, i))
  }

  /** How many steps are applied to `points` now. */
  get applied(): number {
    return this.outcomes.length
  }

  outcome(index: number): StepOutcome | undefined {
    return this.outcomes[index]
  }

  /** Undo the applied steps from the last back to `to`, so that `points` are as before step `to`. */
  rewind(to: number): void {
    this.version++
    const touched = new Set<number>()
    while (this.outcomes.length > Math.max(0, to)) {
      const { changes } = this.outcomes.pop()!
      for (let i = changes.length - 1; i >= 0; i--) {
        const c = changes[i]!
        const [a, f] = c.field.split('.') as [string, string]
        area(this.points[c.point]!, a)[f] = c.before
        touched.add(c.point)
      }
    }
    if (touched.size > 0) validateAndUpdate([...touched].map((i) => this.points[i]!), this.ref)
    markDuplicateNames(this.points)
  }

  /** Apply `steps` from `applied` onwards, one after another. Disabled steps are passed over. */
  async run(steps: readonly (SequenceStep & { disabled?: boolean })[], { onStep, shouldStop }: RunOptions = {}): Promise<void> {
    this.version++
    for (let i = this.outcomes.length; i < steps.length; i++) {
      if (shouldStop?.()) break
      await onStep?.(i, steps.length)
      const step = steps[i]!
      this.outcomes.push(step.disabled ? DISABLED : this.applyOne(step))
    }
    markDuplicateNames(this.points)
  }

  private applyOne(step: SequenceStep): StepOutcome {
    // Filters can test state.duplicated_name, so it must be current before each step.
    markDuplicateNames(this.points)
    const targets = selectPoints(this.points, step.filter)
    const before = targets.map(snapshot)
    const result = applyActions(targets, step.actions, this.ref)
    const changes: Change[] = []
    let changedPoints = 0
    targets.forEach((point, t) => {
      const index = this.indexOf.get(point)!
      let changed = false
      JOURNALED.forEach(([a, f], j) => {
        const after = area(point, a)[f]
        if (after !== before[t]![j]) {
          changes.push({ point: index, field: `${a}.${f}`, before: before[t]![j], after })
          changed = true
        }
      })
      if (changed) changedPoints++
    })
    return { hits: Uint32Array.from(targets, (p) => this.indexOf.get(p)!), changes, changedPoints, skipped: result.skipped }
  }

  /**
   * The values that differ before step `k` from now, by point: walking the journal back from the
   * last applied step to `k`, the earliest step's `before` wins.
   */
  valuesBefore(k: number): Map<number, Record<string, unknown>> {
    const out = new Map<number, Record<string, unknown>>()
    for (let s = this.outcomes.length - 1; s >= Math.max(0, k); s--) {
      const { changes } = this.outcomes[s]!
      for (let i = changes.length - 1; i >= 0; i--) {
        const c = changes[i]!
        let values = out.get(c.point)
        if (!values) out.set(c.point, (values = {}))
        values[c.field] = c.before
      }
    }
    return out
  }

  /** Index of `point` in `points`, or undefined for a point not in them. */
  indexOfPoint(point: DataPoint): number | undefined {
    return this.indexOf.get(point)
  }

  /** A copy of point `index` as it was before step `k`, revalidated so its name and status match. */
  pointBefore(index: number, k: number, before = this.valuesBefore(k)): DataPoint {
    const point = structuredClone(this.points[index]!)
    for (const [field, value] of Object.entries(before.get(index) ?? {})) {
      const [a, f] = field.split('.') as [string, string]
      area(point, a)[f] = value
    }
    if (before.has(index)) validateAndUpdate([point], this.ref)
    return point
  }

  /** The steps that changed point `index`, with what each changed, in order. */
  history(index: number): { step: number; changes: Change[] }[] {
    const out: { step: number; changes: Change[] }[] = []
    this.outcomes.forEach((o, step) => {
      const changes = o.changes.filter((c) => c.point === index)
      if (changes.length) out.push({ step, changes })
    })
    return out
  }

  /** Per cell (point × journaled field) the steps that changed it, in order; built on demand, kept until the points change. */
  private writers(): Map<number, number[]> {
    if (this.cells?.version === this.version && this.cells.applied === this.outcomes.length) return this.cells.writers
    const writers = new Map<number, number[]>()
    this.outcomes.forEach(({ changes }, step) => {
      for (const c of changes) {
        const key = c.point * JOURNALED.length + FIELD_INDEX.get(c.field)!
        const list = writers.get(key)
        if (list) list.push(step)
        else writers.set(key, [step])
      }
    })
    this.cells = { version: this.version, applied: this.outcomes.length, writers }
    return writers
  }

  /** The steps that changed `field` of point `index`, in order. */
  cellWriters(index: number, field: string): readonly number[] {
    const f = FIELD_INDEX.get(field)
    return f === undefined ? [] : this.writers().get(index * JOURNALED.length + f) ?? []
  }

  /** The fields of point `index` that more than one step changed, with those steps in order. */
  collidedCells(index: number): Record<string, number[]> {
    const out: Record<string, number[]> = {}
    JOURNALED.forEach(([a, f], i) => {
      const steps = this.writers().get(index * JOURNALED.length + i)
      if (steps && steps.length > 1) out[`${a}.${f}`] = steps
    })
    return out
  }

  /** Per applied step: whose values it overwrote and who overwrote its own. Only a real change counts, never writing the same value again. */
  collisions(): StepCollisions[] {
    const pairs = this.outcomes.map(() => ({ overwrites: new Map<number, number>(), overwrittenBy: new Map<number, number>(), overwritten: 0 }))
    for (const steps of this.writers().values()) {
      for (let i = 1; i < steps.length; i++) {
        const [earlier, later] = [steps[i - 1]!, steps[i]!]
        pairs[later]!.overwrites.set(earlier, (pairs[later]!.overwrites.get(earlier) ?? 0) + 1)
        pairs[earlier]!.overwrittenBy.set(later, (pairs[earlier]!.overwrittenBy.get(later) ?? 0) + 1)
        pairs[earlier]!.overwritten++
      }
    }
    const sorted = (m: Map<number, number>) => [...m].sort((a, b) => a[0] - b[0])
    return pairs.map((p, step) => ({
      overwrites: sorted(p.overwrites),
      overwrittenBy: sorted(p.overwrittenBy),
      changed: this.outcomes[step]!.changes.length,
      overwritten: p.overwritten,
    }))
  }
}
