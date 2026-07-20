import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Logo from "@/components/brand/Logo";
import Seo from "@/components/Seo";
import {
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Lock,
  KeyRound,
} from "lucide-react";

const MIN_PASSWORD = 8;

type Phase = "checking" | "ready" | "invalid" | "success";

type UpdateErrorKind = "policy" | "expired" | "network" | "generic";

// Map an updateUser failure to governed, non-leaking copy. An expired or
// already-consumed recovery link routes the dealer back to request a new
// one; a weak password surfaces the policy; everything else stays generic.
const classifyUpdateError = (
  err: unknown,
): { kind: UpdateErrorKind; message: string } => {
  const e = (err ?? {}) as { status?: number; message?: string; name?: string };
  const status = typeof e.status === "number" ? e.status : undefined;
  const msg = (e.message ?? "").toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("session") ||
    msg.includes("not authenticated") ||
    msg.includes("expired") ||
    msg.includes("token")
  ) {
    return {
      kind: "expired",
      message:
        "This reset link has expired or was already used. Request a new one from the sign-in page.",
    };
  }
  if (
    msg.includes("at least") ||
    msg.includes("weak") ||
    msg.includes("short") ||
    msg.includes("should be") ||
    msg.includes("characters")
  ) {
    return {
      kind: "policy",
      message: `Choose a stronger password with at least ${MIN_PASSWORD} characters.`,
    };
  }
  if (
    status === 0 ||
    e.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error")
  ) {
    return { kind: "network", message: "Network error — try again." };
  }
  return { kind: "generic", message: "Couldn't update your password. Please try again." };
};

const ResetPassword = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ kind: UpdateErrorKind; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Detect the Supabase recovery session. The client parses the recovery
  // token from the URL and fires PASSWORD_RECOVERY; we subscribe before
  // that lands and also inspect the current session, so a token processed
  // just ahead of the subscription still unlocks the form. A direct visit
  // (no token, no session) or an error-carrying hash is treated as invalid.
  useEffect(() => {
    let resolved = false;
    const markReady = () => {
      resolved = true;
      setPhase((p) => (p === "success" ? p : "ready"));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") markReady();
      else if (event === "SIGNED_IN" && session) markReady();
    });

    const hash = window.location.hash || "";
    const hasError = /error=/.test(hash);
    const hasRecoveryToken = /access_token=/.test(hash) || /type=recovery/.test(hash);

    if (hasError) {
      setPhase("invalid");
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) markReady();
        else if (!hasRecoveryToken && !resolved) setPhase("invalid");
      });
    }

    // A recovery token that never establishes a session is expired or used.
    const timer = setTimeout(() => {
      if (!resolved) setPhase((p) => (p === "ready" || p === "success" ? p : "invalid"));
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const validatePassword = (v: string): string | null => {
    if (!v) return "Enter a new password.";
    if (v.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
    return null;
  };
  const validateConfirm = (pw: string, v: string): string | null => {
    if (!v) return "Re-enter your new password.";
    if (pw !== v) return "Passwords don't match.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const pErr = validatePassword(password);
    const cErr = validateConfirm(password, confirm);
    setPasswordError(pErr);
    setConfirmError(cErr);
    if (pErr || cErr) {
      (pErr ? passwordRef : confirmRef).current?.focus();
      return;
    }

    setFormError(null);
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (err) {
      setFormError(classifyUpdateError(err));
      return;
    }
    setPhase("success");
  };

  // After a confirmed reset the dealer holds a full session; route them the
  // same way sign-in does (admins to /admin, dealers to /dashboard).
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => navigate(isAdmin ? "/admin" : "/dashboard", { replace: true }), 1600);
    return () => clearTimeout(t);
  }, [phase, isAdmin, navigate]);

  const inputClass =
    "w-full h-12 lg:h-11 px-3 rounded-md border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all";

  return (
    <div className="min-h-screen flex items-start lg:items-center justify-center p-5 sm:p-8 lg:p-12 bg-muted/30">
      <Seo
        title="Reset password — AutoLabels.io"
        description="Set a new password for your AutoLabels.io dealer account."
        path="/reset-password"
        noindex
      />
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-full bg-[#1E90FF]/25 blur-2xl"
            />
            <Logo variant="full" size={28} />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-label text-[#1E90FF]">
            Dealer portal
          </span>
        </div>

        <div className="bg-card rounded-2xl border border-border/70 shadow-premium-lg p-5 sm:p-9">
          {phase === "checking" && (
            <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
              <Loader2 className="w-6 h-6 animate-spin text-[#1E90FF]" />
              <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
            </div>
          )}

          {phase === "invalid" && (
            <div>
              <div className="mb-5 flex items-center justify-center">
                <div className="w-11 h-11 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground text-center">
                Reset link invalid or expired
              </h1>
              <p className="mt-2 text-sm text-muted-foreground text-center">
                This password reset link is invalid or has expired. Request a fresh link from the
                sign-in page and try again.
              </p>
              <Link
                to="/login"
                className="mt-6 w-full inline-flex items-center justify-center h-12 lg:h-11 rounded-md shimmer-cta font-semibold text-sm text-white hover:brightness-110 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Back to sign-in
              </Link>
            </div>
          )}

          {phase === "success" && (
            <div role="status" aria-live="polite">
              <div className="mb-5 flex items-center justify-center">
                <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground text-center">
                Password updated
              </h1>
              <p className="mt-2 text-sm text-muted-foreground text-center">
                Your password has been changed. Taking you to your dashboard…
              </p>
              <button
                type="button"
                onClick={() => navigate(isAdmin ? "/admin" : "/dashboard", { replace: true })}
                className="mt-6 w-full h-12 lg:h-11 rounded-md shimmer-cta font-semibold text-sm text-white hover:brightness-110 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Continue
              </button>
            </div>
          )}

          {phase === "ready" && (
            <>
              <div className="mb-6">
                <span className="hidden lg:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-[#1E90FF]">
                  <KeyRound className="w-3.5 h-3.5" />
                  Password reset
                </span>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-tight font-display text-foreground">
                  Set a new password
                </h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  Choose a new password for your dealership account.
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="text-sm font-medium text-foreground mb-1.5 block">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      ref={passwordRef}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      autoFocus
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (passwordError) setPasswordError(null);
                        if (formError) setFormError(null);
                      }}
                      onBlur={() => setPasswordError(validatePassword(password))}
                      placeholder="At least 8 characters"
                      required
                      aria-invalid={!!passwordError}
                      aria-describedby={passwordError ? "new-password-error" : "new-password-hint"}
                      className={`${inputClass} pr-10 ${passwordError ? "border-destructive" : "border-border"}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      tabIndex={-1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordError ? (
                    <p id="new-password-error" role="alert" className="mt-1.5 text-xs text-destructive">
                      {passwordError}
                    </p>
                  ) : (
                    <p id="new-password-hint" className="mt-1.5 text-xs text-muted-foreground">
                      Use at least {MIN_PASSWORD} characters.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="confirm-password" className="text-sm font-medium text-foreground mb-1.5 block">
                    Confirm new password
                  </label>
                  <input
                    id="confirm-password"
                    ref={confirmRef}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      if (confirmError) setConfirmError(null);
                      if (formError) setFormError(null);
                    }}
                    onBlur={() => setConfirmError(validateConfirm(password, confirm))}
                    placeholder="Re-enter your new password"
                    required
                    aria-invalid={!!confirmError}
                    aria-describedby={confirmError ? "confirm-password-error" : undefined}
                    className={`${inputClass} ${confirmError ? "border-destructive" : "border-border"}`}
                  />
                  {confirmError && (
                    <p id="confirm-password-error" role="alert" className="mt-1.5 text-xs text-destructive">
                      {confirmError}
                    </p>
                  )}
                </div>

                {formError && (
                  <div
                    role="alert"
                    className={
                      formError.kind === "network"
                        ? "flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
                        : "flex items-start gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2"
                    }
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {formError.message}
                      {formError.kind === "expired" && (
                        <>
                          {" "}
                          <Link
                            to="/login"
                            className="font-medium text-[#1E90FF] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Go to sign-in
                          </Link>
                        </>
                      )}
                    </span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-12 lg:h-11 rounded-md shimmer-cta font-semibold text-sm text-white hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {submitting ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating…
                    </span>
                  ) : (
                    "Update password"
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  Secure dealer access
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
