import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { emptyDataPoint, ReferenceData, Replay, runSequence, validateAndUpdate, type DataPoint, type NameTemplate, type SequenceStep } from '../src/index.js'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'amev-2026', 'name-template.json')
const ref = new ReferenceData({
  library: [],
  combinations: [],
  bacnetTypes: {},
  bacnetUnits: {},
  nameTemplate: JSON.parse(readFileSync(TEMPLATE, 'utf8')) as NameTemplate,
  activeSources: [],
})

function importedPoints(): DataPoint[] {
  return ['HH4_RLTF1', 'HH4_VLPU1', 'HH3_RLTF1', 'L1_ABTF1'].map((name) => {
    const p = emptyDataPoint()
    p.ede.object_name = name
    return p
  })
}

/** Imported points as a project holds them: validated, so names and descriptions are filled in. */
function validated(points: DataPoint[]): DataPoint[] {
  validateAndUpdate(points, ref)
  return points
}

const step = (filter: string, actions: SequenceStep['actions'], extra: Partial<SequenceStep> = {}): SequenceStep =>
  ({ name: filter || 'all', filter: filter ? [{ field: 'ede.object_name', regex: filter }] : [], actions, ...extra })

const STEPS: SequenceStep[] = [
  step('^HH', [{ field: 'bactwin.gewerk', value: 'HZG' }]),
  step('HH4', [{ field: 'bactwin.gewerk', value: 'LUE' }, { field: 'bactwin.anlage_number', from: [{ field: 'ede.object_name', regex: 'HH(\\d)' }], value: '0$1' }]),
  // Reads what step 2 wrote.
  step('', [{ field: 'state.reminder', value: true }], { filter: [{ field: 'bactwin.gewerk', regex: '^LUE$' }] }),
]

/** The writable values of every point, for comparing two ways of getting there. */
const values = (points: DataPoint[]) => points.map((p) => ({ ...p.bactwin, comment: p.state.comment, ignore: p.state.ignore, reminder: p.state.reminder }))

function replayFromScratch(steps: SequenceStep[]): DataPoint[] {
  const points = validated(importedPoints())
  runSequence({ schema_version: '1.0', steps: steps.filter((s) => !s.disabled) }, points, ref)
  return points
}

describe('the replay', () => {
  it('gives the same data as running the sequence from the import', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(STEPS)
    expect(values(replay.points)).toEqual(values(replayFromScratch(STEPS)))
    expect(replay.outcome(1)!.changedPoints).toBe(2)
    expect([...replay.outcome(0)!.hits]).toEqual([0, 1, 2])
  })

  it('editing an earlier step and running again from there equals a fresh run of the edited sequence', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(STEPS)
    const edited = [STEPS[0]!, step('HH3', [{ field: 'bactwin.gewerk', value: 'LUE' }]), STEPS[2]!]
    replay.rewind(1)
    await replay.run(edited)
    expect(values(replay.points)).toEqual(values(replayFromScratch(edited)))
    expect(replay.points[0]!.state.reminder).toBe(false)
    expect(replay.points[2]!.state.reminder).toBe(true)
  })

  it('rewinding to 0 restores the imported values, names included', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    const fresh = validated(importedPoints())
    await replay.run(STEPS)
    replay.rewind(0)
    expect(values(replay.points)).toEqual(values(fresh))
    expect(replay.applied).toBe(0)
  })

  it('passes over a disabled step', async () => {
    const steps = STEPS.map((s, i) => (i === 1 ? { ...s, disabled: true } : s))
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(steps)
    expect(values(replay.points)).toEqual(values(replayFromScratch(steps)))
    expect(replay.outcome(1)!.hits.length).toBe(0)
  })

  it('tells the values before a step, and a point as it was then', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(STEPS)
    expect(replay.valuesBefore(1).get(0)).toEqual({ 'bactwin.gewerk': 'HZG', 'bactwin.anlage_number': '', 'state.reminder': false })
    expect(replay.pointBefore(0, 1).bactwin.gewerk).toBe('HZG')
    expect(replay.points[0]!.bactwin.gewerk).toBe('LUE')
  })

  it('lists the steps that changed a point', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(STEPS)
    expect(replay.history(0).map((h) => h.step)).toEqual([0, 1, 2])
    expect(replay.history(3)).toEqual([])
  })

  it('stops between steps when asked', async () => {
    const replay = new Replay(validated(importedPoints()), ref)
    let calls = 0
    await replay.run(STEPS, { shouldStop: () => calls++ >= 2 })
    expect(replay.applied).toBe(2)
  })
})

describe('collisions: a later step changing what an earlier one changed', () => {
  const run = async (steps: (SequenceStep & { disabled?: boolean })[]) => {
    const replay = new Replay(validated(importedPoints()), ref)
    await replay.run(steps)
    return replay
  }

  it('names who overwrites whom, per step and per cell, counting values', async () => {
    const replay = await run(STEPS)
    // Step 2 changes gewerk on the two HH4 points that step 1 had set.
    expect(replay.collisions().map((c) => [c.overwrites, c.overwrittenBy, c.changed, c.overwritten])).toEqual([
      [[], [[1, 2]], 3, 2],
      [[[0, 2]], [], 4, 0],
      [[], [], 2, 0],
    ])
    expect(replay.cellWriters(0, 'bactwin.gewerk')).toEqual([0, 1])
    expect(replay.collidedCells(0)).toEqual({ 'bactwin.gewerk': [0, 1] })
    expect(replay.collidedCells(2)).toEqual({})
  })

  it('does not count writing the same value again, or a disabled step', async () => {
    const same = await run([step('^HH', [{ field: 'bactwin.gewerk', value: 'HZG' }]), step('HH4', [{ field: 'bactwin.gewerk', value: 'HZG' }])])
    expect(same.collisions().every((c) => c.overwrites.length === 0 && c.overwrittenBy.length === 0)).toBe(true)
    const disabled = await run([STEPS[0]!, { ...STEPS[1]!, disabled: true }])
    expect(disabled.collisions()[0]!.overwritten).toBe(0)
  })

  it('follows an undo and a run again', async () => {
    const replay = await run(STEPS)
    replay.rewind(1)
    expect(replay.collisions()[0]!.overwrittenBy).toEqual([])
    await replay.run([STEPS[0]!, step('HH3', [{ field: 'bactwin.gewerk', value: 'RLT' }])])
    expect(replay.collisions()[1]!.overwrites).toEqual([[0, 1]])
  })
})
