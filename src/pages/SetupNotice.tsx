/**
 * Shown when the app has no Supabase credentials. Without this the whole UI
 * renders and then fails on every request, which is a much worse first run.
 */
export function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Finish setting up Traction</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        The app can’t reach a Supabase project yet. Three steps and you’re running.
      </p>

      <ol className="mt-8 space-y-6">
        <Step n={1} title="Create a Supabase project">
          Sign in at{' '}
          <a className="underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
            supabase.com/dashboard
          </a>{' '}
          and create a project. Then open the SQL editor and run{' '}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">supabase/migrations/0001_init.sql</code>{' '}
          from this repository.
        </Step>

        <Step n={2} title="Copy your keys into .env">
          <p>
            Copy <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">.env.example</code> to{' '}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">.env</code>, then fill in the values from
            Project Settings → API.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 text-xs text-ink-secondary">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...`}
          </pre>
        </Step>

        <Step n={3} title="Restart the dev server">
          Run <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">npm run dev</code>. Vite only reads{' '}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">.env</code> at startup, so a restart is
          required after editing it.
        </Step>
      </ol>

      <p className="mt-10 text-xs text-ink-muted">
        Full instructions, including the OAuth apps for each social platform, are in{' '}
        <code className="rounded bg-surface-sunken px-1.5 py-0.5">README.md</code>.
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-sm font-medium text-ink-secondary">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <div className="mt-1 text-sm text-ink-secondary">{children}</div>
      </div>
    </li>
  );
}
