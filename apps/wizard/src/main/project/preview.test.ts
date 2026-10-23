import { pointKey } from '@bactwin/mapping-engine'
import { describe, expect, it } from 'vitest'

import { applySet } from './editing.js'
import { importEde } from './importing.js'
import { pointHistory, preview } from './preview.js'
import { points } from './queries.js'
import { getSequence } from './sequence.js'
import { edeFile, testSession } from './testing.js'

const rule = (field: string, value: string, operator: 'equals' | 'regex' = 'equals') => ({ field, operator, value, case_sensitive: false, negated: false })

/** Four points: HH4 binary and analog, HH04 analog, L1 analog. */
async function session() {
  const s = testSession()
  await importEde(s, [edeFile([['HH4_RLTF1', '0', '1'], ['HH4_KLAP1', '3', '1'], ['HH04_RLTF1', '0', '2'], ['L1_ABTF1', '0', '3']])], { mode: 'new' })
  return s
}

const filter = { rules: [rule('ede.object_name', 'HH4', 'regex'), rule('ede.object_type', '0')] }
const names = (rows: { point: { ede: { object_name: string } } }[]) => rows.map((r) => r.point.ede.object_name)

describe('the step preview', () => {
  it('counts each condition alone, the hits, and what the step would change, without changing anything', async () => {
    const s = await session()
    const res = preview(s, { index: null, filter, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], mode: 'hits' })
    expect(res.counts).toMatchObject({ conditions: [2, 3], hits: 1, changed: 1, same: 0, near: 3, missed: 3, total: 4 })
    expect(names(res.items)).toEqual(['HH4_RLTF1'])
    expect(res.items[0]!.point.bactwin.gewerk).toBe('LUE')
    expect(res.items[0]!.before).toEqual({ 'bactwin.gewerk': '' })
    expect(s.requireProject().points[0]!.bactwin.gewerk).toBe('')
  })

  it('counts per source the hits it does not match, and shows the chosen hit as each action finds it', async () => {
    const s = await session()
    const actions = [
      { field: 'bactwin.ort', value: 'R' },
      { field: 'bactwin.anlage_number', from: [{ field: 'bactwin.ort', regex: '^(R)$' }, { field: 'ede.object_name', regex: '^HH(\\d)4?_' }], value: '$2$1' },
    ]
    const all = { rules: [] }
    const first = preview(s, { index: null, filter: all, actions, mode: 'hits', page_size: 1 })
    expect(first.sources.misses).toEqual([[], [0, 1]])
    // The first action's write is what the second one's first source reads.
    expect(first.sources.examples).toEqual([null, { key: expect.any(String), name: 'HH4_RLTF1', sources: [['R'], ['4']], value: '4R' }])
    const l1 = pointKey(s.requireProject().points[3]!.ede)
    const chosen = preview(s, { index: null, filter: all, actions, mode: 'hits', page_size: 1, example: l1 })
    expect(chosen.sources.examples[1]).toMatchObject({ name: 'L1_ABTF1', sources: [['R'], null], value: null })
    // A point a source skips is counted as skipped, not as already having the value.
    expect(first.counts).toMatchObject({ hits: 4, changed: 4, skipped: 0, same: 0 })
    const onlyName = preview(s, { index: null, filter: all, actions: actions.slice(1), mode: 'hits', page_size: 1 })
    expect(onlyName.counts).toMatchObject({ hits: 4, changed: 0, skipped: 4, same: 0 })
  })

  it('shows, without a chosen point, the first hit all of an action\'s sources match', async () => {
    const s = await session()
    const res = preview(s, { index: null, filter: { rules: [] }, actions: [{ field: 'bactwin.ort', value: '$1', from: [{ field: 'ede.object_name', regex: '^L(\\d)' }] }], mode: 'hits', page_size: 1 })
    expect(res.sources.examples[0]).toMatchObject({ name: 'L1_ABTF1', value: '1' })
  })

  it('sorts the table and the preview by a field, numbers inside text as numbers, empty values last either way', async () => {
    const s = testSession()
    await importEde(s, [edeFile([['AHU10', '0', '1'], ['AHU2', '0', '2'], ['ahu1', '0', '3']])], { mode: 'new' })
    const pts = s.requireProject().points
    pts[0]!.state.comment = 'b'
    pts[2]!.state.comment = 'a'
    const names = (items: { ede: { object_name: string } }[]) => items.map((p) => p.ede.object_name)
    expect(names(points(s, { sort: 'ede.object_name' }).items)).toEqual(['ahu1', 'AHU2', 'AHU10'])
    expect(names(points(s, { sort: 'ede.object_name', sort_desc: true }).items)).toEqual(['AHU10', 'AHU2', 'ahu1'])
    expect(names(points(s, { sort: 'state.comment' }).items)).toEqual(['ahu1', 'AHU10', 'AHU2'])
    expect(names(points(s, { sort: 'state.comment', sort_desc: true }).items)).toEqual(['AHU10', 'ahu1', 'AHU2'])
    const res = preview(s, { index: null, filter: { rules: [] }, actions: [], mode: 'hits', sort: 'ede.object_instance', sort_desc: true })
    expect(res.items.map((r) => r.point.ede.object_name)).toEqual(['ahu1', 'AHU2', 'AHU10'])
  })

  it('lists the near misses with which condition each fails', async () => {
    const s = await session()
    const res = preview(s, { index: null, filter, actions: [], mode: 'near' })
    expect(res.items.map((r) => [r.point.ede.object_name, r.conditions])).toEqual([['HH4_KLAP1', [true, false]], ['HH04_RLTF1', [false, true]], ['L1_ABTF1', [false, true]]])
  })

  it('lists what the filter misses, grouped by device, and narrows the list by a view filter only', async () => {
    const s = await session()
    const res = preview(s, { index: null, filter, actions: [], mode: 'missed', view: { rules: [rule('ede.object_name', '^HH', 'regex')] } })
    expect(names(res.items)).toEqual(['HH4_KLAP1', 'HH04_RLTF1'])
    expect(res.counts.missed).toBe(3)
    expect(res.groups).toEqual([{ device: 1, count: 3 }])
  })

  it('runs an edited step on the data before it, so its own earlier effect does not count', async () => {
    const s = await session()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], note: 'all' })
    const res = preview(s, { index: 0, filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], mode: 'hits' })
    expect(res.counts).toMatchObject({ hits: 4, changed: 4, same: 0 })
    const after = preview(s, { index: null, filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], mode: 'hits' })
    expect(after.counts).toMatchObject({ changed: 0, same: 4 })
  })

  it('looks at the imported data when asked, for points a later step would see differently', async () => {
    const s = await session()
    await applySet(s, { filter: { rules: [rule('ede.object_name', 'HH4', 'regex')] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], note: 'hh4' })
    const byGewerk = { rules: [rule('bactwin.gewerk', 'LUE')] }
    expect(preview(s, { index: null, filter: byGewerk, actions: [], mode: 'missed' }).filtered).toBe(2)
    expect(preview(s, { index: null, filter: byGewerk, actions: [], mode: 'missed', context: 'import' }).filtered).toBe(4)
  })
})

describe('a point\'s history', () => {
  it('lists the steps that changed it, with what they changed', async () => {
    const s = await session()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'first' })
    await applySet(s, { filter: { rules: [rule('ede.object_name', 'HH4_RLTF1')] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], note: 'second' })
    const key = pointKey(s.requireProject().points[0]!.ede)
    expect(pointHistory(s, key)).toEqual([
      { step: 0, name: 'first', changes: [{ field: 'bactwin.gewerk', before: '', after: 'HZG', overwrites: null }] },
      { step: 1, name: 'second', changes: [{ field: 'bactwin.gewerk', before: 'HZG', after: 'LUE', overwrites: 0 }] },
    ])
    expect(pointHistory(s, pointKey(s.requireProject().points[3]!.ede)).map((h) => h.step)).toEqual([0])
  })
})

describe('collisions between steps', () => {
  /** Step 1 sets gewerk on every point, step 2 changes it on the HH4 ones, step 3 sets it back to HZG on L1 (the same value). */
  async function overlapping() {
    const s = await session()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'alle' })
    await applySet(s, { filter: { rules: [rule('ede.object_name', 'HH4', 'regex')] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], note: 'HH4' })
    await applySet(s, { filter: { rules: [rule('ede.object_name', 'L1', 'regex')] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'L1' })
    return s
  }

  it('lists per step whose values it changes again and who changes its own', async () => {
    const s = await overlapping()
    const [first, second, third] = getSequence(s).outcomes
    expect(first).toMatchObject({ overwrites: [], overwrittenBy: [[1, 2]], noEffect: false })
    expect(second).toMatchObject({ overwrites: [[0, 2]], overwrittenBy: [], noEffect: false })
    // Writing the same value again changes nothing, so it collides with nothing.
    expect(third).toMatchObject({ overwrites: [], overwrittenBy: [] })
  })

  it('calls a step whose every change is changed again a step without effect', async () => {
    const s = await session()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'erst' })
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'LUE' }], note: 'dann' })
    expect(getSequence(s).outcomes[0]).toMatchObject({ noEffect: true })
  })

  it('marks the cells of the table, the preview and the history', async () => {
    const s = await overlapping()
    const listed = points(s, { page_size: 10 })
    expect(listed.collisions.map((c) => c?.['bactwin.gewerk'] ?? null)).toEqual([[0, 1], [0, 1], null, null])

    // Opening step 1 again: on HH4 points its value is replaced by step 2.
    const again = preview(s, { index: 0, filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'RLT' }], mode: 'hits' })
    expect(again.items[0]!.collisions['bactwin.gewerk']).toEqual({ overwrites: null, overwrittenBy: 1 })
    expect(again.items[3]!.collisions['bactwin.gewerk']).toBeUndefined()
    // A new step at the end replaces the values of the last steps that changed them.
    const added = preview(s, { index: null, isNew: true, filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'ELT' }], mode: 'hits' })
    expect(added.items.map((i) => i.collisions['bactwin.gewerk']?.overwrites)).toEqual([1, 1, 0, 0])

    const history = pointHistory(s, pointKey(s.requireProject().points[0]!.ede))
    expect(history.map((h) => h.changes[0]!.overwrites)).toEqual([null, 0])
  })
})
