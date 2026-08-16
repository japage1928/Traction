import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell } from '@/components/AuthShell';
import { Banner } from '@/components/ui';

/**
 * Shown to a signed-in user whose email is not yet confirmed.
 *
 * They are held here rather than on the dashboard: connecting a social account
 * binds a third-party grant to this Traction identity, and doing that before
 * the address is proven would let someone attach their accounts to an email
 * they do not control.
 */
export function VerifyEmail() {
  const { user, resendVerification, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      await resendVerification(user.email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the verification email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Confirm your email"
      subtitle={user?.email ? `We sent a link to ${user.email}.` : 'We sent you a confirmation link.'}
    >
      <div className="card space-y-4 p-5">
        <p className="text-sm text-ink-secondary">
          Click the link in that email to activate your account. You’ll need a confirmed address before connecting
          social accounts.
        </p>

        {sent && <Banner tone="good">Sent. Give it a minute, then check your inbox and spam folder.</Banner>}
        {error && <Banner tone="critical">{error}</Banner>}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-sm" onClick={() => void handleResend()} disabled={busy}>
            {busy ? 'Sending…' : 'Resend email'}
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={() => window.location.reload()}>
            I’ve confirmed it
          </button>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="block w-full text-center text-xs text-ink-secondary hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
