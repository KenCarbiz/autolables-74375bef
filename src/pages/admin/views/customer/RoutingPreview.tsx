import { useMemo, useState } from "react";
import { Clock, Headset, MessageSquare, Phone, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { AdminCard } from "@/components/admin/v2/primitives";
import { closedPillCopy, resolveCustomerPassportRouting, type ContactMode, type CustomerPassportContactSettings, type PassportAgent } from "@/lib/passportRouting";
import { namedAgents } from "@/lib/admin/routingDraft";
import { selectCls } from "./controls";

// The shopper's view of a routing configuration, resolved by the same rules
// the public passport uses. It renders the draft, never the saved settings,
// so an admin sees the effect of an edit before applying it.

type PreviewMode = "current" | ContactMode;

export const RoutingPreview = ({
  routing,
  agents,
  now,
  id = "routing-preview",
}: {
  routing: CustomerPassportContactSettings;
  agents: PassportAgent[];
  now: number;
  id?: string;
}) => {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("current");
  const [previewOpen, setPreviewOpen] = useState(true);

  // Previewing a mode that is not configured yet would silently fall back to
  // the store contact and look stuck, so the preview injects a labelled sample.
  const { preview, previewSample } = useMemo(() => {
    const pool = namedAgents(agents);
    let draft = previewMode === "current" ? routing : { ...routing, contactMode: previewMode };
    let previewAgents = pool;
    let assignedAgentId = pool[0]?.id ?? null;
    let sample = false;
    if (previewMode === "bdc" && !draft.bdcSettings?.enabled) {
      draft = { ...draft, bdcSettings: { showBdcAsTeam: true, ...(draft.bdcSettings ?? {}), enabled: true } };
      sample = true;
    }
    if (previewMode === "assigned_agent" || previewMode === "smart_routing") {
      if (pool.length === 0) {
        const sampleAgent: PassportAgent = {
          id: "__preview_sample__", name: "Example Specialist", title: "Product Specialist",
          status: "available", manualOverride: "available", acceptsPassportLeads: true, workingHours: [],
        };
        previewAgents = [sampleAgent];
        assignedAgentId = sampleAgent.id;
        sample = true;
      }
      if (!draft.showAgentProfile) {
        draft = { ...draft, showAgentProfile: true };
        sample = true;
      }
    }
    return {
      preview: resolveCustomerPassportRouting(draft, { agents: previewAgents, assignedAgentId, now: new Date(now) }),
      previewSample: sample,
    };
  }, [routing, agents, previewMode, now]);

  const pill = closedPillCopy(preview);
  const HelpIcon = preview.afterHours ? Clock : preview.displayMode === "team" ? Headset : Users;
  const PillIcon = preview.afterHours ? Clock : preview.displayMode === "team" ? Headset : ShieldCheck;

  return (
    <AdminCard
      id={id}
      title="Live preview"
      description={`Exactly what the shopper sees. Routed to: ${preview.routingTargetType.replace(/_/g, " ")}${preview.afterHours ? ", after hours" : ""}.`}
      action={
        <select aria-label="Preview mode" value={previewMode} onChange={(e) => setPreviewMode(e.target.value as PreviewMode)} className={`${selectCls} mt-0 w-auto h-8 text-[12px]`}>
          <option value="current">Current draft</option>
          <option value="smart_routing">Smart routing</option>
          <option value="assigned_agent">Assigned agent</option>
          <option value="bdc">BDC team</option>
          <option value="dealership_default">Dealership default</option>
        </select>
      }
    >
      {previewSample && (
        <p className="text-[12px] leading-[18px] font-medium text-adm-warning" role="status">
          Sample preview. {previewMode === "bdc" ? "Enable the BDC queue" : "Add a salesperson"} and apply to make this mode live.
        </p>
      )}

      <p className="text-[11px] font-bold text-adm-muted uppercase tracking-wide mt-3 mb-1.5">Closed state</p>
      <div className="h-14 pl-4 pr-5 rounded-full text-white inline-flex items-center gap-2.5 shadow-lg" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
        {preview.displayMode === "agent" && preview.agentPhotoUrl && !preview.afterHours
          ? <img src={preview.agentPhotoUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-white/40" />
          : preview.displayMode === "agent" && !preview.afterHours
            ? <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Users className="w-4 h-4" aria-hidden="true" /></span>
            : <PillIcon className="w-5 h-5 shrink-0" aria-hidden="true" />}
        <span className="text-left leading-tight"><span className="block text-[13px] font-extrabold">{pill.title}</span><span className="block text-[11px] opacity-85">{pill.sub}</span></span>
      </div>

      <div className="flex items-center justify-between mt-4 mb-1.5">
        <p className="text-[11px] font-bold text-adm-muted uppercase tracking-wide">Opened state</p>
        <button type="button" onClick={() => setPreviewOpen((o) => !o)} className="text-[12px] font-semibold text-adm-primary hover:underline">{previewOpen ? "Hide" : "Show"}</button>
      </div>
      {previewOpen && (
        <div className="rounded-2xl p-4 text-white" style={{ background: preview.afterHours ? "linear-gradient(160deg,#1e3a8a 0%,#172d6e 100%)" : "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <p className="text-[15px] font-extrabold leading-tight text-center">{preview.afterHours ? "We're closed right now." : "Ready to take the next step?"}</p>
          <p className="text-[10px] opacity-90 text-center mt-0.5">{preview.afterHours ? "Send us a message and our team will follow up as soon as we open." : "Choose the option that works best for you."}</p>
          <div className="mt-3 w-full rounded-xl bg-white text-[#2563EB] px-3 py-2.5 flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden="true" /><span className="text-[12px] font-extrabold">Request Vehicle Hold</span></div>
          <div className="mt-2 w-full rounded-xl bg-white/10 border border-white/40 px-3 py-2.5 flex items-center gap-2"><RefreshCw className="w-4 h-4" aria-hidden="true" /><span className="text-[12px] font-extrabold">Get a Trade Appraisal</span></div>
          <div className="mt-3 pt-3 border-t border-white/20">
            <div className="flex items-center gap-2.5">
              {preview.displayMode === "agent" && preview.agentPhotoUrl && !preview.afterHours
                ? <img src={preview.agentPhotoUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/40" />
                : <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center"><HelpIcon className="w-4 h-4" aria-hidden="true" /></span>}
              <div className="min-w-0">
                <p className="text-[12px] font-bold leading-tight">{preview.afterHours ? "We'll follow up as soon as we open." : preview.displayName}</p>
                <p className="text-[10px] opacity-80 leading-tight">{preview.afterHours ? preview.afterHoursMessage : preview.displaySubtitle}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <span className="h-8 rounded-lg bg-white/15 border border-white/40 text-[11px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3 h-3" aria-hidden="true" /> {preview.callLabel}</span>
              <span className="h-8 rounded-lg bg-white/15 border border-white/40 text-[11px] font-bold inline-flex items-center justify-center gap-1"><MessageSquare className="w-3 h-3" aria-hidden="true" /> {preview.contactLabel}</span>
            </div>
          </div>
        </div>
      )}
    </AdminCard>
  );
};
