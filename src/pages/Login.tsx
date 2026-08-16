import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params] = useSearchParams();

  // Set by the confirmation link's redirect target.
  const justVerified = params.get('verified') === '1';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        const { needsVerification } = await signUp(email, password, displayName || email.split('@')[0]);
        setNotice(
          needsVerification
            ? `Account created. We sent a confirmation link to ${email} — click it to activate your account.`
            : 'Account created. Signing you in…',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Traction</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            AI-powered marketing strategy that tells you what to do next.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-5">
          {mode === 'signup' && (
            <Field label="Name">
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="How should we address you?"
              />
            </Field>
          )}

          <Field label="Email">
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>

          <Field label="Password">
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </Field>

          {justVerified && mode === 'signin' && !notice && (
            <p className="text-sm" style={{ color: 'var(--delta-up)' }}>
              Email confirmed. Sign in to continue.
            </p>
          )}
          {error && (
            <p className="text-sm" style={{ color: 'var(--status-critical)' }} role="alert">
              {error}
            </p>
          )}
          {notice && <p className="text-sm text-ink-secondary">{notice}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setNotice(null);
              }}
              className="w-full text-center text-xs text-ink-secondary hover:text-ink"
            >
              {mode === 'signin' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
            </button>

            {mode === 'signin' && (
              <Link
                to="/forgot-password"
                className="block w-full text-center text-xs text-ink-muted hover:text-ink"
              >
                Forgot your password?
              </Link>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}
