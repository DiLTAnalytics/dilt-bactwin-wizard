/** Form controls: native elements with the shared look. `invalid` marks a value that needs fixing. */

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const CONTROL = 'rounded border bg-surface text-fg disabled:opacity-50 disabled:cursor-not-allowed'
const tone = (invalid?: boolean) => (invalid ? 'border-danger-line bg-danger-soft' : 'border-line hover:border-line-strong')
const HEIGHT = { sm: 'h-7 text-xs', md: 'h-8 text-sm' }

type Size = keyof typeof HEIGHT

export function Input({ invalid, size = 'md', className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { invalid?: boolean; size?: Size }) {
  return <input aria-invalid={invalid || undefined} className={`${CONTROL} ${tone(invalid)} ${HEIGHT[size]} px-2 ${className}`} {...rest} />
}

export function Textarea({ invalid, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={`${CONTROL} ${tone(invalid)} px-2 py-1 text-sm ${className}`} {...rest} />
}

export function Select({ invalid, size = 'md', className = '', children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { invalid?: boolean; size?: Size }) {
  return (
    <select aria-invalid={invalid || undefined} className={`${CONTROL} ${tone(invalid)} ${HEIGHT[size]} pl-2 pr-1 ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({ label, className = '', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm text-fg-2 select-none ${rest.disabled ? 'opacity-50' : 'cursor-pointer'} ${className}`}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-accent" {...rest} />
      {label}
    </label>
  )
}

/** A label above a control, with optional help text under it. */
export function FormField({ label, help, htmlFor, children }: { label: ReactNode; help?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-fg-2">{label}</label>
      {children}
      {help && <p className="text-xs text-muted">{help}</p>}
    </div>
  )
}

/** A titled group of settings, explained under its title. */
export function Section({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}
