import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import JobDetailPage from './pages/JobDetailPage.jsx';
import TaskFormPage from './pages/TaskFormPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import RolesPage from './pages/RolesPage.jsx';
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
        {/* Página de inicio: el Panel (como db-keeper). */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/jobs" element={<RequireAuth perm="jobs:read"><JobsPage /></RequireAuth>} />
        <Route path="/jobs/:id" element={<RequireAuth perm="jobs:read"><JobDetailPage /></RequireAuth>} />
        {/* Tareas de restore (modelo de db-keeper): se definen y guardan, y desde la
            lista se ejecutan o se programan. /launch y /schedules son las rutas antiguas. */}
        <Route
          path="/tasks"
          element={
            <RequireAuth perm="tasks:read">
              <TasksPage />
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/new"
          element={
            <RequireAuth perm="tasks:write">
              <TaskFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/:id/edit"
          element={
            <RequireAuth perm="tasks:write">
              <TaskFormPage />
            </RequireAuth>
          }
        />
        <Route path="/launch" element={<Navigate to="/tasks/new" replace />} />
        <Route path="/schedules" element={<Navigate to="/tasks" replace />} />
        <Route
          path="/catalog"
          element={
            <RequireAuth perm="catalog:read">
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="/credentials"
          element={
            <RequireAuth perm="credentials:read">
              <CredentialsPage />
            </RequireAuth>
          }
        />
        {/* Ajustes: Apariencia para todos; AD/GCP/Sistema solo admin (lo filtra la página). */}
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/users"
          element={
            <RequireAuth perm="users:read">
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/roles"
          element={
            <RequireAuth perm="roles:read">
              <RolesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/audit"
          element={
            <RequireAuth perm="audit:read">
              <AuditPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
