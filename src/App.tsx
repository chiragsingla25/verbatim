import { type ReactNode, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MobileTopBar } from './components/MobileTopBar'
import { Sidebar } from './components/Sidebar'
import { useAuth } from './lib/auth'
import type { AppRole } from './lib/schema'
import { Admin } from './routes/Admin'
import { Ask } from './routes/Ask'
import { AuthCallback } from './routes/AuthCallback'
import { ForgotPassword } from './routes/ForgotPassword'
import { History } from './routes/History'
import { Library } from './routes/Library'
import { Manual } from './routes/Manual'
import { ResetPassword } from './routes/ResetPassword'
import { ReviewUpload } from './routes/ReviewUpload'
import { SignIn } from './routes/SignIn'
import { SignUp } from './routes/SignUp'
import { Upload } from './routes/Upload'

// Authed pages sit in the app shell: a fixed left rail + a single scrolling main column on
// desktop; below 760px the rail becomes an off-canvas drawer behind a mobile top bar. The
// drawer's open-state is derived from the route it was opened on, so any navigation (link,
// back button, redirect) closes it with no effect.
function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const navOpen = openedAt === pathname

  return (
    <div className="app-shell">
      <MobileTopBar onMenu={() => setOpenedAt(pathname)} />
      <Sidebar mobileOpen={navOpen} onNavigate={() => setOpenedAt(null)} />
      <div className="nav-scrim" hidden={!navOpen} onClick={() => setOpenedAt(null)} />
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
            You don’t have access to this page. Ask an admin to grant you the{' '}
            {roles.includes('admin') && !roles.includes('contributor') ? 'admin' : 'contributor'}{' '}
            role.
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
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
        path="/manual/:versionId"
        element={
          <RequireAuth>
            <Manual />
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
        path="/history"
        element={
          <RequireAuth>
            <History />
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
      <Route
        path="/admin"
        element={
          <RequireRole roles={['admin']}>
            <Admin />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
