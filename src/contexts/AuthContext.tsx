import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Last-known admin status per user. The role check must survive a
// transient failure — a slow/cold query, or a stale JWT that makes RLS
// return nothing — without demoting a real admin to "not admin." A wrong
// "not admin" is what routed admins into the tenant-less dealer path and
// the 10s autocurb-pull + bounce. The cache only seeds the gate's render
// decision; every data query still goes through RLS, so a tampered cache
// grants no data.
const ADMIN_PREFIX = "al_admin_";
const readAdminCache = (uid: string): boolean | null => {
  try {
    const v = localStorage.getItem(ADMIN_PREFIX + uid);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
};
const writeAdminCache = (uid: string, v: boolean): void => {
  try {
    localStorage.setItem(ADMIN_PREFIX + uid, v ? "1" : "0");
  } catch {
    /* best-effort */
  }
};
const clearAdminCache = (): void => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ADMIN_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
};

// Force a token refresh, bounded so a hung auth server can't freeze us.
// Returns whether we now hold a valid session.
const refreshSessionSafe = async (): Promise<boolean> => {
  try {
    const refreshed = await Promise.race([
      supabase.auth.refreshSession(),
      new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 4000),
      ),
    ]);
    return !!(refreshed as { data?: { session?: unknown } }).data?.session;
  } catch {
    return false;
  }
};

// Probe the admin role with a clear three-way result so the caller can
// tell a genuine "not admin" (trust it) from a transient miss (don't
// demote). A timeout or a query error is transient; only a clean
// response is authoritative.
type AdminProbe = { kind: "ok"; isAdmin: boolean } | { kind: "transient" };
const TIMEOUT = Symbol("timeout");
const probeAdmin = async (userId: string): Promise<AdminProbe> => {
  try {
    const query = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const res = await Promise.race([
      query,
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), 4000)),
    ]);
    if (res === TIMEOUT) return { kind: "transient" };
    const { data, error } = res as { data: unknown; error: unknown };
    if (error) return { kind: "transient" };
    return { kind: "ok", isAdmin: !!data };
  } catch {
    return { kind: "transient" };
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Resolve admin status with transient-failure resilience. On a
  // transient result, refresh the session once and retry (stale-JWT
  // recovery); if it's still transient, keep the last-known value rather
  // than demoting. Only a clean response (from a fresh token) is allowed
  // to flip a cached admin off.
  const resolveAdmin = async (userId: string) => {
    let probe = await probeAdmin(userId);
    if (probe.kind === "transient") {
      const refreshed = await refreshSessionSafe();
      if (refreshed) probe = await probeAdmin(userId);
    }
    if (probe.kind === "ok") {
      setIsAdmin(probe.isAdmin);
      writeAdminCache(userId, probe.isAdmin);
    } else {
      const cached = readAdminCache(userId);
      if (cached !== null) setIsAdmin(cached); // keep last-known on a blip
      else setIsAdmin(false);
    }
  };

  // Apply an auth state. We unblock `loading` as soon as the session is
  // known — the admin role query NEVER blocks app render. A returning
  // user is seeded from the admin cache and reconciled in the background;
  // a first-time user (no cache) is classified before we stop loading so
  // they don't briefly fall into the wrong (tenant-less) path.
  const applyAuth = async (nextUser: User | null) => {
    setUser(nextUser);
    if (!nextUser) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    const cached = readAdminCache(nextUser.id);
    if (cached !== null) {
      setIsAdmin(cached);
      setLoading(false);
      void resolveAdmin(nextUser.id); // reconcile, non-blocking
    } else {
      await resolveAdmin(nextUser.id);
      setLoading(false);
    }
  };

  useEffect(() => {
    let currentUserId: string | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const nextUser = session?.user ?? null;

        // Only re-resolve when the actual user identity changes (sign-in
        // or sign-out). TOKEN_REFRESHED / USER_UPDATED fire on tab focus —
        // they must not flip loading back to true or re-run the role
        // query, which caused the black-screen-spinner hang on tab return.
        if (nextUser?.id === currentUserId && event !== "SIGNED_IN") {
          setUser(nextUser);
          return;
        }
        currentUserId = nextUser?.id ?? null;
        void applyAuth(nextUser);
      }
    );

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        const nextUser = session?.user ?? null;
        currentUserId = nextUser?.id ?? null;
        return applyAuth(nextUser);
      })
      .catch(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearAdminCache();
    setUser(null);
    setIsAdmin(false);
  }, []);

  const value = useMemo(
    () => ({ user, isAdmin, loading, signIn, signUp, signOut }),
    [user, isAdmin, loading, signIn, signUp, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
