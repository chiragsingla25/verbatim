import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { CheckYourEmail } from '../components/CheckYourEmail'
import { supabase } from '../lib/supabase'

// Request a password-reset email. Supabase sends a recovery link back to
// <BASE_URL>reset-password. Supabase already returns success for unknown addresses, so we
// don't need to hide anything for enumeration — but a genuine send failure (offline, rate
// limit, misconfig) IS shown, so the user isn't left waiting for an email that never comes.
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setBusy(false)
    if (error) {
      setError(
        /rate limit/i.test(error.message)
          ? 'Too many requests just now — wait a minute and try again.'
          : 'Couldn’t send the reset email. Check your connection and try again.',
      )
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <CheckYourEmail>
        If <strong>{email}</strong> has an account, we’ve sent a link to reset its password.
        Open it to choose a new one.
      </CheckYourEmail>
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
        {error && <div className="msg err">{error}</div>}
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
