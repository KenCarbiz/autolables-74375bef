import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import Logo from "@/components/brand/Logo";
import Seo from "@/components/Seo";
import {
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Eye,
  EyeOff,
  Info,
  Lock,
  Loader2,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";

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

  const inputClass =
    "w-full h-12 lg:h-11 px-3 rounded-md border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all";

  return (
    <div className="min-h-screen flex bg-background">
      <Seo
        title="Sign in — AutoLabels.io"
        description="Sign in to AutoLabels.io to manage dealer stickers, addendums, Buyers Guides, and signed deals."
        path="/login"
        noindex
      />
      {/* Left brand panel — hidden below lg so the form is first on mobile */}
      <div className="hidden lg:flex lg:w-1/2 shimmer-hero relative overflow-hidden">
        <div className="absolute inset-0 opacity-25 pointer-events-none">
          <div className="absolute top-20 left-20 w-96 h-96 rounded-full bg-[#3BB4FF] blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-[#1E90FF] blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          <Logo variant="full" size={32} inverted tagline />

          <div className="space-y-8">
            <div>
              <h2 className="text-4xl font-semibold tracking-tight font-display leading-[1.12] [text-shadow:0_2px_22px_rgba(5,10,24,0.4)]">
                <span className="block text-white">Clear.</span>
                <span className="block text-white">Compliant.</span>
                <span className="block text-white">Consistent.</span>
              </h2>
              <div className="mt-4 h-1 w-16 rounded-full bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF]" />
              <p className="mt-5 text-base text-white/80 max-w-md [text-shadow:0_1px_14px_rgba(5,10,24,0.35)]">
                The dealer label platform — every sticker, addendum, and Buyers Guide
                that leaves your lot, perfectly priced and ready to sign.
              </p>
            </div>

            <div className="space-y-3 max-w-md">
              <Feature icon={ShieldCheck} text="FTC-aligned compliance built-in" />
              <Feature icon={Zap} text="VIN decode, rules engine, digital signing" />
              <Feature icon={CheckCircle2} text="Multi-store white label ready" />
            </div>
          </div>

          <div className="text-xs text-white/80">
            © {new Date().getFullYear()} {tenant?.name || "AutoLabels.io"}. Clear · Compliant · Consistent.
          </div>
        </div>
      </div>

      {/* Right form panel — top-aligned on mobile so the form is instantly
          visible; vertically centered from lg up. */}
      <div className="flex-1 flex items-start lg:items-center justify-center p-5 sm:p-8 lg:p-12 bg-muted/30">
        <div className="w-full max-w-[440px]">
          {/* Compact mobile brand header: logo + soft blue glow + portal label */}
          <div className="lg:hidden mb-6 flex flex-col items-center gap-2">
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-full bg-[#1E90FF]/25 blur-2xl"
              />
              <Logo variant="full" size={26} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-label text-[#1E90FF]">
              {isAdminMode ? "Platform admin" : "Dealer portal"}
            </span>
          </div>

          <div className="bg-card rounded-2xl border border-border/70 shadow-premium-lg p-5 sm:p-9">
            <div className="mb-6">
              <span className="hidden lg:block text-[11px] font-bold uppercase tracking-label text-[#1E90FF]">
                {isAdminMode ? "Platform admin" : "Dealer portal"}
              </span>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight font-display text-foreground">
                {isAdminMode ? "Admin sign-in" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                {isAdminMode
                  ? "Platform operators — sign in to manage tenants and billing."
                  : "Sign in to manage your dealership account."}
              </p>
            </div>

            {sessionExpired && (
              <div
                role="status"
                className="mb-5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              >
                Your session expired. Please sign in again.
              </div>
            )}

            {!isAdminMode && (
              <div className="mb-5 flex gap-2.5 rounded-xl bg-muted/60 border border-border/60 px-3.5 py-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Use the email associated with your dealership account. Need access? Contact
                  your dealership administrator or{" "}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("AutoLabels access request")}`}
                    className="font-medium text-[#1E90FF] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    AutoLabels Support
                  </a>
                  .
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className="text-sm font-medium text-foreground mb-1.5 block">
                  Email address
                </label>
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
                  className={`${inputClass} ${emailError ? "border-destructive" : "border-border"}`}
                />
                {emailError && (
                  <p id="email-error" role="alert" className="mt-1.5 text-xs text-destructive">
                    {emailError}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-sm font-medium text-foreground">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetState === "sending"}
                    className="text-xs font-medium text-[#1E90FF] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resetState === "sending" ? "Sending…" : "Forgot password?"}
                  </button>
                </div>
                <div className="relative">
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
                {passwordError && (
                  <p id="password-error" role="alert" className="mt-1.5 text-xs text-destructive">
                    {passwordError}
                  </p>
                )}
                {capsLock && !passwordError && (
                  <p
                    id="caps-hint"
                    role="status"
                    className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Caps Lock is on
                  </p>
                )}
              </div>

              {resetState === "sent" && (
                <div
                  role="status"
                  className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    If an account exists for that email, we&apos;ve sent a password reset link.
                    Check your inbox and spam folder.
                  </span>
                </div>
              )}
              {resetState === "error" && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Couldn&apos;t send the reset email. Please try again.</span>
                </div>
              )}

              {banner && (
                <div
                  role="alert"
                  className={
                    banner.kind === "ratelimit"
                      ? "flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
                      : "flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2"
                  }
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{banner.message}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || inCooldown}
                className="w-full h-12 lg:h-11 rounded-md shimmer-cta font-semibold text-sm text-white hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in…
                  </span>
                ) : isAdminMode ? (
                  "Sign in as admin"
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            {isAdminMode ? (
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-6 w-full text-xs text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              >
                ← Back to dealer sign-in
              </button>
            ) : (
              <div className="mt-6 space-y-3 text-center">
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  Secure dealer access
                </p>
                <p className="text-xs text-muted-foreground">
                  Need account access?{" "}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("AutoLabels access request")}`}
                    className="font-medium text-[#1E90FF] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Contact Support
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* Mobile-only footer + optional marketing disclosure. The desktop
              left panel carries branding, so none of this shows at lg+. */}
          {!isAdminMode && (
            <details className="lg:hidden mt-4 group rounded-xl border border-border/60 bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl [&::-webkit-details-marker]:hidden">
                Why AutoLabels?
                <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 px-4 pb-4 pt-1">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The dealer label platform — every sticker, addendum, and Buyers Guide
                  that leaves your lot, perfectly priced and ready to sign.
                </p>
                <MobileFeature icon={ShieldCheck} text="FTC-aligned compliance built-in" />
                <MobileFeature icon={Zap} text="VIN decode, rules engine, digital signing" />
                <MobileFeature icon={CheckCircle2} text="Multi-store white label ready" />
              </div>
            </details>
          )}

          <div className="lg:hidden mt-6 text-center space-y-2">
            <p className="text-[10px] uppercase tracking-label text-muted-foreground">
              Clear · Compliant · Consistent.
            </p>
            <p className="text-[11px] text-muted-foreground">
              <Link
                to="/privacy"
                className="hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Privacy
              </Link>
              {" · "}
              <Link
                to="/terms"
                className="hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Terms
              </Link>
              {" · © "}
              {new Date().getFullYear()} AutoLabels.io
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const MobileFeature = ({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) => (
  <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
    <div className="w-5 h-5 rounded-full bg-[#1E90FF]/10 text-[#1E90FF] flex items-center justify-center flex-shrink-0">
      <Icon className="w-3 h-3" />
    </div>
    <span>{text}</span>
  </div>
);

const Feature = ({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) => (
  <div className="flex items-center gap-3 text-sm text-white/85 [text-shadow:0_1px_10px_rgba(5,10,24,0.35)]">
    <div className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
      <Icon className="w-3 h-3" />
    </div>
    <span>{text}</span>
  </div>
);

export default Login;
