import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { getDealerDocumentRules } from "@/lib/documentRules";
import { PUBLISHING_LINKS, VEHICLE_CLASSES, VEHICLE_CLASS_LABEL } from "@/lib/admin/publishingPolicy";
import { AdminCard, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { usePublishingData } from "./usePublishingData";

// Publishing > Approvals: the publication-relevant subset of the approval
// rules, read-only. The rules are edited in Documents & Service > Approval
// rules, the one writer of document_rules for print, packet and signing.

const OnOff = ({ v }: { v: boolean }) => <StatusChip tone={v ? "success" : "neutral"}>{v ? "On" : "Off"}</StatusChip>;

export default function ApprovalsView() {
  const { settingsSlice, description, loading, loadFailed } = usePublishingData();
  const rules = useMemo(() => getDealerDocumentRules(settingsSlice), [settingsSlice]);

  if (loading) return <SkeletonBlock className="h-64 w-full" />;

  const docs = [
    { doc: "Window sticker", applies: "New and used", print: rules.requireApprovalBeforePrint, publish: rules.requireApprovalBeforePublish, send: null, auto: rules.autoPublishApprovedWindow },
    { doc: "Addendum", applies: "All eligible", print: rules.requireApprovalBeforePrint, publish: rules.requireApprovalBeforePublish, send: rules.requireApprovalBeforePacketSend, auto: rules.autoPublishApprovedAddendum },
    { doc: "Buyers Guide", applies: "Used and CPO", print: rules.requireApprovalBeforePrint, publish: rules.requireApprovalBeforePublish, send: null, auto: false },
    { doc: "Customer packet", applies: "All eligible", print: null, publish: null, send: rules.requireApprovalBeforePacketSend, auto: false },
  ];

  const reviewModeFor = (cls: string): string => {
    if (!description) return "Unknown";
    const mode = description.reviewModeByClass?.[cls] ?? description.reviewMode;
    return mode ? mode.replace(/_/g, " ") : "Not set";
  };

  return (
    <div className="space-y-4">
      {loadFailed && <InlineNote tone="warning" title="Some inputs could not be read">Values that depend on them read as Unknown.</InlineNote>}
      <AdminCard
        title="Approval rules by document"
        description="Who must approve each document type before it prints, publishes or ships in a packet."
        action={<Link to={PUBLISHING_LINKS.approvalRules} className="text-[13px] font-semibold text-adm-primary hover:underline inline-flex items-center gap-1">Edit in Documents & Service <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>}
        flush
      >
        <AdminTable caption="Approval rules">
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Applies to</Th>
              <Th>Approval before print</Th>
              <Th>Approval before publish</Th>
              <Th>Approval before packet send</Th>
              <Th>Auto-publish when approved</Th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.doc}>
                <Td className="font-semibold">{d.doc}</Td>
                <Td className="text-adm-muted">{d.applies}</Td>
                <Td>{d.print === null ? <span className="text-adm-muted">Not applicable</span> : <OnOff v={d.print} />}</Td>
                <Td>{d.publish === null ? <span className="text-adm-muted">Not applicable</span> : <OnOff v={d.publish} />}</Td>
                <Td>{d.send === null ? <span className="text-adm-muted">Not applicable</span> : <OnOff v={d.send} />}</Td>
                <Td><OnOff v={d.auto} /></Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
        <p className="px-6 py-3 text-[12px] text-adm-muted">Approval before print, publish and packet send are single rooftop-wide rules; only auto-publish is set per document type.</p>
      </AdminCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminCard title="Stale and superseded documents" description="What happens to a public document after the facts behind it change.">
          <ul className="divide-y divide-adm-border -mt-2">
            {[
              ["Mark stale on price change", rules.staleOnPriceChange],
              ["Mark stale on MSRP change", rules.staleOnMsrpChange],
              ["Mark stale on addendum change", rules.staleOnAddendumChange],
              ["Withdraw stale public documents automatically", rules.autoUnpublishStale],
              ["Require manager review for stale documents", rules.requireManagerReviewStale],
              ["Hide superseded documents from the public page", rules.hideSupersededPublic],
            ].map(([label, v]) => (
              <li key={label as string} className="flex items-center justify-between gap-3 py-2.5 text-[14px] text-adm-ink">
                <span>{label as string}</span>
                <OnOff v={v as boolean} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-adm-muted">Approved and signed historical copies are never changed by these rules; a new version replaces them.</p>
        </AdminCard>

        <AdminCard title="Description review" description="Review mode per vehicle type, read from the description settings that description publishing enforces." action={<Link to={PUBLISHING_LINKS.destinations} className="text-[13px] font-semibold text-adm-primary hover:underline">Destinations</Link>}>
          <ul className="divide-y divide-adm-border -mt-2">
            {VEHICLE_CLASSES.map((cls) => (
              <li key={cls} className="flex items-center justify-between gap-3 py-2.5 text-[14px] text-adm-ink">
                <span>{VEHICLE_CLASS_LABEL[cls]}</span>
                <span className={reviewModeFor(cls) === "Unknown" ? "text-adm-muted" : "font-semibold"}>{reviewModeFor(cls)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-adm-muted">Internal publication {!description ? "unknown" : description.internalPublicationEnabled === null ? "not set" : description.internalPublicationEnabled ? "enabled" : "disabled"}.</p>
        </AdminCard>
      </div>
    </div>
  );
}
