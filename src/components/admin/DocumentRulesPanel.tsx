import { useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { getDealerDocumentRules, DEFAULT_DOCUMENT_RULES, type DocumentRules } from "@/lib/documentRules";
import { ShieldCheck, RefreshCw, FileSignature, Globe, Save } from "lucide-react";
import { toast } from "sonner";

// Dealer document workflow rules. Reuses the DealerSettings store
// (dealer_profiles.settings) via updateSettings — no separate table. Careful
// language: disclosure review / manager approval / customer acknowledgment.
export default function DocumentRulesPanel() {
  const { settings, updateSettings } = useDealerSettings();
  const [draft, setDraft] = useState<DocumentRules>(() => getDealerDocumentRules(settings));
  const [saving, setSaving] = useState(false);
  const set = (k: keyof DocumentRules, v: boolean) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    const ok = await updateSettings({ document_rules: draft });
    setSaving(false);
    if (ok) toast.success("Document rules saved");
    else toast.error("Saved locally; couldn't reach the server");
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-base font-bold text-foreground inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Approval &amp; Review Rules</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your store's disclosure review, manager approval, and customer acknowledgment workflows for stickers, addendums, and the Vehicle Passport. These are operational workflow settings, not a legal compliance guarantee.</p>
      </div>

      <Section title="Approval workflow" icon={ShieldCheck}>
        <Toggle label="Require manager approval before printing" v={draft.requireApprovalBeforePrint} on={(x) => set("requireApprovalBeforePrint", x)} />
        <Toggle label="Require manager approval before publishing to Vehicle Passport" v={draft.requireApprovalBeforePublish} on={(x) => set("requireApprovalBeforePublish", x)} />
        <Toggle label="Require manager approval before sending an addendum packet" v={draft.requireApprovalBeforePacketSend} on={(x) => set("requireApprovalBeforePacketSend", x)} />
        <Toggle label="Allow salespeople to print approved documents" v={draft.allowSalesPrintApproved} on={(x) => set("allowSalesPrintApproved", x)} />
        <Toggle label="Auto-submit newly generated documents for approval" v={draft.autoSubmitForApproval} on={(x) => set("autoSubmitForApproval", x)} />
      </Section>

      <Section title="Stale document handling" icon={RefreshCw}>
        <Toggle label="Mark documents stale when the vehicle price changes" v={draft.staleOnPriceChange} on={(x) => set("staleOnPriceChange", x)} />
        <Toggle label="Mark stale when MSRP changes" v={draft.staleOnMsrpChange} on={(x) => set("staleOnMsrpChange", x)} />
        <Toggle label="Mark stale when mileage changes" v={draft.staleOnMileageChange} on={(x) => set("staleOnMileageChange", x)} />
        <Toggle label="Mark stale when addendum items change" v={draft.staleOnAddendumChange} on={(x) => set("staleOnAddendumChange", x)} />
        <Toggle label="Mark stale when the vehicle is sold or removed" v={draft.staleOnSoldRemoved} on={(x) => set("staleOnSoldRemoved", x)} />
        <Toggle label="Auto-unpublish stale public documents" v={draft.autoUnpublishStale} on={(x) => set("autoUnpublishStale", x)} />
        <Toggle label="Require manager review for stale documents" v={draft.requireManagerReviewStale} on={(x) => set("requireManagerReviewStale", x)} />
      </Section>

      <Section title="Addendum packet workflow" icon={FileSignature}>
        <Toggle label="Require addendum sticker match before customer signing" v={draft.requireStickerMatchBeforeSigning} on={(x) => set("requireStickerMatchBeforeSigning", x)} />
        <Toggle label="Block packet send when sticker/packet match fails" v={draft.blockPacketOnMismatchFail} on={(x) => set("blockPacketOnMismatchFail", x)} />
        <Toggle label="Allow warning override with a manager reason" v={draft.allowWarningOverrideWithReason} on={(x) => set("allowWarningOverrideWithReason", x)} />
        <Toggle label="Require customer re-review if a signed packet changes" v={draft.requireRereviewOnSignedChange} on={(x) => set("requireRereviewOnSignedChange", x)} />
        <Toggle label="Require a generated addendum sticker in the packet before signing" v={draft.requireAddendumStickerInPacket} on={(x) => set("requireAddendumStickerInPacket", x)} />
      </Section>

      <Section title="Vehicle Passport visibility" icon={Globe}>
        <Toggle label="Auto-publish approved window stickers" v={draft.autoPublishApprovedWindow} on={(x) => set("autoPublishApprovedWindow", x)} />
        <Toggle label="Auto-publish approved addendum stickers" v={draft.autoPublishApprovedAddendum} on={(x) => set("autoPublishApprovedAddendum", x)} />
        <Toggle label="Hide superseded documents from the public page" v={draft.hideSupersededPublic} on={(x) => set("hideSupersededPublic", x)} />
        <Toggle label="Show document version history publicly" v={draft.showVersionHistoryPublic} on={(x) => set("showVersionHistoryPublic", x)} />
        <Toggle label="Track QR scans" v={draft.trackQrScans} on={(x) => set("trackQrScans", x)} />
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save rules"}</button>
        <button onClick={() => setDraft({ ...DEFAULT_DOCUMENT_RULES })} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reset to defaults</button>
      </div>
    </div>
  );
}

const Section = ({ title, icon: Icon, children }: { title: string; icon: typeof ShieldCheck; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-2.5"><Icon className="w-3.5 h-3.5 text-muted-foreground" /> {title}</h3>
    <div className="divide-y divide-border">{children}</div>
  </div>
);

const Toggle = ({ label, v, on }: { label: string; v: boolean; on: (x: boolean) => void }) => (
  <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
    <span className="text-sm text-foreground">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={v}
      onClick={() => on(!v)}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${v ? "bg-blue-600" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${v ? "translate-x-4" : ""}`} />
    </button>
  </label>
);
