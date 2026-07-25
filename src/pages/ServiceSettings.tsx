import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { hasDealerCapability, dealerRoleHome, roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";
import { CommandCard, EmptyState, LoadingCard, BTN_SECONDARY } from "@/components/command/CommandPrimitives";
import { toast } from "sonner";
import { ArrowLeft, Lock, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// /service/settings — K-208 Policy, relocated OUT of the working queue
// (SERVICE_DESK_SPEC "Settings relocation"). can_manage_service_settings only;
// every change is audited. The Admin.tsx Feed Automation duplicate stays
// functional and links here.

interface MemberRow { id: string; user_id: string | null; email: string | null; role: string; accepted_at: string | null; }

// Keys must match real tenant_members.role values — the finalize gate compares
// the signed K-208 inspector's role against these.
const AUTHORITY_ROLES = [
  { key: "owner", label: "Owner" },
  { key: "admin", label: "Admin" },
  { key: "general_manager", label: "General Manager" },
  { key: "service_manager", label: "Service Manager" },
  { key: "service_advisor", label: "Service Writer" },
] as const;

export default function ServiceSettings() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { settings, loading, updateSettings } = useDealerSettings();
  const { log } = useAudit();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [members, setMembers] = useState<MemberRow[]>([]);

  const allowed = isAdmin || hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin);

  useEffect(() => {
    if (!tenantId || !allowed) return;
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).rpc("list_tenant_members", { p_tenant_id: tenantId });
      setMembers(((data as MemberRow[]) || []).filter((m) => m.accepted_at && m.user_id));
    })();
  }, [tenantId, allowed]);

  // Every policy change lands in audit_log with prev/new, per the spec.
  const change = async <K extends keyof DealerSettings>(key: K, next: DealerSettings[K], label: string) => {
    const prev = settings[key];
    const ok = await updateSettings({ [key]: next } as Partial<DealerSettings>);
    if (!ok) return;
    log({
      action: "service_policy_changed", entity_type: "dealer_settings", entity_id: String(key),
      store_id: tenantId || "", user_id: "",
      details: { key, prev, next },
    });
    toast.success(`${label} updated`);
  };

  if (!tenantId) return null;

  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto p-4 md:p-6">
        <EmptyState
          Icon={Lock}
          title="Service settings are restricted"
          detail={`Your role (${roleDisplayName(member?.role)}) does not have the can_manage_service_settings authorization. Ask an owner or service manager to change K-208 policy.`}
          action={
            <Link to={dealerRoleHome(member?.role, isAdmin)} className={BTN_SECONDARY}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to your home
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={3} />
        <LoadingCard rows={3} />
      </div>
    );
  }

  const grantedUsers = settings.k208_authorized_users || [];
  const roles = settings.k208_authority_roles || [];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">K-208 Policy</h1>
        </div>
        <Link to="/service" className={BTN_SECONDARY}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Service Desk
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Policy lives here, not in the working queue. Every change is recorded in the audit log.
      </p>

      <CommandCard title="Delivery and finalize gates">
        <div className="space-y-4">
          <ToggleRow
            title="Require K-208 before finalizing a used-car deal"
            detail="When on, a used/CPO deal can't be sent for disclosure signature until the safety inspection is signed. New cars are exempt."
            checked={settings.require_safety_inspection === true}
            onChange={(v) => void change("require_safety_inspection", v, "Finalize gate")}
          />
          <ToggleRow
            title="Also require licensee certification (execution)"
            detail="The signed inspection must additionally be executed by an authorized signer (A/B/C result + signature) before the gate is satisfied."
            checked={settings.require_k208_licensee_certification === true}
            onChange={(v) => void change("require_k208_licensee_certification", v, "Certification requirement")}
          />
        </div>
      </CommandCard>

      <CommandCard
        title="Who may sign the K-208 — roles"
        subtitle="Select roles to require the satisfying inspection be signed by a logged-in member with that role. Leave all off to accept any signed K-208 (with per-user grants below still honored)."
      >
        <div className="flex flex-wrap gap-2">
          {AUTHORITY_ROLES.map((r) => {
            const on = roles.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                onClick={() => void change("k208_authority_roles", on ? roles.filter((x) => x !== r.key) : [...roles, r.key], "Signer roles")}
                className={cn(
                  "min-h-[44px] px-4 rounded-full text-sm font-semibold border transition-colors",
                  on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {roles.length > 0 || grantedUsers.length > 0
            ? "Restricted: only the configured authority can execute."
            : "Open (compat): manager-level roles may execute until an explicit authority is configured."}
        </p>
      </CommandCard>

      <CommandCard
        title="Who may sign the K-208 — per-user grants"
        subtitle="Explicit, person-by-person execution authority (never job-title-derived). Enforced server-side by k208_signer_allowed."
        leading={<Users className="w-4 h-4 text-primary" aria-hidden="true" />}
      >
        {members.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground py-2">No accepted team members found.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {members.map((m) => {
              const uid = m.user_id as string;
              const on = grantedUsers.includes(uid);
              return (
                <li key={uid} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-primary/10 text-primary grid place-items-center text-[11px] font-black shrink-0">
                      {(m.email || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate">{m.email || "Member"}</p>
                      <p className="text-[11px] text-muted-foreground">{roleDisplayName(m.role)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`K-208 signer grant for ${m.email || "member"}`}
                    onClick={() => void change("k208_authorized_users", on ? grantedUsers.filter((x) => x !== uid) : [...grantedUsers, uid], "Per-user signer grants")}
                    className={cn("shrink-0 h-7 w-12 rounded-full transition-colors relative", on ? "bg-emerald-600" : "bg-muted")}
                  >
                    <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CommandCard>

      <CommandCard title="Queue and inspection rules">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold text-foreground">Overdue threshold</span>
              <span className="block text-xs text-muted-foreground">Hours since intake before a pending inspection counts as overdue in the queue.</span>
            </span>
            <input
              type="number"
              min={1}
              max={720}
              defaultValue={settings.service_overdue_hours || 24}
              onBlur={(e) => {
                const n = Math.max(1, Math.min(720, Number(e.target.value) || 24));
                if (n !== settings.service_overdue_hours) void change("service_overdue_hours", n, "Overdue threshold");
              }}
              aria-label="Overdue threshold in hours"
              className="w-24 h-11 rounded-lg border border-border bg-background px-3 text-sm text-right"
            />
          </label>
          <ToggleRow
            title="Allow Pass All Eligible Items"
            detail="One tap passes every unmarked line. It never signs the K-208 and never overwrites an existing failure; review is still required before submit."
            checked={settings.service_pass_all_enabled !== false}
            onChange={(v) => void change("service_pass_all_enabled", v, "Pass All availability")}
          />
          <ToggleRow
            title="Require a photo for failed items"
            detail="An inspection with failed lines can't be submitted without at least one attached photo."
            checked={settings.service_failure_photo_required === true}
            onChange={(v) => void change("service_failure_photo_required", v, "Failure photo rule")}
          />
          <ToggleRow
            title="Restrict reinspection to approvers"
            detail="Only roles with approve authority may mark a failed item passed on reinspection. Off: any inspection-capable employee may."
            checked={settings.service_reinspection_managers_only === true}
            onChange={(v) => void change("service_reinspection_managers_only", v, "Reinspection permission")}
          />
        </div>
      </CommandCard>
    </div>
  );
}

function ToggleRow({ title, detail, checked, onChange }: {
  title: string; detail: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="pr-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn("shrink-0 h-7 w-12 rounded-full transition-colors relative mt-0.5", checked ? "bg-emerald-600" : "bg-muted")}
      >
        <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
