import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from './AuthShell'

// Shared "Check your email" confirmation panel — signup (email confirm) and forgot-password
// (recovery link) both land here.
export function CheckYourEmail({
  active,
  children,
}: {
  active?: 'signin' | 'signup'
  children: ReactNode
}) {
  return (
    <AuthShell active={active}>
      <h2>Check your email</h2>
      <div className="msg ok">{children}</div>
      <p className="af-foot">
        <Link to="/signin">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
