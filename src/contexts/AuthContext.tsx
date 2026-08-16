import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@shared/types';

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setProfile(null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('profiles')
      .select('id, display_name, niche, audience, goals, timezone, onboarded_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile((data as Profile) ?? null);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },

      async signUp(email, password, displayName) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error) throw new Error(error.message);
      },

      async signOut() {
        await supabase.auth.signOut();
      },

      async refreshProfile() {
        if (!userId) return;
        const { data } = await supabase
          .from('profiles')
          .select('id, display_name, niche, audience, goals, timezone, onboarded_at')
          .eq('id', userId)
          .maybeSingle();
        setProfile((data as Profile) ?? null);
      },
    }),
    [session, profile, loading, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
