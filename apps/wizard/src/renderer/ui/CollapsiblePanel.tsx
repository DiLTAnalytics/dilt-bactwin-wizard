import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStoredState } from '@/hooks/useStoredState'

/** A section whose header toggles the body; the open state is remembered per `id`. */
export function CollapsiblePanel({ id, title, defaultCollapsed = false, header, controls, children }: {
  id: string
  title: string
  defaultCollapsed?: boolean
  /** Extra items in the header bar, after the title. */
  header?: ReactNode
  /** Right-aligned header items. */
  controls?: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useStoredState(`panel.${id}.collapsed`, defaultCollapsed)
  return (
    <section className="border-b border-line bg-surface">
      <div className="flex h-9 items-center gap-2 px-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs font-semibold uppercase tracking-wide text-fg-2 hover:bg-subtle"
        >
          <ChevronRight size={14} aria-hidden className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          {title}
        </button>
        {header}
        {controls && <div className="ml-auto flex items-center gap-2">{controls}</div>}
      </div>
      {!collapsed && children}
    </section>
  )
}
