import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SetupNotice } from '@/pages/SetupNotice';
import { Login } from '@/pages/Login';
import { ForgotPassword } from '@/pages/ForgotPassword';
import { UpdatePassword } from '@/pages/UpdatePassword';
import { VerifyEmail } from '@/pages/VerifyEmail';
import { Dashboard } from '@/pages/Dashboard';
import { Advisor } from '@/pages/Advisor';
import { Trends } from '@/pages/Trends';
import { Account } from '@/pages/Account';
import { Settings } from '@/pages/Settings';

function Loading() {
  return <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>;
}

/**
 * Gate for every signed-in route.
 *
 * Three checks, in order:
 *   1. Signed in at all, else to /login.
 *   2. Not mid-password-recovery — a recovery session is only good for setting
 *      a new password, so it must not land on the dashboard.
 *   3. Email confirmed, else held on /verify-email. Connecting a social account
 *      binds a third-party grant to this identity, which should not happen
 *      against an unproven address.
 */
function Protected() {
  const { session, loading, emailVerified, recoveringPassword } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (recoveringPassword) return <Navigate to="/update-password" replace />;
  if (!emailVerified) return <Navigate to="/verify-email" replace />;

  return <Layout />;
}

function Router() {
  const { session, loading, emailVerified, recoveringPassword } = useAuth();

  return (
    <Routes>
      {/* --- Signed-out routes --- */}
      <Route
        path="/login"
        element={loading ? <Loading /> : session && emailVerified && !recoveringPassword ? <Navigate to="/" replace /> : <Login />}
      />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      {/* Reachable while signed in: the reset link creates a session. */}
      <Route path="/update-password" element={<UpdatePassword />} />
      <Route
        path="/verify-email"
        element={
          loading ? <Loading /> : !session ? <Navigate to="/login" replace /> : emailVerified ? <Navigate to="/" replace /> : <VerifyEmail />
        }
      />

      {/* --- Signed-in routes --- */}
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="trends" element={<Trends />} />
        <Route path="account" element={<Account />} />
        {/* Old path kept alive for bookmarks; the Account page supersedes it. */}
        <Route path="accounts" element={<Navigate to="/account" replace />} />
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
