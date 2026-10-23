import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fieldName, identityFilter, indexFieldOf, pointKey, numericDigits, type BACtwinData, type BACtwinField, type DataPoint, type ValidationMessage } from '@bactwin/mapping-engine'
import { useDebounced } from '@/hooks/useDebounced'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { fetchValidOptions } from '@/ipc/bulk'
import { queryKeys } from '@/queries'
import type { CombinationMode } from '@/stores/stepStore'
import { Input } from '@/ui/Field'
import { KeySelect } from '@/ui/KeySelect'
import { FieldMessages, hasError } from './FieldMessages'

/** One BACtwin field of a single point, with its index number beside it where it has one, and the messages about it under it. */
export function DetailFieldRow({ field, point, draftBt, combinationMode, messages, onUpdate }: {
  field: BACtwinField
  point: DataPoint
  /** The point's BACtwin values with the unapplied draft laid over them. */
  draftBt: BACtwinData
  combinationMode: CombinationMode
  messages: ValidationMessage[]
  onUpdate: (field: string, value: string | null) => void
}) {
  const index = indexFieldOf(field.id)
  const digits = numericDigits(useNameTemplate(), index?.id ?? field.id) ?? 2
  const current = draftBt[field.id]
  const path = `bactwin.${field.id}`

  // The other fields' draft values narrow the options; debounced so typing does not refetch per key.
  const overrides: Record<string, string> = {}
  for (const [key, v] of Object.entries(draftBt)) if (key !== field.id && v) overrides[key] = v
  const overridesKey = useDebounced(JSON.stringify(overrides), 250)
  const { data } = useQuery({
    queryKey: [...queryKeys.validOptions, 'point', path, pointKey(point.ede), overridesKey, combinationMode],
    queryFn: () => fetchValidOptions({
      field: field.id,
      filter: identityFilter(point.ede),
      mode: combinationMode,
      overrides: JSON.parse(overridesKey) as Record<string, string>,
    }),
    enabled: field.kind === 'key',
    placeholderData: keepPreviousData,
  })

  const invalid = hasError(messages)
  const numberInput = (target: string, value: string | null, className: string, bad = false) => (
    <Input
      size="sm"
      inputMode="numeric"
      invalid={bad}
      className={`w-full font-mono ${className}`}
      placeholder={'#'.repeat(digits)}
      aria-label={fieldName(target)}
      value={value ?? ''}
      onChange={(e) => onUpdate(target, e.target.value.replace(/\D/g, '') || null)}
      maxLength={digits}
    />
  )

  return (
    <tr className="border-b border-line-soft">
      <td className="py-1 pr-2 text-xs text-muted w-36 whitespace-nowrap align-top pt-2.5">{fieldName(field.id)}</td>
      <td className="py-1 align-top">
        {field.kind === 'free' ? (
          <Input
            size="sm"
            invalid={invalid}
            className="w-full"
            aria-label={fieldName(path)}
            value={current ?? ''}
            onChange={(e) => onUpdate(path, e.target.value || null)}
          />
        ) : field.kind === 'number' ? numberInput(path, current, '', invalid) : (
          <KeySelect
            block={field.id}
            value={current || null}
            onChange={(v) => onUpdate(path, v || null)}
            valid={data?.valid_for_all ?? []}
            mode={combinationMode}
            invalid={invalid}
            className="w-full"
          />
        )}
        <FieldMessages messages={messages} />
      </td>
      <td className={index ? 'py-1 pl-1 align-top w-16' : undefined}>
        {index && numberInput(`bactwin.${index.id}`, draftBt[index.id], 'text-center')}
      </td>
    </tr>
  )
}
