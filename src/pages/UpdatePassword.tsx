import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell, AuthField } from '@/components/AuthShell';
import { Banner } from '@/components/ui';

/**
 * Lands here from the emailed reset link. Supabase has already exchanged the
 * link for a short-lived recovery session by this point, so the user is
 * technically signed in — but only long enough to set a new password.
 */
export function UpdatePassword() {
  const { updatePassword, session, loading } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || tooShort) return;

    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <AuthShell title="Checking your link…"><div /></AuthShell>;
  }

  // No session means the link was never followed, or it has already expired.
  if (!session) {
    return (
      <AuthShell
        title="This link is no longer valid"
        subtitle="Reset links expire after an hour and can only be used once."
      >
        <div className="card space-y-4 p-5">
          <button type="button" className="btn-primary w-full" onClick={() => navigate('/forgot-password')}>
            Request a new link
          </button>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="Taking you to your dashboard…">
        <div className="card p-5">
          <Banner tone="good">Your password has been changed.</Banner>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="At least 8 characters.">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <AuthField label="New password">
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>

        <AuthField label="Confirm new password">
          <input
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </AuthField>

        {tooShort && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>Use at least 8 characters.</p>}
        {mismatch && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>The two passwords don’t match.</p>}
        {error && <Banner tone="critical">{error}</Banner>}

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={busy || !password || mismatch || tooShort}
        >
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
