import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { consumeSessionExpired } from "@/lib/auth/sessionExpiry";
import { Loader2, ShieldX } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// AdminGate — wrap any platform-operator route. Three outcomes:
//
//   1. Not signed in.
//      → redirect to /login?next=<path>.
//
//   2. Signed in but not admin.
//      → render a polite "not authorized" page instead of
//        redirecting away, so the user can see why they're
//        blocked and sign out / switch accounts if needed.
//
//   3. Signed in AND admin.
//      → render children.
//
// Unlike EntitlementGate, AdminGate does NOT require a tenant or
// an app_entitlement. Platform admins are operators of the SaaS,
// not dealership members.
// ──────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

const AdminGate = ({ children }: Props) => {
  const navigate = useNavigate();
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    const nextPath = encodeURIComponent(window.location.pathname + window.location.search);
    // A lapsed (vs never-signed-in) session surfaces the "session expired" banner.
    const expired = consumeSessionExpired() ? "&expired=1" : "";
    setTimeout(() => navigate(`/login?next=${nextPath}${expired}`), 0);
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <ShieldX className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Admin access required</h1>
          <p className="text-sm text-muted-foreground">
            You're signed in as <span className="font-mono">{user.email}</span>, but this
            account doesn't have platform-admin privileges. If you manage a dealership,
            go to your dashboard. If you believe you should have admin access, contact
            hello@autolabels.io.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => navigate("/dashboard")}
              className="px-4 h-9 rounded-md bg-primary text-primary-foreground text-sm font-semibold"
            >
              Go to dashboard
            </button>
            <button
              onClick={() => navigate("/")}
              className="px-4 h-9 rounded-md border border-border text-sm font-semibold"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminGate;
