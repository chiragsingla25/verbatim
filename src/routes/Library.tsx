import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listVisibleVersions, type LibraryVersion } from '../lib/api'

// The manual library. RLS (manual_versions_select_visible) returns status='active' for
// anyone, plus the caller's own pending uploads — so a contributor sees their in-review
// versions here with a link back to review. A fresh student sees the empty state.
export function Library() {
  const [rows, setRows] = useState<LibraryVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listVisibleVersions()
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const active = rows?.filter((v) => v.status === 'active') ?? []
  const mine = rows?.filter((v) => v.status !== 'active') ?? []

  return (
    <main className="wrap">
      <h1>Manuals</h1>
      {error && <div className="msg err">{error}</div>}
      {rows === null && !error && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      {rows && active.length === 0 && mine.length === 0 && (
        <p className="empty">
          No published manuals yet.
          <br />
          A contributor needs to upload and publish one.
        </p>
      )}

      {active.length > 0 && (
        <ul className="manual-list">
          {active.map((v) => (
            <li key={v.id}>
              <Link to={`/ask/${v.id}`} className="row">
                <div className="title">{v.instrument?.name ?? 'Unknown instrument'}</div>
                <div className="meta">
                  {v.title}
                  {v.edition ? ` · ${v.edition}` : ''}
                  {v.year ? ` · ${v.year}` : ''}
                  {v.publisher ? ` · ${v.publisher}` : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {mine.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem', fontSize: '1.05rem' }}>Your uploads in progress</h2>
          <ul className="manual-list">
            {mine.map((v) => (
              <li key={v.id}>
                <div className="title">
                  {v.instrument?.name ?? 'Unknown instrument'}{' '}
                  <span className="meta" style={{ fontWeight: 400 }}>· {v.status}</span>
                </div>
                <div className="meta">
                  {v.title} · <Link to={`/review/${v.id}`}>review</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
