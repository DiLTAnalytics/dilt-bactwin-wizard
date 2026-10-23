import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readSettingsFrom, writeSettingsTo } from './settings.js'

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'bactwin-settings-')), 'settings.json')

describe('settings', () => {
  it('start from fresh defaults each time, never shared between reads', () => {
    const path = tempFile()
    const first = readSettingsFrom(path)
    first.folders['x'] = '/somewhere'
    expect(readSettingsFrom(path).folders).toEqual({})
  })

  it('round-trip through the file', () => {
    const path = tempFile()
    writeSettingsTo(path, { folders: { 'project-save': '/p' } })
    expect(readSettingsFrom(path)).toEqual({ folders: { 'project-save': '/p' } })
  })

  it('fall back to defaults when the file is corrupt', () => {
    const path = tempFile()
    writeFileSync(path, '{ not json')
    expect(readSettingsFrom(path)).toEqual({ folders: {} })
  })
})
