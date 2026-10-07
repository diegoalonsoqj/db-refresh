import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import JobDetailPage from './pages/JobDetailPage.jsx';
import TaskFormPage from './pages/TaskFormPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import CredentialsPage from './pages/CredentialsPage.jsx';

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
        {/* Tareas de restore (modelo de db-keeper): se definen y guardan, y desde la
            lista se ejecutan o se programan. /launch y /schedules son las rutas antiguas. */}
        <Route
          path="/tasks"
          element={
            <RequireAuth roles={['operator', 'admin']}>
              <TasksPage />
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/new"
          element={
            <RequireAuth roles={['operator', 'admin']}>
              <TaskFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/:id/edit"
          element={
            <RequireAuth roles={['operator', 'admin']}>
              <TaskFormPage />
            </RequireAuth>
          }
        />
        <Route path="/launch" element={<Navigate to="/tasks/new" replace />} />
        <Route path="/schedules" element={<Navigate to="/tasks" replace />} />
        <Route
          path="/catalog"
          element={
            <RequireAuth roles={['admin']}>
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/credentials"
          element={
            <RequireAuth roles={['admin']}>
              <CredentialsPage />
            </RequireAuth>
          }
        />
        {/* Ajustes: Apariencia para todos; AD/GCP/Sistema solo admin (lo filtra la página). */}
        <Route path="/settings" element={<SettingsPage />} />
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
