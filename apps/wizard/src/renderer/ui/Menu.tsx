/** Dropdown menus with keyboard navigation, Escape and outside-click handled by Radix. */

import * as DM from '@radix-ui/react-dropdown-menu'
import { Check, type LucideIcon } from 'lucide-react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'

const WIDTH = {
  menu: 'min-w-[220px]',
  /** At least as wide as the trigger, wider for a longer item. */
  trigger: 'min-w-[var(--radix-dropdown-menu-trigger-width)]',
  /** One width for every list of fields, so they all open alike; longer labels are cut. */
  field: 'w-60',
}

/** A visible scrollbar takes from the fixed width; the menu grows by it instead. Overlay scrollbars take none. */
function roomForScrollbar(el: HTMLDivElement | null) {
  if (!el || el.style.width) return
  requestAnimationFrame(() => {
    const css = getComputedStyle(el)
    const bar = el.offsetWidth - el.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
    if (bar > 0) el.style.width = `${el.offsetWidth + bar}px`
  })
}

/** Opens from its trigger; `open` and `onOpenChange` also let something else open it. */
export function Menu({ trigger, align = 'start', open, onOpenChange, width = 'menu', onKeyDown, children }: {
  trigger: ReactElement
  align?: 'start' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  width?: keyof typeof WIDTH
  /** Runs before the menu's own keys; preventDefault keeps the menu from handling the key. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  return (
    <DM.Root open={open} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={onKeyDown}
          ref={width === 'field' ? roomForScrollbar : undefined}
          className={`z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] ${WIDTH[width]} overflow-y-auto rounded-md border border-line bg-surface p-1 text-sm text-fg shadow-lg`}
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

/** A menu opened at a point, e.g. by a right click; `at` null closes it. */
export function AnchoredMenu({ at, onClose, children }: { at: { x: number; y: number } | null; onClose: () => void; children: ReactNode }) {
  return (
    <DM.Root open={at !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DM.Trigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: at?.x ?? 0, top: at?.y ?? 0, width: 0, height: 0 }} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" collisionPadding={8} className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[220px] overflow-y-auto rounded-md border border-line bg-surface p-1 text-sm text-fg shadow-lg">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

const ITEM = 'flex items-center gap-2 rounded px-2 py-1.5 outline-none cursor-pointer select-none data-[highlighted]:bg-subtle data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed'

export function MenuItem({ icon: Icon, onSelect, disabled, hint, children }: { icon?: LucideIcon; onSelect: () => void; disabled?: boolean; hint?: string; children: ReactNode }) {
  return (
    <DM.Item className={ITEM} onSelect={onSelect} disabled={disabled}>
      {Icon ? <Icon size={15} className="text-muted" aria-hidden /> : <span className="w-[15px]" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </DM.Item>
  )
}

/** A setting that stays open on click, for options next to the actions they affect. */
export function MenuCheckboxItem({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <DM.CheckboxItem className={ITEM} checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()}>
      <span className="w-[15px]"><DM.ItemIndicator><Check size={15} aria-hidden /></DM.ItemIndicator></span>
      <span className="flex-1">{children}</span>
    </DM.CheckboxItem>
  )
}

export function MenuRadioGroup<T extends string>({ value, onValueChange, children }: { value: T; onValueChange: (value: T) => void; children: ReactNode }) {
  return <DM.RadioGroup value={value} onValueChange={(v) => onValueChange(v as T)}>{children}</DM.RadioGroup>
}

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DM.RadioItem className={ITEM} value={value} onSelect={(e) => e.preventDefault()}>
      <span className="w-[15px]"><DM.ItemIndicator><Check size={15} aria-hidden /></DM.ItemIndicator></span>
      <span className="flex-1">{children}</span>
    </DM.RadioItem>
  )
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">{children}</DM.Label>
)

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />
