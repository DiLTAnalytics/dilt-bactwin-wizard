import { showErrorDialog } from '@/ipc/client'

/** Show a failed action in a native error dialog, with the error's message as the detail. */
export function reportError(title: string, err: unknown): Promise<void> {
  return showErrorDialog(title, err instanceof Error ? err.message : String(err))
}
