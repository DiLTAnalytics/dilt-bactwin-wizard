import { useQuery } from '@tanstack/react-query'
import { FilePlus, FolderOpen, FileClock, FolderSync } from 'lucide-react'
import { useI18n } from '@/i18n'
import { invoke } from '@/ipc/client'
import { dispatchMenuAction } from '@/menuActions'
import { AppMark } from '@/ui/AppMark'
import { Button } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

/** Shown while no project is open: the ways to get one, and the projects opened last. */
export function StartScreen({ onOpenRecent }: { onOpenRecent: (index: number) => void }) {
  const { t } = useI18n()
  const { data: recent = [] } = useQuery({ queryKey: ['recent-projects'], queryFn: () => invoke('app:recentProjects') })

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-canvas p-8">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AppMark size={72} />
          <div className="text-2xl font-semibold text-fg">{t('app.name')}</div>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-fg">{t('start.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('start.hint')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" icon={FilePlus} onClick={() => dispatchMenuAction('project:new')}>{t('start.new')}</Button>
          <Button icon={FolderOpen} onClick={() => dispatchMenuAction('project:open')}>{t('start.open')}</Button>
        </div>
        {recent.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('start.recent')}</h2>
            <ul className="overflow-hidden rounded-md border border-line bg-surface">
              {recent.map((r, i) => (
                <li key={`${r.folder}/${r.name}`} className="border-b border-line-soft last:border-0">
                  <button
                    type="button"
                    disabled={!r.exists}
                    onClick={() => onOpenRecent(i)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:enabled:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileClock size={16} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{r.name}</span>
                      <Tooltip content={r.folder} side="bottom"><span className="block truncate text-xs text-muted">{r.folder}</span></Tooltip>
                    </span>
                    {!r.exists && <span className="text-xs text-muted">{t('start.missing')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
