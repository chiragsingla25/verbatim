import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// Landing page for the email-confirmation link. supabase-js (detectSessionInUrl) parses the
// #access_token=… hash and fires onAuthStateChange; we just wait for the session then go home.
export function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])

  return (
    <main className="wrap">
      <h1>Confirming…</h1>
      {!loading && !session && slow && (
        <div className="msg info">
          This link may have expired or already been used.{' '}
          <Link to="/signin">Try signing in</Link>.
        </div>
      )}
    </main>
  )
}
