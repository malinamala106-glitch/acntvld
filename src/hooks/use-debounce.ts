'use client'
import { useEffect, useState } from 'react'

/**
 * Debounce a value — returns a new value that only updates
 * after `delay` ms have passed without changes.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
