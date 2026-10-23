import { describe, expect, it } from 'vitest'
import {
  applyFilter, emptyDataPoint, identityFilter, readSequence, pointKey, sequenceToFile, toCondition, toDsl, type DataPoint,
} from '../src/index.js'

function point(name: string, device = '1', instance = '7'): DataPoint {
  const p = emptyDataPoint()
  Object.assign(p.ede, { object_name: name, device_obj_instance: device, object_type: '0', object_instance: instance })
  return p
}

describe('identity', () => {
  it('tells apart points that share an object name', () => {
    expect(pointKey(point('TEMP', '1').ede)).not.toBe(pointKey(point('TEMP', '2').ede))
  })

  it('keys points apart where joined cells would collide', () => {
    const a = point('A_B')
    const b = point('A')
    Object.assign(a.ede, { object_type: '0' })
    Object.assign(b.ede, { object_type: 'B_0' })
    expect(pointKey(a.ede)).not.toBe(pointKey(b.ede))
  })

  it('selects exactly one point, whatever its name contains, also after a trip through a sequence file', () => {
    const target = point('AHU|01.TEMP (RL)')
    const points = [target, point('ahu|01.temp (rl)'), point('AHU'), point('01.TEMP (RL)'), point('AHU|01.TEMP (RL)', '2')]
    const filter = identityFilter(target.ede)
    expect(applyFilter(points, filter)).toEqual([target])
    const saved = readSequence(sequenceToFile({ schema_version: '1.0', steps: [{ name: 'x', filter: filter.rules.map(toCondition), actions: [{ field: 'state.reminder', value: true }] }] }))
    expect(applyFilter(points, toDsl(saved.steps[0]!.filter))).toEqual([target])
  })
})
