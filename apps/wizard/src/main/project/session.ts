/** The open project and everything that goes with it, held in memory. No Electron in project/. */

import {
  ReferenceData,
  Replay,
  SEQUENCE_FORMAT_VERSION,
  markDuplicateNames,
  translateBacnetFields,
  validateAndUpdate,
  type DataPoint,
  type Sequence,
  type SequenceStep,
} from '@bactwin/mapping-engine'

import { PROJECT_FORMAT_VERSION, type TableLayout } from './projectSchema.js'

import type { RunProgress } from '../../shared/channels.js'
import type { PluginSummary, ReferenceSources } from './reference.js'

/** An imported EDE file (see sources.ts). `meta` holds the file's own header lines (TIMESTAMP_OF_LAST_CHANGE, ...). */
export interface EdeSource {
  filename: string
  imported_at?: string
  meta?: Record<string, string>
  /** Absolute in memory, relative to the project file on disk. */
  path?: string
  sha256?: string
  size?: number
}

export interface ProjectHeader {
  project_name: string
  ede_sources: EdeSource[]
  /** The reference data the file was saved with; names and validity depend on it. */
  reference?: ReferenceStamp
  /** How the project is shown, stored with it. */
  layout?: { table?: TableLayout }
}

export interface ReferenceStamp {
  template: string
  plugins: { id: string; version: string }[]
}

export interface Project {
  header: ProjectHeader
  /** The imported points with every step applied; the replay keeps them current. */
  points: DataPoint[]
}

/** One sequence file in the project's sequence. The steps of all blocks, in order, are the sequence. */
export interface SequenceBlock {
  /** Absolute; null for a block created before the project was first saved, which gets its file then. */
  path: string | null
  steps: SequenceStep[]
  /** The file was not found when the project was opened; its steps are missing. */
  missing?: boolean
  /** The file was deleted while open; its steps still run, but cannot change until it is written again or located. */
  gone?: boolean
  /** The file's content as last read or written, so the watcher can tell the app's own writes from outside changes. */
  text?: string
  /** Against the last Git commit; undefined until checked, null when clean or not in Git. */
  git?: GitState
}

export type GitState = 'modified' | 'untracked' | null

export function emptyProject(): Project {
  return {
    header: { project_name: '', ede_sources: [] },
    points: [],
  }
}

/** Translates a message key for the user; the shell passes the real one, tests a stub. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

export class Session {
  project: Project | null = null
  referenceData: ReferenceData | null = null
  /** The plugins behind referenceData, from the same load. */
  plugins: PluginSummary[] = []
  enabledPlugins: string[] = []
  /** Plugins the project names that are not installed here; kept, so saving does not drop them. */
  missingPlugins: { id: string; version: string }[] = []
  /** Where plugins are found; set by the shell. */
  pluginSources: ReferenceSources | null = null
  /** The plugins a new project starts with (App-Einstellungen); all installed ones when unset. */
  defaultPlugins: string[] | undefined = undefined
  /** The sequence files in the order they run. */
  blocks: SequenceBlock[] = []
  replay: Replay | null = null
  /** Steps with edits not applied yet, as the renderer reports them; they live only there, so closing asks first. */
  unappliedSteps = 0
  /** Reports each step of a recalculation, then null; set by the shell. */
  onProgress: (progress: RunProgress | null) => void = () => {}
  private queue: Promise<unknown> = Promise.resolve()
  /** Non-null only while steps are being recalculated. */
  runProgress: RunProgress | null = null
  /** Changes not yet written to disk. */
  dirty = false
  /** Where the project was last saved or loaded, for "save" as against "save as". */
  projectPath: string | null = null
  /** The project file as last read or written, so the watcher can tell the app's own writes from outside changes. */
  projectStamp: { size: number; sha256: string } | null = null

  constructor(readonly t: Translate) {}

  requireProject(): Project {
    if (!this.project) throw new Error(this.t('error.noProject'))
    return this.project
  }

  requireReferenceData(): ReferenceData {
    if (!this.referenceData) throw new Error(this.t('error.noReferenceData'))
    return this.referenceData
  }

  /** Throws while steps are being recalculated. */
  requireIdle(): void {
    if (this.runProgress) throw new Error(this.t('error.sequenceRunning'))
  }

  /** The steps of every block, in order. */
  get sequence(): Sequence {
    return { schema_version: SEQUENCE_FORMAT_VERSION, steps: this.blocks.flatMap((b) => b.steps) }
  }

  /** The block holding step `index` of the whole sequence, and its position there. */
  locate(index: number): { block: SequenceBlock; local: number; start: number } {
    let start = 0
    for (const block of this.blocks) {
      if (index < start + block.steps.length) return { block, local: index - start, start }
      start += block.steps.length
    }
    throw new Error(this.t('error.noSuchStep', { step: index + 1 }))
  }

  /** Where `block` starts in the whole sequence. */
  startOf(block: SequenceBlock): number {
    let start = 0
    for (const b of this.blocks) {
      if (b === block) return start
      start += b.steps.length
    }
    return start
  }

  /** Run `task` after every earlier one has finished, so recalculations never overlap. */
  exclusive<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  /** Make the points the import plus every step, keeping the steps before `from` as they are. */
  async replayFrom(from: number): Promise<void> {
    const project = this.project
    const ref = this.referenceData
    if (!project || !ref) return
    this.replay ??= new Replay(project.points, ref)
    this.replay.rewind(from)
    const report = (progress: RunProgress | null) => {
      this.runProgress = progress
      this.onProgress(progress)
    }
    const steps = this.sequence.steps
    try {
      await this.replay.run(steps, {
        onStep: async (index, total) => {
          report({ index, total, name: steps[index]?.name ?? null })
          // Yield, so progress reaches the window and other requests are answered in between.
          await new Promise((resolve) => setImmediate(resolve))
        },
      })
    } finally {
      report(null)
    }
  }

  /**
   * After the imported data or the reference data changed: undo every step, let `change` alter the
   * imported points, recompute what derives from them, and run every step again.
   */
  async rebase(change?: () => void): Promise<void> {
    this.replay?.rewind(0)
    this.replay = null
    change?.()
    this.recomputeAll()
    await this.replayFrom(0)
  }

  /** Recompute everything derived: readable BACnet fields, validation, duplicates. */
  recomputeAll(): void {
    if (!this.project || !this.referenceData) return
    translateBacnetFields(this.project.points, this.referenceData)
    validateAndUpdate(this.project.points, this.referenceData)
    markDuplicateNames(this.project.points)
  }

  reset(): void {
    this.project = null
    this.blocks = []
    this.replay = null
    this.unappliedSteps = 0
    this.runProgress = null
    this.dirty = false
    this.projectPath = null
    this.projectStamp = null
  }
}
