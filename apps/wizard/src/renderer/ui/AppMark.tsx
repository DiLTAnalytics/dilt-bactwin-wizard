import markUrl from '../../../assets/mark.svg'
import { useI18n } from '@/i18n'

/** The DiLT mark, alone or with the app name beside it. Its stroke is 1/32 of `size`, so multiples of 32 stay crisp. */
export function AppMark({ size, withName = false, className = '' }: { size: number; withName?: boolean; className?: string }) {
  const { t } = useI18n()
  const mark = <img src={markUrl} width={size} height={size} alt={withName ? '' : t('app.name')} className="shrink-0" />
  if (!withName) return mark
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {mark}
      <span className="font-semibold text-fg">{t('app.name')}</span>
    </span>
  )
}
