import { useEffect, useState } from 'react'

const PREFIX = 'bactwin.ui.'

/** UI state remembered across restarts (collapsed sections, column choices); falls back to `initial`. */
export function useStoredState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Not remembering is harmless.
    }
  }, [key, value])
  return [value, setValue]
}
