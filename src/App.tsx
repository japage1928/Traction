import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SetupNotice } from '@/pages/SetupNotice';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Advisor } from '@/pages/Advisor';
import { Trends } from '@/pages/Trends';
import { Accounts } from '@/pages/Accounts';
import { Settings } from '@/pages/Settings';

function Protected() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}

function Router() {
  const { session, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? null : session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="trends" element={<Trends />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </BrowserRouter>
  );
}
