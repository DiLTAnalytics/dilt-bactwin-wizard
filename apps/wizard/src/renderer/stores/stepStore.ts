import { create } from 'zustand'
import { BACTWIN_FIELDS, toDsl, type FilterRule, type SequenceStep, type SetAction } from '@bactwin/mapping-engine'
import type { Flag, FlagDrafts } from '@/lib/flags'
import { emptyRow, fromAction, rowReady, toAction, type SetRow } from '@/lib/stepRows'

/** Which keys the editor offers: those the combinations allow, those common for the trade, or all. */
export type CombinationMode = 'combination' | 'gewerk_specific' | 'free'

/** A step as the editor holds it while it is changed. */
export interface Draft {
  name: string
  /** "Wenn": all must hold. */
  rules: FilterRule[]
  /** "Dann": BACtwin fields. */
  rows: SetRow[]
  /** "Dann": status flags the step sets; one not in here is left alone. */
  flags: FlagDrafts
  /** "Dann": the comment written, or null when the step leaves it alone. */
  comment: string | null
  mode: CombinationMode
}

export const emptyDraft = (): Draft => ({ name: '', rules: [], rows: [], flags: {}, comment: null, mode: 'combination' })

/** A new step as the editor opens it. */
const freshStep = (): Draft => ({ ...emptyDraft(), rows: [emptyRow(BACTWIN_FIELDS[1]!)] })

export function draftFromStep(step: SequenceStep): Draft {
  const flags: FlagDrafts = {}
  let comment: string | null = null
  for (const a of step.actions) {
    if (a.field === 'state.comment') comment = String(a.value)
    else if (typeof a.value === 'boolean') flags[a.field.slice('state.'.length) as Flag] = a.value
  }
  return {
    name: step.name ?? '',
    rules: toDsl(step.filter).rules,
    rows: step.actions.map(fromAction).filter((r): r is SetRow => r !== null),
    flags,
    comment,
    mode: step.combination_mode ?? 'combination',
  }
}

/** What the draft writes, in order: fields, then the comment, then flags. */
export function actionsOf(d: Draft): SetAction[] {
  const actions: SetAction[] = d.rows.filter(rowReady).map(toAction)
  if (d.comment !== null) actions.push({ field: 'state.comment', value: d.comment })
  for (const [flag, value] of Object.entries(d.flags) as [Flag, boolean][]) actions.push({ field: `state.${flag}`, value })
  return actions
}

/** Two drafts that would save the same step; row identities do not count. */
const withoutKeys = (d: Draft | null) => d && { ...d, rows: d.rows.map(({ key: _, sources, ...r }) => ({ ...r, sources: sources.map(({ key: _k, ...x }) => x) })) }
const same = (a: Draft | null, b: Draft | null) => JSON.stringify(withoutKeys(a)) === JSON.stringify(withoutKeys(b))

export type Target = number | 'new'
const keyOf = (t: Target) => String(t)

/** Where the new step goes: a sequence file by its path, so moving files keeps it, and a position in it. */
export interface NewStepPlace {
  path: string | null
  position: number
}

interface StepStore {
  /** The step in the editor: its index, 'new' for one not saved yet, or null for none. */
  target: Target | null
  draft: Draft | null
  /** The step as it is saved; null for a new one. */
  saved: Draft | null
  /** Unsaved edits of other steps, kept while switching between them until the app closes. */
  drafts: Record<string, Draft>
  /** Where the new step goes; null for the end of the sequence. */
  newPlace: NewStepPlace | null
  /** Open a step; opening the new one with `place` also sets where it goes. */
  open: (target: Target, saved: Draft | null, place?: NewStepPlace | null) => void
  /** Open `draft` as the new step at `place`, replacing any new step there was. */
  openNew: (draft: Draft, place: NewStepPlace | null) => void
  edit: (patch: Partial<Draft>) => void
  discard: () => void
  close: () => void
  /** After the draft was saved as the step. */
  committed: () => void
  /** Throw the new step away, open or not. */
  dropNew: () => void
  /** After steps were deleted or moved: drafts of saved steps no longer point at the right step. */
  forgetStepDrafts: () => void
  /**
   * After the `before` steps from `start` were replaced by `after` others (a file changed outside the app):
   * drop their drafts and close the editor if it is on one of them; later steps move along. Returns the
   * indexes whose unsaved edits were dropped.
   */
  replaceSteps: (start: number, before: number, after: number) => number[]
  reset: () => void
}

/** The current draft back into `drafts` if it differs from what is saved. */
function stash(s: Pick<StepStore, 'target' | 'draft' | 'saved' | 'drafts'>): Record<string, Draft> {
  if (s.target === null || !s.draft) return s.drafts
  const { [keyOf(s.target)]: _, ...rest } = s.drafts
  return same(s.draft, s.saved ?? emptyDraft()) ? rest : { ...rest, [keyOf(s.target)]: s.draft }
}

export const useStepStore = create<StepStore>((set, get) => ({
  target: null,
  draft: null,
  saved: null,
  drafts: {},
  newPlace: null,
  open: (target, saved, place) => {
    const drafts = stash(get())
    if (target === 'new' && place !== undefined) set({ newPlace: place })
    set({ target, saved, drafts, draft: drafts[keyOf(target)] ?? saved ?? freshStep() })
  },
  openNew: (draft, place) => {
    const { new: _, ...drafts } = stash(get())
    set({ target: 'new', saved: null, drafts, draft, newPlace: place })
  },
  edit: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
  discard: () => set((s) => {
    if (s.target === null) return {}
    const { [keyOf(s.target)]: _, ...drafts } = s.drafts
    return { drafts, draft: s.saved ?? emptyDraft() }
  }),
  close: () => set((s) => ({ drafts: stash(s), target: null, draft: null, saved: null })),
  committed: () => set((s) => {
    const { [keyOf(s.target ?? 'new')]: _, ...drafts } = s.drafts
    return { drafts, target: null, draft: null, saved: null, ...(s.target === 'new' ? { newPlace: null } : {}) }
  }),
  dropNew: () => set((s) => {
    const { new: _, ...drafts } = s.drafts
    return { drafts, newPlace: null, ...(s.target === 'new' ? { target: null, draft: null, saved: null } : {}) }
  }),
  forgetStepDrafts: () => set((s): Partial<StepStore> => ({ drafts: s.drafts['new'] ? { new: s.drafts['new'] } : {} })),
  replaceSteps: (start, before, after) => {
    const s = get()
    const moved = (i: number) => (i < start ? i : i >= start + before ? i + after - before : null)
    const dropped: number[] = []
    const drafts: Record<string, Draft> = {}
    for (const [key, d] of Object.entries(s.drafts)) {
      const to = key === 'new' ? key : moved(Number(key))
      if (to === null) dropped.push(Number(key))
      else drafts[String(to)] = d
    }
    if (typeof s.target !== 'number') set({ drafts })
    else {
      const to = moved(s.target)
      if (to !== null) set({ drafts, target: to })
      else {
        if (isDirty(s)) dropped.push(s.target)
        set({ drafts, target: null, draft: null, saved: null })
      }
    }
    return dropped.sort((a, b) => a - b)
  },
  reset: () => set({ target: null, draft: null, saved: null, drafts: {}, newPlace: null }),
}))

/** The draft differs from the saved step (a new step counts as soon as it has anything). */
export const isDirty = (s: Pick<StepStore, 'draft' | 'saved'>) => s.draft !== null && !same(s.draft, s.saved ?? emptyDraft())

/** Unsaved edits by step, the open one included. */
export const allDrafts = (s: Pick<StepStore, 'target' | 'draft' | 'saved' | 'drafts'>): Record<string, Draft> => stash(s)

/** Steps with unsaved edits, the open one included. */
export function draftTargets(s: Pick<StepStore, 'target' | 'draft' | 'saved' | 'drafts'>): Set<string> {
  return new Set(Object.keys(stash(s)))
}

/** Steps whose edits would be lost on closing; a new step only once something was filled in. */
export function unappliedCount(s: Pick<StepStore, 'target' | 'draft' | 'saved' | 'drafts'>): number {
  return Object.entries(stash(s)).filter(([key, d]) => key !== 'new' || !same(d, freshStep())).length
}
