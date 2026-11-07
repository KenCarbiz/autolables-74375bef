import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { DraftActionBar, EditorEmpty, LeaveGuardDialog, ReviewChangesDialog, ScopeLabel, SectionCard } from "@/components/admin/v3/editor";
import { Banner, LinkRow } from "../brand/feeds/bits";
import { destinationRows } from "@/lib/admin/descriptionSettingsModel";
import { AutomationPanel, AutomationRuleDrawer, ConnectorDrawer, DeliveryHistoryDrawer, DestinationCard, ExportOptionsDrawer, OutputPreviewDrawer } from "./DestinationParts";
import { BrandVoiceSection, ClaimsSection, Managed45Notice, OutputProfileDrawer, OutputProfilesSection, PhraseEditorDrawer, ValidationDrawer } from "./DescriptionParts";
import { useDescriptionSettings } from "./useDescriptionSettings";

type Section = "automation" | "description";

const NAV: Array<{ id: Section; label: string }> = [
  { id: "automation", label: "Automation and destinations" },
  { id: "description", label: "Description settings" },
];

export default function DestinationsView() {
  const api = useDescriptionSettings();
  const [params, setParams] = useSearchParams();
  const section: Section = (api.section ?? params.get("section")) === "description" ? "description" : "automation";
  const [rule, setRule] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ kind: "preview" | "export" | "history" | "connector"; key: string } | null>(null);
  const [phrases, setPhrases] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [validate, setValidate] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);

  const choose = (id: Section) => {
    const next = new URLSearchParams(params);
    if (id === "automation") next.delete("section"); else next.set("section", id);
    setParams(next, { replace: true });
  };

  if (api.loading) return <div className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" aria-busy="true" aria-label="Loading destinations" />;
  const draft = api.edit.draft;
  if (api.unreadable || !draft) {
    return (
      <div className="rounded-xl border border-adm-divider bg-adm-surface">
        <EditorEmpty tone="danger" title="Description settings could not be read" description="Nothing is shown as saved and nothing can be changed until the settings load. This is not a report of default settings." action={<AdminButton variant="secondary" onClick={api.refresh}>Try again</AdminButton>} />
      </div>
    );
  }

  const dests = destinationRows(draft);
  const focus = dests.find((d) => d.key === drawer?.key) ?? null;
  const rooftop = api.rooftopLabel;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">Stored once for {api.groupLabel ?? "the dealer group"}{rooftop ? `; you are viewing ${rooftop}` : ""}. There is no rooftop override.</p>
      </div>

      <nav aria-label="Destinations sections" className="flex gap-2 flex-wrap">
        {NAV.map((n) => (
          <button key={n.id} type="button" aria-current={section === n.id ? "page" : undefined} onClick={() => choose(n.id)}
            className={cn("min-h-[44px] px-4 rounded-lg border text-[14px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", section === n.id ? "bg-adm-selected border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-divider text-adm-ink hover:bg-adm-workspace")}>
            {n.label}
          </button>
        ))}
      </nav>

      {!api.canEdit && <Banner tone="neutral" icon="lock" title="You can view these settings but not change them">Changing automation, destinations and description settings needs the manage settings permission. Ask an owner or manager.</Banner>}

      {section === "automation" ? (
        <>
          <SectionCard id="automation" icon="sliders" title="Automation" description="How much AutoLabels does before a person is involved when it writes a description.">
            <AutomationPanel api={api} onEdit={setRule} />
          </SectionCard>

          <SectionCard id="destinations" icon="plug" title="Destinations" description="Each destination separates writing text, how it is delivered, and whether delivery is automatic.">
            <Banner tone="info" icon="eye" title="Writing and previewing never send anything">Export only means AutoLabels produces the text and you send it. Only the internal Vehicle Passport is delivered by AutoLabels. Website, marketplace, vAuto and SEO outputs are separate from each other.</Banner>
            {!draft.internal_publication_enabled && <Banner tone="warning" title="Passport delivery is off">Nothing is written to the shopper Passport automatically, whatever the automation mode says.</Banner>}
            <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4" aria-label="Destinations">
              {dests.map((r) => (
                <DestinationCard key={r.key} row={r} summary={api.deliveries.summary[r.key]} deliveryState={api.deliveries.state} api={api} onAction={(kind, key) => setDrawer({ kind, key })} />
              ))}
            </ul>
          </SectionCard>

          <div>
            <h2 className="text-[16px] leading-[24px] font-semibold text-adm-ink mb-2">Related settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <LinkRow to={adminTabHref("effective-policy")} icon="globe" title="Passport publishing on intake" description="Auto-publish and document rules" />
              <LinkRow to={adminTabHref("websites-feeds")} icon="link" title="Websites and feeds" description="Inventory and listing addresses" />
              <LinkRow to="/description-operations" icon="activity" title="Description Operations" description="Per-vehicle review and exceptions" />
            </div>
          </div>
        </>
      ) : (
        <>
          <Managed45Notice />
          <SectionCard id="brand-voice" icon="paintbrush" title="Brand voice" description="How the dealership sounds, and the wording every description must carry.">
            <BrandVoiceSection api={api} onEditPhrases={() => setPhrases(true)} />
          </SectionCard>
          <SectionCard id="output-profiles" icon="list" title="Output profiles" description="Target, readable range and limit for each destination. Counts include spaces, the call to action and the required wording.">
            <OutputProfilesSection api={api} onEdit={setProfile} onPreview={setSample} onValidate={setValidate} />
          </SectionCard>
          <SectionCard id="claims" icon="shield-check" title="Claims" description="What descriptions are permitted to say, when the vehicle's own records support it.">
            <ClaimsSection api={api} />
          </SectionCard>
        </>
      )}

      {api.canEdit && <DraftActionBar state={api.barState} onDiscard={api.discard} onReview={api.flow.openReview} onRetry={() => void api.apply()} onRefresh={api.refresh} retryDisabled={!api.canApply} />}

      <AutomationRuleDrawer api={api} type={rule} onClose={() => setRule(null)} />
      <ConnectorDrawer row={drawer?.kind === "connector" ? focus : null} onClose={() => setDrawer(null)} />
      <ExportOptionsDrawer row={drawer?.kind === "export" ? focus : null} onClose={() => setDrawer(null)} />
      <DeliveryHistoryDrawer api={api} row={drawer?.kind === "history" ? focus : null} onClose={() => setDrawer(null)} />
      <OutputPreviewDrawer api={api} open={drawer?.kind === "preview" || !!sample} initialKey={drawer?.kind === "preview" ? drawer.key : sample} onClose={() => { setDrawer(null); setSample(null); }} />
      <PhraseEditorDrawer api={api} open={phrases} onClose={() => setPhrases(false)} />
      <OutputProfileDrawer api={api} profileKey={profile} onClose={() => setProfile(null)} />
      <ValidationDrawer api={api} profileKey={validate} onClose={() => setValidate(null)} />

      <ReviewChangesDialog open={api.flow.phase === "reviewing" || api.flow.phase === "saving"} scope={<ScopeLabel scope="all_rooftops" />}
        timing="Takes effect for descriptions written or checked from now on."
        changes={api.rows} impact={<p className="text-[14px] text-adm-muted">Descriptions already published are not rewritten. Saving can queue existing descriptions to be checked again against the new rules.</p>}
        applying={api.flow.phase === "saving"} applyDisabled={!api.canApply} error={!api.canApply ? api.blockedReason : undefined}
        onCancel={api.flow.closeReview} onApply={() => void api.apply()} />
      <LeaveGuardDialog open={api.guard.pending} onStay={api.guard.stay} onLeave={api.guard.leave} />
    </div>
  );
}
