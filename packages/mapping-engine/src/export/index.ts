/** The export formats, as strings or bytes; writing them is the caller's job. */

import { emptyDataPoint, serializeDataPoint, type DataPoint, type SerializedDataPoint } from '../types.js'
import { markDuplicateNames } from '../validate/index.js'

export interface ExportOptions {
  /** Data-point table: only points with a complete BACtwin name. */
  complete: boolean
  /** Replacement table: also write ignore rows. */
  ignore: boolean
}

/** The points the data-point table writes, out of the chosen ones. */
export function narrowForTable(points: DataPoint[], complete: boolean): DataPoint[] {
  return complete ? points.filter((p) => p.state.translation_complete) : points
}

function csvCell(value: string): string {
  // Excel and the partner system both expect RFC 4180 quoting.
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The device object (BACnet object type 8): the controller itself, which carries no time series. */
export const isDeviceObject = (p: DataPoint) => p.ede.object_type === 8

export interface ReplacementRows {
  rows: string[][]
  /** Replace points without a complete name: nothing to replace with. */
  leftOut: number
  devices: number
  /** Ignore points not written. */
  ignored: number
}

/**
 * The replacement table's rows: Key, Command, Replacement, Comment. Device objects are no data points
 * to rename and are left out. replace rows need a complete name; doNotParse rows are always written,
 * ignore rows only with `ignore`; the name is filled only when complete.
 */
export function replacementRows(points: DataPoint[], ignore: boolean): ReplacementRows {
  const rows: string[][] = []
  let leftOut = 0
  let devices = 0
  let ignored = 0
  for (const p of points) {
    const command = p.state.replacement_command
    const name = p.state.translation_complete ? p.bactwin.bactwin_name : ''
    if (isDeviceObject(p)) devices++
    else if (command === 'ignore' && !ignore) ignored++
    else if (command === 'replace' && !name) leftOut++
    else rows.push([p.ede.object_name || '', command, name, p.state.comment || ''])
  }
  return { rows, leftOut, devices, ignored }
}

/** The replacement table the partner system imports, as CSV. */
export function exportReplacementCsv(points: DataPoint[], ignore: boolean): { content: string } & ReplacementRows {
  const result = replacementRows(points, ignore)
  const lines = [['Key', 'Command', 'Replacement', 'Comment'], ...result.rows].map((r) => r.map(csvCell).join(','))
  return { content: lines.join('\r\n') + '\r\n', ...result }
}

/** A table cell: the field's value as it is typed, null when empty. */
export type TableCell = string | number | boolean | null

/** Nested point fields flattened to `area.field` columns. Lists (messages) are left out. */
function flatten(value: Record<string, unknown>, prefix = ''): Record<string, TableCell> {
  const out: Record<string, TableCell> = {}
  for (const [key, val] of Object.entries(value)) {
    const col = `${prefix}${key}`
    if (Array.isArray(val)) continue
    if (val !== null && typeof val === 'object') Object.assign(out, flatten(val as Record<string, unknown>, `${col}.`))
    else out[col] = val === undefined || val === '' ? null : (val as TableCell)
  }
  return out
}

/** The data-point table's columns, taken from an empty point so they never vary with the data. */
export function xlsxColumns(): string[] {
  return Object.keys(flatten(serializeDataPoint(emptyDataPoint())))
}

/** The data-point table (for the XLSX export): one row per selected point, with duplicate marking refreshed first. */
export function datapointsTable(allPoints: DataPoint[], selected: DataPoint[]): { columns: string[]; rows: TableCell[][] } {
  markDuplicateNames(allPoints)
  const columns = xlsxColumns()
  const rows = selected.map((p) => {
    const flat = flatten(serializeDataPoint(p))
    return columns.map((c) => flat[c] ?? null)
  })
  return { columns, rows }
}

/** The data-point table as JSON: one nested object per selected point, values typed, with duplicate marking refreshed first. */
export function datapointsJson(allPoints: DataPoint[], selected: DataPoint[]): string {
  markDuplicateNames(allPoints)
  const points: SerializedDataPoint[] = selected.map(serializeDataPoint)
  return JSON.stringify(points, null, 2) + '\n'
}
