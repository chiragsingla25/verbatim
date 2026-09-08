import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

const THEME_LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' } as const

export function Nav() {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, cycle } = useTheme()
  const canUpload = role === 'contributor' || role === 'admin'

  return (
    <header className="topbar">
      <span style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link to="/" className="brand">
          Verbatim
        </Link>
        {session && canUpload && (
          <Link to="/upload" style={{ fontSize: '0.85rem', color: 'var(--om-text-secondary)' }}>
            Upload
          </Link>
        )}
      </span>
      <span className="who">
        <button className="theme-toggle" onClick={cycle} title="Toggle colour theme">
          {THEME_LABEL[theme]}
        </button>
        {session && (
          <>
            <span>
              {session.user.email}
              {role ? ` · ${role}` : ''}
            </span>
            <button
              className="link"
              onClick={async () => {
                await signOut()
                navigate('/signin', { replace: true })
              }}
            >
              sign out
            </button>
          </>
        )}
        {!session && <Link to="/signin">sign in</Link>}
      </span>
    </header>
  )
}
