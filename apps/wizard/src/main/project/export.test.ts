import readExcelFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'

import { importEde } from './importing.js'
import { exportFile } from './queries.js'
import { DEMO_EDE, testSession } from './testing.js'

describe('the data-point table export', () => {
  it('writes one sheet with a header row and typed cells, read back as written', async () => {
    const s = testSession()
    await importEde(s, [DEMO_EDE], { mode: 'new' })
    s.requireProject().points[1]!.state.comment = 'a\u0001b <&>'
    const { bytes } = await exportFile(s, 'xlsx', 'all')

    const [sheet, ...others] = await readExcelFile(Buffer.from(bytes))
    expect(others).toEqual([])
    expect(sheet!.sheet).toBe('files.datapointSheet')
    const [header, ...rows] = sheet!.data
    expect(rows).toHaveLength(s.requireProject().points.length)
    const cell = (row: number, column: string) => rows[row]![header!.indexOf(column)]
    expect(cell(0, 'ede.object_type')).toBe(8)
    expect(cell(1, 'ede.object_name')).toBe('XXDILT__HH4_____RLTF1__ME___')
    expect(cell(1, 'ede.unit_code')).toBe(62)
    // A control character XML cannot hold is dropped; the rest is kept as text.
    expect(cell(1, 'state.comment')).toBe('ab <&>')
    expect(cell(1, 'bactwin.gewerk')).toBeNull()
  })
})

describe('the data-point JSON export', () => {
  it('writes one nested object per selected point, with typed values', async () => {
    const s = testSession()
    await importEde(s, [DEMO_EDE], { mode: 'new' })
    const { bytes } = await exportFile(s, 'json', 'all')

    const points = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, Record<string, unknown>>[]
    expect(points).toHaveLength(s.requireProject().points.length)
    expect(Object.keys(points[1]!)).toEqual(['source', 'ede', 'bacnet', 'bactwin', 'state'])
    expect(points[1]!.ede!['object_name']).toBe('XXDILT__HH4_____RLTF1__ME___')
    expect(points[1]!.ede!['unit_code']).toBe(62)
    expect(points[1]!.state!['ignore']).toBe(false)
  })
})
