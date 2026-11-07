import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { servicePolicyFromSettings } from "@/lib/admin/documentPolicy";
import { inspectionSummary, reconSummary, technicianSummary, titlePolicyFromSettings, titleSummary, type GroupSummary } from "@/lib/admin/servicePolicyModel";
import { AdminIcon, AdminIconTile, StatusBadge, type AdminIconName } from "@/components/admin/v3/editor";
import type { ServicePolicyFixture } from "../ServicePolicyView";

export const SERVICE_GROUPS: Array<{ id: "inspection" | "technician" | "recon" | "title"; title: string; icon: AdminIconName; blurb: string }> = [
  { id: "inspection", title: "Inspection & signing", icon: "clipboard-check", blurb: "K-208, signers and install verification" },
  { id: "technician", title: "Technician requirements", icon: "wrench", blurb: "RO number, photos and task evidence" },
  { id: "recon", title: "Recon spending approvals", icon: "dollar", blurb: "Per line-item approval limit and approvers" },
  { id: "title", title: "Title & MCO collection", icon: "folder", blurb: "Recipients, intake email and reminders" },
];

export const serviceGroupHref = (group: string): string => `/admin?tab=service-policy&group=${group}`;

export function useServiceSummaries(): Record<(typeof SERVICE_GROUPS)[number]["id"], GroupSummary> {
  const { settings } = useDealerSettings();
  const fixture = useViewFixture<ServicePolicyFixture>("service-policy");
  return useMemo(() => {
    const policy = fixture?.policy ?? servicePolicyFromSettings(settings);
    const title = titlePolicyFromSettings(fixture?.title ?? settings);
    return { inspection: inspectionSummary(policy), technician: technicianSummary(policy), recon: reconSummary(policy), title: titleSummary(title) };
  }, [fixture, settings]);
}

const STATE_BADGE = { on: "enabled", off: "disabled", attention: "setup_required" } as const;

export default function HubService() {
  const summaries = useServiceSummaries();
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-[20px] text-adm-muted max-w-3xl">These are the service rules that apply to every vehicle. They are read from the saved Service policy and edited there; this page changes nothing.</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {SERVICE_GROUPS.map((g) => {
          const s = summaries[g.id];
          return (
            <li key={g.id} className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <AdminIconTile name={g.icon} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] leading-[24px] font-semibold">{g.title}</h2>
                  <p className="text-[14px] leading-[20px] font-medium">{s.headline}</p>
                  <ul className="mt-1.5 space-y-0.5 text-[14px] leading-[20px] text-adm-muted">{s.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
                <StatusBadge state={STATE_BADGE[s.state]} label={s.state === "on" ? "In effect" : s.state === "off" ? "Not required" : "Setup needed"} />
              </div>
              <Link to={serviceGroupHref(g.id)} className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-semibold text-adm-primary hover:underline">
                Open in Service policy <AdminIcon name="arrow-right" />
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] leading-[18px] text-adm-muted">Per-user signer grants and the overdue threshold live in <Link className="font-semibold text-adm-primary hover:underline" to="/service/settings">Service Desk settings</Link>. The Get-Ready service catalog is on <Link className="font-semibold text-adm-primary hover:underline" to={adminTabHref("service-policy", "getready-catalog")}>Service policy</Link>.</p>
    </div>
  );
}
