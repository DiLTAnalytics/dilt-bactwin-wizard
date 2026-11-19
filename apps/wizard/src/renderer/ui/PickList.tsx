import { ChevronDown } from 'lucide-react'
import { SearchMenu } from './SearchMenu'

export interface PickOption<T extends string> {
  value: T
  label: string
  /** Heading the option is listed under; consecutive options share it. */
  group?: string
  disabled?: boolean
}

/** A select in place of a native one: the app's menu, with the current value ticked and filtered by typing. */
export function PickList<T extends string>({ value, options, onChange, label, compact = false, className = '' }: {
  value: T
  options: PickOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the control. */
  label: string
  /** A few short words, e.g. operators: the menu is as wide as the control. */
  compact?: boolean
  className?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <SearchMenu compact={compact} items={options.map((o) => ({ key: o.value, label: o.label, group: o.group, disabled: o.disabled, checked: o.value === value, onSelect: () => onChange(o.value) }))} trigger={
      <button
        type="button"
        role="combobox"
        aria-label={label}
        className={`inline-flex h-7 min-w-0 items-center gap-1 rounded border border-line bg-surface px-2 text-left text-xs text-fg hover:border-line-strong ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
    } />
  )
}
