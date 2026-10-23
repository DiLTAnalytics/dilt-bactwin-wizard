import type { ValidationMessage } from '@bactwin/mapping-engine'
import { useI18n } from '@/i18n'
import { byLevel, messageText } from '@/lib/messages'

const TONE = { error: 'text-danger-fg', warning: 'text-warning-fg', info: 'text-muted' } as const

/** The messages about one field, under it. */
export function FieldMessages({ messages }: { messages: ValidationMessage[] }) {
  const { t } = useI18n()
  if (messages.length === 0) return null
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5">
      {byLevel(messages).map((msg, i) => <li key={i} className={`text-2xs leading-snug ${TONE[msg.level]}`}>{messageText(msg, t)}</li>)}
    </ul>
  )
}

export const hasError = (messages: ValidationMessage[]) => messages.some((m) => m.level === 'error')
