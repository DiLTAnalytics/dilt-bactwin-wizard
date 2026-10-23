import { Fragment, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Ellipsis, FilePlus, FileSearch, FileText, FolderSync, Link2, Link2Off, Plus, Save, SaveAll } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toCondition, type SequenceStep } from '@bactwin/mapping-engine'
import type { RunProgress } from '../../../shared/channels'
import { dropLineClass, useRowDrag } from '@/hooks/useRowDrag'
import { useStoredState } from '@/hooks/useStoredState'
import { useI18n } from '@/i18n'
import { dropPosition, keyboardPosition, landedIndex, resolvePlace, type StepPosition } from '@/lib/stepPositions'
import { ApiError, confirmDialog, events } from '@/ipc/client'
import {
  createSequenceFile, deleteStep, getSequence, linkSequenceFile, locateSequenceFile, moveSequenceBlock, moveStepTo,
  restoreSequenceFile, saveSequenceFileAs, setStepDisabled, unlinkSequenceBlock,
} from '@/ipc/sequence'
import { dispatchMenuAction, useMenuAction } from '@/menuActions'
import { queryKeys, useRefresh } from '@/queries'
import { useProjectStore } from '@/stores/projectStore'
import { actionsOf, draftFromStep, draftTargets, isDirty, useStepStore, type NewStepPlace } from '@/stores/stepStore'
import { Button, IconButton } from '@/ui/Button'
import { DragHandle } from '@/ui/DragHandle'
import { Menu, MenuItem } from '@/ui/Menu'
import { Tooltip } from '@/ui/Tooltip'
import { reportError } from '@/ui/reportError'
import { RunBar, RunLabel } from './RunProgress'
import { NewStepRow, StepRow } from './StepRow'


/** Scroll the list while a step is dragged near its top or bottom edge, faster the closer; the sticky file headers cover the top edge Chromium would scroll at. */
function scrollAtEdge(e: DragEvent<HTMLElement>) {
  const list = e.currentTarget
  const { top, bottom } = list.getBoundingClientRect()
  const zone = 48
  const above = top + zone - e.clientY
  const below = e.clientY - (bottom - zone)
  if (above > 0) list.scrollTop -= Math.ceil(above / 3)
  else if (below > 0) list.scrollTop += Math.ceil(below / 3)
}

/**
 * The sequence as the left column, block by block (one sequence file each). The data is always the
 * import with every step applied, so changing a step recalculates; nothing here runs steps by hand.
 */
export function MappingSequencePanel() {
  const { t } = useI18n()
  const refresh = useRefresh()
  const { target, open, openNew, close, forgetStepDrafts, reset, dropNew } = useStepStore()
  // A string, so the selection is stable between renders.
  const draftKeys = useStepStore((s) => [...draftTargets(s)].join('|'))
  const withDrafts = new Set(draftKeys.split('|'))
  const selectedIndex = typeof target === 'number' ? target : null

  const { data: sequence } = useQuery({ queryKey: queryKeys.sequence, queryFn: getSequence })
  const steps = sequence?.steps ?? []
  const blocks = sequence?.blocks ?? []

  // The new step, open or kept as a draft, shows where it will go: its place, else the end of the last file that takes steps.
  const newDraft = useStepStore((s) => (s.target === 'new' ? s.draft : s.drafts['new'] ?? null))
  const newPlace = useStepStore((s) => s.newPlace)
  const placed = resolvePlace(blocks, newPlace, steps.length).at
  const lastUsable = blocks.map((b) => !b.missing && !b.gone).lastIndexOf(true)
  const newAt: StepPosition | null = !newDraft ? null : placed ?? (lastUsable < 0 ? null : { block: lastUsable, position: blocks[lastUsable]!.count })
  const newStepView: SequenceStep | null = newDraft && { name: newDraft.name.trim(), filter: newDraft.rules.map(toCondition), actions: actionsOf(newDraft) }
  const newRow = newStepView && (
    <NewStepRow step={newStepView} selected={target === 'new'} onSelect={() => open('new', null)} onDrop={dropNew} />
  )
  useEffect(() => {
    if (target === 'new') listRef.current?.querySelector('[data-new-step-row]')?.scrollIntoView({ block: 'nearest' })
  }, [target, newAt?.block, newAt?.position])

  // Collapsed files by path; the file of a project not saved yet has none.
  const [collapsed, setCollapsed] = useStoredState<string[]>('sequence.collapsedFiles', [])
  const isCollapsed = (path: string | null) => collapsed.includes(path ?? '')
  const toggle = (path: string | null) => setCollapsed((c) => (c.includes(path ?? '') ? c.filter((p) => p !== (path ?? '')) : [...c, path ?? '']))

  // Every structural change recalculates the data from the step it touches, and steps change places.
  const afterChange = () => { close(); forgetStepDrafts(); refresh('sequence', 'points', 'stats', 'validOptions', 'preview', 'history') }
  // Main refuses changes during a recalculation; a race past the disabled buttons still surfaces.
  const alertOnConflict = (err: unknown) => {
    if (err instanceof ApiError) void reportError(t('dialog.actionNotPossible'), err)
  }

  const deleteMut = useMutation({ mutationFn: deleteStep, onSuccess: afterChange, onError: alertOnConflict })
  const moveMut = useMutation({
    mutationFn: ({ index, to }: { index: number; to: StepPosition }) => moveStepTo(index, to),
    onSuccess: (_, { index, to }) => {
      const landed = landedIndex(blocks, index, to)
      afterChange()
      // A keyboard move keeps focus on the moved step.
      if (listRef.current?.contains(document.activeElement)) focusRow(landed)
    },
    onError: alertOnConflict,
  })
  const moveBlockMut = useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) => moveSequenceBlock(from, to),
    onSuccess: afterChange,
    onError: alertOnConflict,
  })
  const disableMut = useMutation({
    mutationFn: ({ index, disabled }: { index: number; disabled: boolean }) => setStepDisabled(index, disabled),
    onSuccess: () => refresh('sequence', 'points', 'stats', 'preview', 'history'),
    onError: alertOnConflict,
  })
  const unlinkMut = useMutation({ mutationFn: unlinkSequenceBlock, onSuccess: afterChange, onError: alertOnConflict })

  const keyMove = (index: number, down: boolean) => {
    const to = keyboardPosition(blocks, index, down)
    if (to && !busy) moveMut.mutate({ index, to })
  }
  const rowDrag = useRowDrag((index, target) => moveMut.mutate({ index, to: dropPosition(blocks, index, target) }), steps.length, keyMove)
  const blockDrag = useRowDrag((from, to) => moveBlockMut.mutate({ from, to }), blocks.length)
  // The header a step is dragged over: dropped there, it goes first into that file.
  const [headerOver, setHeaderOver] = useState<number | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const focusRow = (i: number) => listRef.current?.querySelector<HTMLElement>(`[data-step-row="${i}"]`)?.focus()

  /** A focused step: Enter or Space opens it, ↑/↓ moves the focus, Alt+↑/↓ moves the step. */
  const rowKeys = (i: number) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      keyMove(i, e.key === 'ArrowDown')
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectStep(i)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault()
      focusRow(i + (e.key === 'ArrowDown' ? 1 : -1))
    }
  }

  // Main pushes one report per recalculated step and null when done.
  const [progress, setProgress] = useState<RunProgress | null>(null)
  useEffect(() => events.onRunProgress(setProgress), [])
  const busy = progress !== null

  /** A file action that asks main for a file; null back means cancelled. */
  async function fileAction(run: () => Promise<unknown>) {
    try {
      if (await run()) afterChange()
    } catch (err) {
      await reportError(t('dialog.sequenceLoadFailed'), err)
    }
  }
  /** Writing a deleted file again moves no step, so drafts stay. */
  async function rewrite(run: () => Promise<unknown>) {
    try {
      if (await run()) refresh('sequence')
    } catch (err) {
      await reportError(t('dialog.saveFailed'), err)
    }
  }
  // The file menu of a block, also opened by clicking its "gelöscht" mark.
  const [blockMenu, setBlockMenu] = useState<number | null>(null)
  const handleLink = () => fileAction(linkSequenceFile)
  const handleCreate = () => fileAction(createSequenceFile)

  // A different project brings its own sequence and drafts.
  const projectLoads = useProjectStore((s) => s.projectLoads)
  useEffect(() => { reset() }, [projectLoads])  // eslint-disable-line react-hooks/exhaustive-deps

  const blockOf = (i: number) => blocks.findIndex((b) => i >= b.start && i < b.start + b.count)

  /** Open a step in the editor, unfolding its file; an unsaved edit of the one open before is kept as its draft. */
  function selectStep(i: number) {
    if (i < 0 || i >= steps.length) return
    const block = blocks[blockOf(i)]
    if (block && isCollapsed(block.path)) toggle(block.path)
    open(i, draftFromStep(steps[i]!))
  }

  /** The new step: at `place`, else after the selected step in its file, else where it was meant to go. */
  function newStep(place?: NewStepPlace) {
    const b = selectedIndex === null ? -1 : blockOf(selectedIndex)
    const after = b < 0 ? undefined : { path: blocks[b]!.path, position: selectedIndex! - blocks[b]!.start + 1 }
    open('new', null, place ?? after)
  }

  /** A copy of step `i` as the new step, right after it; its unapplied edits are copied too. */
  async function duplicateStep(i: number) {
    const s = useStepStore.getState()
    const source = s.target === i ? s.draft : s.drafts[String(i)] ?? (steps[i] && draftFromStep(steps[i]))
    const b = blockOf(i)
    if (!source || b < 0) return
    const pendingNew = s.target === 'new' ? isDirty(s) : 'new' in s.drafts
    if (pendingNew && !(await confirmDialog(t('dialog.replaceNewStepTitle'), t('dialog.replaceNewStepDetail'), t('dialog.replaceNewStep')))) return
    openNew({ ...structuredClone(source), name: t('sequence.copyName', { name: source.name }) }, { path: blocks[b]!.path, position: i - blocks[b]!.start + 1 })
  }

  async function confirmDelete(i: number) {
    const step = steps[i]
    if (!step) return
    const detail = t('common.step', { step: i + 1 }) + (step.name ? ` „${step.name}"` : '')
    if (await confirmDialog(t('dialog.deleteStepTitle'), detail, t('dialog.delete'))) deleteMut.mutate(i)
  }

  async function confirmUnlink(b: number) {
    const block = blocks[b]!
    // A block not saved yet has no file, so its steps go with it.
    const detail = block.path ? t('dialog.unlinkDetail', { name: block.name }) : t('dialog.unlinkUnsavedDetail', { count: block.count })
    if (await confirmDialog(t('dialog.unlinkTitle'), detail, t('dialog.unlink'))) unlinkMut.mutate(b)
  }

  useMenuAction('sequence:link', () => { if (!busy) void handleLink() })
  useMenuAction('sequence:create', () => { if (!busy) void handleCreate() })
  useMenuAction('step:new', () => { if (!busy) newStep() })
  useMenuAction('step:duplicate', () => { if (!busy && selectedIndex !== null) void duplicateStep(selectedIndex) })

  /** A file's header takes a dragged file (reorder) or a dragged step (first in this file). */
  function headerDrop(b: number) {
    const row = blockDrag(b).rowProps
    const takesStep = rowDrag.from !== null && !blocks[b]!.missing && !blocks[b]!.gone
    return {
      onDragOver: (e: DragEvent) => {
        if (rowDrag.from === null) return row.onDragOver(e)
        e.preventDefault()
        if (takesStep) setHeaderOver(b)
      },
      onDragLeave: () => { setHeaderOver((o) => (o === b ? null : o)); row.onDragLeave() },
      onDrop: (e: DragEvent) => {
        if (rowDrag.from === null) return row.onDrop(e)
        e.preventDefault()
        if (takesStep) moveMut.mutate({ index: rowDrag.from, to: { block: b, position: 0 } })
        rowDrag.end()
        setHeaderOver(null)
      },
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-3 pr-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t('sequence.title')}</h2>
        <span className="text-xs text-muted tabular-nums">{steps.length}</span>
        <div className="ml-auto flex items-center">
          {/* Step through the sequence: look at each step, nothing changes. */}
          <IconButton size="sm" icon={ChevronUp} label={t('sequence.prevStep')} onClick={() => selectStep((selectedIndex ?? 0) - 1)} disabled={steps.length === 0} />
          <IconButton size="sm" icon={ChevronDown} label={t('sequence.nextStep')} onClick={() => selectStep((selectedIndex ?? -1) + 1)} disabled={steps.length === 0} />
          <Menu align="end" trigger={<IconButton size="sm" icon={Ellipsis} label={t('sequence.more')} />}>
            <MenuItem icon={FilePlus} onSelect={() => void handleCreate()} disabled={busy}>{t('sequence.create')}</MenuItem>
            <MenuItem icon={Link2} onSelect={() => void handleLink()} disabled={busy}>{t('sequence.link')}</MenuItem>
          </Menu>
        </div>
      </div>

      {progress && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-line px-3 py-2">
          <RunLabel progress={progress} />
          <RunBar progress={progress} />
        </div>
      )}

      <ol ref={listRef} onDragOver={scrollAtEdge} className="min-h-0 flex-1 overflow-y-auto pb-1">
        {blocks.length === 0 && !newDraft && (
          <li className="px-3 py-6 text-center text-sm text-muted">
            {t('sequence.emptyList')}
            <p className="mt-1 text-xs">{t('sequence.emptyHint')}</p>
          </li>
        )}
        {blocks.map((block, b) => {
          const folded = isCollapsed(block.path)
          const drag = blockDrag(b)
          const drop = headerOver === b ? 'border-b-accent' : dropLineClass(drag.dropTarget) || 'border-b-line-soft'
          return (
            <Fragment key={`${b}:${block.path ?? ''}`}>
              <li
                {...headerDrop(b)}
                className={`sticky top-0 z-[1] flex items-center gap-1 border-y-2 border-transparent bg-subtle py-0.5 pr-1 pl-1 text-xs ${drop} ${drag.dragged ? 'opacity-40' : ''}`}
              >
                <IconButton size="sm" icon={ChevronRight} label={folded ? t('common.expand') : t('common.collapse')}
                  className={folded ? '' : '[&>svg]:rotate-90'} onClick={() => toggle(block.path)} />
                <DragHandle drag={drag} disabled={busy} title={t('sequence.blockDragHint')} />
                <FileText size={13} className="shrink-0 text-muted" aria-hidden />
                <Tooltip content={block.path ?? t('sequence.unsavedBlock')}><span className="truncate font-medium text-fg-2">{block.name}</span></Tooltip>
                {block.git && (
                  <Tooltip content={t(block.git === 'modified' ? 'sequence.gitModified' : 'sequence.gitUntracked')}>
                    <span role="img" aria-label={t(block.git === 'modified' ? 'sequence.gitModified' : 'sequence.gitUntracked')}
                      className={`size-1.5 shrink-0 rounded-full ${block.git === 'modified' ? 'bg-warning' : 'border border-muted'}`} />
                  </Tooltip>
                )}
                {block.missing ? (
                  <Tooltip content={t('sequence.locate')}>
                    <button type="button" disabled={busy} onClick={() => void fileAction(() => locateSequenceFile(b))}
                      className="shrink-0 text-warning-fg underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-40">{t('sequence.missingBlock')}</button>
                  </Tooltip>
                ) : block.gone ? (
                  <Tooltip content={t('sequence.goneHint')}>
                    <button type="button" disabled={busy} onClick={() => setBlockMenu(b)}
                      className="shrink-0 text-warning-fg underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-40">{t('sequence.goneBlock')}</button>
                  </Tooltip>
                ) : <span className="shrink-0 text-muted tabular-nums">{block.count}</span>}
                <div className="ml-auto flex shrink-0 items-center">
                  <IconButton size="sm" icon={Plus} label={t('sequence.newStepHere')} disabled={busy || block.missing || block.gone}
                    onClick={() => newStep({ path: block.path, position: block.count })} />
                  <Menu align="end" open={blockMenu === b} onOpenChange={(o) => setBlockMenu(o ? b : null)}
                    trigger={<IconButton size="sm" icon={Ellipsis} label={t('sequence.blockMore', { name: block.name })} />}>
                    {block.gone && <MenuItem icon={Save} onSelect={() => void rewrite(() => restoreSequenceFile(b))} disabled={busy}>{t('sequence.restore')}</MenuItem>}
                    {block.gone && <MenuItem icon={SaveAll} onSelect={() => void rewrite(() => saveSequenceFileAs(b))} disabled={busy}>{t('sequence.saveAs')}</MenuItem>}
                    {(block.missing || block.gone) && <MenuItem icon={FileSearch} onSelect={() => void fileAction(() => locateSequenceFile(b))} disabled={busy}>{t('sequence.locate')}</MenuItem>}
                    <MenuItem icon={Link2Off} onSelect={() => void confirmUnlink(b)} disabled={busy}>{t('sequence.unlink')}</MenuItem>
                  </Menu>
                </div>
              </li>
              {!folded && block.count === 0 && !block.missing && newAt?.block !== b && (
                <li className="py-2 pr-3 pl-9 text-xs text-muted">{t('sequence.emptyBlock')}</li>
              )}
              {(folded ? [] : steps.slice(block.start, block.start + block.count)).map((step, j) => {
                const i = block.start + j
                return (
                  <Fragment key={i}>
                  {newAt?.block === b && newAt.position === j && newRow}
                  <StepRow
                    step={step}
                    index={i}
                    outcome={sequence?.outcomes[i] ?? null}
                    selected={selectedIndex === i}
                    hasDraft={withDrafts.has(String(i))}
                    busy={busy}
                    onSelect={() => selectStep(i)}
                    onJump={selectStep}
                    onToggle={(disabled) => disableMut.mutate({ index: i, disabled })}
                    onDelete={() => void confirmDelete(i)}
                    onDuplicate={() => void duplicateStep(i)}
                    drag={rowDrag(i)}
                    onKeyDown={rowKeys(i)}
                  />
                  </Fragment>
                )
              })}
              {newAt?.block === b && (folded || newAt.position >= block.count) && newRow}
            </Fragment>
          )
        })}
        {newDraft && !newAt && newRow}
        <li className="px-3 pt-2">
          <Button size="sm" className="w-full" icon={Plus} variant={target === 'new' ? 'primary' : 'secondary'} disabled={busy} onClick={() => newStep()}>
            {withDrafts.has('new') && target !== 'new' ? `${t('step.new')} ●` : t('step.new')}
          </Button>
        </li>
      </ol>
    </section>
  )
}
