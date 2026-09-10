import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { startManualUpload } from '../lib/api'

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Contributor uploads a manual version. Metadata + a rights attestation create the pending
// manual_versions row; the PDF then goes up via a signed URL. The parse runs asynchronously
// and lands the version in review.
export function Upload() {
  const navigate = useNavigate()
  const [instrumentName, setInstrumentName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [title, setTitle] = useState('')
  const [edition, setEdition] = useState('')
  const [year, setYear] = useState('')
  const [publisher, setPublisher] = useState('')
  const [attestation, setAttestation] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (instrumentName.trim().length < 2) return setError('Instrument name is too short.')
    if (title.trim().length < 2) {
      return setError('Version title is too short — name the edition, e.g. “PSS-10, 1994 scoring sheet”.')
    }
    if (!file) return setError('Choose a PDF to upload.')
    if (!attestation) return setError('You must confirm you have the right to store this document.')
    setBusy(true)
    try {
      const { versionId } = await startManualUpload(
        {
          instrumentName,
          slug: slug || slugify(instrumentName),
          title,
          licenseClass: 'public_domain',
          attestation,
          edition: edition || undefined,
          year: year ? Number(year) : undefined,
          publisher: publisher || undefined,
        },
        file,
      )
      navigate(`/review/${versionId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-head">
        <Link to="/" className="ask-back" style={{ marginLeft: 0 }}>
          ← Manual library
        </Link>
        <h1 style={{ marginTop: 8 }}>Upload a manual version</h1>
        <p className="subtitle">
          v1 accepts <strong>public-domain instruments only</strong> (PHQ-9, GAD-7, PSS, IPIP
          scales…). Every upload is recorded with your identity in the audit log.
        </p>
      </header>

      <div className="page-body">
        <form onSubmit={onSubmit} className="card" style={{ maxWidth: '40rem' }}>
          <label htmlFor="instrument">Instrument name</label>
          <input
            id="instrument"
            required
            value={instrumentName}
            onChange={(e) => {
              setInstrumentName(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
            placeholder="Perceived Stress Scale"
          />
          <label htmlFor="slug">Slug</label>
          <input
            id="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugTouched(true)
            }}
            placeholder="perceived-stress-scale"
          />
          <label htmlFor="title">Version title</label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PSS-10, 1994 scoring sheet"
          />
          <label htmlFor="edition">Edition (optional)</label>
          <input id="edition" value={edition} onChange={(e) => setEdition(e.target.value)} />
          <label htmlFor="year">Year (optional)</label>
          <input
            id="year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="1994"
          />
          <label htmlFor="publisher">Publisher (optional)</label>
          <input id="publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          <label htmlFor="file">PDF</label>
          <input
            id="file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label
            style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '1.1rem', fontWeight: 400 }}
          >
            <input
              type="checkbox"
              style={{ width: 'auto', marginTop: '0.2rem' }}
              checked={attestation}
              onChange={(e) => setAttestation(e.target.checked)}
            />
            <span>
              I confirm this is a public-domain instrument and I have the right to store and share it
              here.
            </span>
          </label>
          {error && <div className="msg err">{error}</div>}
          <div style={{ marginTop: '1.1rem' }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload & continue to review'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
