import { Puzzle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import type { PluginSummary } from '@/ipc/project'
import { Badge } from '@/ui/Badge'
import { Switch } from '@/ui/Switch'
import { Tooltip } from '@/ui/Tooltip'
import { togglePlugin } from './togglePlugin'

/** Installed plugins to switch on or off; `missing` are named by the project but not installed here. */
export function PluginList({ plugins, missing = [], checked, onChange }: {
  plugins: PluginSummary[]
  missing?: { id: string; version: string }[]
  checked: string[]
  onChange: (checked: string[]) => void
}) {
  const { t } = useI18n()
  const [note, setNote] = useState<string | null>(null)
  const nameOf = (id: string) => plugins.find((p) => p.id === id)?.name ?? id
  const toggle = (id: string, on: boolean) => {
    const result = togglePlugin(plugins, checked, id, on)
    setNote(result.along.length
      ? t(on ? 'settings.switchedOnAlong' : 'settings.switchedOffAlong', { names: result.along.map(nameOf).join(', '), name: nameOf(id) })
      : null)
    onChange(result.checked)
  }
  if (plugins.length === 0 && missing.length === 0) return <p className="text-sm text-muted">{t('settings.noPlugins')}</p>
  return (
    <div className="flex flex-col gap-2">
      {plugins.map((p) => (
        <PluginCard key={p.id} name={p.name} on={checked.includes(p.id)} onToggle={(on) => toggle(p.id, on)}
          badges={<><Badge className="font-mono">{p.version}</Badge><Badge>{p.license}</Badge><Badge>{t(`settings.origin.${p.origin}`)}</Badge>
            {p.requires.length > 0 && <Badge>{t('settings.requires', { names: p.requires.map(nameOf).join(', ') })}</Badge>}</>}>
          {p.description && <Tooltip content={p.description}><p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p></Tooltip>}
        </PluginCard>
      ))}
      {missing.map((p) => (
        <PluginCard key={p.id} name={p.id} missing on={checked.includes(p.id)} onToggle={(on) => toggle(p.id, on)}
          badges={<><Badge className="font-mono">{p.version}</Badge><Badge tone="warning">{t('settings.notInstalled')}</Badge></>} />
      ))}
      {note && <p className="text-xs text-muted" role="status">{note}</p>}
    </div>
  )
}

/** One plugin as a card; a click anywhere on it flips the switch. */
function PluginCard({ name, on, missing = false, onToggle, badges, children }: {
  name: string
  on: boolean
  missing?: boolean
  onToggle: (on: boolean) => void
  badges: ReactNode
  children?: ReactNode
}) {
  const frame = missing ? 'border-warning-line bg-warning-soft/40' : on ? 'border-accent-line bg-accent-soft/40' : 'border-line bg-surface hover:bg-subtle'
  const icon = missing ? 'bg-warning-soft text-warning-fg' : on ? 'bg-accent-soft text-accent-fg' : 'bg-sunken text-muted'
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${frame}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${icon}`}><Puzzle size={16} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-sm font-medium text-fg">{name}</span>
          {badges}
        </div>
        {children}
      </div>
      <Switch on={on} onChange={onToggle} label={name} className="mt-2" />
    </label>
  )
}
