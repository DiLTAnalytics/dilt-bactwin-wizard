import type { ComponentProps } from 'react'

/** An on/off switch; it never passes the click on, so it can sit inside a clickable row. Takes a tooltip's props and ref. */
export function Switch({ on, onChange, label, className = '', onClick, ...rest }: Omit<ComponentProps<'button'>, 'onChange'> & { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      {...rest}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); onChange(!on) }}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-accent' : 'bg-line-strong'} ${className}`}
    >
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-[left] ${on ? 'left-3.5' : 'left-0.5'}`} />
    </button>
  )
}
