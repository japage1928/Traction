import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, Section, Banner } from '@/components/ui';

/**
 * The positioning fields here are not decoration — they are read verbatim into
 * the advisor's context on every request and used to scope trend searches.
 * Vague answers here produce vague advice.
 */
export function Settings() {
  const { profile, user, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [niche, setNiche] = useState('');
  const [audience, setAudience] = useState('');
  const [goals, setGoals] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setNiche(profile.niche ?? '');
    setAudience(profile.audience ?? '');
    setGoals(profile.goals ?? '');
  }, [profile]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        niche: niche.trim() || null,
        audience: audience.trim() || null,
        goals: goals.trim() || null,
        onboarded_at: profile?.onboarded_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSaved(true);
      await refreshProfile();
    }
    setSaving(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 md:px-8 md:py-8">
      <PageHeader title="Settings" subtitle="What the advisor knows about you." />

      <form onSubmit={handleSubmit} className="mt-6">
        <Section title="Positioning" subtitle="Fed into every piece of advice and every trend scan.">
          <div className="space-y-4">
            <Field label="Name" hint="Used to address you.">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>

            <Field
              label="What you do"
              hint="Be specific. “Developer tooling for data engineers” beats “tech”."
            >
              <input
                className="input"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. Indie SaaS for freelance designers"
              />
            </Field>

            <Field label="Who you're trying to reach" hint="The advisor writes for this reader.">
              <input
                className="input"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. Solo designers billing $80–150/hr who hate admin"
              />
            </Field>

            <Field label="What you're aiming at" hint="Give a target and a timeframe if you have one.">
              <textarea
                className="input min-h-[90px] resize-y"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="e.g. 1,000 email subscribers by Q4, mostly from X and LinkedIn"
              />
            </Field>

            {error && <Banner tone="critical">{error}</Banner>}
            {saved && <Banner tone="good">Saved.</Banner>}

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <span className="text-xs text-ink-muted">{user?.email}</span>
            </div>
          </div>
        </Section>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-secondary">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-ink-muted">{hint}</span>}
      {children}
    </label>
  );
}
