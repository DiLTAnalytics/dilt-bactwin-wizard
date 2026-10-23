import { CircleAlert, Copy, EyeOff, Flag, Layers } from 'lucide-react'
import type { DataPoint } from '@bactwin/mapping-engine'
import { useI18n } from '@/i18n'
import { fieldLabel } from '@/lib/fieldLabel'
import { byLevel, messageText } from '@/lib/messages'
import { MARK_CLASSES, markSegments, type Mark } from '@/lib/highlight'
import { Tooltip } from '@/ui/Tooltip'

/**
 * Computed status as a coloured bar (error, complete, in progress, empty), the hand-set flags as icons
 * beside it. Clicking the duplicate icon lists every point with that name.
 */
export function StatusCell({ point, onDuplicateClick }: { point: DataPoint; onDuplicateClick: (name: string) => void }) {
  const { t } = useI18n()
  const m = point.state
  const error = m.messages.some((msg) => msg.level === 'error')
  const [bar, label] = error ? ['bg-danger', t('table.status.error')]
    : m.duplicated_name ? ['bg-danger', t('common.duplicateName')]
    : m.translation_complete ? ['bg-success', t('table.status.complete')]
    : point.bactwin.gewerk || point.bactwin.anlage ? ['bg-warning', t('table.status.inProgress')]
    : ['bg-transparent', t('table.status.empty')]

  // Cut, so the tooltip stays readable.
  const messages = byLevel(m.messages).map((msg) => messageText(msg, t))
  const errorText = (
    <div className="space-y-0.5">
      {messages.slice(0, 3).map((text, i) => <p key={i}>{text}</p>)}
      {messages.length > 3 && <p className="opacity-70">{t('table.status.more', { count: messages.length - 3 })}</p>}
    </div>
  )

  return (
    <span className="flex items-center gap-1">
      <Tooltip content={label}><span className={`h-5 w-1 shrink-0 rounded-full ${bar}`} aria-label={label} /></Tooltip>
      {error && (
        <Tooltip content={errorText} side="right">
          <span className="shrink-0 text-danger-fg" aria-label={messages.join(' ')}><CircleAlert size={14} aria-hidden /></span>
        </Tooltip>
      )}
      {m.duplicated_name && (
        <Tooltip content={t('table.status.duplicateHint')}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicateClick(point.bactwin.bactwin_name) }}
            className="shrink-0 rounded text-danger-fg hover:bg-danger-soft"
            aria-label={t('table.status.duplicateHint')}
          >
            <Copy size={14} aria-hidden />
          </button>
        </Tooltip>
      )}
      {m.ignore && <EyeOff size={14} className="shrink-0 text-muted" aria-label={fieldLabel('state.ignore', t)} />}
      {m.reminder && <Flag size={14} className="shrink-0 text-warning-fg" aria-label={fieldLabel('state.reminder', t)} />}
    </span>
  )
}

const Empty = () => <span className="text-xs text-faint">–</span>

/** A written value, and the one it replaces when a preview shows a change. */
/** Other steps changing the same cell: who wrote the value and whose it replaced, or for a step preview whose it replaces and who replaces it. */
export interface CellCollision {
  /** The step whose value the cell holds; null in a step preview, where it is the open step. */
  writer: number | null
  overwrites: number[]
  overwrittenBy: number | null
}

function CollisionMark({ collision }: { collision: CellCollision }) {
  const { t } = useI18n()
  const steps = (list: number[]) => list.map((s) => s + 1).join(', ')
  const lines = collision.writer !== null
    ? [t('table.cellOverwrites', { step: collision.writer + 1, others: steps(collision.overwrites) })]
    : [
        ...(collision.overwrites.length ? [t('table.previewOverwrites', { step: steps(collision.overwrites) })] : []),
        ...(collision.overwrittenBy !== null ? [t('table.previewOverwrittenBy', { step: collision.overwrittenBy + 1 })] : []),
      ]
  return (
    <Tooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>}>
      <Layers size={11} aria-label={lines.join('; ')} className={`ml-1 inline shrink-0 align-[-1px] ${collision.overwrittenBy !== null ? 'text-warning-fg' : 'text-muted'}`} />
    </Tooltip>
  )
}

export function ValueCell({ value, before, collision, mono = true }: { value: unknown; before?: unknown; collision?: CellCollision; mono?: boolean }) {
  const text = value === null || value === undefined ? '' : String(value)
  const changed = before !== undefined
  const old = before === null || before === undefined || before === '' ? '–' : String(before)
  return (
    <span className={`whitespace-nowrap text-xs ${mono ? 'font-mono' : ''}`}>
      {text ? <span className={changed ? 'font-semibold text-fg' : 'text-fg-2'}>{text}</span> : changed ? <span className="font-semibold">–</span> : <Empty />}
      {changed && <span className="ml-1.5 text-2xs text-muted line-through">{old}</span>}
      {collision && <CollisionMark collision={collision} />}
    </span>
  )
}

export function CommentCell({ point }: { point: DataPoint }) {
  const comment = point.state.comment
  if (!comment) return <Empty />
  return <Tooltip content={comment}><span className="block truncate text-xs text-fg-2">{comment}</span></Tooltip>
}

/** A short value, or a dash when empty. */
export function TextCell({ value, mono = false }: { value: string | number | null; mono?: boolean }) {
  return value !== null && value !== ''
    ? <span className={`whitespace-nowrap text-xs text-fg-2 ${mono ? 'font-mono' : ''}`}>{value}</span>
    : <Empty />
}

/** Text with what each of the step's conditions matched marked in that condition's colour. */
export function Highlighted({ text, marks }: { text: string; marks: Mark[] }) {
  if (!marks.length || !text) return <>{text}</>
  return (
    <>
      {markSegments(text, marks).map((s, i) => s.color === null
        ? s.text
        : <mark key={i} className={`rounded-sm text-inherit ring-1 ${MARK_CLASSES[s.color]}`}>{s.text}</mark>)}
    </>
  )
}
