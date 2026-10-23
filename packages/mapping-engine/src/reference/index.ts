/** Reference data (key libraries, BACnet tables, combination catalogue), from parsed content into an indexed structure. */

import { NOT_PRESENT_INDEX, NOT_PRESENT_MARKER } from '../types.js'

/** One entry of a key library, e.g. gewerk:HZG. */
export interface LibraryEntry {
  block: string
  key: string
  name?: string
  description?: string | null
  default_gewerk?: string[]
  deprecated?: boolean
  source?: string
  key_number?: string
}

/** One row of the combination catalogue. An empty cell is a wildcard, not a value. */
export type CombinationRow = Record<string, string>

export interface BacnetType {
  bacnet_object_type: string
  acronym: string
  description: string
}
export interface BacnetUnit {
  unit: string
}

/** Columns the combination catalogue carries; `ort` is free text and has none. */
export const COMBINATION_COLUMNS = [
  'gewerk',
  'anlage',
  'baugruppe',
  'medium_position',
  'aggregat',
  'betriebsmittel',
  'funktion',
  'funktion_erweiterung',
] as const
export type CombinationColumn = (typeof COMBINATION_COLUMNS)[number]

export interface NameSegment {
  id: string
  type: 'free' | 'key' | 'key_indexed'
  required?: boolean
  optional_display?: boolean
  placeholder?: string
  index_field?: string
  index_digits?: number
  index_placeholder?: string
  digits?: number
}

export interface NameTemplate {
  version: string
  separator: string
  index_default?: string
  segments: NameSegment[]
}

export interface ReferenceDataInput {
  /** Key library entries from every active source, already merged. */
  library: LibraryEntry[]
  combinations: CombinationRow[]
  bacnetTypes: Record<string, BacnetType>
  bacnetUnits: Record<string, BacnetUnit>
  nameTemplate: NameTemplate
  activeSources: string[]
}

/** Indexed reference data. The catalogue is indexed per column and value, so a lookup is a few set intersections. */
export class ReferenceData {
  readonly library: Map<string, LibraryEntry>
  readonly combinations: readonly CombinationRow[]
  readonly bacnetTypes: Record<string, BacnetType>
  readonly bacnetUnits: Record<string, BacnetUnit>
  readonly nameTemplate: NameTemplate
  readonly activeSources: ReadonlySet<string>

  /** column -> value -> indices of rows carrying that value (wildcards excluded). */
  private readonly index: Map<string, Map<string, number[]>>
  /** column -> indices of rows whose cell is empty, i.e. that match any value. */
  private readonly wildcards: Map<string, number[]>
  private readonly columns: Set<string>

  constructor(input: ReferenceDataInput) {
    this.library = new Map(input.library.map((e) => [`${e.block}:${e.key}`, e]))
    this.combinations = input.combinations
    this.bacnetTypes = input.bacnetTypes
    this.bacnetUnits = input.bacnetUnits
    this.nameTemplate = input.nameTemplate
    this.activeSources = new Set(input.activeSources)

    this.columns = new Set(input.combinations.flatMap((r) => Object.keys(r)))
    this.index = new Map()
    this.wildcards = new Map()
    for (const col of this.columns) {
      const byValue = new Map<string, number[]>()
      const wild: number[] = []
      input.combinations.forEach((row, i) => {
        const value = (row[col] ?? '').trim()
        if (value === '') {
          wild.push(i)
          return
        }
        const bucket = byValue.get(value)
        if (bucket) bucket.push(i)
        else byValue.set(value, [i])
      })
      this.index.set(col, byValue)
      this.wildcards.set(col, wild)
    }
  }

  get hasCombinations(): boolean {
    return this.combinations.length > 0
  }

  hasColumn(column: string): boolean {
    return this.columns.has(column)
  }

  /** True when some catalogue row carries this exact value in this column. */
  columnHasValue(column: string, value: string): boolean {
    return (this.index.get(column)?.get(value)?.length ?? 0) > 0
  }

  /**
   * Row indices matching every (column, value) pair; an empty cell is a wildcard. Null when there
   * is no catalogue, which means "no opinion", not "nothing is valid".
   */
  matchingRows(state: ReadonlyMap<string, string>): Set<number> | null {
    if (!this.hasCombinations) return null
    let current: Set<number> | null = null
    for (const [col, value] of state) {
      if (!this.columns.has(col) || !value) continue
      const exact = this.index.get(col)?.get(value) ?? []
      const wild = this.wildcards.get(col) ?? []
      const allowed = new Set<number>(exact)
      for (const i of wild) allowed.add(i)
      if (current === null) {
        current = allowed
      } else {
        const next = new Set<number>()
        for (const i of current) if (allowed.has(i)) next.add(i)
        current = next
      }
      if (current.size === 0) return current
    }
    return current ?? new Set(this.combinations.map((_, i) => i))
  }

  /** Distinct non-empty values a column takes across the given rows. */
  valuesIn(rows: Set<number>, column: string): string[] {
    const out = new Set<string>()
    for (const i of rows) {
      const v = (this.combinations[i]?.[column] ?? '').trim()
      if (v) out.add(v)
    }
    return [...out].sort()
  }

  /** True when every catalogue row leaves this column empty, i.e. it constrains nothing. */
  columnIsAlwaysEmpty(column: string): boolean {
    if (!this.columns.has(column)) return false
    return (this.wildcards.get(column)?.length ?? 0) === this.combinations.length
  }

  entry(block: string, key: string): LibraryEntry | undefined {
    return this.library.get(`${block}:${key}`)
  }

  /** Keys the library offers for a block, restricted to the active sources. */
  keysForBlock(block: string): string[] {
    const out = new Set<string>()
    for (const entry of this.library.values()) {
      if (entry.block === block && entry.source && this.activeSources.has(entry.source)) {
        out.add(entry.key)
      }
    }
    return [...out].sort()
  }
}

/** The not-present markers are structural statements, never catalogue or library values. */
export function isStructuralMarker(value: unknown): boolean {
  return value === NOT_PRESENT_MARKER || value === NOT_PRESENT_INDEX
}
