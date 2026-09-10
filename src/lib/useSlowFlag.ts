import { useEffect, useState } from 'react'

// Flips to true after `ms`. Used by the auth landing pages to show an "expired / already
// used" fallback only once a link has clearly failed to establish a session.
export function useSlowFlag(ms: number): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return slow
}
