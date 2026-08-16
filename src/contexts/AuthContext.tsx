import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@shared/types';

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /**
   * Whether the signed-in user has confirmed their email address. Null while
   * unknown. Supabase projects can have confirmation switched off, in which
   * case this is always true.
   */
  emailVerified: boolean;
  /** True after a password-recovery link has been followed. */
  recoveringPassword: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsVerification: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveringPassword, setRecoveringPassword] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) setProfile(null);

      // Following a reset link signs the user in with a short-lived recovery
      // session. Flagging it lets the router send them to set a new password
      // instead of dropping them on the dashboard still unable to sign in.
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
      if (event === 'SIGNED_OUT') setRecoveringPassword(false);
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
      // Projects with email confirmation disabled never set the timestamp, so
      // treat an active session with no confirmation requirement as verified.
      emailVerified: Boolean(session?.user?.email_confirmed_at ?? session?.user?.confirmed_at),
      recoveringPassword,

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async signUp(email, password, displayName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/login?verified=1`,
          },
        });
        if (error) throw new Error(friendlyAuthError(error.message));
        // Supabase returns a user with no session when confirmation is required.
        return { needsVerification: Boolean(data.user && !data.session) };
      },

      async signOut() {
        await supabase.auth.signOut();
      },

      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(friendlyAuthError(error.message));
        setRecoveringPassword(false);
      },

      async resendVerification(email) {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: `${window.location.origin}/login?verified=1` },
        });
        if (error) throw new Error(friendlyAuthError(error.message));
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
    [session, profile, loading, recoveringPassword, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Supabase auth errors are terse and sometimes leak implementation detail.
 * Rewrite the common ones; pass anything unrecognised through unchanged so a
 * genuine problem is still debuggable.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'That email and password combination did not match an account.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address first — check your inbox for the verification link.';
  }
  if (lower.includes('user already registered')) {
    return 'An account with that email already exists. Try signing in, or reset your password.';
  }
  if (lower.includes('password should be at least')) {
    return 'Please choose a password of at least 8 characters.';
  }
  if (lower.includes('same as the old password') || lower.includes('should be different')) {
    return 'Please choose a password different from your current one.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (lower.includes('token has expired') || lower.includes('invalid or has expired')) {
    return 'That link has expired. Please request a new one.';
  }
  return message;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
