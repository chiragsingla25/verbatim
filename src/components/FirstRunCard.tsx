import { useState } from 'react'

const KEY = 'verbatim.onboarded'

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true // storage blocked → don't nag
  }
}

// One-card orientation, shown once on the library. Sets the mental model: one edition,
// a page citation, or an honest "not in here".
export function FirstRunCard() {
  const [hidden, setHidden] = useState(seen)
  if (hidden) return null

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  return (
    <div className="firstrun">
      <div className="firstrun-body">
        <h2>How Verbatim works</h2>
        <p>
          Pick <strong>one edition</strong> of a manual and ask a question. You get an answer
          quoted from <em>that edition</em>, with a page citation — or an honest{' '}
          <em>“not found in this version.”</em> Nothing is blended across editions, and it
          never guesses from the open web.
        </p>
      </div>
      <button className="secondary" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
