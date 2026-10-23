export type Flag = 'ignore' | 'reminder'
/** Only the flags a step sets, true or false; a flag not in here is left alone. */
export type FlagDrafts = Partial<Record<Flag, boolean>>

/** Draft `value` for `flag`; the stored value again needs no draft. */
export function draftFlag(drafts: FlagDrafts, flag: Flag, value: boolean, stored: boolean): FlagDrafts {
  const { [flag]: _, ...rest } = drafts
  return value === stored ? rest : { ...rest, [flag]: value }
}
