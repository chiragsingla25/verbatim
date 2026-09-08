import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { useAuth } from './lib/auth'
import type { AppRole } from './lib/schema'
import { Ask } from './routes/Ask'
import { AuthCallback } from './routes/AuthCallback'
import { Library } from './routes/Library'
import { ReviewUpload } from './routes/ReviewUpload'
import { SignIn } from './routes/SignIn'
import { SignUp } from './routes/SignUp'
import { Upload } from './routes/Upload'

// Authed pages sit in the app shell: fixed left rail + a single scrolling main column.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-col">{children}</div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="wrap">Loading…</div>
  if (!session) return <Navigate to="/signin" replace />
  return <Shell>{children}</Shell>
}

function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { session, role, loading } = useAuth()
  if (loading) return <div className="wrap">Loading…</div>
  if (!session) return <Navigate to="/signin" replace />
  if (!role || !roles.includes(role)) {
    return (
      <Shell>
        <div className="page-body">
          <h1>Not available</h1>
          <p className="subtitle">
            This page is for contributors. Ask an admin to grant you the contributor role.
          </p>
        </div>
      </Shell>
    )
  }
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Library />
          </RequireAuth>
        }
      />
      <Route
        path="/ask/:versionId"
        element={
          <RequireAuth>
            <Ask />
          </RequireAuth>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireRole roles={['contributor', 'admin']}>
            <Upload />
          </RequireRole>
        }
      />
      <Route
        path="/review/:versionId"
        element={
          <RequireRole roles={['contributor', 'admin']}>
            <ReviewUpload />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
