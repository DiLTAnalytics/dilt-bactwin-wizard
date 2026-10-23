/** Writing a table as an XLSX file. */

import type { TableCell } from '@bactwin/mapping-engine'
import writeExcelFile, { type Row } from 'write-excel-file/node'

const MIN_WIDTH = 8
const MAX_WIDTH = 60

/** One sheet: a bold header row that stays in view, each column as wide as its longest value within bounds. */
export async function tableToXlsx(sheet: string, columns: string[], rows: TableCell[][]): Promise<Uint8Array> {
  const widths = columns.map((c) => c.length)
  for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i]!, String(cell ?? '').length) })
  const data: Row[] = [columns.map((value) => ({ value, fontWeight: 'bold' as const })), ...rows]
  const file = writeExcelFile(data, {
    sheet,
    columns: widths.map((w) => ({ width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + 2)) })),
    stickyRowsCount: 1,
  })
  return new Uint8Array(await file.toBuffer())
}
