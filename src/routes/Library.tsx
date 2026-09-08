import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type VersionRow = {
  id: string
  title: string
  edition: string | null
  year: number | null
  publisher: string | null
  instrument: { name: string; slug: string } | null
}

// The manual library: active versions the caller may read. RLS
// (manual_versions_select_visible) returns status='active' for anyone, plus the caller's
// own pending uploads. A fresh student with an empty corpus sees the empty state.
export function Library() {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('manual_versions')
      .select('id, title, edition, year, publisher, instrument:instruments(name, slug)')
      .eq('status', 'active')
      .order('title')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows((data ?? []) as unknown as VersionRow[])
      })
  }, [])

  return (
    <main className="wrap">
      <h1>Manuals</h1>
      {error && <div className="msg err">{error}</div>}
      {rows === null && !error && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="empty">
          No published manuals yet.
          <br />
          A contributor needs to upload and publish one.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="manual-list">
          {rows.map((v) => (
            <li key={v.id}>
              <div className="title">{v.instrument?.name ?? 'Unknown instrument'}</div>
              <div className="meta">
                {v.title}
                {v.edition ? ` · ${v.edition}` : ''}
                {v.year ? ` · ${v.year}` : ''}
                {v.publisher ? ` · ${v.publisher}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
