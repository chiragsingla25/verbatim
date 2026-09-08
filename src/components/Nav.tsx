import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Nav() {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()
  const canUpload = role === 'contributor' || role === 'admin'

  return (
    <header className="topbar">
      <span>
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          Verbatim
        </Link>
        {session && canUpload && (
          <Link to="/upload" style={{ marginLeft: '1rem', fontSize: '0.9rem' }}>
            upload
          </Link>
        )}
      </span>
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
