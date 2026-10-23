/** Modal dialogs: focus trap, Escape, scroll lock and ARIA come from Radix. */

import * as RD from '@radix-ui/react-dialog'
import { CircleX, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'

export type DialogTone = 'info' | 'warning' | 'error'

const TONE_ICONS = {
  info: { Icon: Info, className: 'text-accent-fg' },
  warning: { Icon: TriangleAlert, className: 'text-warning-fg' },
  error: { Icon: CircleX, className: 'text-danger-fg' },
} satisfies Record<DialogTone, unknown>

export function ToneIcon({ tone, size = 20 }: { tone: DialogTone; size?: number }) {
  const { Icon, className } = TONE_ICONS[tone]
  return <Icon size={size} className={`shrink-0 ${className}`} aria-hidden />
}

export function Dialog({ open, onClose, title, subtitle, tone, width = 'w-[520px]', closeLabel, dismissable = true, footer, children }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  tone?: DialogTone
  /** Width class; the height is capped to the window and the body scrolls. */
  width?: string
  closeLabel: string
  /** False for dialogs holding unsaved input: a click beside the dialog does not close it. */
  dismissable?: boolean
  /** Buttons, right-aligned below the body. */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <RD.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <RD.Content
          aria-describedby={undefined}
          onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault() }}
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface text-fg shadow-xl ${width}`}
        >
          <div className="flex items-start gap-2.5 px-5 pt-4 pb-3">
            {tone && <ToneIcon tone={tone} />}
            <div className="min-w-0 flex-1">
              <RD.Title className="text-base font-semibold text-fg">{title}</RD.Title>
              {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
            </div>
            <RD.Close aria-label={closeLabel} className="-mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-subtle hover:text-fg">
              <X size={16} aria-hidden />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
