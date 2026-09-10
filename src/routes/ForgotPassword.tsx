import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { supabase } from '../lib/supabase'

// Request a password-reset email. Supabase sends a recovery link back to
// <BASE_URL>reset-password. The confirmation panel is shown regardless of the result so an
// attacker can't probe which addresses are registered.
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) console.warn('resetPasswordForEmail:', error.message) // never surfaced
    setBusy(false)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell>
        <h2>Check your email</h2>
        <div className="msg ok">
          If <strong>{email}</strong> has an account, we’ve sent a link to reset its password.
          Open it to choose a new one.
        </div>
        <p className="af-foot">
          <Link to="/signin">Back to sign in</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h2>Reset your password</h2>
      <p className="af-lead">
        Enter your account email and we’ll send you a link to set a new password.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="af-foot">
        Remembered it? <Link to="/signin">Sign in</Link>
      </p>
    </AuthShell>
  )
}
