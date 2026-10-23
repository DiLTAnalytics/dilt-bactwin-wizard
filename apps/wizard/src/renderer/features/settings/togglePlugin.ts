/** Switching plugins with what they require: on brings its requirements along, off takes the plugins that need it along. */

interface Requiring {
  id: string
  requires: string[]
}

export interface Toggled {
  checked: string[]
  /** Plugins switched along with the one clicked. */
  along: string[]
}

export function togglePlugin(plugins: Requiring[], checked: string[], id: string, on: boolean): Toggled {
  const next = new Set(checked)
  const along: string[] = []
  const visit = (pid: string) => {
    if (next.has(pid) === on) return
    if (on) next.add(pid)
    else next.delete(pid)
    if (pid !== id) along.push(pid)
    const related = on
      ? plugins.find((p) => p.id === pid)?.requires ?? []
      : plugins.filter((p) => p.requires.includes(pid)).map((p) => p.id)
    related.filter((r) => plugins.some((p) => p.id === r)).forEach(visit)
  }
  visit(id)
  return { checked: [...next], along }
}
