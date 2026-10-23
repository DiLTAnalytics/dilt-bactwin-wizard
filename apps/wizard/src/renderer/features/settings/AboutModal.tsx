import { useEffect, useState } from 'react'
import { Code2, ExternalLink, Puzzle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { invoke, type Result } from '@/ipc/client'
import { AppMark } from '@/ui/AppMark'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Section } from '@/ui/Field'

type AboutInfo = Result<'app:about'>

/** Version, licences, the AGPL section 13 source offer, and the installed plugins with their licences. */
export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const [info, setInfo] = useState<AboutInfo | null>(null)

  useEffect(() => {
    if (!open) return
    void invoke('app:about').then(setInfo)
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeLabel={t('about.close')}
      width="w-[560px]"
      title={t('about.title')}
      footer={<Button onClick={onClose}>{t('about.close')}</Button>}
    >
      <div className="flex flex-col gap-5 text-sm">
        <div className="flex items-center gap-4">
          <AppMark size={56} />
          <div>
            <div className="text-lg font-semibold text-fg">{t('app.name')}</div>
            {info && <div className="text-xs text-muted">{t('about.version', { version: info.version })} · {t('about.builtWith', { electron: info.electron, chrome: info.chrome })}</div>}
            <div className="text-xs text-muted">{t('about.copyright')}</div>
          </div>
        </div>

        <Section title={t('about.licensing')} description={t('about.licensingApp')}>
          {info && (
            // target=_blank goes to the system browser via main's window-open handler.
            <a href={info.repository} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 rounded-md border border-line p-3 transition-colors hover:border-accent-line hover:bg-accent-soft/40">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sunken text-muted"><Code2 size={16} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{t('about.sourceOfferTitle')}</span>
                <span className="block truncate font-mono text-xs text-accent-fg">{info.repository}</span>
              </span>
              <ExternalLink size={14} className="shrink-0 text-muted" aria-hidden />
            </a>
          )}
          <p className="text-xs text-muted">{t('about.sourceOffer')}</p>
        </Section>

        <Section title={t('about.plugins')}>
          {info && info.plugins.length === 0 && <p className="text-muted">{t('about.noPlugins')}</p>}
          <div className="flex flex-col gap-2">
            {info?.plugins.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-md border border-line p-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${p.enabled ? 'bg-accent-soft text-accent-fg' : 'bg-sunken text-muted'}`}><Puzzle size={16} aria-hidden /></span>
                <span className="text-sm font-medium text-fg">{p.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge className="font-mono">{p.version}</Badge>
                  <Badge>{p.license}</Badge>
                  <Badge>{t(`settings.origin.${p.origin}`)}</Badge>
                  {!p.enabled && <Badge tone="warning">{t('about.pluginDisabled')}</Badge>}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <div className="flex flex-col gap-1.5 border-t border-line-soft pt-4 text-xs text-muted">
          <p>{t('about.referenceDataNote')}</p>
          <p>{t('about.trademarks')}</p>
          <p>{t('about.thirdParty')}</p>
        </div>
      </div>
    </Dialog>
  )
}
