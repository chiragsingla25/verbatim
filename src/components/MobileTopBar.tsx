import { Link } from 'react-router-dom'

// Shown only < 760px (CSS). Brand + a hamburger that opens the Sidebar as a drawer.
export function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="mobile-topbar">
      <Link to="/" className="mt-brand">
        <span className="brand-mark">V</span>
        <span className="brand-word">Verbatim</span>
      </Link>
      <button className="mt-menu" onClick={onMenu} aria-label="Open menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </header>
  )
}
