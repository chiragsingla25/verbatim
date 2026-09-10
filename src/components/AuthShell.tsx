import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const CHECK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

// Split brand + form layout for /signin and /signup (SignIn artboard). The
// forgot-password / reset-password screens reuse it with no `active` tab.
export function AuthShell({
  active,
  children,
}: {
  active?: 'signin' | 'signup'
  children: ReactNode
}) {
  return (
    <div className="auth-split">
      <div className="auth-brand">
        <div className="ab-row">
          <span className="ab-mark">V</span>
          <span className="ab-word">Verbatim</span>
        </div>
        <div>
          <h1>Answers only from the manual version you choose.</h1>
          <p>
            A grounded question-and-answer workspace for psychological test manuals. Every response
            is quoted from one selected edition, with the page shown beside it — and “not found”
            when the manual doesn’t say.
          </p>
        </div>
        <div className="ab-points">
          <div>{CHECK} Version-locked retrieval — no cross-edition bleed</div>
          <div>{CHECK} Page-level citations on every claim</div>
          <div>{CHECK} Uploads gated to approved contributors</div>
        </div>
      </div>

      <div className="auth-form-pane">
        <div className="auth-form">
          {active && (
            <div className="auth-tabs">
              <Link to="/signin" className={active === 'signin' ? 'on' : undefined}>
                Sign in
              </Link>
              <Link to="/signup" className={active === 'signup' ? 'on' : undefined}>
                Create account
              </Link>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
