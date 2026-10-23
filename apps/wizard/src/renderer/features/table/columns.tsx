import { columnSizingFeature, tableFeatures, type ColumnDef } from '@tanstack/react-table'
import { BACNET_FIELDS, BACTWIN_FIELDS, EDE_FIELDS, buildNameParts, fieldAbbr, fieldName, type DataPoint, type FilterRule, type NameTemplate } from '@bactwin/mapping-engine'
import { BACtwinName } from '@/ui/BACtwinName'
import { fieldLabel } from '@/lib/fieldLabel'
import { CommentCell, Highlighted, StatusCell, TextCell, ValueCell, type CellCollision } from './cells'
import type { Mark } from '@/lib/highlight'
import type { ColumnFit, FitLine } from './columnWidths'

export type ColumnGroup = 'ede' | 'bacnet' | 'bactwin' | 'description' | 'state'

/** A table row: a point, and for a step preview what the step changes and which conditions hold. */
export interface Row {
  point: DataPoint
  /** Values the step changes, as they were before it. */
  before?: Record<string, unknown>
  beforeName?: string | null
  conditions?: boolean[]
  /** Per field, the other steps changing that cell. */
  collisions?: Record<string, CellCollision>
}

/** EDE and BACnet column widths; object-name and description share the first column. */
const COLUMN_SIZE: Record<Exclude<keyof typeof EDE_FIELDS, 'object_name' | 'description'> | keyof typeof BACNET_FIELDS, number> = {
  device_obj_instance: 75, object_type: 64, object_instance: 84, unit_code: 70, type: 56, unit: 70,
}

const BACTWIN_COLUMNS = BACTWIN_FIELDS.map((f) => ({
  id: f.id,
  size: f.kind === 'free' ? 110 : f.kind === 'key' ? 60 : f.indexOf ? 36 : 44,
}))

/** Only column widths; columns are shown or hidden by building them, and paging is server-side. */
export const features = tableFeatures({ columnSizingFeature })
type TableFeatureSet = typeof features
/** Columns sharing a group get one cell in the group header row; 'when' holds the step's conditions. */
export type HeaderGroup = 'ede' | 'bacnet' | 'bactwin' | 'when'
export interface ColumnMeta {
  written?: boolean
  group?: HeaderGroup
  /** Full field name, as the header's tooltip. */
  title?: string
  /** How the column's width follows its content; without it, its size stays. */
  fit?: ColumnFit
  /** The field clicking the header orders the table by, as area.field. */
  sortField?: string
}
type Column = ColumnDef<TableFeatureSet, Row> & { meta?: ColumnMeta }

/** Header and group of the column showing `field`. */
const fromRegistry = (field: `${Exclude<HeaderGroup, 'when'>}.${string}`) =>
  ({ header: fieldAbbr(field), meta: { group: field.slice(0, field.indexOf('.')) as HeaderGroup, title: fieldName(field) } })

const read = (p: DataPoint, field: string) => {
  const [a, f] = field.split('.') as [string, string]
  return (p as unknown as Record<string, Record<string, unknown>>)[a]?.[f]
}

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : String(v))
/** A ValueCell's line: the value, the one it replaces when the preview changes it, and room for a collision mark. */
const valueLine = (value: unknown, before: unknown, font: 'mono' | 'sans' = 'mono', marked = false): FitLine => [
  { text: shown(value), font: before === undefined ? font : 'monoBold' },
  ...(before === undefined ? [] : [{ text: shown(before), font: 'small' as const, gap: 6 }]),
  ...(marked ? [{ text: '', font: 'small' as const, gap: 15 }] : []),
]
const nameText = (template: NameTemplate, row: Row, label?: (block: string, key: string) => string) =>
  buildNameParts(template, row.point.bactwin, label).map((seg) => seg.parts.map((p) => p.text).join('')).join(template.separator ?? '_')

export function buildColumns({ show, template, label, t, onDuplicateClick, written, onlyWritten, conditions, highlight }: {
  show: Record<ColumnGroup, boolean>
  template: NameTemplate
  /** A key's label, for the description column. */
  label: (block: string, key: string) => string
  t: (key: string) => string
  onDuplicateClick: (name: string) => void
  /** Fields the open step writes, as bactwin.x; their columns are marked. */
  written: Set<string>
  /** Show only the name, the written fields and the conditions. */
  onlyWritten: boolean
  /** The open step's conditions, for a column each (near misses). */
  conditions: FilterRule[] | null
  /** Marks what this regex matches in the object name. */
  /** What the open step's conditions match, by field. */
  highlight: Mark[]
}): Column[] {
  const cols: Column[] = [
    { id: 'status', header: '', size: 64, cell: ({ row }) => <StatusCell point={row.original.point} onDuplicateClick={onDuplicateClick} /> },
  ]
  cols.push({
    id: 'object_name', header: `${fieldAbbr('ede.object_name')} / ${fieldAbbr('ede.description')}`, size: 240,
    meta: {
      group: 'ede', title: `${fieldName('ede.object_name')} / ${fieldName('ede.description')}`, sortField: 'ede.object_name',
      fit: { max: 300, grow: true, lines: (row) => [[{ text: row.point.ede.object_name, font: 'monoBold' }], [{ text: row.point.ede.description, font: 'sans' }]] },
    },
    cell: ({ row }) => (
      <div>
        <div className="truncate font-mono text-xs font-medium text-fg"><Highlighted text={row.original.point.ede.object_name} marks={highlight.filter((m) => m.field === 'ede.object_name')} /></div>
        <div className="truncate text-xs text-muted"><Highlighted text={row.original.point.ede.description} marks={highlight.filter((m) => m.field === 'ede.description')} /></div>
      </div>
    ),
  })
  conditions?.forEach((rule, c) => {
    const field = fieldName(rule.field)
    cols.push({
      id: `cond_${c}`, header: `${rule.negated ? '¬ ' : ''}${field} ${rule.operator} ${rule.value ?? ''}`.trim(), size: 150,
      meta: { group: 'when', sortField: rule.field, fit: { lines: (row) => [[{ text: '✓', font: 'monoBold' }, { text: shown(read(row.point, rule.field)), font: 'mono', gap: 6 }]] } },
      cell: ({ row }) => {
        const ok = row.original.conditions?.[c]
        const value = read(row.original.point, rule.field)
        return (
          <span className="flex items-center gap-1.5 text-xs">
            <span className={ok ? 'font-semibold text-success-fg' : 'font-semibold text-danger-fg'}>{ok ? '✓' : '✗'}</span>
            <span className="truncate font-mono text-fg-2">{value === null || value === undefined || value === '' ? '–' : String(value)}</span>
          </span>
        )
      },
    })
  })
  if (show.ede && !onlyWritten) {
    for (const id of Object.keys(EDE_FIELDS) as (keyof typeof EDE_FIELDS)[]) {
      if (id === 'object_name' || id === 'description') continue
      const { header, meta } = fromRegistry(`ede.${id}`)
      cols.push({
        id, header, size: COLUMN_SIZE[id], meta: { ...meta, sortField: `ede.${id}`, fit: { lines: (row) => [[{ text: shown(row.point.ede[id]), font: 'mono' }]] } },
        cell: ({ row }) => <TextCell value={row.original.point.ede[id]} mono />,
      })
    }
  }
  if (show.bacnet && !onlyWritten) {
    for (const id of Object.keys(BACNET_FIELDS) as (keyof typeof BACNET_FIELDS)[]) {
      const { header, meta } = fromRegistry(`bacnet.${id}`)
      cols.push({
        id: `bacnet_${id}`, header, size: COLUMN_SIZE[id], meta: { ...meta, sortField: `bacnet.${id}`, fit: { max: 120, lines: (row) => [[{ text: shown(row.point.bacnet[id]), font: 'sans' }]] } },
        cell: ({ row }) => <TextCell value={row.original.point.bacnet[id]} />,
      })
    }
  }
  for (const { id, size } of BACTWIN_COLUMNS) {
    const field = `bactwin.${id}` as const
    const isWritten = written.has(field)
    if (onlyWritten ? !isWritten : !show.bactwin && !isWritten) continue
    const { header, meta } = fromRegistry(field)
    cols.push({
      id: `bt_${id}`, header, size: isWritten ? Math.max(size, 96) : size,
      meta: { ...meta, written: isWritten, sortField: field, fit: { lines: (row) => [valueLine(row.point.bactwin[id], row.before?.[field], 'mono', !!row.collisions?.[field])] } },
      cell: ({ row }) => <ValueCell value={row.original.point.bactwin[id]} before={row.original.before?.[field]} collision={row.original.collisions?.[field]} />,
    })
  }
  for (const flag of ['state.ignore', 'state.reminder', 'state.comment'] as const) {
    if (!written.has(flag)) continue
    cols.push({
      id: flag, header: fieldLabel(flag, t), size: 110,
      meta: { written: true, sortField: flag, fit: { lines: (row) => [valueLine(read(row.point, flag) === true ? '✓' : read(row.point, flag), row.before?.[flag], 'sans', !!row.collisions?.[flag])] } },
      cell: ({ row }) => <ValueCell value={read(row.original.point, flag) === true ? '✓' : read(row.original.point, flag) === false ? '' : read(row.original.point, flag)}
        before={row.original.before?.[flag] === undefined ? undefined : row.original.before[flag] === true ? '✓' : row.original.before[flag] || '–'}
        collision={row.original.collisions?.[flag]} mono={false} />,
    })
  }
  const name: Column = {
    id: 'bt_bactwin_name', header: fieldAbbr('bactwin.bactwin_name'), size: 300,
    meta: {
      group: 'bactwin', title: fieldName('bactwin.bactwin_name'), sortField: 'bactwin.bactwin_name',
      fit: { max: 480, grow: true, lines: (row) => [[{ text: nameText(template, row), font: 'mono' }], ...(row.beforeName ? [[{ text: row.beforeName, font: 'small' as const }]] : [])] },
    },
    cell: ({ row }) => (
      <div>
        {row.original.beforeName && <div className="truncate font-mono text-2xs text-muted line-through">{row.original.beforeName}</div>}
        <BACtwinName bt={row.original.point.bactwin} template={template} />
      </div>
    ),
  }
  if (show.description && !onlyWritten) {
    cols.push({
      id: 'bt_bactwin_description', header: fieldAbbr('bactwin.bactwin_description'), size: 480,
      meta: { group: 'bactwin', title: fieldName('bactwin.bactwin_description'), sortField: 'bactwin.bactwin_description', fit: { max: 640, lines: (row) => [[{ text: nameText(template, row, label), font: 'mono' }]] } },
      cell: ({ row }) => <BACtwinName bt={row.original.point.bactwin} template={template} label={label} />,
    })
  }
  if (show.state && !onlyWritten && !written.has('state.comment')) {
    cols.push({
      id: 'state_comment', header: fieldLabel('state.comment', t), size: 220, meta: { sortField: 'state.comment', fit: { max: 320, lines: (row) => [[{ text: row.point.state.comment, font: 'sans' }]] } },
      cell: ({ row }) => <CommentCell point={row.original.point} />,
    })
  }
  cols.push(name)
  return cols
}
