/** The export formats, as strings or bytes; writing them is the caller's job. */

import { applyFilter, type FilterDsl } from '../filter/index.js'
import { emptyDataPoint, serializeDataPoint, type DataPoint, type SerializedDataPoint } from '../types.js'
import { markDuplicateNames } from '../validate/index.js'

export type ExportScope = 'all' | 'filtered' | 'complete'

export function selectForExport(points: DataPoint[], scope: ExportScope, filter: FilterDsl): DataPoint[] {
  if (scope === 'filtered') return applyFilter(points, filter)
  if (scope === 'complete') return points.filter((p) => p.state.translation_complete)
  return points
}

function csvCell(value: string): string {
  // Excel and the partner system both expect RFC 4180 quoting.
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The device object (BACnet object type 8): the controller itself, which carries no time series. */
export const isDeviceObject = (p: DataPoint) => p.ede.object_type === 8

/**
 * The replacement table the partner system imports to rename points. `Command` is always "replace".
 * Points without a BACtwin name have nothing to replace with, and device objects are no data
 * points to rename; both are left out and counted.
 */
export function exportReplacementCsv(points: DataPoint[]): { content: string; leftOut: number; devices: number } {
  const lines = [['Key', 'Command', 'Replacement', 'Comment'].join(',')]
  let leftOut = 0
  let devices = 0
  for (const p of points) {
    if (isDeviceObject(p)) {
      devices++
      continue
    }
    if (!p.bactwin.bactwin_name) {
      leftOut++
      continue
    }
    lines.push([p.ede.object_name || '', 'replace', p.bactwin.bactwin_name, p.state.comment || ''].map(csvCell).join(','))
  }
  return { content: lines.join('\r\n') + '\r\n', leftOut, devices }
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
