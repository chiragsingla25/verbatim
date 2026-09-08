import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Nav() {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        Verbatim
      </Link>
      {session ? (
        <span className="who">
          {session.user.email}
          {role ? ` · ${role}` : ''} ·{' '}
          <button
            className="link"
            onClick={async () => {
              await signOut()
              navigate('/signin', { replace: true })
            }}
          >
            sign out
          </button>
        </span>
      ) : (
        <span className="who">
          <Link to="/signin">sign in</Link>
        </span>
      )}
    </header>
  )
}
