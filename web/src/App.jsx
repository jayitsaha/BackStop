import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { CustomerProvider } from './lib/CustomerContext.jsx'
import Shelf from './pages/Shelf.jsx'
import AgentDetail from './pages/AgentDetail.jsx'
import Pricing from './pages/Pricing.jsx'
import Studio from './pages/Studio.jsx'
import CustomerApp from './pages/CustomerApp.jsx'
import Calls from './pages/Calls.jsx'
import Litigation from './pages/Litigation.jsx'
import Chain from './pages/Chain.jsx'
import Login from './pages/Login.jsx'
import Loop from './pages/Loop.jsx'

function RequireAuth({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RoutedApp() {
  const loc = useLocation()
  return (
    <ErrorBoundary key={loc.pathname}>
      <Routes>
        <Route path="/" element={<Shelf />} />
        <Route path="/agent/:id" element={<AgentDetail />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/loop" element={<Loop />} />
        <Route path="/login" element={<Login />} />
        <Route path="/studio" element={<RequireAuth><Studio /></RequireAuth>} />
        <Route path="/app" element={<RequireAuth><CustomerApp /></RequireAuth>} />
        <Route path="/calls" element={<RequireAuth><Calls /></RequireAuth>} />
        <Route path="/claims" element={<RequireAuth><Litigation /></RequireAuth>} />
        <Route path="/chain" element={<Chain />} />
        <Route path="/maya" element={<Navigate to="/app" replace />} />
        <Route path="/submit" element={<Navigate to="/studio" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CustomerProvider>
        <Layout>
          <RoutedApp />
        </Layout>
      </CustomerProvider>
    </AuthProvider>
  )
}
