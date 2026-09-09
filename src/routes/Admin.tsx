import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  type AdminActivity,
  adminListActivity,
  adminListAllVersions,
  adminListUsers,
  adminSetRole,
  type AdminUser,
  type AdminVersion,
  archiveVersion,
  republishVersion,
  setSupersedes,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { errMessage, relDate } from '../lib/format'
import { APP_ROLES, type AppRole } from '../lib/schema'

type Tab = 'users' | 'manuals' | 'activity'
const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'manuals', label: 'Manuals' },
  { key: 'activity', label: 'Activity' },
]

export function Admin() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'users'

  return (
    <>
      <header className="page-head">
        <h1>Admin</h1>
        <div className="adm-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'on' : undefined}
              onClick={() => setParams(t.key === 'users' ? {} : { tab: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="page-body">
        {tab === 'users' && <UsersTab />}
        {tab === 'manuals' && <ManualsTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const { session } = useAuth()
  const myId = session?.user.id
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    adminListUsers().then(setUsers).catch((e) => setError(errMessage(e)))
  }, [])

  async function change(u: AdminUser, role: AppRole) {
    setError(null)
    setBusyId(u.id)
    const prev = u.role
    setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, role } : x)) ?? null)
    try {
      await adminSetRole(u.id, role)
    } catch (e) {
      setError(errMessage(e))
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, role: prev } : x)) ?? null)
    } finally {
      setBusyId(null)
    }
  }

  if (error && !users) return <div className="msg err">{error}</div>
  if (!users) return <p className="turn-pending">Loading…</p>

  return (
    <>
      {error && <div className="msg err">{error}</div>}
      <p className="subtitle" style={{ marginBottom: 14 }}>
        A role change takes effect on that person’s next page load. You cannot change your own role.
      </p>
      <div className="adm-table">
        <div className="adm-head adm-users-grid">
          <span>Email</span>
          <span>Role</span>
          <span>Joined</span>
          <span>Last seen</span>
        </div>
        {users.map((u) => (
          <div key={u.id} className="adm-row adm-users-grid">
            <span className="adm-email">
              {u.email}
              {u.id === myId && <span className="adm-you">you</span>}
            </span>
            <span>
              <select
                value={u.role}
                disabled={u.id === myId || busyId === u.id}
                onChange={(e) => change(u, e.target.value as AppRole)}
                title={u.id === myId ? 'You cannot change your own role' : undefined}
              >
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </span>
            <span className="adm-dim">{relDate(u.createdAt)}</span>
            <span className="adm-dim">{u.lastSignInAt ? relDate(u.lastSignInAt) : 'never'}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Manuals ───────────────────────────────────────────────────────────────
function ManualsTab() {
  const [versions, setVersions] = useState<AdminVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () =>
    adminListAllVersions()
      .then(setVersions)
      .catch((e) => setError(errMessage(e)))

  useEffect(() => {
    load()
  }, [])

  async function act(id: string, fn: () => Promise<void>) {
    setError(null)
    setBusyId(id)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  if (error && !versions) return <div className="msg err">{error}</div>
  if (!versions) return <p className="turn-pending">Loading…</p>

  const pill = (s: AdminVersion['status']) =>
    s === 'active' ? 'green' : s === 'pending' ? 'amber' : ''

  return (
    <>
      {error && <div className="msg err">{error}</div>}
      <div className="adm-table">
        <div className="adm-head adm-manuals-grid">
          <span>Instrument &amp; version</span>
          <span>Status</span>
          <span>Ingest</span>
          <span>Supersedes</span>
          <span />
        </div>
        {versions.map((v) => {
          const siblings = versions.filter(
            (o) => o.id !== v.id && o.instrument?.id && o.instrument.id === v.instrument?.id,
          )
          return (
            <div key={v.id} className="adm-row adm-manuals-grid">
              <span className="r-name">
                <span className="r-title">{v.instrument?.name ?? 'Unknown'}</span>
                <span className="r-sub">
                  {v.title}
                  {v.edition ? ` · ${v.edition}` : ''}
                  {v.year ? ` · ${v.year}` : ''}
                </span>
              </span>
              <span>
                <span className={`pill ${pill(v.status)}`}>
                  {v.status === 'active' && <span className="dot" />}
                  {v.status}
                </span>
              </span>
              <span className="adm-dim">{v.ingestState ?? '—'}</span>
              <span>
                <select
                  value={v.supersedesId ?? ''}
                  disabled={busyId === v.id || siblings.length === 0}
                  onChange={(e) => {
                    const target = e.target.value || null
                    act(v.id, () => setSupersedes(v.id, target))
                  }}
                >
                  <option value="">— none —</option>
                  {siblings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.edition ? ` · ${s.edition}` : ''}
                    </option>
                  ))}
                </select>
              </span>
              <span className="adm-actions">
                <Link to={`/review/${v.id}`}>Review →</Link>
                {v.status === 'active' && (
                  <button
                    className="secondary"
                    disabled={busyId === v.id}
                    onClick={() => act(v.id, () => archiveVersion(v.id))}
                  >
                    Archive
                  </button>
                )}
                {v.status === 'archived' && (
                  <button
                    disabled={busyId === v.id}
                    onClick={() => act(v.id, () => republishVersion(v.id))}
                  >
                    Re-publish
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Activity ──────────────────────────────────────────────────────────────
function ActivityTab() {
  const [rows, setRows] = useState<AdminActivity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminListActivity(100)
      .then(setRows)
      .catch((e) => setError(errMessage(e)))
  }, [])

  if (error) return <div className="msg err">{error}</div>
  if (!rows) return <p className="turn-pending">Loading…</p>

  return (
    <div className="adm-activity">
      {rows.length === 0 && <p className="empty">No activity yet.</p>}
      {rows.map((r) => (
        <div key={r.id} className="adm-act-row">
          <span className="adm-act-who">{r.actorEmail ?? 'system'}</span>
          <span className="adm-act-what">
            <strong>{r.action}</strong>
            {r.target ? ` · ${r.target}` : ''}
            {r.action === 'role_change' && r.meta.from && r.meta.to
              ? ` (${r.meta.from} → ${r.meta.to})`
              : ''}
          </span>
          <span className="adm-dim">{relDate(r.at)}</span>
        </div>
      ))}
    </div>
  )
}
