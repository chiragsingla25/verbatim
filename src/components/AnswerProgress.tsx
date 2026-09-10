import { useEffect, useState } from 'react'

// The wait between asking and an answer. The pipeline really does run in this order
// (retrieve → draft → verify), so the labels are honest about WHAT is happening — but
// they advance on a timer, not on real progress events. Real token streaming with true
// stage events is a separate spec; this just replaces a dead spinner with something that
// shows the work. Holds on the last label until the parent unmounts it (answer arrived).
const STAGES = [
  'Finding the relevant pages…',
  'Reading the manual…',
  'Drafting the answer…',
  'Checking every claim against the source…',
]
const STEP_MS = 2600

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function AnswerProgress() {
  const [i, setI] = useState(0)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setI((n) => Math.min(n + 1, STAGES.length - 1)), STEP_MS)
    return () => clearInterval(t)
  }, [reduced])

  return (
    <p className="turn-pending answer-progress" aria-live="polite">
      <span className="answer-progress-dot" aria-hidden="true" />
      {reduced ? STAGES[1] : STAGES[i]}
    </p>
  )
}
