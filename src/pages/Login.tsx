import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import Logo from "@/components/brand/Logo";
import Seo from "@/components/Seo";
import "@/styles/login.css";
import LoginHero from "@/components/login/LoginHero";
import {
  IconEmail,
  IconLock,
  IconEye,
  IconEyeOff,
  IconArrowRight,
  IconWarning,
  IconCheck,
  IconSpinner,
} from "@/components/login/LoginIcons";

const SUPPORT_EMAIL = "hello@autolabels.io";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client-side throttle. The Supabase auth endpoint has its own rate
// limiting, but it doesn't always surface a 429 quickly, so we add a
// lightweight local cooldown after repeated failures to blunt brute
// forcing from a single tab.
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

const safeNext = (raw: string | null): string => {
  // Only allow same-origin paths; otherwise default to /dashboard.
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
};

type AuthErrorKind = "credentials" | "ratelimit" | "network";

// Map any auth failure to a generic, non-enumerating message. We never
// reveal whether the email exists — a bad email and a bad password read
// identically as "Invalid email or password".
const classifyAuthError = (
  err: unknown,
): { kind: AuthErrorKind; message: string } => {
  const e = (err ?? {}) as { status?: number; message?: string; name?: string };
  const status = typeof e.status === "number" ? e.status : undefined;
  const msg = (e.message ?? "").toLowerCase();
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) {
    return { kind: "ratelimit", message: "Too many attempts. Try again in a moment." };
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
  return { kind: "credentials", message: "Invalid email or password." };
};

const Login = () => {
  const { signIn, user, isAdmin } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const explicitNext = searchParams.get("next");
  const isAdminMode = searchParams.get("admin") === "1";
  // Invite links from admin_invite_member / admin_create_tenant land with
  // ?email=... pre-filled so the dealer doesn't have to re-type theirs.
  const invitedEmail = searchParams.get("email") || "";
  // A redirect that carries ?expired=1 (or router state { expired: true })
  // means an authenticated session lapsed; surface a gentle banner. No
  // gate currently sets this, so it stays dormant until one does.
  const sessionExpired =
    searchParams.get("expired") === "1" ||
    (location.state as { expired?: boolean } | null)?.expired === true;
  // Admins default to /admin, dealers to /dashboard. Same-origin
  // ?next= overrides.
  const resolveNext = () =>
    explicitNext ? safeNext(explicitNext) : isAdmin ? "/admin" : "/dashboard";
  const nextPath = resolveNext();

  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ kind: AuthErrorKind; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const inCooldown = cooldownUntil !== null && now < cooldownUntil;

  // Tick once a second while a cooldown is active so the submit button
  // re-enables itself the moment it lapses.
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  // If we're already signed in, don't make the user log in again —
  // just go where they were headed.
  useEffect(() => {
    if (user) navigate(nextPath, { replace: true });
  }, [user, nextPath, navigate]);

  const validateEmail = (v: string): string | null => {
    const trimmed = v.trim();
    if (!trimmed) return "Enter your email address.";
    if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
    return null;
  };
  const validatePassword = (v: string): string | null =>
    v ? null : "Enter your password.";

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || inCooldown) return;

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setEmailError(eErr);
    setPasswordError(pErr);
    if (eErr || pErr) {
      (eErr ? emailRef : passwordRef).current?.focus();
      return;
    }

    setFormError(null);
    setLoading(true);
    const { error: err } = await signIn(email.trim(), password);
    setLoading(false);

    if (err) {
      const classified = classifyAuthError(err);
      setFormError(classified);
      const next = failCount + 1;
      setFailCount(next);
      if (classified.kind === "ratelimit" || next >= MAX_ATTEMPTS) {
        setCooldownUntil(Date.now() + COOLDOWN_MS);
        setNow(Date.now());
      }
      return;
    }
    // On successful sign-in we deliberately do NOT navigate here. The
    // useEffect above waits for both user + isAdmin to resolve, then
    // routes admins to /admin and dealers to /dashboard.
    setFailCount(0);
  };

  // Self-serve reset. We reuse whatever is already typed in the Email
  // field; an empty/invalid address surfaces the inline validation and
  // never sends. The confirmation is deliberately non-enumerating — a
  // missing account resolves without error and shows identical copy, so
  // the page never reveals whether an address is registered.
  const handleForgotPassword = async () => {
    if (resetState === "sending") return;
    const eErr = validateEmail(email);
    if (eErr) {
      setEmailError(eErr);
      emailRef.current?.focus();
      return;
    }
    setEmailError(null);
    setResetState("sending");
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetState(err ? "error" : "sent");
  };

  const banner = inCooldown
    ? { kind: "ratelimit" as AuthErrorKind, message: "Too many attempts. Try again in a moment." }
    : formError;

  // Presentation-only affordance for the network-failure banner: re-fires
  // the exact same submit path a click on the primary button would, via
  // the native form, rather than duplicating handleSubmit's logic.
  const retry = () => formRef.current?.requestSubmit();

  return (
    <main className="login-page">
      <Seo
        title="Sign in — AutoLabels.io"
        description="Sign in to AutoLabels.io to manage dealer stickers, addendums, Buyers Guides, and signed deals."
        path="/login"
        noindex
      />

      <LoginHero year={new Date().getFullYear()} />

      <div className="login-auth">
        <p className="login-auth-eyebrow">
          Trusted by dealerships
          <br />
          Nationwide
        </p>

        <div className="login-mobile-brand">
          <Logo variant="full" size={26} />
        </div>

        <form ref={formRef} onSubmit={handleSubmit} noValidate className="login-card">
          <p className="login-eyebrow">{isAdminMode ? "Platform admin" : "Dealer portal"}</p>
          <h1 className="login-card-title">{isAdminMode ? "Admin sign-in" : "Welcome back"}</h1>
          <p className="login-card-subtitle">
            {isAdminMode
              ? "Platform operators — sign in to manage tenants and billing."
              : "Sign in to your AutoLabels workspace."}
          </p>

          {sessionExpired && (
            <div role="status" className="login-alert is-warning">
              <IconWarning className="login-alert-icon" />
              <span>Your session expired. Please sign in again.</span>
            </div>
          )}

          <div className="login-field">
            <div className="login-field-head">
              <label htmlFor="email" className="login-field-label">
                Email address
              </label>
            </div>
            <div className={cn("login-input-shell", emailError && "is-invalid")}>
              <IconEmail className="login-input-icon" />
              <input
                id="email"
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus={!invitedEmail}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                  if (formError) setFormError(null);
                  if (resetState !== "idle") setResetState("idle");
                }}
                onBlur={() => setEmailError(validateEmail(email))}
                placeholder="you@dealership.com"
                required
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "email-error" : undefined}
                className="login-input"
              />
            </div>
            {emailError && (
              <p id="email-error" role="alert" className="login-field-error">
                {emailError}
              </p>
            )}
          </div>

          <div className="login-field">
            <div className="login-field-head">
              <label htmlFor="password" className="login-field-label">
                Password
              </label>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetState === "sending"}
                className="login-field-link"
              >
                {resetState === "sending" ? "Sending…" : "Forgot password?"}
              </button>
            </div>
            <div className={cn("login-input-shell", passwordError && "is-invalid")}>
              <IconLock className="login-input-icon" />
              <input
                id="password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoFocus={!!invitedEmail}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                  if (formError) setFormError(null);
                }}
                onBlur={() => {
                  setPasswordError(validatePassword(password));
                  setCapsLock(false);
                }}
                onKeyDown={onPasswordKey}
                onKeyUp={onPasswordKey}
                placeholder="••••••••"
                required
                aria-invalid={!!passwordError}
                aria-describedby={
                  [passwordError ? "password-error" : null, capsLock ? "caps-hint" : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className="login-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={-1}
                className="login-input-action"
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            {passwordError && (
              <p id="password-error" role="alert" className="login-field-error">
                {passwordError}
              </p>
            )}
            {capsLock && !passwordError && (
              <p id="caps-hint" role="status" className="login-field-error is-hint">
                Caps Lock is on
              </p>
            )}
          </div>

          {resetState === "sent" && (
            <div role="status" className="login-alert is-success">
              <IconCheck className="login-alert-icon" />
              <span>
                If an account exists for that email, we&apos;ve sent a password reset link.
                Check your inbox and spam folder.
              </span>
            </div>
          )}
          {resetState === "error" && (
            <div role="alert" className="login-alert is-error">
              <IconWarning className="login-alert-icon" />
              <span>Couldn&apos;t send the reset email. Please try again.</span>
            </div>
          )}

          {banner && (
            <div
              role="alert"
              className={cn("login-alert", banner.kind === "ratelimit" ? "is-warning" : "is-error")}
            >
              <IconWarning className="login-alert-icon" />
              {banner.kind === "network" ? (
                <div className="login-alert-text">
                  <p className="login-alert-title">Connection issue</p>
                  <p className="login-alert-body">
                    We couldn&apos;t reach AutoLabels. Check your connection and try again.
                  </p>
                  <button type="button" onClick={retry} className="login-alert-action">
                    Retry
                  </button>
                </div>
              ) : (
                <span>{banner.message}</span>
              )}
            </div>
          )}

          <button type="submit" disabled={loading || inCooldown} className="login-submit">
            {loading ? "Signing in…" : isAdminMode ? "Sign in as admin" : "Sign in"}
            {loading ? <IconSpinner className="login-submit-spinner" /> : <IconArrowRight />}
          </button>

          {isAdminMode ? (
            <button type="button" onClick={() => navigate("/login")} className="login-back">
              ← Back to dealer sign-in
            </button>
          ) : (
            <>
              <div className="login-secure">
                <span className="login-secure-inner">
                  <IconLock />
                  Secure dealership access
                </span>
              </div>
              <p className="login-access">
                Need access?{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("AutoLabels access request")}`}
                  className="login-access-link"
                >
                  Contact your administrator.
                </a>
              </p>
            </>
          )}
        </form>

        <div className="login-auth-footer">
          <nav className="login-legal" aria-label="Legal">
            <Link to="/privacy">Privacy</Link>
            <span className="login-legal-sep" aria-hidden="true">|</span>
            <Link to="/terms">Terms</Link>
            <span className="login-legal-sep" aria-hidden="true">|</span>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("AutoLabels support")}`}>
              Support
            </a>
          </nav>
          <p className="login-tagline">
            <span className="login-tagline-rule" aria-hidden="true" />
            A cleaner, smarter automotive retail
          </p>
        </div>
      </div>
    </main>
  );
};

export default Login;
