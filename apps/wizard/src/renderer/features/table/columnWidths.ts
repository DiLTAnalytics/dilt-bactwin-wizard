/** Column widths fitted to what the table shows, measured with the fonts the cells use. */

import type { Row } from './columns'

/** The fonts cells write in, as the classes they use. */
const FONT_CLASSES = {
  sans: 'text-xs',
  mono: 'font-mono text-xs',
  monoBold: 'font-mono text-xs font-semibold',
  small: 'font-mono text-2xs',
  header: 'text-xs font-medium',
} as const
export type FitFont = keyof typeof FONT_CLASSES

/** One line of a cell, in pieces of text; `gap` is space before the piece in pixels. */
export type FitLine = { text: string; font: FitFont; gap?: number }[]

/** How a column fits its content. */
export interface ColumnFit {
  /** The lines a cell shows for `row`; the widest decides. */
  lines: (row: Row) => FitLine[]
  max?: number
  /** Takes a share of the space the columns leave free. */
  grow?: boolean
}

const PADDING = 16 + 2
const MIN = 24
const MAX = 240

let context: CanvasRenderingContext2D | null = null
const fonts = new Map<FitFont, string>()

/** The CSS font of `font`, read once from a probe element so it follows the stylesheet. */
function cssFont(font: FitFont): string {
  let css = fonts.get(font)
  if (!css) {
    const probe = document.createElement('span')
    probe.className = FONT_CLASSES[font]
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    document.body.append(probe)
    css = getComputedStyle(probe).font
    probe.remove()
    fonts.set(font, css)
  }
  return css
}

function measure(text: string, font: FitFont): number {
  context ??= document.createElement('canvas').getContext('2d')
  if (!context || !text) return 0
  context.font = cssFont(font)
  return context.measureText(text).width
}

const lineWidth = (line: FitLine) => line.reduce((w, piece) => w + (piece.gap ?? 0) + measure(piece.text, piece.font), 0)

/**
 * Content widths by column id: each fitted column as wide as its header and its widest cell in `rows`,
 * within bounds, and at least `atLeast` (to keep what was fitted before). Columns without a fit keep `size`.
 */
export function fitContent(
  columns: { id: string; size: number; header: string; fit?: ColumnFit }[],
  rows: Row[],
  atLeast: Record<string, number> = {},
): Record<string, number> {
  const content: Record<string, number> = {}
  for (const col of columns) {
    if (!col.fit) {
      content[col.id] = col.size
      continue
    }
    let width = measure(col.header, 'header')
    for (const row of rows) for (const line of col.fit.lines(row)) width = Math.max(width, lineWidth(line))
    content[col.id] = Math.max(atLeast[col.id] ?? 0, Math.min(col.fit.max ?? MAX, Math.max(MIN, Math.ceil(width) + PADDING)))
  }
  return content
}

/** The widths shown: `fixed` (set by hand) over `content`, and the space left to `available` shared by the growing columns not set by hand. */
export function spreadWidths(
  columns: { id: string; fit?: ColumnFit }[],
  content: Record<string, number>,
  fixed: Record<string, number>,
  available: number,
): Record<string, number> {
  const widths: Record<string, number> = {}
  for (const col of columns) widths[col.id] = fixed[col.id] ?? content[col.id] ?? MIN
  const growing = columns.filter((c) => c.fit?.grow && fixed[c.id] === undefined)
  const free = available - columns.reduce((w, c) => w + widths[c.id]!, 0)
  if (free > 0 && growing.length) for (const col of growing) widths[col.id]! += Math.floor(free / growing.length)
  return widths
}
