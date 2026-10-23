import * as Popover from '@radix-ui/react-popover'
import { BACTWIN_FIELDS } from '@bactwin/mapping-engine'
import { useStats } from '@/hooks/useStats'
import { useI18n } from '@/i18n'
import { useViewStore, type StatusChip } from '@/stores/viewStore'
import { Tooltip } from '@/ui/Tooltip'

const COUNTED_FIELDS = BACTWIN_FIELDS.filter((f) => f.counted)
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

/** A count that narrows the table to those points when clicked, and shows when it does. */
function CountButton({ chip, label, value, tone }: { chip: StatusChip; label: string; value: string; tone: 'danger' | 'warning' | 'muted' }) {
  const { t } = useI18n()
  const active = useViewStore((s) => s.chips.includes(chip))
  const toggle = useViewStore((s) => s.toggleChip)
  const color = value === '0' ? 'text-muted' : tone === 'danger' ? 'text-danger-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-fg-2'
  return (
    <Tooltip content={t('status.filterHint')}>
      <button type="button" aria-pressed={active} onClick={() => toggle(chip)}
        className={`inline-flex h-5 items-center gap-1 rounded px-1.5 ${active ? 'bg-accent-soft ring-1 ring-accent-line' : 'hover:bg-sunken'}`}>
        <span className="text-muted">{label}</span>
        <span className={`font-semibold tabular-nums ${color}`}>{value}</span>
      </button>
    </Tooltip>
  )
}

/** Totals for the whole project, always visible at the bottom; the counts on the right filter the table. */
export function StatusBar() {
  const { data: s } = useStats()
  const { t, n } = useI18n()
  if (!s) return <footer className="h-7 shrink-0 border-t border-line bg-subtle" />
  if (s.total === 0) {
    return <footer className="flex h-7 shrink-0 items-center border-t border-line bg-subtle px-3 text-xs text-muted">{t('status.empty')}</footer>
  }

  // Ignored points are left out of the progress ratios; main already excludes them from the counts.
  const relevant = s.total - s.ignore
  const complete = pct(s.translation_complete, relevant)
  const fields = pct(s.fields_set, s.fields_total)

  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-line bg-subtle px-3 text-xs text-fg-2">
      <span><span className="text-muted">{t('status.points')}</span> <span className="font-semibold tabular-nums text-fg">{n(s.total)}</span></span>
      <span className="flex items-center gap-2">
        <span className="text-muted">{t('status.complete')}</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
          <span className="block h-full rounded-full bg-success" style={{ width: `${complete}%` }} />
        </span>
        <span className="tabular-nums"><span className="font-semibold text-fg">{complete.toFixed(1)} %</span> <span className="text-muted">({t('status.completeOf', { done: n(s.translation_complete), total: n(relevant) })})</span></span>
      </span>
      <Popover.Root>
        <Popover.Trigger className="rounded px-1 hover:bg-sunken">
          <span className="text-muted">{t('status.fields')}</span> <span className="font-semibold tabular-nums text-fg">{fields.toFixed(1)} %</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="start" sideOffset={6} className="z-50 w-72 rounded-md border border-line bg-surface p-3 text-xs text-fg shadow-lg">
            <p className="mb-2 font-medium text-fg-2">{t('status.fieldsTitle')}</p>
            <ul className="flex flex-col gap-1">
              {COUNTED_FIELDS.map((f) => {
                const value = s.field_fill_pct[f.id] ?? 0
                return (
                  <li key={f.id} className="grid grid-cols-[110px_1fr_44px] items-center gap-2">
                    <span className="truncate font-mono text-fg-2">{f.id}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
                    </span>
                    <span className="text-right tabular-nums text-muted">{value.toFixed(0)} %</span>
                  </li>
                )
              })}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="ml-auto flex items-center gap-1">
        <CountButton chip="errors" label={t('status.errors')} value={n(s.errors)} tone="danger" />
        <CountButton chip="duplicates" label={t('status.duplicates')} value={n(s.duplicated_name)} tone="danger" />
        <CountButton chip="review" label={t('status.review')} value={n(s.reminder)} tone="warning" />
        <CountButton chip="ignored" label={t('status.ignored')} value={n(s.ignore)} tone="muted" />
      </span>
    </footer>
  )
}
