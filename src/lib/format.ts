// Normalise a thrown value to a display string.
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Short relative date for list rows ("today", "3d ago", "12 Mar 2026").
export function relDate(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
