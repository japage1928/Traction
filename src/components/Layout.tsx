import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/advisor', label: 'Advisor' },
  { to: '/trends', label: 'Trends' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(
    () => (localStorage.getItem('traction-theme') as 'light' | 'dark' | null) ?? 'system',
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      localStorage.removeItem('traction-theme');
    } else {
      root.setAttribute('data-theme', theme);
      localStorage.setItem('traction-theme', theme);
    }
  }, [theme]);

  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const label = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="btn-ghost w-full justify-start text-xs"
      title={`Theme: ${label}. Click for ${next}.`}
    >
      Theme: {label}
    </button>
  );
}

export function Layout() {
  const { profile, user, signOut } = useAuth();
  const name = profile?.display_name ?? user?.email ?? '';

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface px-4 py-5 md:flex">
        <div className="mb-6 px-1">
          <div className="text-lg font-semibold tracking-tight text-ink">Traction</div>
          <div className="mt-0.5 text-xs text-ink-muted">What to do next</div>
        </div>

        <nav className="flex-1 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-surface-sunken font-medium text-ink'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-line pt-3">
          <ThemeToggle />
          <div className="truncate px-1 text-xs text-ink-muted" title={name}>
            {name}
          </div>
          <button type="button" onClick={() => void signOut()} className="btn-ghost w-full justify-start text-xs">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface md:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                'flex-1 px-2 py-3 text-center text-xs',
                isActive ? 'font-medium text-ink' : 'text-ink-muted',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
