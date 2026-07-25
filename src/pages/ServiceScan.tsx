import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Loader2, QrCode } from "lucide-react";
import { EmptyState, BTN_SECONDARY } from "@/components/command/CommandPrimitives";

// /service/scan/:token — the authenticated Service QR landing. Resolves the
// permanent dept_signoff hub token (get_vehicle_ready, SECURITY DEFINER) to the
// tenant + vehicle and lands the employee DIRECTLY on that vehicle's workspace.
// The QR is never authentication: a logged-out scan goes through /login with
// ?next= back here (EntitlementGate adds it for this path). The anon vendor
// flow at /ready/:token is untouched.

const REASONS: Record<string, string> = {
  not_found: "This Service QR does not match any vehicle. It may have been reprinted.",
  expired: "This Service QR has expired or was revoked. Generate a fresh one from the vehicle workspace.",
};

export default function ServiceScan() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [failReason, setFailReason] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!token) { setFailReason("not_found"); return; }
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_vehicle_ready", { _token: token });
      if (off) return;
      if (error || !data?.ok || !data?.vin) {
        setFailReason(String(data?.reason || "not_found"));
        return;
      }
      // The same shared workspace the desktop queue opens — a completed
      // vehicle renders there read-only; no duplicate inspection is possible.
      navigate(`/service/vehicle/${String(data.vin).toUpperCase()}`, { replace: true });
    })();
    return () => { off = true; };
  }, [token, navigate]);

  if (failReason) {
    return (
      <div className="max-w-lg mx-auto p-4 md:p-6">
        <EmptyState
          Icon={QrCode}
          title="Couldn't open this vehicle"
          detail={REASONS[failReason] || REASONS.not_found}
          action={
            <Link to="/service" className={BTN_SECONDARY}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Go to the Service Desk
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-[50vh] grid place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Opening this vehicle's service workspace…</p>
      </div>
    </div>
  );
}
