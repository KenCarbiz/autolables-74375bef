import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Users, UserPlus, Loader2, Trash2 } from "lucide-react";
import { ASSIGNABLE_ROLE_GROUPS, roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";

// Dealer-scoped team management. Uses the tenant RBAC RPCs (owner/admin-gated,
// last-owner-protected) from 20260617000000_team_rbac.sql — no platform admin
// needed, a dealership owner manages their own staff.

interface Member {
  id: string;
  user_id: string | null;
  email: string | null;
  role: string;
  accepted_at: string | null;
  invited_email: string | null;
}

// Job roles (grouped) come from the capability source of truth so the picker
// and the access model can never drift apart.
const RoleOptions = () => (
  <>{ASSIGNABLE_ROLE_GROUPS.map((g) => (
    <optgroup key={g.group} label={g.group}>
      {g.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </optgroup>
  ))}</>
);
const roleLabel = (r: string) => roleDisplayName(r);

export default function TeamPanel() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("salesperson");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("list_tenant_members", { p_tenant_id: tenantId });
    if (!error) setMembers((data as Member[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { toast.error("Enter a valid email"); return; }
    setInviting(true);
    const { error } = await (supabase as any).rpc("invite_tenant_member", { p_tenant_id: tenantId, p_email: e, p_role: role });
    setInviting(false);
    if (error) { toast.error(error.message.includes("not authorized") ? "Only an owner or admin can invite teammates." : error.message); return; }
    toast.success(`Invited ${e} as ${roleLabel(role)}`);
    setEmail("");
    load();
  };

  const changeRole = async (m: Member, next: string) => {
    const { error } = await (supabase as any).rpc("set_tenant_member_role", { p_member_id: m.id, p_role: next });
    if (error) { toast.error(error.message.includes("last owner") ? "You can't change the last owner." : error.message); return; }
    toast.success("Role updated");
    load();
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email || m.invited_email} from the team?`)) return;
    const { error } = await (supabase as any).rpc("remove_tenant_member", { p_member_id: m.id });
    if (error) { toast.error(error.message.includes("last owner") ? "You can't remove the last owner." : error.message); return; }
    toast.success("Removed");
    load();
  };

  if (!tenantId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-[#2563EB]" />
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">Team</h3>
      </div>
      <p className="text-sm text-muted-foreground -mt-1 max-w-2xl">
        Invite your staff and set what each person can do. Salespeople and F&amp;I see a simpler menu;
        managers and owners see setup and reports.
      </p>

      {/* Invite */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@dealership.com"
            className="flex-1 h-10 rounded-md border border-border bg-background px-3 text-sm"
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm font-semibold">
            <RoleOptions />
          </select>
          <button onClick={invite} disabled={inviting} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading team…</p>
        ) : members.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No teammates yet — invite your first above.</p>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{m.email || m.invited_email || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{m.accepted_at ? "Active" : "Invited — pending sign-up"}</p>
                </div>
                {m.role === "owner" ? (
                  <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-amber-50 text-amber-700">Owner</span>
                ) : (
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs font-semibold"
                  >
                    {!ASSIGNABLE_ROLE_GROUPS.some((g) => g.roles.some((r) => r.value === m.role)) && (
                      <option value={m.role}>{roleLabel(m.role)} (current)</option>
                    )}
                    <RoleOptions />
                  </select>
                )}
                {m.role !== "owner" && (
                  <button onClick={() => remove(m)} title="Remove" className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
