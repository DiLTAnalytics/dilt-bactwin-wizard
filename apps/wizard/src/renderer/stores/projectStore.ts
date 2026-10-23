import { create } from 'zustand'
import { setTableLayout, type TableLayout } from '@/ipc/project'

interface ProjectStore {
  projectName: string
  hasProject: boolean
  labels: Record<string, string>
  /** Bumped when a project is opened or started, which replaces the mapping sequence too. */
  projectLoads: number
  projectReplaced: () => void
  setProject: (name: string, hasProject: boolean) => void
  setLabels: (labels: Record<string, string>) => void
  /** How the point table is laid out, as stored in the project. */
  tableLayout: TableLayout
  /** On opening a project: its stored layout. */
  loadTableLayout: (layout: TableLayout | null) => void
  /** A change by the user, stored with the project. */
  changeTableLayout: (layout: TableLayout) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projectName: '',
  hasProject: false,
  labels: {},
  projectLoads: 0,
  projectReplaced: () => set((s) => ({ projectLoads: s.projectLoads + 1 })),
  setProject: (projectName, hasProject) => set({ projectName, hasProject }),
  setLabels: (labels) => set({ labels }),
  tableLayout: {},
  loadTableLayout: (layout) => set({ tableLayout: layout ?? {} }),
  changeTableLayout: (tableLayout) => {
    set({ tableLayout })
    void setTableLayout(tableLayout)
  },
}))

/** A key's label; `labels` is keyed `block:key`, as the key library is. */
export const labelOf = (labels: Record<string, string>, block: string, key: string): string | undefined =>
  labels[`${block}:${key}`]?.trim() || undefined
