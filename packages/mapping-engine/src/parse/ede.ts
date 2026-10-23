/** Reading BACnet EDE (Engineering Data Exchange) CSV exports. */

import { parse } from 'csv-parse/browser/esm/sync'

import { CodedError, emptyDataPoint, type DataPoint, type Notice } from '../types.js'
import { EDE_REQUIRED_COLUMNS, EdeRowSchema, type EdeRow } from './edeSchema.js'

export class EdeFormatError extends CodedError {}

export interface EdeParseResult {
  points: DataPoint[]
  warnings: Notice[]
  /** The `KEY;value` header lines before the column header, e.g. TIMESTAMP_OF_LAST_CHANGE. */
  meta: Record<string, string>
}

/** The EDE layout puts the column header on line 8, after the format line, five metadata lines and the mandatory/optional line. */
export const EDE_COLUMN_HEADER_LINE = 8

/** Per field, its header spellings in lower case: the EDE layout's own first (used in messages), then ones seen in the wild. */
const EDE_COLUMN_SPELLINGS: Record<keyof EdeRow, readonly [string, ...string[]]> = {
  keyname: ['keyname'],
  device_obj_instance: ['device obj.-instance', 'device-instance', 'device_obj.-instance', 'device obj. instance'],
  object_name: ['object-name'],
  object_type: ['object-type'],
  object_instance: ['object-instance'],
  description: ['description'],
  present_value_default: ['present-value-default', 'present-value'],
  min_present_value: ['min-present-value'],
  max_present_value: ['max-present-value'],
  settable: ['settable'],
  commandable: ['commandable'],
  supports_cov: ['supports cov', 'supports_cov'],
  hi_limit: ['hi-limit', 'high-limit'],
  low_limit: ['low-limit'],
  state_text_reference: ['state-text-reference'],
  unit_code: ['unit-code'],
  vendor_specific_address: ['vendor-specific-address', 'vendor-specific-addres'],
  notification_class: ['notification-class', 'notification_class'],
  object_tag: ['object-tag'],
  object_tag_text: ['object-tag-text'],
}

const EDE_COLUMN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(EDE_COLUMN_SPELLINGS).flatMap(([field, spellings]) => spellings.map((spelling) => [spelling, field])),
)

const EDE_FIELDS = Object.keys(EdeRowSchema.shape)

/** Each byte as Windows-1252 reads it. */
const CP1252 = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i))

/** Length of the valid UTF-8 sequence at `i`, or 0 when the byte there starts none. */
function utf8Length(bytes: Uint8Array, i: number): number {
  const b = bytes[i]!
  const n = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0
  for (let k = 1; k < n; k++) if (((bytes[i + k] ?? 0) & 0xc0) !== 0x80) return 0
  return n
}

const UTF8 = new TextDecoder('utf-8')
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

/**
 * Decode as UTF-8; a byte that is no valid UTF-8 is read as Windows-1252, so a UTF-8 file with a few
 * bytes from another tool (°, µ) keeps both. `mixed` counts those bytes when the file also has
 * UTF-8 characters; a file without any is plain Windows-1252.
 */
export function decodeEdeBytes(bytes: Uint8Array): { text: string; mixed: number } {
  try {
    return { text: UTF8_STRICT.decode(bytes), mixed: 0 }
  } catch {
    // Not clean UTF-8: byte by byte below.
  }
  let text = ''
  let fallback = 0
  let multibyte = 0
  let start = 0
  for (let i = 0; i < bytes.length;) {
    const n = utf8Length(bytes, i)
    if (n > 0) {
      if (n > 1) multibyte++
      i += n
      continue
    }
    text += UTF8.decode(bytes.subarray(start, i)) + CP1252[bytes[i]!]
    fallback++
    start = ++i
  }
  text += UTF8.decode(bytes.subarray(start))
  return { text, mixed: multibyte > 0 ? fallback : 0 }
}

/**
 * The column header (line 8, without its "#") and the rows after it, cells trimmed, as pandas reads
 * them: a quote opens only at a cell's start (12" Rohr is text), a line starting with # is a comment,
 * and a quoted cell may hold `;` or a line break. Lines are counted from the header.
 */
function readTable(lines: string[]): { record: string[]; info: { lines: number } }[] {
  const [header = '', ...rows] = lines
  const table = [header.replace(/^\s*#\s*/, ''), ...rows]
  // csv-parse reports an unclosed quote at the end of the file; it opened on the next row after the last complete one.
  let last = 0
  try {
    return parse(table.join('\n'), {
      delimiter: ';',
      relax_quotes: true,
      relax_column_count: true,
      comment: '#',
      comment_no_infix: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      info: true,
      on_record: (record, context) => {
        last = context.lines
        return record
      },
    }) as unknown as { record: string[]; info: { lines: number } }[]
  } catch (e) {
    const error = e as { code?: string; lines?: number }
    if (error.code === 'CSV_QUOTE_NOT_CLOSED') {
      let next = last
      while (next < table.length && /^\s*(#|$)/.test(table[next]!)) next++
      error.lines = next + 1
    }
    throw e
  }
}


/** A row as typed values and the optional cells refused, or the notice why the row is not imported. */
function readRow(raw: Record<string, string>, line: string): { ede: EdeRow; invalid: Record<string, string> } | { skip: Notice } {
  const parsed = EdeRowSchema.safeParse(raw)
  if (parsed.success) return { ede: parsed.data, invalid: {} }
  const invalid: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const column = String(issue.path[0])
    if ((EDE_REQUIRED_COLUMNS as readonly string[]).includes(column)) {
      return { skip: { code: `EDE_ROW_${issue.message}`, params: { line, column, value: raw[column] ?? '' } } }
    }
    invalid[column] = raw[column] ?? ''
  }
  const cleared = Object.fromEntries(Object.keys(invalid).map((column) => [column, '']))
  return { ede: EdeRowSchema.parse({ ...raw, ...cleared }), invalid }
}

export interface ParseEdeOptions {
  filename?: string
}

/**
 * Read an EDE file. The file fails on a wrong format line, column header or missing required
 * column. A row with a missing or invalid required cell is skipped with a warning; an invalid
 * optional cell is imported as null and kept in `source.invalid`.
 */
export function parseEde(input: string | Uint8Array, options: ParseEdeOptions = {}): EdeParseResult {
  const displayName = options.filename ?? '(unnamed)'
  const decoded = typeof input === 'string' ? { text: input, mixed: 0 } : decodeEdeBytes(input)
  // A BOM would defeat the header check.
  const text = decoded.text.replace(/^﻿/, '')

  const lines = text.split(/\r\n|\r|\n/)
  const firstLine = (lines[0] ?? '').trim()

  // "#" plus the format tag near the start, in any case and with any prefix
  // (e.g. "# Proposal_Engineering-Data-Exchange - B.I.G.-EU").
  const headerBody = firstLine.startsWith('#') ? firstLine.slice(1).trim().toLowerCase() : ''
  const isValidHeader = headerBody.slice(0, 60).includes('engineering-data-exchange')
  if (!firstLine || !isValidHeader) {
    if (text.trim() === '') {
      throw new EdeFormatError('EDE_EMPTY', { file: displayName })
    }
    const preview = firstLine.slice(0, 120) + (firstLine.length > 120 ? '…' : '')
    throw new EdeFormatError('EDE_BAD_HEADER', { file: displayName, firstLine: preview })
  }

  const result: EdeParseResult = { points: [], warnings: [], meta: {} }
  if (decoded.mixed) result.warnings.push({ code: 'EDE_ENCODING_MIXED', params: { count: String(decoded.mixed) } })

  for (const line of lines.slice(1, EDE_COLUMN_HEADER_LINE - 1)) {
    const [key = '', ...value] = line.split(';')
    const name = key.trim()
    if (!name || name.startsWith('#')) continue
    if (name in result.meta) result.warnings.push({ code: 'EDE_META_REPEATED', params: { key: name } })
    result.meta[name] = value.join(';').replace(/;+\s*$/, '').trim()
  }

  const headerLine = (lines[EDE_COLUMN_HEADER_LINE - 1] ?? '').trim()
  let table: ReturnType<typeof readTable>
  try {
    table = headerLine.startsWith('#') ? readTable(lines.slice(EDE_COLUMN_HEADER_LINE - 1)) : []
  } catch (e) {
    const error = e as { code?: string; lines?: number; message: string }
    const line = String(EDE_COLUMN_HEADER_LINE - 1 + (error.lines ?? 1))
    throw error.code === 'CSV_QUOTE_NOT_CLOSED'
      ? new EdeFormatError('EDE_UNCLOSED_QUOTE', { file: displayName, line })
      // csv-parse counts lines from the header; ours are the file's.
      : new EdeFormatError('EDE_UNREADABLE_ROW', { file: displayName, line, reason: error.message.replace(/ at line \d+.*$/, '') })
  }
  const [head, ...records] = table
  const header = (head?.record ?? []).map((c) => c.toLowerCase())
  const columns = header.map((c) => EDE_COLUMN_MAP[c] ?? null)
  if (!columns.some((c) => c !== null)) {
    const preview = headerLine.slice(0, 120) + (headerLine.length > 120 ? '…' : '')
    throw new EdeFormatError('EDE_BAD_COLUMN_HEADER', { file: displayName, line: String(EDE_COLUMN_HEADER_LINE), content: preview })
  }
  const missing = EDE_REQUIRED_COLUMNS.filter((c) => !columns.includes(c))
  if (missing.length) {
    throw new EdeFormatError('EDE_MISSING_COLUMNS', { file: displayName, columns: missing.map((c) => EDE_COLUMN_SPELLINGS[c][0]).join(', ') })
  }
  const repeated = header.filter((_, i) => columns[i] !== null && columns.indexOf(columns[i]!) !== i)
  if (repeated.length) throw new EdeFormatError('EDE_REPEATED_COLUMNS', { file: displayName, columns: repeated.join(', ') })

  const unknown = header.filter((c, i) => c !== '' && columns[i] === null)
  if (unknown.length) result.warnings.push({ code: 'EDE_UNKNOWN_COLUMNS', params: { columns: unknown.join(', ') } })

  const comments = lines.slice(EDE_COLUMN_HEADER_LINE).filter((l) => l.trim().startsWith('#')).length
  if (comments) result.warnings.push({ code: 'EDE_COMMENT_ROWS', params: { count: String(comments) } })

  const unnamed = new Set<number>()
  const refused = new Map<string, number>()
  for (const { record: cells, info } of records) {
    const line = String(EDE_COLUMN_HEADER_LINE - 1 + info.lines)

    if (cells.slice(header.length).some((c) => c !== '')) {
      result.warnings.push({ code: 'EDE_LONG_ROW', params: { line, found: String(cells.length), expected: String(header.length) } })
    }
    header.forEach((h, idx) => { if (h === '' && cells[idx]) unnamed.add(idx + 1) })

    const raw: Record<string, string> = Object.fromEntries(EDE_FIELDS.map((f) => [f, '']))
    const nan = new Set<string>()
    columns.forEach((field, idx) => {
      if (!field) return
      const value = cells[idx] ?? ''
      // "nan" from exporters that went through a dataframe.
      if (value === 'nan') nan.add(field)
      raw[field] = value === 'nan' ? '' : value
    })

    const row = readRow(raw, line)
    if ('skip' in row) {
      const column = row.skip.params['column'] ?? ''
      result.warnings.push(nan.has(column) ? { code: 'EDE_ROW_NAN', params: row.skip.params } : row.skip)
      continue
    }
    for (const column of Object.keys(row.invalid)) refused.set(column, (refused.get(column) ?? 0) + 1)
    const point = emptyDataPoint()
    point.ede = row.ede
    point.source.invalid = row.invalid
    result.points.push(point)
  }

  if (unnamed.size) result.warnings.push({ code: 'EDE_UNNAMED_COLUMNS', params: { columns: [...unnamed].join(', ') } })
  if (refused.size) {
    const cells = [...refused.values()].reduce((a, b) => a + b, 0)
    result.warnings.push({ code: 'EDE_INVALID_CELLS', params: { count: String(cells), columns: [...refused.keys()].join(', ') } })
  }
  return result
}
