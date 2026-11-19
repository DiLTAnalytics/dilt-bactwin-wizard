import { Check, Search } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useI18n } from '@/i18n'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'

export interface SearchItem {
  key: string
  label: string
  /** Heading the item is listed under; consecutive items share it. */
  group?: string
  disabled?: boolean
  /** Ticked, e.g. the current value of a select. */
  checked?: boolean
  onSelect: () => void
}

const typed = (e: KeyboardEvent) => e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey

/**
 * The app's menu over a list of items; typing filters it. Field lists all share one width, so every
 * field menu opens alike; `compact` lists (a few short words) are as wide as their trigger instead.
 */
export function SearchMenu({ trigger, items, compact = false }: { trigger: ReactElement; items: SearchItem[]; compact?: boolean }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const menu = useRef<HTMLDivElement | null>(null)
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items

  // The first match takes the focus, so Enter picks it.
  useEffect(() => {
    if (query) menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus()
  }, [query])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    menu.current = e.currentTarget
    // Space picks the focused entry unless a search is under way.
    if (typed(e) && (e.key !== ' ' || query)) {
      e.preventDefault()
      // Filtering would shrink a compact menu to its matches; it keeps its first width instead.
      if (compact && !e.currentTarget.style.width) e.currentTarget.style.width = `${e.currentTarget.offsetWidth}px`
      setQuery((s) => s + e.key)
    } else if (e.key === 'Backspace' && query) {
      e.preventDefault()
      setQuery((s) => s.slice(0, -1))
    }
  }

  return (
    <Menu width={compact ? 'trigger' : 'field'} onKeyDown={onKeyDown} onOpenChange={() => setQuery('')} trigger={trigger}>
      {query && (
        <div className="flex items-center gap-2 px-2 pt-1.5 pb-1 text-xs text-muted">
          <Search size={13} aria-hidden />
          <span className="truncate text-fg">{query}</span>
        </div>
      )}
      {query && shown.length === 0 && <div className="px-2 py-1.5 text-xs text-muted">{t('keySelect.none')}</div>}
      {shown.map((item, i) => (
        <Fragment key={item.key}>
          {item.group && shown[i - 1]?.group !== item.group && (
            <>
              {(i > 0 || query) && <MenuSeparator />}
              <MenuLabel>{item.group}</MenuLabel>
            </>
          )}
          <MenuItem icon={item.checked ? Check : undefined} disabled={item.disabled} onSelect={item.onSelect}>{item.label}</MenuItem>
        </Fragment>
      ))}
    </Menu>
  )
}
