import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, DetailDrawer, EditorEmpty, StatusBadge, useIsNarrow, type AdminIconName, type StatusState } from "@/components/admin/v3/editor";
import { PUBLISHING_DRAFT_LABELS, VEHICLE_CLASS_LABEL, type ClassDetailCard, type PolicyCell, type PublishingRow, type VehicleClass } from "@/lib/admin/publishingPolicy";
import { adminTabHref } from "@/lib/admin/sections";
import { Banner } from "../brand/feeds/bits";
import type { PolicyHistoryEntry } from "./usePublishingData";

const CELL_STATE: Record<PolicyCell["state"], { state: StatusState; label: string }> = {
  enforced: { state: "required", label: "Enforced" },
  configured: { state: "enabled", label: "Configured" },
  open: { state: "disabled", label: "Not gated" },
  unknown: { state: "unknown", label: "Unknown" },
};

export const CONCEPT: Record<ClassDetailCard["key"], { icon: AdminIconName; heading: string; col: keyof Pick<PublishingRow, "listingVisibility" | "documentPublication" | "retailReadiness">; owner: { label: string; href: string } }> = {
  visibility: { icon: "eye", heading: "Listing visibility", col: "listingVisibility", owner: { label: "Edit in this policy", href: "" } },
  documents: { icon: "file", heading: "Document publication", col: "documentPublication", owner: { label: "Approval rules", href: adminTabHref("approval-rules") } },
  readiness: { icon: "wrench", heading: "Retail readiness", col: "retailReadiness", owner: { label: "Service policy", href: adminTabHref("service-policy") } },
};

const Cell = ({ cell }: { cell: PolicyCell }) => <span title={cell.detail} className={cn(cell.state === "unknown" && "text-adm-muted italic")}>{cell.label}</span>;

export const PolicyMatrix = ({ rows, selected, onSelect }: { rows: PublishingRow[]; selected: VehicleClass; onSelect: (c: VehicleClass) => void }) => {
  const narrow = useIsNarrow();
  if (narrow) {
    return (
      <ul className="space-y-3" aria-label="Effective publishing policy by vehicle type">
        {rows.map((r) => {
          const on = r.vehicleClass === selected;
          return (
            <li key={r.vehicleClass}>
              <button type="button" aria-pressed={on} onClick={() => onSelect(r.vehicleClass)} className={cn("w-full text-left rounded-xl border p-4 min-h-[44px] space-y-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", on ? "border-adm-primary bg-adm-selected" : "border-adm-divider bg-adm-surface")}>
                <span className="block text-[16px] leading-[22px] font-semibold text-adm-ink">{r.label}</span>
                <dl className="grid grid-cols-1 gap-1.5">
                  {([["Listing visibility", r.listingVisibility], ["Document publication", r.documentPublication], ["Retail readiness", r.retailReadiness], ["Overrides", r.overrides]] as Array<[string, PolicyCell]>).map(([k, c]) => (
                    <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 text-[14px] leading-[20px]"><dt className="text-adm-muted">{k}</dt><dd className="text-adm-ink break-words"><Cell cell={c} /></dd></div>
                  ))}
                </dl>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  const head: Array<[string, AdminIconName]> = [["Vehicle type", "car"], ["Listing visibility", "eye"], ["Document publication", "file"], ["Retail readiness", "wrench"], ["Overrides", "key"]];
  return (
    <div className="rounded-xl border border-adm-divider overflow-hidden">
      <table className="w-full text-left text-[14px] leading-[20px]" aria-label="Effective publishing policy by vehicle type">
        <caption className="sr-only">Effective publishing policy by vehicle type</caption>
        <thead>
          <tr className="bg-adm-workspace">
            {head.map(([h, icon]) => (
              <th key={h} scope="col" className="px-4 py-3 text-[14px] font-semibold text-adm-ink border-b border-adm-divider"><span className="inline-flex items-center gap-2"><AdminIcon name={icon} className="text-adm-muted" />{h}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = r.vehicleClass === selected;
            return (
              <tr key={r.vehicleClass} aria-selected={on} onClick={() => onSelect(r.vehicleClass)} className={cn("cursor-pointer border-b border-adm-divider last:border-b-0", on ? "bg-adm-selected" : "hover:bg-adm-workspace")}>
                <td className={cn("px-4 py-3.5 font-semibold", on && "shadow-[inset_3px_0_0_rgb(var(--adm-primary))]")}>
                  <button type="button" aria-pressed={on} onClick={() => onSelect(r.vehicleClass)} className={cn("min-h-[40px] text-left text-[15px] font-semibold hover:text-adm-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary", on ? "text-adm-primary" : "text-adm-ink")}>{r.label}</button>
                </td>
                <td className="px-4 py-3.5"><Cell cell={r.listingVisibility} /></td>
                <td className="px-4 py-3.5"><Cell cell={r.documentPublication} /></td>
                <td className="px-4 py-3.5"><Cell cell={r.retailReadiness} /></td>
                <td className="px-4 py-3.5"><Cell cell={r.overrides} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const ConceptCard = ({ card, cell, extra, onDetails }: { card: ClassDetailCard; cell: PolicyCell; extra?: string | null; onDetails: () => void }) => {
  const c = CONCEPT[card.key];
  const tone = card.tone === "danger" ? "danger" : card.tone === "warning" ? "primary" : "primary";
  return (
    <li className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 flex flex-col gap-3 min-w-0" data-concept={card.key}>
      <div className="flex items-start gap-3">
        <AdminIconTile name={c.icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[18px] text-adm-muted">{c.heading}</p>
          <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{card.title}</h3>
        </div>
      </div>
      <div><StatusBadge state={CELL_STATE[cell.state].state} label={CELL_STATE[cell.state].label} /></div>
      <p className="text-[14px] leading-[20px] text-adm-ink">{card.summary}</p>
      <p className="text-[14px] leading-[20px] text-adm-muted">{card.explanation}</p>
      {extra && <p className="text-[14px] leading-[20px] text-adm-ink">{extra}</p>}
      <div className="mt-auto pt-1"><AdminButton variant="secondary" className="min-h-[44px]" onClick={onDetails} aria-label={`Rule details: ${c.heading}`}>Rule details<AdminIcon name="chevron-right" /></AdminButton></div>
    </li>
  );
};

export const RuleDetailsDrawer = ({ concept, cls, cell, card, onClose, onEdit, canEdit }: { concept: ClassDetailCard["key"] | null; cls: VehicleClass; cell: PolicyCell | null; card: ClassDetailCard | null; onClose: () => void; onEdit: () => void; canEdit: boolean }) => {
  const c = concept ? CONCEPT[concept] : null;
  return (
    <DetailDrawer open={!!concept && !!cell} onClose={onClose} title={c ? `${c.heading}: ${VEHICLE_CLASS_LABEL[cls]}` : "Rule details"} description="What the rule says and what enforces it." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      {cell && card && c && (
        <>
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge state={CELL_STATE[cell.state].state} label={CELL_STATE[cell.state].label} /><span className="text-[15px] font-semibold text-adm-ink">{cell.label}</span></div>
          <p className="text-[14px] leading-[20px] text-adm-ink">{cell.detail}</p>
          <dl className="space-y-3">
            <div><dt className="text-[13px] text-adm-muted">Enforced by</dt><dd className="text-[14px] leading-[20px] text-adm-ink break-words"><code className="text-[13px]">{cell.enforcer}</code></dd></div>
            <div><dt className="text-[13px] text-adm-muted">Existing versions</dt><dd className="text-[14px] leading-[20px] text-adm-ink">Signed and approved documents keep the version they were signed or approved under. A policy change affects decisions from now on.</dd></div>
          </dl>
          {concept === "visibility" ? (
            canEdit ? <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => { onClose(); onEdit(); }}>Edit this rule</AdminButton> : <p className="text-[13px] text-adm-muted">Editing needs the manage settings permission.</p>
          ) : (
            <Link to={c.owner.href} className="inline-flex items-center gap-1 min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline">Open {c.owner.label}<AdminIcon name="chevron-right" size="inline" /></Link>
          )}
        </>
      )}
    </DetailDrawer>
  );
};

export const RecallDrawer = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <DetailDrawer open={open} onClose={onClose} title="Recall blocking policy" description="A separate policy that listing visibility always respects." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
    <Banner tone="warning" title="Not edited on this screen">This policy is enforced by the database. A visual or policy change here does not weaken it.</Banner>
    <dl className="space-y-3">
      <div><dt className="text-[13px] text-adm-muted">When a recall says do not drive</dt><dd className="text-[14px] leading-[20px] text-adm-ink">A vehicle cannot be published, and a live listing goes back to draft.</dd></div>
      <div><dt className="text-[13px] text-adm-muted">Who can override</dt><dd className="text-[14px] leading-[20px] text-adm-ink">A platform administrator, with the override recorded on the vehicle.</dd></div>
      <div><dt className="text-[13px] text-adm-muted">Enforced by</dt><dd className="text-[14px] leading-[20px] text-adm-ink"><code className="text-[13px]">enforce_prep_gate</code> and <code className="text-[13px]">trg_recall_unpublish_guard</code> on vehicle listings.</dd></div>
    </dl>
  </DetailDrawer>
);

const show = (v: unknown) => (v === true ? "On" : v === false ? "Off" : v === undefined || v === null ? "Not recorded" : String(v));

export const HistoryDrawer = ({ open, onClose, state, entries }: { open: boolean; onClose: () => void; state: "loading" | "ok" | "unavailable"; entries: PolicyHistoryEntry[] }) => (
  <DetailDrawer open={open} onClose={onClose} title="Policy history" description="Changes recorded when a policy was applied." footer={<><Link to={adminTabHref("change-history")} className="inline-flex items-center gap-1 min-h-[44px] mr-auto text-[14px] font-semibold text-adm-primary hover:underline">All configuration changes<AdminIcon name="chevron-right" size="inline" /></Link><AdminButton variant="primary" onClick={onClose}>Close</AdminButton></>}>
    {state === "loading" ? (
      <div className="h-32 rounded-xl bg-adm-workspace animate-pulse" aria-busy="true" />
    ) : state === "unavailable" ? (
      <EditorEmpty tone="danger" title="History is unavailable" description="The change history could not be read, so nothing is shown. This does not mean the policy was never changed." />
    ) : entries.length === 0 ? (
      <EditorEmpty artwork="documents" title="No recorded changes" description="No policy change has been recorded for this dealership. History appears here after a change is applied." />
    ) : (
      <ol className="space-y-4" aria-label="Policy changes">
        {entries.map((e) => {
          const labelled = e.keys.filter((k) => k in PUBLISHING_DRAFT_LABELS);
          return (
            <li key={e.id} className="rounded-xl border border-adm-divider p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap"><span className="text-[14px] font-semibold text-adm-ink">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span><span className="text-[13px] text-adm-muted">{e.actor ?? "Actor not recorded"}</span></div>
              {labelled.length === 0 ? <p className="text-[14px] text-adm-muted">{e.keys.length ? `Changed: ${e.keys.join(", ")}` : "The changed rules were not recorded."}</p> : (
                <ul className="space-y-1" aria-label="Changed rules">
                  {labelled.map((k) => (
                    <li key={k} className="text-[14px] leading-[20px] text-adm-ink">{PUBLISHING_DRAFT_LABELS[k as keyof typeof PUBLISHING_DRAFT_LABELS]}: <span className="text-adm-muted">{show(e.prev?.[k])}</span> to <strong>{show(e.next?.[k])}</strong></li>
                  ))}
                </ul>
              )}
              {e.version !== null && <p className="text-[13px] text-adm-muted">Reviewed against policy version {String(e.version)}</p>}
            </li>
          );
        })}
      </ol>
    )}
  </DetailDrawer>
);
