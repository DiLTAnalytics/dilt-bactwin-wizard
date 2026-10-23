/**
 * Watching the files a project uses for changes from outside the app: a git pull or checkout, another
 * editor, a colleague on a shared drive. Folders are watched rather than files, since a save that
 * renames a temporary file over one ends a watch on the file itself.
 */

import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { SequenceFileEvent, SourceChangedEvent } from '../../shared/channels.js'
import { blockName, parseBlock } from './sequence.js'
import type { EdeSource, GitState, SequenceBlock, Session } from './session.js'
import { fingerprint, stateOf, type SourceState } from './sources.js'

export interface WatchHandlers {
  /** A sequence file was reloaded, found unreadable or deleted. */
  sequenceFile: (event: SequenceFileEvent) => void
  /** A block's Git state or deleted mark changed while its steps stayed the same. */
  status: () => void
  /** The project file was changed or deleted outside; resolves once the user has decided. */
  project: (kind: 'changed' | 'deleted') => Promise<void>
  /** An imported EDE file changed state; it is never imported again by itself. */
  source: (event: SourceChangedEvent) => void
}

type Kind = 'sequence' | 'project' | 'source'

/** Git checkouts delete and recreate files; a file back within this counts as changed, not deleted. */
const SETTLE_MS = 300

const log = (e: unknown) => process.stderr.write(`watcher: ${(e as Error)?.message ?? String(e)}\n`)

/** A file against the last commit of the Git repository it is in; null when clean, not in one, or Git is not there. */
export function gitStatus(path: string): Promise<GitState> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain', '--', basename(path)], { cwd: dirname(path), timeout: 3000 }, (error, stdout) => {
      const line = error ? '' : stdout.split('\n')[0] ?? ''
      resolve(!line ? null : line.startsWith('??') ? 'untracked' : 'modified')
    })
  })
}

export class FileWatcher {
  private readonly folders = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** The content of an unreadable file already reported, so touching it again says nothing new. */
  private readonly unreadable = new Map<string, string>()
  /** Each source's last known state, by path and recorded checksum, so a new import or location starts quietly. */
  private readonly sourceStates = new Map<string, SourceState>()
  /** True while the user is asked about the project file. */
  private asking = false
  /** The project file was touched again while asking. */
  private recheck = false

  constructor(private readonly s: Session, private readonly on: WatchHandlers, private readonly settleMs = SETTLE_MS) {}

  /** The folders watched now. */
  get watching(): string[] {
    return [...this.folders.keys()]
  }

  private sources(): (EdeSource & { path: string })[] {
    return (this.s.project?.header.ede_sources ?? []).filter((source): source is EdeSource & { path: string } => !!source.path)
  }

  private files(): Map<string, Kind> {
    const files = new Map<string, Kind>()
    for (const source of this.sources()) files.set(source.path, 'source')
    for (const b of this.s.blocks) if (b.path) files.set(b.path, 'sequence')
    if (this.s.projectPath && this.s.project) files.set(this.s.projectPath, 'project')
    return files
  }

  /** Watch exactly the folders of the files the project uses now; cheap, so it runs after every change that may touch them. */
  sync(): void {
    const files = this.files()
    const wanted = new Set([...files.keys()].map(dirname))
    for (const [folder, watcher] of this.folders) {
      if (wanted.has(folder)) continue
      watcher.close()
      this.folders.delete(folder)
    }
    for (const folder of wanted) if (!this.folders.has(folder)) this.open(folder)
    for (const [path, timer] of this.timers) {
      if (files.has(path)) continue
      clearTimeout(timer)
      this.timers.delete(path)
    }
    const unchecked = this.s.blocks.filter((b) => b.git === undefined && b.path)
    if (unchecked.length) void this.refreshGit(unchecked)
    const sources = this.sources()
    const keys = new Set(sources.map(sourceKey))
    for (const key of this.sourceStates.keys()) if (!keys.has(key)) this.sourceStates.delete(key)
    for (const source of sources) {
      const key = sourceKey(source)
      if (this.sourceStates.has(key)) continue
      this.sourceStates.set(key, 'current')
      void stateOf(source).then((state) => this.sourceStates.set(key, state), log)
    }
  }

  close(): void {
    for (const watcher of this.folders.values()) watcher.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.folders.clear()
    this.timers.clear()
    this.unreadable.clear()
    this.sourceStates.clear()
  }

  /** Check the Git state of `blocks` again, by default all; a commit outside changes it without touching the file. */
  async refreshGit(blocks: SequenceBlock[] = this.s.blocks): Promise<void> {
    const states = await Promise.all(blocks.map((b) => (b.path ? gitStatus(b.path) : Promise.resolve(null))))
    let changed = false
    blocks.forEach((b, i) => {
      const git = states[i] ?? null
      if ((b.git ?? null) !== git) changed = true
      b.git = git
    })
    if (changed) this.on.status()
  }

  private open(folder: string): void {
    try {
      const watcher = watch(folder, (_event, name) => {
        if (name) this.touched(join(folder, name.toString()))
      })
      watcher.on('error', (e) => {
        log(e)
        watcher.close()
        this.folders.delete(folder)
      })
      this.folders.set(folder, watcher)
    } catch {
      // A folder that is not there is tried again at the next sync.
    }
  }

  private touched(path: string): void {
    if (!this.files().has(path)) return
    clearTimeout(this.timers.get(path))
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path)
      void this.settle(path)
    }, this.settleMs))
  }

  private async settle(path: string): Promise<void> {
    const kind = this.files().get(path)
    if (kind === 'project') return this.settleProject(path)
    if (kind === 'source') return this.settleSource(path)
    try {
      await this.s.exclusive(async () => {
        const block = this.s.blocks.find((b) => b.path === path)
        if (block) await this.reread(block, path)
      })
      await this.refreshGit(this.s.blocks.filter((b) => b.path === path))
    } catch (e) {
      log(e)
    }
  }

  private async reread(block: SequenceBlock, path: string): Promise<void> {
    const name = blockName(block, this.s)
    const where = { name, start: this.s.startOf(block), before: block.steps.length }
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      if (block.missing || block.gone) return
      block.gone = true
      this.unreadable.delete(path)
      this.on.sequenceFile({ ...where, kind: 'deleted', after: block.steps.length })
      return
    }
    if (text === block.text) {
      // Back as it was, e.g. restored by Git.
      if (block.gone) {
        delete block.gone
        this.on.status()
      }
      return
    }
    let parsed: ReturnType<typeof parseBlock>
    try {
      parsed = parseBlock(text)
    } catch (e) {
      if (this.unreadable.get(path) === text) return
      this.unreadable.set(path, text)
      this.on.sequenceFile({ ...where, kind: 'unreadable', after: block.steps.length, message: (e as Error).message })
      return
    }
    this.unreadable.delete(path)
    block.steps = parsed.steps
    block.text = text
    delete block.missing
    delete block.gone
    await this.s.replayFrom(where.start)
    this.on.sequenceFile({ ...where, kind: 'reloaded', after: block.steps.length })
  }

  private async settleProject(path: string): Promise<void> {
    if (this.asking) {
      this.recheck = true
      return
    }
    this.asking = true
    try {
      const kind = await this.s.exclusive(() => this.projectChange(path))
      if (kind) await this.on.project(kind)
    } catch (e) {
      log(e)
    } finally {
      this.asking = false
    }
    if (!this.recheck) return
    this.recheck = false
    if (this.s.projectPath) await this.settleProject(this.s.projectPath)
  }

  /** How the project file differs from what the app last read or wrote; null when it does not. */
  private async projectChange(path: string): Promise<'changed' | 'deleted' | null> {
    const stamp = this.s.projectStamp
    if (this.s.projectPath !== path || !stamp) return null
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'deleted' : null
    }
    const now = fingerprint(bytes)
    return now.size === stamp.size && now.sha256 === stamp.sha256 ? null : 'changed'
  }

  private async settleSource(path: string): Promise<void> {
    try {
      for (const source of this.sources().filter((x) => x.path === path)) {
        const key = sourceKey(source)
        const state = await stateOf(source)
        if (this.sourceStates.get(key) === state) continue
        this.sourceStates.set(key, state)
        this.on.source({ filename: source.filename, state })
      }
    } catch (e) {
      log(e)
    }
  }
}

const sourceKey = (source: EdeSource) => `${source.path}\u0000${source.sha256 ?? ''}`
