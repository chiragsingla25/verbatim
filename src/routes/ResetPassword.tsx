import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useSlowFlag } from '../lib/useSlowFlag'

// Captured at module load — before supabase-js's detectSessionInUrl strips the hash — so we
// can tell a real recovery landing from a signed-in user who just wandered onto this route.
const HAD_RECOVERY_HASH =
  typeof window !== 'undefined' &&
  (window.location.hash.includes('type=recovery') || window.location.hash.includes('access_token'))

// Landing page for the recovery link. supabase-js parses the #…&type=recovery hash and fires
// onAuthStateChange('PASSWORD_RECOVERY'); updateUser keeps the session, so a successful reset
// lands straight in the app.
export function ResetPassword() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [recovered, setRecovered] = useState(false)
  const slow = useSlowFlag(4000)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovered(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Show the form only when we have a session that arrived via a recovery link — not for a
  // user who is merely already signed in.
  const ready = recovered || (!!session && HAD_RECOVERY_HASH)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pw !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/', { replace: true })
  }

  if (!ready)
    return (
      <AuthShell>
        <h2>Reset your password</h2>
        {slow ? (
          <>
            <div className="msg err">This reset link has expired or was already used.</div>
            <p className="af-foot">
              <Link to="/forgot-password">Request a new link</Link>
            </p>
          </>
        ) : (
          <p className="af-lead">Checking your reset link…</p>
        )}
      </AuthShell>
    )

  return (
    <AuthShell>
      <h2>Set a new password</h2>
      <form onSubmit={onSubmit}>
        <label htmlFor="password">New password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <label htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <div className="msg err">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set password & continue'}
        </button>
      </form>
    </AuthShell>
  )
}
