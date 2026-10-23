import { useEffect } from 'react'
import { invoke } from '@/ipc/client'
import { unappliedCount, useStepStore } from '@/stores/stepStore'

/** Tells main how many steps have edits not applied yet, so closing or replacing the project asks first. */
export function useUnappliedStepsSync(): void {
  useEffect(() => {
    let last = 0
    return useStepStore.subscribe((state) => {
      const count = unappliedCount(state)
      if (count === last) return
      last = count
      void invoke('project:setUnappliedSteps', count)
    })
  }, [])
}
