import { create } from 'zustand'
import { escapeRegex, type FilterDsl, type FilterRule } from '@bactwin/mapping-engine'

/** With a step open: what the step hits, nearly hits or misses, or the data after all applied steps ('final'). */
export type PreviewMode = 'hits' | 'near' | 'missed' | 'final'
export type StatusChip = 'errors' | 'duplicates' | 'review' | 'ignored'

interface ViewStore {
  /** Finds points by object name or description; only narrows what the table lists. */
  search: string
  chips: StatusChip[]
  /** An exact BACtwin name, from clicking a duplicate. */
  name: string | null
  /** One device, from the groups of missed points. */
  device: number | null
  /** Which points of the selected step the table lists. */
  mode: PreviewMode
  /** For 'missed': the data before the step, or as imported. */
  context: 'before' | 'import'
  /** The field the table is ordered by, as area.field; null keeps the import order. */
  sort: { field: string; desc: boolean } | null
  /** Ascending, then descending, then the import order again. */
  cycleSort: (field: string) => void
  setSearch: (search: string) => void
  toggleChip: (chip: StatusChip) => void
  setName: (name: string | null) => void
  setDevice: (device: number | null) => void
  setMode: (mode: PreviewMode) => void
  setContext: (context: 'before' | 'import') => void
  /** Back to an unfiltered view, for another project. */
  reset: () => void
}

const INITIAL = { search: '', chips: [], name: null, device: null, mode: 'hits', context: 'before', sort: null } satisfies Partial<ViewStore>

export const useViewStore = create<ViewStore>((set) => ({
  ...INITIAL,
  cycleSort: (field) => set((s) => ({
    sort: s.sort?.field !== field ? { field, desc: false } : s.sort.desc ? null : { field, desc: true },
  })),
  setSearch: (search) => set({ search }),
  toggleChip: (chip) => set((s) => ({ chips: s.chips.includes(chip) ? s.chips.filter((c) => c !== chip) : [...s.chips, chip] })),
  setName: (name) => set({ name }),
  setDevice: (device) => set({ device }),
  setMode: (mode) => set({ mode }),
  setContext: (context) => set({ context }),
  reset: () => set(INITIAL),
}))

const rule = (field: string, operator: FilterRule['operator'], value: string | null = null): FilterRule =>
  ({ field, operator, value, case_sensitive: false, negated: false })

const CHIP_RULES: Record<StatusChip, FilterRule> = {
  errors: rule('state.has_error', 'is_true'),
  duplicates: rule('state.duplicated_name', 'is_true'),
  review: rule('state.reminder', 'is_true'),
  ignored: rule('state.ignore', 'is_true'),
}

/** The view filter as a filter: search, status chips, an exact name and a device, all of which must hold. */
export function viewFilter({ search, chips, name, device }: Pick<ViewStore, 'search' | 'chips' | 'name' | 'device'>): FilterDsl {
  const rules = chips.map((c) => CHIP_RULES[c])
  if (device !== null) rules.push(rule('ede.device_obj_instance', 'equals', String(device)))
  if (search.trim()) rules.push(rule('ede.name_or_description', 'regex', escapeRegex(search.trim())))
  if (name) rules.push(rule('bactwin.bactwin_name', 'equals', name))
  return { rules }
}
