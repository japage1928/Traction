import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell, AuthField } from '@/components/AuthShell';
import { Banner } from '@/components/ui';

export function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox" subtitle={`If an account exists for ${email}, a reset link is on its way.`}>
        <div className="card space-y-4 p-5">
          <p className="text-sm text-ink-secondary">
            The link is valid for one hour and can only be used once. If it doesn’t arrive, check your spam folder.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/login" className="btn-primary text-sm">
              Back to sign in
            </Link>
            <button type="button" className="btn-ghost text-sm" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We’ll email you a link to choose a new one.">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <AuthField label="Email">
          <input
            className="input"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </AuthField>

        {error && <Banner tone="critical">{error}</Banner>}

        <button type="submit" className="btn-primary w-full" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>

        <Link to="/login" className="block text-center text-xs text-ink-secondary hover:text-ink">
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
