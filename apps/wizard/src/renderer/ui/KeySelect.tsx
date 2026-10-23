import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { NOT_PRESENT_MARKER, fieldName, isStructuralMarker } from '@bactwin/mapping-engine'
import { useI18n } from '@/i18n'
import type { CombinationMode } from '@/stores/stepStore'
import { labelOf, useProjectStore } from '@/stores/projectStore'

interface Item {
  /** null: nothing chosen. */
  value: string | null
  label: string
  group: 'main' | 'some' | 'outside'
}

/**
 * Library keys for one BACtwin field, searchable by key and label. "###" is added in trade-specific
 * mode, where "segment not present" is always plausible. A current value that is not offered stays
 * visible, marked as outside the combinations (the markers excepted, which are always valid).
 */
export function KeySelect({ block, value, onChange, valid, someOnly = [], mode, placeholder, markOutside, invalid: flagged = false, disabled, className = '' }: {
  block: string
  /** null = nothing chosen; only meaningful together with `placeholder`. */
  value: string | null
  onChange: (value: string | null) => void
  /** Valid for the whole selection. */
  valid: string[]
  /** Valid for part of it, offered separately. */
  someOnly?: string[]
  mode: CombinationMode
  /** Text of the "nothing chosen" entry, given the number of keys offered; without it there is none. */
  placeholder?: (offered: number) => string
  /** Mark the control as needing a fix, whatever the combinations say. */
  invalid?: boolean
  /** Highlight the control when the value is outside the combinations. */
  markOutside?: boolean
  disabled?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const { labels } = useProjectStore()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const all = mode === 'gewerk_specific' && !valid.includes(NOT_PRESENT_MARKER) ? [...valid, NOT_PRESENT_MARKER].sort() : valid
  const some = someOnly.filter((v) => !all.includes(v))
  /** The current value when the lists do not offer it. */
  const outside = value && !all.includes(value) && !some.includes(value) ? value : null

  const label = (key: string) => {
    if (isStructuralMarker(key)) return `${key} – ${t('common.notPresent')}`
    const name = labelOf(labels, block, key)
    return name ? `${key} [${name}]` : key
  }

  const items: Item[] = useMemo(() => [
    ...(placeholder ? [{ value: null, label: placeholder(all.length + some.length), group: 'main' as const }] : []),
    { value: '', label: t('common.empty'), group: 'main' as const },
    ...all.map((v) => ({ value: v, label: label(v), group: 'main' as const })),
    ...some.map((v) => ({ value: v, label: label(v), group: 'some' as const })),
    ...(outside ? [{ value: outside, label: label(outside), group: 'outside' as const }] : []),
  ], [placeholder, all, some, outside, labels, block, t])  // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => i.value !== null && i.label.toLowerCase().includes(q)) : items
  const current = items.find((i) => i.value === value) ?? items[0]!
  const invalid = flagged || (markOutside && outside && !isStructuralMarker(outside))

  function choose(item: Item | undefined) {
    if (!item) return
    onChange(item.value)
    setOpen(false)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]) }
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); setQuery(''); setActive(0) }}>
      <Popover.Trigger
        disabled={disabled}
        role="combobox"
        aria-label={fieldName(block)}
        aria-expanded={open}
        aria-controls={listId}
        className={`inline-flex h-7 min-w-0 items-center gap-1 rounded border px-2 text-left text-xs disabled:opacity-50 ${invalid ? 'border-danger-line bg-danger-soft text-danger-fg' : 'border-line bg-surface text-fg hover:border-line-strong'} ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${current.value === null || current.value === '' ? 'text-muted' : ''}`}>
          {current.value === null ? current.label : current.value === '' ? `– ${current.label} –` : current.label}
          {current.group === 'outside' && !isStructuralMarker(current.value!) ? ` (${t('keySelect.outside')})` : ''}
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} collisionPadding={8}
          className="z-50 flex max-h-80 w-[max(var(--radix-popover-trigger-width),280px)] flex-col rounded-md border border-line bg-surface p-1 text-xs text-fg shadow-lg">
          <input
            autoFocus
            className="mb-1 h-7 rounded border border-line bg-surface px-2 text-xs outline-none focus:border-accent"
            placeholder={t('keySelect.search')}
            aria-label={t('keySelect.search')}
            aria-controls={listId}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onKey}
          />
          <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 && <li className="px-2 py-1.5 text-muted">{t('keySelect.none')}</li>}
            {shown.map((item, i) => {
              const header = item.group !== 'main' && shown[i - 1]?.group !== item.group
              return (
                <li key={`${item.group}:${item.value ?? 'unset'}`} role="presentation">
                  {header && <div className="px-2 pt-1.5 pb-0.5 text-2xs font-medium text-muted">{t(item.group === 'some' ? 'keySelect.someOnly' : 'keySelect.outside')}</div>}
                  <div
                    role="option"
                    aria-selected={item.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={`cursor-pointer truncate rounded px-2 py-1 ${i === active ? 'bg-subtle' : ''} ${item.value === value ? 'font-semibold' : ''} ${item.value === null || item.value === '' ? 'text-muted' : ''}`}
                  >
                    {item.value === '' ? `– ${item.label} –` : item.label}
                  </div>
                </li>
              )
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
