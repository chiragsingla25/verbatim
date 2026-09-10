import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { type AskVersion, type OutlineItem, getAskVersion, manualOutline } from '../lib/api'
import { errMessage } from '../lib/format'
import { instrumentBadge } from '../lib/instrument'

// A landing page for one manual version — what it is, at a glance, and its section outline —
// instead of dropping straight from the library into Ask.
export function Manual() {
  const { versionId = '' } = useParams()
  const [version, setVersion] = useState<AskVersion | null>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    getAskVersion(versionId)
      .then((v) => {
        setVersion(v)
        return manualOutline(versionId).then(setOutline).catch(() => setOutline([]))
      })
      .catch((e) => setError(errMessage(e)))
  }, [versionId])

  if (error) {
    return (
      <div className="page-body">
        <div className="msg err">{error}</div>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/">← Manual library</Link>
        </p>
      </div>
    )
  }
  if (!version) return <div className="page-body">Loading…</div>

  const badge = instrumentBadge(version.instrument?.name)
  const facts = [
    version.edition,
    version.year ? String(version.year) : null,
    version.publisher,
    version.page_count ? `${version.page_count} pages` : null,
  ].filter(Boolean)

  return (
    <>
      <header className="page-head">
        <Link to="/" className="ask-back" style={{ marginLeft: 0 }}>
          ← Manual library
        </Link>
        <div className="manual-hero">
          <span className="inst-badge lg" style={{ background: badge.tint }}>
            {badge.initials}
          </span>
          <div>
            <h1>{version.instrument?.name ?? 'Manual'}</h1>
            <p className="subtitle">{version.title}</p>
          </div>
        </div>
        {facts.length > 0 && <p className="manual-facts">{facts.join(' · ')}</p>}
        {version.supersededBy && (
          <p className="manual-superseded">
            Superseded by{' '}
            <Link to={`/manual/${version.supersededBy.id}`}>{version.supersededBy.title}</Link>
          </p>
        )}
      </header>

      <div className="page-body">
        {version.status === 'active' ? (
          <Link to={`/ask/${version.id}`}>
            <button className="manual-ask">Ask about this manual →</button>
          </Link>
        ) : (
          <p className="msg info">
            This version has been retired — it can’t be queried, but earlier conversations
            still open in “My answers”.
          </p>
        )}

        <h2 style={{ marginTop: '1.75rem' }}>In this manual</h2>
        {outline.length === 0 ? (
          <p className="subtitle">No section outline was detected for this version.</p>
        ) : (
          <ol className="manual-outline">
            {outline.map((o) => (
              <li key={`${o.section}-${o.page}`}>
                <span className="mo-section">{o.section}</span>
                <span className="mo-page">p.{o.page}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  )
}
