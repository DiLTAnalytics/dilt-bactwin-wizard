import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  hint?: string
}

/** One choice out of a few, all visible. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md' }: {
  options: Segment<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group. */
  label: string
  size?: 'sm' | 'md'
}) {
  const height = size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm'
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-line bg-subtle p-0.5">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <Tooltip key={o.value} content={o.hint}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`${height} rounded-sm px-2.5 transition-colors ${selected ? 'bg-surface text-fg font-medium shadow-xs' : 'text-muted hover:text-fg'}`}
            >
              {o.label}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
