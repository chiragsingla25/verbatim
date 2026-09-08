import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
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
      <main className="wrap">
        <h1>Check your email</h1>
        <div className="msg ok">
          We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your
          account, then sign in.
        </div>
        <p style={{ marginTop: '1.5rem' }}>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </main>
    )
  }

  return (
    <main className="wrap">
      <h1>Create an account</h1>
      <p style={{ color: 'var(--muted)' }}>
        Everyone starts as a student — ask questions against a manual version. Contributors
        (upload &amp; version manuals) are promoted by an admin.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
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
      <p style={{ marginTop: '1.25rem' }}>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </main>
  )
}
