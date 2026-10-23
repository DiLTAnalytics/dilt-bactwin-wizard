import { LoaderCircle, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'chrome'
export type ButtonSize = 'sm' | 'md'

const BASE = 'inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap select-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-solid hover:enabled:bg-accent-hover',
  secondary: 'bg-surface text-fg-2 border border-line hover:enabled:bg-subtle hover:enabled:border-line-strong',
  ghost: 'text-fg-2 hover:enabled:bg-subtle hover:enabled:text-fg',
  // Outlined: destructive actions should not be the loudest thing on screen.
  danger: 'bg-surface text-danger-fg border border-line hover:enabled:bg-danger-soft hover:enabled:border-danger-line',
  /** On the dark toolbar. */
  chrome: 'text-chrome-fg hover:enabled:bg-chrome-line data-[state=open]:bg-chrome-line',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16 }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  /** Shows a spinner and blocks further clicks while an action runs. */
  busy?: boolean
  children?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, busy = false, disabled, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...rest}>
      {busy ? <LoaderCircle size={ICON_SIZE[size]} className="animate-spin" aria-hidden /> : Icon && <Icon size={ICON_SIZE[size]} aria-hidden />}
      {children}
    </button>
  )
}

export type IconTone = 'default' | 'accent' | 'success' | 'danger' | 'chrome'

const ICON_TONES: Record<IconTone, string> = {
  default: 'text-muted hover:enabled:text-fg hover:enabled:bg-subtle',
  accent: 'text-accent-fg hover:enabled:bg-accent-soft',
  success: 'text-success-fg hover:enabled:bg-success-soft',
  danger: 'text-muted hover:enabled:text-danger-fg hover:enabled:bg-danger-soft',
  chrome: 'text-chrome-fg hover:enabled:bg-chrome-line',
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon
  /** Required: the accessible name and the tooltip. */
  label: string
  tone?: IconTone
  size?: ButtonSize
}

/** A button that is only an icon; `label` names it for screen readers and shows as its tooltip. */
export function IconButton({ icon: Icon, label, tone = 'default', size = 'md', className = '', type = 'button', ...rest }: IconButtonProps) {
  const box = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  return (
    <Tooltip content={label}>
      <button
        type={type}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${box} ${ICON_TONES[tone]} ${className}`}
        {...rest}
      >
        <Icon size={ICON_SIZE[size]} aria-hidden />
      </button>
    </Tooltip>
  )
}
