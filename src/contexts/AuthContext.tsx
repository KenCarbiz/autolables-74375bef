import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { markSessionActive, clearSessionActive } from "@/lib/auth/sessionExpiry";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

type SignInResult = { error: unknown };

const isFetchFailure = (error: unknown): boolean => {
  const candidate = error as { name?: string; message?: string } | null;
  const message = candidate?.message?.toLowerCase() ?? "";
  return candidate?.name === "AuthRetryableFetchError" || message.includes("failed to fetch") || message.includes("network error");
};

const signInWithRelay = (email: string, password: string): Promise<SignInResult> =>
  new Promise((resolve) => {
    const request = new XMLHttpRequest();
    const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
    const projectRef = new URL(baseUrl).hostname.split(".")[0];

    request.open("POST", `https://${projectRef}.functions.supabase.co/auth-login-relay`);
    request.timeout = 15_000;
    request.setRequestHeader("Content-Type", "application/json");

    request.onload = async () => {
      try {
        const payload = JSON.parse(request.responseText || "{}") as {
          access_token?: string;
          refresh_token?: string;
          error_description?: string;
          msg?: string;
        };
        if (request.status < 200 || request.status >= 300 || !payload.access_token || !payload.refresh_token) {
          resolve({ error: new Error(payload.error_description ?? payload.msg ?? "Invalid email or password.") });
          return;
        }
        const { error } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        });
        resolve({ error });
      } catch (error) {
        resolve({ error });
      }
    };
    request.onerror = () => resolve({ error: new Error("Network error") });
    request.ontimeout = () => resolve({ error: new Error("Network error") });
    request.send(JSON.stringify({ email, password }));
  });

const signInWithNavigationRelay = (email: string, password: string): Promise<SignInResult> =>
  new Promise((resolve) => {
    const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
    const projectRef = new URL(baseUrl).hostname.split(".")[0];
    const relayOrigin = `https://${projectRef}.functions.supabase.co`;
    const frameName = `auth-relay-${crypto.randomUUID()}`;
    const frame = document.createElement("iframe");
    const form = document.createElement("form");
    let settled = false;

    const finish = (result: SignInResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeoutId);
      form.remove();
      frame.remove();
      resolve(result);
    };

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== relayOrigin || event.data?.type !== "autolabels-auth-relay") return;
      const payload = event.data.payload as {
        access_token?: string;
        refresh_token?: string;
        error_description?: string;
        msg?: string;
      };
      if (!payload.access_token || !payload.refresh_token) {
        finish({ error: new Error(payload.error_description ?? payload.msg ?? "Invalid email or password.") });
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });
      finish({ error });
    };

    const timeoutId = window.setTimeout(
      () => finish({ error: new Error("Network error") }),
      15_000,
    );
    window.addEventListener("message", onMessage);

    frame.name = frameName;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);

    form.method = "POST";
    form.action = `${relayOrigin}/auth-login-relay`;
    form.target = frameName;
    form.hidden = true;
    for (const [name, value] of [["email", email], ["password", password]]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  });

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
    // Remember a session was active this tab so a later gate can tell a real
    // expiry from a first visit. Cleared only on an intentional sign-out.
    markSessionActive();
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
      (event: AuthChangeEvent, session: Session | null) => {
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
      .then(({ data: { session } }: { data: { session: Session | null } }) => {
        const nextUser = session?.user ?? null;
        currentUserId = nextUser?.id ?? null;
        return applyAuth(nextUser);
      })
      .catch(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error || !isFetchFailure(error)) return { error };
    } catch (error) {
      if (!isFetchFailure(error)) return { error };
    }
    const relayResult = await signInWithRelay(email, password);
    if (!relayResult.error || !isFetchFailure(relayResult.error)) return relayResult;
    return signInWithNavigationRelay(email, password);
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
    // Clear the session-active flag first so the gate redirect reads as a
    // normal logout, not an expiry banner.
    clearSessionActive();
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
