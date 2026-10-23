/**
 * The mapping sequence: its blocks (one file each), and every change to it. A change is written to its
 * block's file at once and the data is recalculated from the first step it affects.
 */

import { access, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { readSequence, SequenceTooNewError, sequenceToFile, type SequenceStep } from '@bactwin/mapping-engine'

import { writeFileSafely } from './files.js'
import type { GitState, SequenceBlock, Session } from './session.js'

export interface StepSummary {
  /** Points the step's filter selected. */
  hits: number
  /** Points it changed. */
  changed: number
  skipped: number
}

/** A step's counts in the sequence view, with how it collides with other steps. */
export interface StepOutcomeView extends StepSummary {
  /** Earlier steps whose values this one changed again, as [step, values]. */
  overwrites: [number, number][]
  /** Later steps that changed its values again, as [step, values]. */
  overwrittenBy: [number, number][]
  /** Every value it changed was changed again later, so it has no effect. */
  noEffect: boolean
}

export interface BlockSummary {
  name: string
  path: string | null
  missing: boolean
  /** Deleted while open; its steps still run. */
  gone: boolean
  git: GitState
  /** Index of its first step in the whole sequence. */
  start: number
  count: number
}

export interface SequenceView {
  schema_version: string
  steps: SequenceStep[]
  /** Per step, what it did on the current data; null while it has not run yet. */
  outcomes: (StepOutcomeView | null)[]
  blocks: BlockSummary[]
}

/** A place in the sequence: a block, and the position among its steps. */
export interface StepPosition {
  block: number
  position: number
}

export const blockName = (block: SequenceBlock, s: Session) =>
  block.path ? basename(block.path).replace(/\.json$/, '') : s.t('files.sequenceName')

export function getSequence(s: Session): SequenceView {
  const sequence = s.sequence
  const collisions = s.replay?.collisions()
  return {
    ...sequence,
    outcomes: sequence.steps.map((_, i) => {
      const o = s.replay?.outcome(i)
      const c = collisions?.[i]
      return o && c ? { ...summaryOf(s, i), overwrites: c.overwrites, overwrittenBy: c.overwrittenBy, noEffect: c.changed > 0 && c.overwritten === c.changed } : null
    }),
    blocks: s.blocks.map((b) => ({
      name: blockName(b, s), path: b.path, missing: !!b.missing, gone: !!b.gone, git: b.git ?? null, start: s.startOf(b), count: b.steps.length,
    })),
  }
}

/** Write a block to its file; a block created before the project was first saved has none and is written with the project. */
export async function writeBlock(block: SequenceBlock): Promise<void> {
  if (!block.path || block.missing) return
  const text = `${JSON.stringify(sequenceToFile({ schema_version: '', steps: block.steps }), null, 2)}\n`
  await writeFileSafely(block.path, text)
  block.text = text
}

/** Read a block's file; a file that is gone yields an empty block marked missing. */
export async function readBlock(path: string): Promise<SequenceBlock> {
  try {
    return await readBlockAt(path)
  } catch (e) {
    if (e instanceof SequenceTooNewError) e.file = path
    throw e
  }
}

async function readBlockAt(path: string): Promise<SequenceBlock> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return { path, steps: [], missing: true }
  }
  return { path, ...parseBlock(content) }
}

/** A sequence file's content as a block's steps; throws when it is not valid JSON or not a sequence. */
export function parseBlock(text: string): Pick<SequenceBlock, 'steps' | 'text'> {
  return { steps: readSequence(JSON.parse(text)).steps, text }
}

/**
 * `<Projekt>.sequence.json` beside the project, or `<Projekt>-2.sequence.json` and so on when a block
 * already uses it; with `onDisk`, an existing file counts as taken too, so its old steps are not reused.
 */
export async function sequencePathFor(s: Session, projectPath: string, onDisk: boolean): Promise<string> {
  const stem = basename(projectPath, extname(projectPath))
  for (let n = 1; ; n++) {
    const path = join(dirname(projectPath), `${n === 1 ? stem : `${stem}-${n}`}.sequence.json`)
    if (s.blocks.some((b) => b.path === path)) continue
    if (onDisk && (await access(path).then(() => true, () => false))) continue
    return path
  }
}

/** Refuse a change to a block whose file is missing or was deleted, since it cannot be written. */
function requireWritable(s: Session, block: SequenceBlock): void {
  if (block.missing) throw new Error(s.t('error.sequenceFileMissing', { name: blockName(block, s) }))
  if (block.gone) throw new Error(s.t('error.sequenceFileGone', { name: blockName(block, s) }))
}

/** The block a step can go into. */
function usableBlock(s: Session, index: number): SequenceBlock {
  const block = s.blocks[index]
  if (!block) throw new Error(s.t('error.noSuchBlock', { block: index + 1 }))
  requireWritable(s, block)
  return block
}

/** Where a new step goes by default: the last block that can take it, or a new file beside the project. */
async function defaultBlock(s: Session): Promise<SequenceBlock> {
  const last = s.blocks.filter((b) => !b.missing && !b.gone).at(-1)
  if (last) return last
  const block: SequenceBlock = { path: s.projectPath ? await sequencePathFor(s, s.projectPath, true) : null, steps: [] }
  s.blocks.push(block)
  return block
}

function summaryOf(s: Session, index: number): StepSummary {
  const o = s.replay?.outcome(index)
  return { hits: o?.hits.length ?? 0, changed: o?.changedPoints ?? 0, skipped: o?.skipped ?? 0 }
}

/** A change to the sequence: refused during a recalculation, written, then recalculated from `from`. */
async function change(s: Session, edit: () => { from: number; blocks: SequenceBlock[] }): Promise<void> {
  s.requireIdle()
  const { from, blocks } = edit()
  s.dirty = true
  await Promise.all([...new Set(blocks)].map(writeBlock))
  await s.replayFrom(from)
}

/** Insert a step at `at`, by default at the end of the sequence, and run it. */
export function insertStep(s: Session, step: SequenceStep, at?: StepPosition): Promise<StepSummary> {
  return s.exclusive(async () => {
    s.requireIdle()
    const block = at ? usableBlock(s, at.block) : await defaultBlock(s)
    const position = Math.min(at?.position ?? block.steps.length, block.steps.length)
    const index = s.startOf(block) + position
    await change(s, () => {
      block.steps.splice(position, 0, step)
      return { from: index, blocks: [block] }
    })
    return summaryOf(s, index)
  })
}

/** Replace step `index`; the data then looks as if it had always been this step. */
export function replaceStep(s: Session, index: number, step: SequenceStep): Promise<StepSummary> {
  return s.exclusive(async () => {
    await change(s, () => {
      const { block, local } = s.locate(index)
      requireWritable(s, block)
      block.steps[local] = { ...step, ...(block.steps[local]?.disabled ? { disabled: true } : {}) }
      return { from: index, blocks: [block] }
    })
    return summaryOf(s, index)
  })
}

export function deleteStep(s: Session, index: number): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    await change(s, () => {
      const { block, local } = s.locate(index)
      requireWritable(s, block)
      block.steps.splice(local, 1)
      return { from: index, blocks: [block] }
    })
    return { steps: s.sequence.steps.length }
  })
}

export function setDisabled(s: Session, index: number, disabled: boolean): Promise<StepSummary> {
  return s.exclusive(async () => {
    await change(s, () => {
      const { block, local } = s.locate(index)
      requireWritable(s, block)
      const { disabled: _, ...step } = block.steps[local]!
      block.steps[local] = disabled ? { ...step, disabled: true } : step
      return { from: index, blocks: [block] }
    })
    return summaryOf(s, index)
  })
}

/** Move step `index` to `to`, counted after it has left its place; it may change blocks. */
export function moveStep(s: Session, index: number, to: StepPosition): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    s.requireIdle()
    const { block: from, local } = s.locate(index)
    requireWritable(s, from)
    const target = usableBlock(s, to.block)
    if (target !== from || to.position !== local) {
      await change(s, () => {
        const [step] = from.steps.splice(local, 1)
        const position = Math.min(to.position, target.steps.length)
        target.steps.splice(position, 0, step!)
        return { from: Math.min(index, s.startOf(target) + position), blocks: [from, target] }
      })
    }
    return { steps: s.sequence.steps.length }
  })
}

/** Move block `from` to place `to` among the blocks. */
export function moveBlock(s: Session, from: number, to: number): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    s.requireIdle()
    const block = s.blocks[from]
    const there = s.blocks[to]
    if (block && there && from !== to) {
      const first = Math.min(s.startOf(block), s.startOf(there))
      s.blocks.splice(to, 0, ...s.blocks.splice(from, 1))
      s.dirty = true
      await s.replayFrom(first)
    }
    return { steps: s.sequence.steps.length }
  })
}

/**
 * Link sequence files, e.g. ones shared between projects. They run after every block there is, in the
 * order of their names, so numbered files (01_..., 02_...) keep theirs. Files already linked are named back.
 */
export function linkBlocks(s: Session, paths: string[]): Promise<{ steps: number; alreadyLinked: string[] }> {
  return s.exclusive(async () => {
    s.requireIdle()
    const alreadyLinked = paths.filter((p) => s.blocks.some((b) => b.path === p))
    const fresh = [...new Set(paths.filter((p) => !alreadyLinked.includes(p)))].sort((a, b) => basename(a).localeCompare(basename(b), 'de', { numeric: true }))
    const linked = await Promise.all(fresh.map((p) => readBlock(p)))
    if (linked.length) {
      const start = s.sequence.steps.length
      s.blocks.push(...linked)
      s.dirty = true
      await s.replayFrom(start)
    }
    return { steps: s.sequence.steps.length, alreadyLinked: alreadyLinked.map((p) => basename(p)) }
  })
}

/** Write an empty sequence file at `path` and link it at the end; a file this project already links is refused. */
export function createBlock(s: Session, path: string): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    s.requireIdle()
    if (s.blocks.some((b) => b.path === path)) throw new Error(s.t('error.sequenceAlreadyLinked', { name: basename(path) }))
    const block: SequenceBlock = { path, steps: [] }
    await writeBlock(block)
    s.blocks.push(block)
    s.dirty = true
    return { steps: s.sequence.steps.length }
  })
}

/** Point a block whose file was not found at `path`, read its steps and recalculate from there. */
export function locateBlock(s: Session, blockIndex: number, path: string): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    s.requireIdle()
    const block = s.blocks[blockIndex]
    if (!block) throw new Error(s.t('error.noSuchBlock', { block: blockIndex + 1 }))
    if (s.blocks.some((b) => b !== block && b.path === path)) throw new Error(s.t('error.sequenceAlreadyLinked', { name: basename(path) }))
    const found = await readBlock(path)
    if (found.missing) throw new Error(s.t('error.sequenceNotReadable', { name: basename(path) }))
    s.blocks[blockIndex] = found
    s.dirty = true
    await s.replayFrom(s.startOf(found))
    return { steps: s.sequence.steps.length }
  })
}

/** Stop using a sequence file; the file itself stays as it is. */
export function unlinkBlock(s: Session, blockIndex: number): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    s.requireIdle()
    const block = s.blocks[blockIndex]
    if (!block) return { steps: s.sequence.steps.length }
    const start = s.startOf(block)
    s.blocks.splice(blockIndex, 1)
    s.dirty = true
    await s.replayFrom(start)
    return { steps: s.sequence.steps.length }
  })
}

/** Write a block's steps to its file again, e.g. after the file was deleted while open. */
export function restoreBlock(s: Session, blockIndex: number): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    const block = s.blocks[blockIndex]
    if (!block) throw new Error(s.t('error.noSuchBlock', { block: blockIndex + 1 }))
    if (block.missing) throw new Error(s.t('error.sequenceFileMissing', { name: blockName(block, s) }))
    delete block.gone
    await writeBlock(block)
    return { steps: s.sequence.steps.length }
  })
}

/** Write a block's steps to `path` and use that file from now on; a file another block links is refused. */
export function saveBlockAs(s: Session, blockIndex: number, path: string): Promise<{ steps: number }> {
  return s.exclusive(async () => {
    const block = s.blocks[blockIndex]
    if (!block) throw new Error(s.t('error.noSuchBlock', { block: blockIndex + 1 }))
    if (block.missing) throw new Error(s.t('error.sequenceFileMissing', { name: blockName(block, s) }))
    if (s.blocks.some((b) => b !== block && b.path === path)) throw new Error(s.t('error.sequenceAlreadyLinked', { name: basename(path) }))
    const previous = block.path
    block.path = path
    try {
      await writeBlock(block)
    } catch (e) {
      block.path = previous
      throw e
    }
    delete block.gone
    delete block.git
    s.dirty = true
    return { steps: s.sequence.steps.length }
  })
}
