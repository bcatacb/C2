import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { Login } from './pages/Login'
import { Accounts } from './pages/Accounts'
import { Leads } from './pages/Leads'
import { Campaigns } from './pages/Campaigns'
import { Pipeline } from './pages/Pipeline'
import { Unibox } from './pages/Unibox'
import { Settings } from './pages/Settings'
import { Automation } from './pages/Automation'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="unibox" replace />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="leads" element={<Leads />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="automation" element={<Automation />} />
          <Route path="unibox" element={<Unibox />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
