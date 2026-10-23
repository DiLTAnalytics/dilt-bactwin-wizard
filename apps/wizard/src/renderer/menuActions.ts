/**
 * Native menu entries, dispatched to the component that registered the action, so a menu entry
 * runs the same handler as the button beside it. An unhandled action logs a warning.
 */

import { useEffect, useRef } from 'react'

export type MenuAction =
  | 'project:new' | 'project:open' | 'project:save' | 'project:saveAs' | 'project:properties'
  | 'import:ede' | 'import:edeFiles'
  | 'export:replacement' | 'export:table'
  | 'sequence:link' | 'sequence:create' | 'step:new' | 'step:duplicate'
  | 'help:about' | 'app:settings'

type Handler = () => void | Promise<void>

const handlers = new Map<MenuAction, Handler>()

/** Register a handler while mounted. Called through a ref, so it always sees the current state. */
export function useMenuAction(action: MenuAction, handler: Handler): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    const entry: Handler = () => latest.current()
    handlers.set(action, entry)
    return () => {
      if (handlers.get(action) === entry) handlers.delete(action)
    }
  }, [action])
}

export function dispatchMenuAction(action: string): void {
  const handler = handlers.get(action as MenuAction)
  if (!handler) {
    console.warn(`menu action "${action}" has no handler registered`)
    return
  }
  void handler()
}
