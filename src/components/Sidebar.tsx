import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { listVisibleVersions, type LibraryVersion } from '../lib/api'
import { useAuth } from '../lib/auth'
import { type Theme, useTheme } from '../lib/theme'

const THEMES: { key: Theme; label: string }[] = [
  { key: 'system', label: 'Auto' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

function initials(email: string) {
  const name = email.split('@')[0]
  const parts = name.split(/[.\-_]+/).filter(Boolean)
  return (parts[0]?.[0] ?? email[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

// Persistent left rail (Main / Library artboards): brand, nav, the manual list for
// quick version switching, and the user chip + theme control at the foot. Below 760px it
// renders as an off-canvas drawer: `mobileOpen` toggles it, `onNavigate` closes it after a
// link tap.
export function Sidebar({
  mobileOpen = false,
  onNavigate,
}: {
  mobileOpen?: boolean
  onNavigate?: () => void
} = {}) {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { versionId } = useParams()
  const [manuals, setManuals] = useState<LibraryVersion[]>([])
  const canUpload = role === 'contributor' || role === 'admin'

  useEffect(() => {
    listVisibleVersions()
      .then((rows) => setManuals(rows.filter((v) => v.status === 'active')))
      .catch(() => setManuals([]))
  }, [])

  const email = session?.user.email ?? ''

  return (
    <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
      <div className="sidebar-brand">
        <span className="brand-mark">V</span>
        <Link to="/" className="brand-word" onClick={onNavigate}>
          Verbatim
        </Link>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end onClick={onNavigate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z" />
          </svg>
          Manual library
        </NavLink>
        {canUpload && (
          <NavLink to="/upload" onClick={onNavigate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 7l4-4 4 4M4 21h16" />
            </svg>
            Upload manual
          </NavLink>
        )}
      </nav>

      <div className="sidebar-section">Manuals in library</div>
      <div className="sidebar-manuals">
        {manuals.length === 0 && (
          <span className="m-sub" style={{ padding: '4px 10px' }}>
            None published yet.
          </span>
        )}
        {manuals.map((v) => (
          <Link
            key={v.id}
            to={`/ask/${v.id}`}
            className={v.id === versionId ? 'active' : undefined}
            onClick={onNavigate}
          >
            <span className="m-name">{v.instrument?.name ?? 'Manual'}</span>
            <span className="m-sub">
              {v.title}
              {v.year ? ` · ${v.year}` : ''}
            </span>
          </Link>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="user-chip">
          <span className="user-avatar">{email ? initials(email) : '?'}</span>
          <span className="user-meta">
            <span className="u-name">{email}</span>
            <span className="u-role">{role ? `${role} · read & ask` : 'signed in'}</span>
          </span>
        </div>
        <div className="sidebar-foot-row">
          <span className="theme-seg">
            {THEMES.map((t) => (
              <button
                key={t.key}
                className={theme === t.key ? 'on' : undefined}
                onClick={() => setTheme(t.key)}
              >
                {t.label}
              </button>
            ))}
          </span>
          <button
            className="ghost"
            onClick={async () => {
              onNavigate?.()
              await signOut()
              navigate('/signin', { replace: true })
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
