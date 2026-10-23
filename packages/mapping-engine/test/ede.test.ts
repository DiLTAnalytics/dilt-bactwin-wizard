import { describe, expect, it } from 'vitest'
import { EdeFormatError, parseEde } from '../src/index.js'

const HEAD = [
  '#Engineering-Data-Exchange - test', 'PROJECT_NAME;Demo', 'VERSION_OF_REFERENCEFILE;1', 'TIMESTAMP_OF_LAST_CHANGE;01.10.2026',
  'AUTHOR_OF_LAST_CHANGE;test', 'VERSION_OF_LAYOUT;2.3', '#mandatory;mandatory;mandatory;mandatory;mandatory;optional',
  '# keyname;device obj.-instance;object-name;object-type;object-instance;description',
]
const failure = (rows: string[]) => {
  try {
    parseEde([...HEAD, ...rows].join('\n'))
  } catch (e) {
    return { code: (e as EdeFormatError).code, line: (e as EdeFormatError).params['line'] }
  }
  return null
}

describe('EDE rows the reader cannot take', () => {
  it('names the line where an unclosed quote opens, after rows spanning two lines and comments', () => {
    expect(failure(['K1;1;A;0;1;"zwei', 'Zeilen"', '#K2;1;B;0;2;x', 'K3;1;"C;0;3;y', 'K4;1;D;0;4;z'])).toEqual({ code: 'EDE_UNCLOSED_QUOTE', line: '12' })
  })

  it('names the line with text after a closing quote, as the file counts it', () => {
    expect(failure(['K1;1;A;0;1;x', '', 'K2;1;"B"x;0;2;y'])).toEqual({ code: 'EDE_UNREADABLE_ROW', line: '11' })
  })

  it('counts lines from the top of the file for warnings', () => {
    const { warnings } = parseEde([...HEAD, 'K1;1;A;0;1;"zwei', 'Zeilen"', 'K2;1;B;0;2;y;extra'].join('\n'))
    expect(warnings).toEqual([{ code: 'EDE_LONG_ROW', params: { line: '11', found: '7', expected: '6' } }])
  })
})
