import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { ClipboardCheck, ChevronLeft } from "lucide-react";
import { ServiceApprovalsPanel } from "@/components/service/AdditionalWork";
import { CommandCapabilityProvider } from "@/components/command/CommandPrimitives";

// /service/approvals — manager authorization as its own downstream screen.
// Technicians request additional work from the inspection; the decision
// happens here, off the operational queue.

export default function ServiceApprovals() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  if (!tenantId) return null;

  return (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[900px] mx-auto p-4 md:p-6 space-y-5">
        <div>
          <Link to="/service" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Service Desk
          </Link>
          <div className="flex items-center gap-2 mt-2">
            <ClipboardCheck className="w-5 h-5 text-primary" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Work Authorization</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Additional-work requests from the shop, waiting on a manager decision.
          </p>
        </div>
        <ServiceApprovalsPanel tenantId={tenantId} />
      </div>
    </CommandCapabilityProvider>
  );
}
