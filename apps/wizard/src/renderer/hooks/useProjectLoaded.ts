import { useQueryClient } from '@tanstack/react-query'
import { getLabels, getSettings } from '@/ipc/project'
import { useProjectStore } from '@/stores/projectStore'

/** Returns the refresh to run after a project was opened, started or imported into, or its plugins changed. */
export function useProjectLoaded(): () => Promise<void> {
  const queryClient = useQueryClient()
  const { setProject, setLabels, loadTableLayout } = useProjectStore()
  return async () => {
    const [settings, labels] = await Promise.all([getSettings(), getLabels()])
    setProject(settings.project_name, settings.has_project)
    setLabels(labels)
    loadTableLayout(settings.table_layout)
    // A project carries its data, sequence and plugins: nothing cached for the previous one is valid.
    await queryClient.invalidateQueries()
  }
}
