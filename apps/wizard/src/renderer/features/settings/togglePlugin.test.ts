import { describe, expect, it } from 'vitest'
import { togglePlugin } from './togglePlugin'

const plugins = [
  { id: 'amev', requires: [] },
  { id: 'dilt', requires: ['amev'] },
  { id: 'extra', requires: ['dilt', 'not-installed'] },
]

describe('toggling a plugin', () => {
  it('switches on what it requires, through a chain, skipping what is not installed', () => {
    expect(togglePlugin(plugins, [], 'extra', true)).toEqual({ checked: ['extra', 'dilt', 'amev'], along: ['dilt', 'amev'] })
  })

  it('switches off what requires it', () => {
    expect(togglePlugin(plugins, ['amev', 'dilt', 'extra'], 'amev', false)).toEqual({ checked: [], along: ['dilt', 'extra'] })
  })

  it('touches nothing else when there is no requirement', () => {
    expect(togglePlugin(plugins, ['amev', 'dilt'], 'dilt', false)).toEqual({ checked: ['amev'], along: [] })
  })
})
