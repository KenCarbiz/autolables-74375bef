import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Manage the dealer's third-party installers. ingest-orchestrate emails the
// active ones the per-vehicle install link on intake (when auto-notify is on).
// Writes go straight to installer_contacts (tenant-scoped RLS).

interface Installer { id: string; company: string; product: string | null; email: string | null; active: boolean; }
// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export default function InstallerContactsCard() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [rows, setRows] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ company: "", product: "", email: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) { setRows([]); setLoading(false); return; }
    const { data } = await sb().from("installer_contacts").select("id, company, product, email, active")
      .eq("tenant_id", tenantId).order("created_at", { ascending: true });
    setRows((data as Installer[]) || []);
    setLoading(false);
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!tenantId || !draft.company.trim()) return;
    setBusy(true);
    const { error } = await sb().from("installer_contacts").insert({
      tenant_id: tenantId, company: draft.company.trim(),
      product: draft.product.trim() || null, email: draft.email.trim() || null, active: true,
    });
    setBusy(false);
    if (error) { toast.error("Couldn't add installer."); return; }
    setDraft({ company: "", product: "", email: "" });
    await load();
  };

  const toggle = async (id: string, active: boolean) => {
    await sb().from("installer_contacts").update({ active }).eq("id", id);
    await load();
  };
  const remove = async (id: string) => {
    await sb().from("installer_contacts").delete().eq("id", id);
    await load();
  };

  return (
    <div className="border-t border-border-custom pt-4 mt-1">
      <span className="text-sm font-semibold text-foreground">Third-party installers</span>
      <p className="text-xs text-muted-foreground mt-0.5">Notified with the install link when a vehicle is ingested (if auto-notify is on).</p>
      {loading ? (
        <div className="py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <label className="inline-flex items-center gap-1.5 shrink-0">
                <input type="checkbox" checked={r.active} onChange={(e) => toggle(r.id, e.target.checked)} className="h-4 w-4" />
              </label>
              <span className="font-medium text-foreground min-w-0 truncate flex-1">{r.company}{r.product ? ` · ${r.product}` : ""}</span>
              <span className="text-muted-foreground text-xs truncate max-w-[40%]">{r.email || "no email"}</span>
              <button onClick={() => remove(r.id)} className="w-7 h-7 grid place-items-center rounded border border-border-custom text-muted-foreground shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {rows.length === 0 && <p className="text-xs text-muted-foreground">No installers yet.</p>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <input value={draft.company} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} placeholder="Company" className="px-2.5 py-2 border border-border-custom rounded text-sm" />
        <input value={draft.product} onChange={(e) => setDraft((d) => ({ ...d, product: e.target.value }))} placeholder="Product (e.g. Tint)" className="px-2.5 py-2 border border-border-custom rounded text-sm" />
        <input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Email" className="px-2.5 py-2 border border-border-custom rounded text-sm" />
      </div>
      <button disabled={!draft.company.trim() || busy} onClick={add} className="mt-2 h-9 px-3 rounded-lg border border-dashed border-border-custom text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add installer
      </button>
    </div>
  );
}
