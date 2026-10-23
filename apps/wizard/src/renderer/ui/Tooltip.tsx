import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

/** Mounted once at the root; shared delays make moving between tooltips feel instant. */
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>{children}</RadixTooltip.Provider>
)

/** A tooltip on hover and keyboard focus. `children` must be one element that can hold a ref. */
export function Tooltip({ content, side = 'top', children }: { content: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  if (!content) return children
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[100] max-w-xs wrap-break-word rounded bg-fg px-2 py-1 text-xs text-surface shadow-md"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
