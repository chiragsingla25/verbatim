import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteVersion, listVisibleVersions, type LibraryVersion } from '../lib/api'
import { useAuth } from '../lib/auth'
import { confirmDeleteVersion } from '../lib/ui'

// The manual library (Library artboard). RLS returns status='active' for anyone, plus the
// caller's own pending uploads — a contributor sees their in-review versions with a link
// back to review; a fresh student sees the empty state.
export function Library() {
  const { role } = useAuth()
  const [rows, setRows] = useState<LibraryVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const canUpload = role === 'contributor' || role === 'admin'

  const reload = useCallback(() => {
    listVisibleVersions()
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  useEffect(reload, [reload])

  async function discard(v: LibraryVersion) {
    if (!confirmDeleteVersion(v.title)) return
    setError(null)
    setBusyId(v.id)
    try {
      await deleteVersion(v.id)
      reload()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusyId(null)
    }
  }

  const active = rows?.filter((v) => v.status === 'active') ?? []
  const mine = rows?.filter((v) => v.status !== 'active') ?? []
  const instruments = new Set(active.map((v) => v.instrument?.slug ?? v.id)).size

  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <h1>Manual library</h1>
            <p className="subtitle">
              {rows
                ? `${instruments} instrument${instruments === 1 ? '' : 's'} · ${active.length} version${active.length === 1 ? '' : 's'} indexed · every answer is scoped to one version`
                : 'Loading…'}
            </p>
          </div>
          {canUpload && (
            <Link to="/upload">
              <button>+ Upload manual</button>
            </Link>
          )}
        </div>
      </header>

      <div className="page-body">
        {error && <div className="msg err">{error}</div>}

        {rows && active.length === 0 && mine.length === 0 && (
          <p className="empty">
            No published manuals yet.
            <br />
            A contributor needs to upload and publish one.
          </p>
        )}

        {active.length > 0 && (
          <>
            <div className="lib-table-head">
              <span>Instrument &amp; document</span>
              <span>Edition</span>
              <span>License</span>
              <span>Status</span>
            </div>
            {active.map((v) => (
              <Link key={v.id} to={`/ask/${v.id}`} className="lib-row">
                <span className="r-name">
                  <span className="r-title">{v.instrument?.name ?? 'Unknown instrument'}</span>
                  <span className="r-sub">
                    {v.title}
                    {v.publisher ? ` · ${v.publisher}` : ''}
                  </span>
                  {v.supersededBy && (
                    <span className="r-superseded">superseded by {v.supersededBy.title}</span>
                  )}
                </span>
                <span className="r-cell">
                  {v.edition ?? '—'}
                  {v.year ? ` · ${v.year}` : ''}
                </span>
                <span>
                  <span className="pill green">Public domain</span>
                </span>
                <span>
                  <span className="pill green">
                    <span className="dot" />
                    Active
                  </span>
                </span>
              </Link>
            ))}
          </>
        )}

        {mine.length > 0 && (
          <>
            <div className="lib-group-label">Your uploads in progress</div>
            {mine.map((v) => (
              <div key={v.id} className="lib-row pending">
                <span className="r-name">
                  <span className="r-title">{v.instrument?.name ?? 'Unknown instrument'}</span>
                  <span className="r-sub">{v.title}</span>
                </span>
                <span className="r-cell">
                  {v.edition ?? '—'}
                  {v.year ? ` · ${v.year}` : ''}
                </span>
                <span>
                  <span className="pill green">Public domain</span>
                </span>
                <span className="lib-pending-actions">
                  <Link to={`/review/${v.id}`} className="r-review">
                    {v.ingestState === 'failed' ? 'failed' : v.status} · Review →
                  </Link>
                  {(v.ingestState === 'failed' || v.ingestState === 'rejected') && (
                    <button
                      className="danger sm"
                      disabled={busyId === v.id}
                      onClick={() => discard(v)}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}
