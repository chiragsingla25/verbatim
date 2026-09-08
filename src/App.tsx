import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Nav } from './components/Nav'
import { useAuth } from './lib/auth'
import { AuthCallback } from './routes/AuthCallback'
import { Library } from './routes/Library'
import { SignIn } from './routes/SignIn'
import { SignUp } from './routes/SignUp'

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="wrap">Loading…</div>
  if (!session) return <Navigate to="/signin" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <>
      <Nav />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
