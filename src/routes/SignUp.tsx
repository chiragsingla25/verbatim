import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { CheckYourEmail } from '../components/CheckYourEmail'
import { supabase } from '../lib/supabase'

// Self-serve signup — anyone becomes a `student` (the handle_new_user trigger sets the
// role; profiles default is 'student'). Email confirmation is mandatory: Supabase sends a
// link back to <BASE_URL>auth/callback.
export function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  if (sent) {
    return (
      <CheckYourEmail active="signup">
        We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your
        account, then sign in.
      </CheckYourEmail>
    )
  }

  return (
    <AuthShell active="signup">
      <h2>Create your account</h2>
      <p className="af-lead">
        Everyone starts as a <strong>student</strong> — ask questions against a manual version.
        Contributors are promoted by an admin.
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
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="msg err">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="af-foot">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </AuthShell>
  )
}
