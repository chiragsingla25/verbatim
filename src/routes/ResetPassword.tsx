import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

// Landing page for the recovery link. supabase-js (detectSessionInUrl) parses the
// #access_token=…&type=recovery hash and fires onAuthStateChange('PASSWORD_RECOVERY').
// Once we have that (or any session from the parsed hash) we show the set-password form;
// updateUser keeps the session, so a successful reset lands straight in the app.
export function ResetPassword() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [recovered, setRecovered] = useState(false)
  const [slow, setSlow] = useState(false)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The recovery link's hash yields a PASSWORD_RECOVERY event (detectSessionInUrl). If it
    // fired before mount, AuthProvider already holds the session — hence the `|| session`.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovered(true)
    })
    const t = setTimeout(() => setSlow(true), 4000)
    return () => {
      data.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  const ready = recovered || !!session

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
