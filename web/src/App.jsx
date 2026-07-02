import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import JobDetailPage from './pages/JobDetailPage.jsx';
import LaunchPage from './pages/LaunchPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import SchedulesPage from './pages/SchedulesPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import AuditPage from './pages/AuditPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/jobs" replace />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route
          path="/launch"
          element={
            <RequireAuth roles={['operator', 'admin']}>
              <LaunchPage />
            </RequireAuth>
          }
        />
        <Route
          path="/schedules"
          element={
            <RequireAuth roles={['operator', 'admin']}>
              <SchedulesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/catalog"
          element={
            <RequireAuth roles={['admin']}>
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth roles={['admin']}>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth roles={['admin']}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/audit"
          element={
            <RequireAuth roles={['admin']}>
              <AuditPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
