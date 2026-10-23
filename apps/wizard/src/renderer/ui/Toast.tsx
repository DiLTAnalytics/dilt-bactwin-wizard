/** Short results of an action ("8 gesetzt"), shown bottom right and gone after a few seconds. */

import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react'
import { create } from 'zustand'

export type ToastTone = 'success' | 'info' | 'warning' | 'error'

/** A button in the toast; using it also dismisses the toast. */
export interface ToastAction {
  label: string
  run: () => void
}

interface ToastItem {
  id: number
  text: string
  tone: ToastTone
  action?: ToastAction
}

interface ToastStore {
  items: ToastItem[]
  push: (text: string, tone: ToastTone, action?: ToastAction) => void
  dismiss: (id: number) => void
}

const DURATION_MS = 5000
// Errors stay until dismissed; they may need reading twice.
const STICKY: ToastTone[] = ['error']

let nextId = 0

const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  push: (text, tone, action) => {
    const id = nextId++
    set({ items: [...get().items, { id, text, tone, ...(action ? { action } : {}) }].slice(-4) })
    if (!STICKY.includes(tone)) setTimeout(() => get().dismiss(id), DURATION_MS)
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}))

export const toast = (text: string, tone: ToastTone = 'success', action?: ToastAction) => useToastStore.getState().push(text, tone, action)

const ICONS = {
  success: { Icon: CircleCheck, className: 'text-success-fg' },
  info: { Icon: Info, className: 'text-accent-fg' },
  warning: { Icon: TriangleAlert, className: 'text-warning-fg' },
  error: { Icon: CircleX, className: 'text-danger-fg' },
} satisfies Record<ToastTone, unknown>

/** Mounted once at the root. */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  const { items, dismiss } = useToastStore()
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-10 z-[90] flex w-[360px] flex-col gap-2">
      {items.map(({ id, text, tone, action }) => {
        const { Icon, className } = ICONS[tone]
        return (
          <div key={id} className="pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-fg shadow-lg">
            <Icon size={16} className={`mt-0.5 shrink-0 ${className}`} aria-hidden />
            <span className="flex-1 whitespace-pre-line">{text}</span>
            {action && (
              <button type="button" onClick={() => { dismiss(id); action.run() }}
                className="shrink-0 rounded px-1.5 text-sm font-medium text-accent-fg hover:bg-accent-soft">{action.label}</button>
            )}
            <button type="button" aria-label={closeLabel} onClick={() => dismiss(id)} className="text-muted hover:text-fg">
              <X size={14} aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
