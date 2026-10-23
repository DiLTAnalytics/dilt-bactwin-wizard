import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Columns3, MoveHorizontal, Pin, PinOff, Search, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { pointKey, type DataPoint } from '@bactwin/mapping-engine'
import { useNameTemplate } from '@/hooks/useNameTemplate'
import { useRowBlocks } from '@/hooks/useRowBlocks'
import { fetchPoints } from '@/ipc/points'
import { invoke } from '@/ipc/client'
import { queryKeys } from '@/queries'
import { useStoredState } from '@/hooks/useStoredState'
import { useI18n } from '@/i18n'
import { labelOf, useProjectStore } from '@/stores/projectStore'
import { actionsOf, useStepStore } from '@/stores/stepStore'
import { useViewStore, viewFilter, type PreviewMode, type StatusChip } from '@/stores/viewStore'
import { Button } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { Checkbox } from '@/ui/Field'
import { AnchoredMenu, Menu, MenuCheckboxItem, MenuItem, MenuLabel } from '@/ui/Menu'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { usePreviewCounts, useStepRequest } from '@/hooks/usePreview'
import { useStats } from '@/hooks/useStats'
import { buildColumns, type ColumnGroup, type ColumnMeta, type HeaderGroup, type Row } from './columns'
import { conditionMarks, searchMarks } from '@/lib/highlight'
import { fitContent, spreadWidths } from './columnWidths'

/** Rows fetched at a time; only the ones on screen are rendered. */
const BLOCK = 200
/** Every row is this tall, so rows need no measuring while scrolling. */
const ROW_HEIGHT = 44
/** Pinned at the right edge until the user says otherwise; the status column is always pinned at the left. */
const DEFAULT_PINNED_RIGHT = ['bt_bactwin_name']
const STATUS = 'status'

/** Where a pinned column stays while the others scroll sideways; `edge` draws the line to them. */
interface PinPlace { side: 'left' | 'right'; offset: number; edge: boolean }

/** Sticky and opaque, so the columns scrolling under it do not show through. */
const pinnedClass = (pin: PinPlace | undefined) =>
  !pin ? '' : `sticky z-[1] ${pin.edge ? (pin.side === 'left' ? 'border-r border-r-line' : 'border-l border-l-line') : ''}`
const pinnedStyle = (pin: PinPlace | undefined) => (pin ? { [pin.side]: pin.offset } : undefined)
const GROUPS: ColumnGroup[] = ['ede', 'bacnet', 'bactwin', 'description', 'state']
const DEFAULT_GROUPS: Record<ColumnGroup, boolean> = { ede: true, bacnet: true, bactwin: true, description: false, state: false }
const CHIPS: { chip: StatusChip; labelKey: string }[] = [
  { chip: 'errors', labelKey: 'view.errors' },
  { chip: 'duplicates', labelKey: 'view.duplicates' },
  { chip: 'review', labelKey: 'view.review' },
  { chip: 'ignored', labelKey: 'view.ignored' },
]

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))

/**
 * The points, filling the space it is given and scrolling through all of them: rows are loaded in
 * blocks as they come into view, and only those on screen are rendered. With a step open it shows
 * what the step does: its hits with before and after, its near misses, or what it misses. The view
 * filter above only narrows what is listed. While a point is selected, ↑ and ↓ move through the list.
 */
export function DataTable({ selected, onSelect }: { selected: DataPoint | null; onSelect: (point: DataPoint) => void }) {
  const { t, n } = useI18n()
  const view = useViewStore()
  const filter = viewFilter(view)
  const target = useStepStore((s) => s.target)
  const draft = useStepStore((s) => s.draft)
  const stepOpen = target !== null && draft !== null
  // "Endergebnis" lists the points after all applied steps, as with no step open; the step stays open.
  const previewMode = view.mode === 'final' ? null : view.mode
  const preview = stepOpen && previewMode !== null

  const request = useStepRequest()
  const counts = usePreviewCounts(selected ? pointKey(selected.ede) : null).data?.counts
  const scrollRef = useRef<HTMLDivElement>(null)
  const filterKey = JSON.stringify([filter, view.mode, view.context, request, view.sort])
  const sortRequest = view.sort ? { sort: view.sort.field, sort_desc: view.sort.desc } : {}
  // A different list starts at the top.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [filterKey])
  const [show, setShow] = useStoredState<Record<ColumnGroup, boolean>>('table.columns', DEFAULT_GROUPS)
  const [onlyWritten, setOnlyWritten] = useStoredState('table.onlyWritten', false)

  const [range, setRange] = useState<[number, number]>([0, 60])
  const blocks = useRowBlocks<Row, { device: number | null; count: number }[]>(
    preview ? [...queryKeys.preview, 'rows', request, view.mode, view.context, filter, view.sort] : [...queryKeys.points, 'rows', filter, view.sort],
    BLOCK,
    async (block) => {
      if (preview && request) {
        const res = await invoke('step:preview', { ...request, mode: previewMode, context: view.context, view: filter, page: block + 1, page_size: BLOCK, ...sortRequest })
        const rows = res.items.map((i) => ({
          point: i.point, before: i.before, beforeName: i.beforeName, conditions: i.conditions,
          collisions: Object.fromEntries(Object.entries(i.collisions).map(([field, c]) =>
            [field, { writer: null, overwrites: c.overwrites === null ? [] : [c.overwrites], overwrittenBy: c.overwrittenBy }])),
        }))
        return { rows, filtered: res.filtered, extra: res.groups }
      }
      const res = await fetchPoints({ filter, page: block + 1, page_size: BLOCK, ...sortRequest })
      // A cell more than one step changed holds the last one's value.
      const rows = res.items.map((point, i) => ({
        point,
        collisions: Object.fromEntries(Object.entries(res.collisions[i] ?? {}).map(([field, steps]) =>
          [field, { writer: steps.at(-1)!, overwrites: steps.slice(0, -1), overwrittenBy: null }])),
      }))
      return { rows, filtered: res.filtered }
    },
    range[0],
    range[1],
    !preview || request !== null,
  )
  const filtered = blocks.filtered
  const virtualizer = useVirtualizer({
    count: filtered,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const firstIndex = items[0]?.index ?? 0
  const lastIndex = items.at(-1)?.index ?? 0
  useEffect(() => { setRange([firstIndex, lastIndex]) }, [firstIndex, lastIndex])

  const [available, setAvailable] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const template = useNameTemplate()
  const { labels, tableLayout, changeTableLayout } = useProjectStore()
  const pinnedLeft = tableLayout.pinned_left ?? []
  const pinnedRight = tableLayout.pinned_right ?? DEFAULT_PINNED_RIGHT
  const written = useMemo(() => new Set(preview ? actionsOf(draft).map((a) => a.field) : []), [preview, draft])
  const built = useMemo(
    () => buildColumns({
      show, template, label: (block, key) => labelOf(labels, block, key) ?? key, t,
      onDuplicateClick: view.setName,
      written,
      onlyWritten: preview && onlyWritten,
      conditions: stepOpen && view.mode === 'near' ? draft.rules : null,
      // Conditions come first, so where they overlap the search their colour stays.
      highlight: [...(stepOpen ? conditionMarks(draft.rules) : []), ...searchMarks(view.search)],
    }),
    [show, template, labels, t, view.setName, written, stepOpen, preview, onlyWritten, view.mode, draft, view.search],
  )
  // Left pins first (the status column always), right pins last, each in the order they were pinned.
  const arranged = useMemo(() => {
    const byId = new Map(built.map((c) => [c.id!, c]))
    const left = [STATUS, ...pinnedLeft.filter((id) => id !== STATUS)].filter((id) => byId.has(id))
    const right = pinnedRight.filter((id) => byId.has(id) && !left.includes(id))
    const middle = built.filter((c) => !left.includes(c.id!) && !right.includes(c.id!))
    return { columns: [...left, ...middle.map((c) => c.id!), ...right].map((id) => byId.get(id)!), left, right }
  }, [built, pinnedLeft.join(), pinnedRight.join()])
  const { columns } = arranged
  // Neighbouring columns of one group share a cell in the row above the headers.
  const groupSpans = useMemo(() => {
    const spans: { group: HeaderGroup | undefined; span: number; start: string; pinned: boolean }[] = []
    for (const col of columns) {
      const meta = col.meta as ColumnMeta | undefined
      const pinned = arranged.left.includes(col.id!) || arranged.right.includes(col.id!)
      const last = spans.at(-1)
      // A pinned column gets a group cell of its own, so it can stay at the edge with it.
      if (last && last.group === meta?.group && !pinned && !last.pinned) last.span++
      else spans.push({ group: meta?.group, span: 1, start: col.id!, pinned })
    }
    return spans
  }, [columns, arranged])
  const groupStarts = useMemo(() => new Set(groupSpans.slice(1).map((g) => g.start)), [groupSpans])
  // Fitted to the first block, afresh when the data, the shown columns, the open step or the space
  // change; in between (typing in a step, filtering) columns only grow, so they never jump back.
  const dataRevision = useStats().dataUpdatedAt
  const layoutKey = `${dataRevision}|${String(target)}|${available}|${columns.map((c) => c.id).join()}`
  const kept = useRef({ key: '', content: {} as Record<string, number> })
  const fitColumns = useMemo(
    () => columns.map((c) => ({ id: c.id!, size: c.size ?? 120, header: typeof c.header === 'string' ? c.header : '', fit: (c.meta as ColumnMeta | undefined)?.fit })),
    [columns],
  )
  const content = useMemo(() => {
    const fitted = fitContent(fitColumns, blocks.firstRows ?? [], kept.current.key === layoutKey ? kept.current.content : {})
    kept.current = { key: layoutKey, content: fitted }
    return fitted
  }, [fitColumns, blocks.firstRows, layoutKey])
  // A column edge being dragged; stored when it is let go.
  const [dragging, setDragging] = useState<{ id: string; width: number } | null>(null)
  const widths = useMemo(
    () => spreadWidths(fitColumns, content, { ...tableLayout.widths, ...(dragging ? { [dragging.id]: dragging.width } : {}) }, available),
    [fitColumns, content, tableLayout.widths, dragging, available],
  )
  const tableWidth = columns.reduce((w, c) => w + widths[c.id!]!, 0)
  const pins = useMemo(() => {
    const out: Record<string, PinPlace> = {}
    let offset = 0
    arranged.left.forEach((id, i) => { out[id] = { side: 'left', offset, edge: i === arranged.left.length - 1 && arranged.left.length > 1 }; offset += widths[id]! })
    offset = 0
    ;[...arranged.right].reverse().forEach((id, i) => { out[id] = { side: 'right', offset, edge: i === arranged.right.length - 1 }; offset += widths[id]! })
    return out
  }, [arranged, widths])

  function togglePin(id: string) {
    const left = pinnedLeft.filter((c) => c !== id)
    const right = pinnedRight.filter((c) => c !== id)
    const pinned = left.length !== pinnedLeft.length || right.length !== pinnedRight.length
    if (!pinned && DEFAULT_PINNED_RIGHT.includes(id)) right.push(id)
    else if (!pinned) left.push(id)
    changeTableLayout({ ...tableLayout, pinned_left: left, pinned_right: right })
  }

  /** Drag a column's right edge to set its width; the width is kept with the project. */
  function startResize(e: React.PointerEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = widths[id]!
    // A right-pinned column grows towards the left.
    const sign = pins[id]?.side === 'right' ? -1 : 1
    let width = startWidth
    const move = (ev: PointerEvent) => {
      width = Math.max(24, Math.round(startWidth + sign * (ev.clientX - startX)))
      setDragging({ id, width })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      if (width !== startWidth) changeTableLayout({ ...tableLayout, widths: { ...tableLayout.widths, [id]: width } })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Give a column back to fitting its content. */
  function resetWidth(id: string) {
    const { [id]: _, ...rest } = tableLayout.widths ?? {}
    changeTableLayout({ ...tableLayout, widths: rest })
  }
  // The same functions on every render, so the header is not rendered again while scrolling.
  const headerActions = useRef({ togglePin, startResize, resetWidth })
  headerActions.current = { togglePin, startResize, resetWidth }
  const onPin = useCallback((id: string) => headerActions.current.togglePin(id), [])
  const onResizeStart = useCallback((e: React.PointerEvent, id: string) => headerActions.current.startResize(e, id), [])
  const onResetWidth = useCallback((id: string) => headerActions.current.resetWidth(id), [])
  const selectedKey = selected ? pointKey(selected.ede) : null
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  useEffect(() => { if (selectedKey === null) setSelectedIndex(null) }, [selectedKey])

  function select(index: number, row: Row) {
    setSelectedIndex(index)
    onSelect(row.point)
  }
  // The same function on every render, so rows that did not change are not rendered again.
  const selectRef = useRef(select)
  selectRef.current = select
  const onRowClick = useCallback((index: number, row: Row) => selectRef.current(index, row), [])

  useEffect(() => {
    if (selectedIndex === null) return
    const handler = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target) || document.querySelector('[role="dialog"]')) return
      const next = selectedIndex + (e.key === 'ArrowDown' ? 1 : -1)
      const row = next >= 0 && next < filtered ? blocks.rowAt(next) : undefined
      if (!row) return
      e.preventDefault()
      select(next, row)
      virtualizer.scrollToIndex(next, { align: 'auto' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const groups = stepOpen && view.mode === 'missed' ? blocks.extra ?? [] : []

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-2">{t('table.title')}</h2>
        {stepOpen ? (
          <>
            <SegmentedControl<PreviewMode>
              size="sm"
              label={t('table.modeLabel')}
              value={view.mode}
              onChange={view.setMode}
              options={[
                { value: 'hits', label: t('table.mode.hits', { count: counts ? n(counts.hits) : '…' }), hint: t('table.mode.hitsHint') },
                { value: 'near', label: t('table.mode.near', { count: counts ? n(counts.near) : '…' }), hint: t('table.mode.nearHint') },
                { value: 'missed', label: t('table.mode.missed', { count: counts ? n(counts.missed) : '…' }), hint: t('table.mode.missedHint') },
                { value: 'final', label: t('table.mode.final'), hint: t('table.mode.finalHint') },
              ]}
            />
            {view.mode === 'missed' && (
              <SegmentedControl<'before' | 'import'>
                size="sm"
                label={t('table.contextLabel')}
                value={view.context}
                onChange={view.setContext}
                options={[
                  { value: 'before', label: t('table.context.before'), hint: t('table.context.beforeHint') },
                  { value: 'import', label: t('table.context.import'), hint: t('table.context.importHint') },
                ]}
              />
            )}
            {view.mode === 'hits' && counts && (
              <span className="text-xs text-muted tabular-nums">
                {[
                  t('table.changed', { count: n(counts.changed) }),
                  ...(counts.skipped ? [t('table.skipped', { count: n(counts.skipped) })] : []),
                  ...(counts.same ? [t('table.same', { count: n(counts.same) })] : []),
                ].join(', ')}
              </span>
            )}
            {view.mode === 'final' && <span className="text-xs text-muted tabular-nums">{t('common.datapoints', { count: n(filtered) })}</span>}
          </>
        ) : (
          <span className="text-xs text-muted tabular-nums">{t('common.datapoints', { count: n(filtered) })}</span>
        )}
        {blocks.isFetching && <span className="animate-pulse text-xs text-muted">{t('table.loading')}</span>}
        <div className="ml-auto flex items-center gap-2">
          {preview && <Checkbox className="text-xs" label={t('table.onlyWritten')} checked={onlyWritten} onChange={(e) => setOnlyWritten(e.target.checked)} />}
          <Menu align="end" trigger={<Button size="sm" variant="ghost" icon={Columns3}>{t('table.columns')}</Button>}>
            <MenuLabel>{t('table.columnGroups')}</MenuLabel>
            {GROUPS.map((group) => (
              <MenuCheckboxItem key={group} checked={show[group]} onCheckedChange={(on) => setShow((s) => ({ ...s, [group]: on }))}>
                {t(`table.group.${group}`)}
              </MenuCheckboxItem>
            ))}
          </Menu>
        </div>
      </div>

      {/* The view filter: only what is listed, never what a step does. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-subtle px-3 py-1.5">
        <label className="flex h-7 w-60 items-center gap-1.5 rounded border border-line bg-surface px-2 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-muted" aria-hidden />
          <input className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder={t('view.search')} aria-label={t('view.search')}
            value={view.search} onChange={(e) => view.setSearch(e.target.value)} />
        </label>
        {CHIPS.map(({ chip, labelKey }) => (
          <button key={chip} type="button" aria-pressed={view.chips.includes(chip)} onClick={() => view.toggleChip(chip)}
            className={`h-6 rounded-full border px-2.5 text-xs ${view.chips.includes(chip) ? 'border-accent-line bg-accent-soft text-accent-fg' : 'border-line bg-surface text-fg-2 hover:border-line-strong'}`}>
            {t(labelKey)}
          </button>
        ))}
        {view.name && <ActiveChip label={t('view.name', { name: view.name })} onClear={() => view.setName(null)} clearLabel={t('view.clear')} />}
        {view.device !== null && <ActiveChip label={t('view.device', { device: view.device })} onClear={() => view.setDevice(null)} clearLabel={t('view.clear')} />}
        <span className="ml-auto text-2xs text-muted">{t('view.note')}</span>
      </div>

      {groups.length > 1 && view.device === null && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line-soft px-3 py-1.5 text-xs">
          <span className="text-muted">{t('table.byDevice')}</span>
          {groups.slice(0, 12).map((g) => (
            <button key={String(g.device)} type="button" onClick={() => view.setDevice(g.device)}
              className="h-6 rounded-full border border-line bg-surface px-2.5 text-fg-2 tabular-nums hover:border-line-strong">
              {g.device ?? '–'} · {n(g.count)}
            </button>
          ))}
        </div>
      )}

      {/* Focusable, so the rows can be reached without a mouse: ↓ or ↑ selects the first row, then moves on. */}
      <div ref={scrollRef} tabIndex={0} aria-label={t('table.title')} className="min-h-0 flex-1 overflow-auto"
        onKeyDown={(e) => {
          if (selectedIndex !== null || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.target !== e.currentTarget) return
          const row = blocks.rowAt(firstIndex)
          if (!row) return
          // Not on to the window's arrow handler, which would move past it in the same keypress.
          e.preventDefault()
          e.stopPropagation()
          select(firstIndex, row)
        }}>
        <table className="table-fixed border-collapse text-xs" style={{ width: Math.max(tableWidth, available) }}>
          {/* A fixed layout takes its widths from here; the first row has merged group cells. */}
          <colgroup>{columns.map((c) => <col key={c.id} style={{ width: widths[c.id!] }} />)}</colgroup>
          <TableHead columns={columns} groupSpans={groupSpans} groupStarts={groupStarts} pins={pins} handSized={tableLayout.widths} resizing={dragging?.id ?? null} sort={view.sort}
            onSort={view.cycleSort} onPin={onPin} onResizeStart={onResizeStart} onResetWidth={onResetWidth} />
          <tbody>
            {filtered === 0 && !blocks.isFetching && (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-sm text-muted">
                  {blocks.loaded ? t('table.empty') : t('table.noProject')}
                </td>
              </tr>
            )}
            {(items[0]?.start ?? 0) > 0 && <tr aria-hidden style={{ height: items[0]!.start }} />}
            {items.map((item) => {
              const row = blocks.rowAt(item.index)
              return row
                ? <TableRow key={item.key} index={item.index} row={row} columns={columns} pins={pins} selected={pointKey(row.point.ede) === selectedKey} onClick={onRowClick} />
                : (
                  <tr key={item.key} style={{ height: ROW_HEIGHT }}>
                    <td colSpan={columns.length} className="px-3 text-muted">…</td>
                  </tr>
                )
            })}
            {items.length > 0 && virtualizer.getTotalSize() > items.at(-1)!.end && <tr aria-hidden style={{ height: virtualizer.getTotalSize() - items.at(-1)!.end }} />}
          </tbody>
        </table>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-1 border-t border-line bg-subtle px-3 text-xs text-muted tabular-nums">
        {filtered > 0 && t('table.showing', { from: n(firstIndex + 1), to: n(Math.min(lastIndex + 1, filtered)), total: n(filtered) })}
      </div>
    </section>
  )
}

/** The group row and the column headers, with each column's pin button and resize edge. */
const TableHead = memo(function TableHead({ columns, groupSpans, groupStarts, pins, handSized, resizing, sort, onSort, onPin, onResizeStart, onResetWidth }: {
  columns: ReturnType<typeof buildColumns>
  groupSpans: { group: HeaderGroup | undefined; span: number; start: string; pinned: boolean }[]
  groupStarts: Set<string>
  pins: Record<string, PinPlace>
  /** Widths set by hand, by column id. */
  handSized: Record<string, number> | undefined
  resizing: string | null
  sort: { field: string; desc: boolean } | null
  onSort: (field: string) => void
  onPin: (id: string) => void
  onResizeStart: (e: React.PointerEvent, id: string) => void
  onResetWidth: (id: string) => void
}) {
  const { t } = useI18n()
  // Right click on a header: pin it or give it back its fitted width.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const menuPinned = menu ? !!pins[menu.id] : false
  return (
    <thead className="sticky top-0 z-10 bg-subtle">
      <tr>
        {groupSpans.map(({ group, span, start, pinned }) => (
          <th key={start} colSpan={span} scope="colgroup" style={pinnedStyle(pins[start])}
            className={`border-b border-line-soft bg-subtle px-2 pt-1 text-left text-2xs font-semibold uppercase tracking-wide text-fg-2 ${groupStarts.has(start) ? 'border-l' : ''} ${pinnedClass(pins[start])}`}>
            {pinned ? '' : group === 'when' ? t('sequence.when') : group ? t(`filter.group.${group}`) : ''}
          </th>
        ))}
      </tr>
      <tr>
        {columns.map((col) => {
          const id = col.id!
          const meta = col.meta as ColumnMeta | undefined
          const pin = pins[id]
          const userPinned = pin && id !== STATUS
          return (
            <th key={id} style={pinnedStyle(pin)}
              onContextMenu={id === STATUS ? undefined : (e) => { e.preventDefault(); setMenu({ id, x: e.clientX, y: e.clientY }) }}
              aria-sort={meta?.sortField && sort?.field === meta.sortField ? (sort.desc ? 'descending' : 'ascending') : undefined}
              className={`group/th relative whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium ${groupStarts.has(id) ? 'border-l border-l-line-soft' : ''} ${meta?.written ? 'bg-accent-soft text-accent-fg' : 'bg-subtle text-muted'} ${pinnedClass(pin)}`}>
              {/* The header's one right-click menu; its anchor needs a cell to live in. */}
              {id === STATUS && (
                <AnchoredMenu at={menu} onClose={() => setMenu(null)}>
                  {menu && (
                    <>
                      <MenuItem icon={menuPinned ? PinOff : Pin} onSelect={() => onPin(menu.id)}>{menuPinned ? t('table.unpin') : t('table.pin')}</MenuItem>
                      <MenuItem icon={MoveHorizontal} disabled={handSized?.[menu.id] === undefined} onSelect={() => onResetWidth(menu.id)}>{t('table.fitWidth')}</MenuItem>
                    </>
                  )}
                </AnchoredMenu>
              )}
              {meta?.sortField ? (
                <Tooltip content={`${meta.title ?? String(col.header)} · ${t('table.sortHint')}`}>
                  <button type="button" onClick={() => onSort(meta.sortField!)}
                    className={`flex w-full min-w-0 items-center gap-0.5 text-left font-medium hover:text-fg ${sort?.field === meta.sortField ? 'text-fg' : ''}`}>
                    <span className="truncate">{typeof col.header === 'string' ? col.header : ''}</span>
                    {sort?.field === meta.sortField && (sort.desc ? <ArrowDown size={11} className="shrink-0" aria-hidden /> : <ArrowUp size={11} className="shrink-0" aria-hidden />)}
                    {userPinned && <Pin size={10} className="shrink-0 fill-current text-accent-fg" aria-label={t('table.pinned')} />}
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={meta?.title}><span className="block truncate">{typeof col.header === 'string' ? col.header : ''}</span></Tooltip>
              )}

              {/* Over the end of the header, so it takes no width from narrow columns. */}
              {id !== STATUS && (
                <Tooltip content={t('table.resizeHint')}>
                  <span aria-hidden onPointerDown={(e) => onResizeStart(e, id)} onDoubleClick={() => onResetWidth(id)}
                    className={`absolute top-0 h-full w-1.5 cursor-col-resize hover:bg-accent-line ${pin?.side === 'right' ? 'left-0' : 'right-0'} ${resizing === id ? 'bg-accent-line' : ''}`} />
                </Tooltip>
              )}
            </th>
          )
        })}
      </tr>
    </thead>
  )
})

/** One point's row; rendered again only when its point, the columns or its selection change. */
const TableRow = memo(function TableRow({ index, row, columns, pins, selected, onClick }: {
  index: number
  row: Row
  columns: ReturnType<typeof buildColumns>
  pins: Record<string, PinPlace>
  selected: boolean
  onClick: (index: number, row: Row) => void
}) {
  return (
    <tr
      data-index={index}
      data-point-key={pointKey(row.point.ede)}
      aria-selected={selected}
      onClick={() => onClick(index, row)}
      style={{ height: ROW_HEIGHT }}
      className={`group cursor-pointer border-b border-line-soft ${selected ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
    >
      {columns.map((col) => (
        <td key={col.id} style={pinnedStyle(pins[col.id!])} className={`overflow-hidden px-2 py-1 align-middle ${col.meta?.written && !selected ? 'bg-accent-soft/40' : ''} ${
          pins[col.id!] ? `${pinnedClass(pins[col.id!])} ${selected ? 'bg-accent-soft' : 'bg-surface group-hover:bg-subtle'}` : ''}`}>
          {typeof col.cell === 'function' ? (col.cell as (ctx: { row: { original: Row } }) => React.ReactNode)({ row: { original: row } }) : null}
        </td>
      ))}
    </tr>
  )
})

function ActiveChip({ label, onClear, clearLabel }: { label: string; onClear: () => void; clearLabel: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-accent-line bg-accent-soft pl-2.5 pr-1 text-xs text-accent-fg">
      {label}
      <button type="button" aria-label={clearLabel} onClick={onClear} className="rounded-full p-0.5 hover:bg-accent-line/40"><X size={12} aria-hidden /></button>
    </span>
  )
}
