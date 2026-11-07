import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { ChannelLogo } from "@/components/description/ChannelCard";
import { AdminIcon, AdminIconTile, DetailDrawer, EditorEmpty, SelectField, StatusBadge, SwitchField, type AdminIconName } from "@/components/admin/v3/editor";
import { Banner } from "../brand/feeds/bits";
import {
  AUTOMATION_MODES,
  AUTOMATION_TYPES,
  OUTPUT_PROFILE_KEYS,
  automationRows,
  buildSample,
  modeLabel,
  outputProfile,
  type AutomationRow,
  type DeliverySummary,
  type DestinationRow,
} from "@/lib/admin/descriptionSettingsModel";
import { FIXTURE_SAMPLE_LABEL, FIXTURE_SAMPLE_NARRATIVE } from "@/lib/admin/descriptionSample";
import { resolveReviewMode } from "../../../../../supabase/functions/_shared/description-review-mode";
import type { DescriptionSettingsApi } from "./useDescriptionSettings";

const MODE_ICON: Record<string, AdminIconName> = { AUTO_PUBLISH_CLEAN: "activity", EXCEPTION_REVIEW: "alert", REQUIRE_APPROVAL_ALL: "user-check", DRAFT_ONLY: "edit" };

export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return "None recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "None recorded" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const Fact = ({ label, children, tone }: { label: string; children: ReactNode; tone?: "danger" }) => (
  <div className="min-w-0">
    <dt className="text-[13px] leading-[18px] text-adm-muted">{label}</dt>
    <dd className={cn("text-[14px] leading-[20px] break-words", tone === "danger" ? "text-adm-danger" : "text-adm-ink")}>{children}</dd>
  </div>
);

const SourceBadge = ({ source }: { source: AutomationRow["source"] }) =>
  source === "custom" ? <StatusBadge state="overridden" label="Custom for this type" /> : <StatusBadge state="unknown" label={source === "inherited" ? "Inherited default" : "Built-in default"} className="!bg-adm-workspace !text-adm-muted" />;

export const AutomationPanel = ({ api, onEdit }: { api: DescriptionSettingsApi; onEdit: (type: string) => void }) => {
  const draft = api.edit.draft!;
  const rows = useMemo(() => automationRows(draft), [draft]);
  const disabled = !api.canEdit;
  return (
    <div className="space-y-5">
      <fieldset className="min-w-0" disabled={disabled}>
        <legend className="text-[14px] leading-[20px] font-semibold text-adm-ink">Default automation mode</legend>
        <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">How much AutoLabels does before a person is involved. Vehicle types below inherit this unless they have their own rule.</p>
        <div role="radiogroup" aria-label="Default automation mode" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AUTOMATION_MODES.map((m) => {
            const on = draft.review_mode === m.key;
            return (
              <label key={m.key} className={cn("flex items-start gap-3 rounded-xl border p-3 sm:p-4 min-h-[44px]", on ? "border-adm-primary bg-adm-selected" : "border-adm-divider bg-adm-surface", disabled ? "cursor-default" : "cursor-pointer hover:border-adm-primary")}>
                <input type="radio" name="default-mode" value={m.key} checked={on} onChange={() => api.edit.set("review_mode", m.key)} className="mt-1 h-5 w-5 flex-shrink-0 accent-[rgb(var(--adm-primary))]" />
                <AdminIconTile name={MODE_ICON[m.key]} tone={on ? "primary" : "neutral"} />
                <span className="min-w-0">
                  <span className="block text-[15px] leading-[22px] font-semibold text-adm-ink">{m.label}</span>
                  <span className="block text-[14px] leading-[20px] text-adm-muted">{m.help}</span>
                </span>
              </label>
            );
          })}
        </div>
        {api.edit.errors.review_mode && <p role="alert" className="mt-2 text-[13px] text-adm-danger">{api.edit.errors.review_mode}</p>}
      </fieldset>

      <div>
        <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Mode by vehicle type</h3>
        <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">The mode in effect is worked out by the same rule the server uses when it decides whether a description may publish.</p>
        <ul className="mt-3 divide-y divide-adm-divider rounded-xl border border-adm-divider" aria-label="Automation by vehicle type">
          {rows.map((r) => (
            <li key={r.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-automation-type={r.type}>
              <span className="w-[120px] text-[15px] leading-[22px] font-semibold text-adm-ink">{r.label}</span>
              <span className="flex-1 min-w-[160px] text-[14px] leading-[20px] text-adm-ink">{modeLabel(r.effective)}</span>
              <SourceBadge source={r.source} />
              <AdminButton variant="secondary" size="sm" className="min-h-[40px] max-sm:min-h-[44px]" onClick={() => onEdit(r.type)} aria-label={`${disabled ? "View" : "Edit"} rule for ${r.label}`}>
                {disabled ? "View rule" : "Edit rule"}
              </AdminButton>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">Demo and loaner vehicles use the rule for the listing condition demo. If your feed labels them differently, the rule has no effect on them.</p>
      </div>
    </div>
  );
};

export const AutomationRuleDrawer = ({ api, type, onClose }: { api: DescriptionSettingsApi; type: string | null; onClose: () => void }) => {
  const draft = api.edit.draft!;
  const label = AUTOMATION_TYPES.find((t) => t.key === type)?.label ?? "";
  const custom = type ? draft.review_mode_by_class[type] || "" : "";
  const resolved = type ? resolveReviewMode(draft, type) : null;
  const setCustom = (v: string) => {
    if (!type) return;
    const next = { ...draft.review_mode_by_class };
    if (v) next[type] = v; else delete next[type];
    api.edit.set("review_mode_by_class", next);
  };
  return (
    <DetailDrawer open={!!type} onClose={onClose} title={`Automation rule: ${label}`} description="Choose whether this vehicle type follows the default or has its own mode."
      footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      {!api.canEdit && <Banner tone="neutral" icon="lock" title="Read only">You can see this rule but not change it. Changing automation needs the manage settings permission.</Banner>}
      <fieldset disabled={!api.canEdit} className="space-y-2">
        <legend className="sr-only">Mode for {label}</legend>
        {[{ key: "", label: `Use the default (${modeLabel(draft.review_mode)})`, help: "Inherited. Changing the default later changes this type too." }, ...AUTOMATION_MODES].map((m) => (
          <label key={m.key || "inherit"} className={cn("flex items-start gap-3 rounded-lg border px-3 py-3 min-h-[44px]", custom === m.key ? "border-adm-primary bg-adm-selected" : "border-adm-divider", api.canEdit && "cursor-pointer hover:border-adm-primary")}>
            <input type="radio" name="type-mode" checked={custom === m.key} onChange={() => setCustom(m.key)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--adm-primary))]" />
            <span className="min-w-0"><span className="block text-[14px] leading-[20px] font-medium text-adm-ink">{m.label}</span><span className="block text-[13px] leading-[18px] text-adm-muted">{m.help}</span></span>
          </label>
        ))}
      </fieldset>
      {resolved && (
        <div className="rounded-lg bg-adm-workspace border border-adm-divider p-4 space-y-1" data-resolved-mode={resolved.mode}>
          <p className="text-[13px] leading-[18px] text-adm-muted">In effect for {label} vehicles after this change</p>
          <p className="text-[15px] leading-[22px] font-semibold text-adm-ink">{modeLabel(resolved.mode)}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted">{resolved.source === "class" ? "Custom rule for this type." : resolved.source === "default" ? "Inherited from the default mode." : "No mode is stored, so the built-in default applies."}</p>
        </div>
      )}
      <p className="text-[13px] leading-[18px] text-adm-muted">This changes how new descriptions are handled. Descriptions already published are not touched. The change waits in your draft until you review and apply it.</p>
    </DetailDrawer>
  );
};

const KIND_ICON: Record<DestinationRow["kind"], AdminIconName> = { owned_surface: "globe", owned_site: "globe", marketplace: "tag", output_optimization: "search", inventory_workflow: "database" };

export const DestinationCard = ({ row, summary, deliveryState, api, onAction }: {
  row: DestinationRow; summary: DeliverySummary | undefined; deliveryState: "ok" | "unavailable" | "loading"; api: DescriptionSettingsApi; onAction: (a: "preview" | "export" | "history" | "connector", key: string) => void;
}) => {
  const draft = api.edit.draft!;
  const generates = draft.enabled_channels.includes(row.key);
  const toggleGenerate = (on: boolean) => api.edit.set("enabled_channels", on ? [...draft.enabled_channels, row.key] : draft.enabled_channels.filter((k) => k !== row.key));
  const passport = row.delivery === "internal";
  const lastLine = (value: string | null | undefined) => (deliveryState === "unavailable" ? "Unavailable" : deliveryState === "loading" ? "Loading" : fmtWhen(value));
  return (
    <li className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 flex flex-col gap-4 min-w-0" data-destination={row.key}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-lg border border-adm-divider bg-adm-workspace flex items-center justify-center p-1"><ChannelLogo channel={row.key} name={row.label} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{row.label}</h3>
          <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-adm-muted"><AdminIcon name={KIND_ICON[row.kind]} size="compact" />{row.kindLabel}</p>
        </div>
      </div>

      <section aria-label={`${row.label} generate content`} className="border-t border-adm-divider pt-3">
        <SwitchField label="Generate content" checked={generates} disabled={!api.canEdit} onChange={toggleGenerate} ariaLabel={`Generate content for ${row.label}`} />
        <p className="text-[13px] leading-[18px] text-adm-muted">{generates ? "Descriptions are written for this destination." : "No text is written for this destination."} Writing never sends anything.</p>
      </section>

      <section aria-label={`${row.label} delivery`} className="border-t border-adm-divider pt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h4 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Delivery</h4>
          {row.delivery === "internal" && <StatusBadge state="internal_publication" />}
          {row.delivery === "manual_export" && <StatusBadge state="manual_export" />}
          {row.delivery === "connector_needed" && <StatusBadge state="setup_required" label="Connector not configured" />}
        </div>
        <p className="text-[14px] leading-[20px] text-adm-ink">{row.automaticDelivery.reason}</p>
        {passport && (
          <div className="rounded-lg bg-adm-workspace border border-adm-divider px-3 py-2">
            <SwitchField label="Automatic delivery to Passport" checked={draft.internal_publication_enabled} disabled={!api.canEdit} onChange={(v) => api.edit.set("internal_publication_enabled", v)} />
            <p className="text-[13px] leading-[18px] text-adm-muted">{draft.internal_publication_enabled ? `Follows the automation mode: ${modeLabel(draft.review_mode)} by default.` : "Off. Nothing is written to the shopper Passport automatically."}</p>
          </div>
        )}
      </section>

      <dl className="border-t border-adm-divider pt-3 grid grid-cols-1 gap-2" aria-label={`${row.label} delivery record`}>
        <Fact label={passport ? "Last attempt" : "Last export or attempt"}>{lastLine(summary?.lastAttempt)}</Fact>
        <Fact label="Last success">{lastLine(summary?.lastSuccess)}</Fact>
        <Fact label="Last error" tone={summary?.lastError ? "danger" : undefined}>{deliveryState === "ok" && summary?.lastError ? `${fmtWhen(summary.lastError.at)}: ${summary.lastError.message}` : lastLine(null)}</Fact>
      </dl>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <AdminButton variant="secondary" className="min-h-[44px] flex-1" onClick={() => onAction("preview", row.key)}><AdminIcon name="eye" />Preview output</AdminButton>
        {row.delivery === "manual_export" && <AdminButton variant="secondary" className="min-h-[44px] flex-1" onClick={() => onAction("export", row.key)}><AdminIcon name="download" />Export options</AdminButton>}
        {row.delivery === "connector_needed" && <AdminButton variant="secondary" className="min-h-[44px] flex-1" onClick={() => onAction("connector", row.key)}><AdminIcon name="plug" />Configure</AdminButton>}
        <AdminButton variant="secondary" className="min-h-[44px] flex-1" onClick={() => onAction("history", row.key)}><AdminIcon name="history" />History</AdminButton>
      </div>
    </li>
  );
};

export const ConnectorDrawer = ({ row, onClose }: { row: DestinationRow | null; onClose: () => void }) => (
  <DetailDrawer open={!!row} onClose={onClose} title={`${row?.label ?? ""} connector`} description="Automatic delivery needs a configured connector."
    footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
    <div className="flex items-center gap-2"><StatusBadge state="setup_required" label="Connector not configured" /></div>
    <p className="text-[14px] leading-[20px] text-adm-ink">AutoLabels has no working connection to {row?.label}. Saving a listing address or a feed URL elsewhere does not create one, so automatic delivery stays unavailable and cannot be switched on from here.</p>
    <dl className="space-y-3">
      <Fact label="What works today">Descriptions are written for this destination and can be exported as text for you to send.</Fact>
      <Fact label="What is missing">A provider connection that AutoLabels can deliver through, with a delivery record for each attempt.</Fact>
      <Fact label="Delivery record">No delivery has been attempted through a connector.</Fact>
    </dl>
    <Banner tone="neutral" icon="lock" title="Nothing to set up on this screen">Connector fields appear here only once a connector exists in the product. Until then there is no credential or switch to change.</Banner>
  </DetailDrawer>
);

export const ExportOptionsDrawer = ({ row, onClose }: { row: DestinationRow | null; onClose: () => void }) => {
  const profile = row ? outputProfile(row.key) : null;
  return (
    <DetailDrawer open={!!row} onClose={onClose} title={`${row?.label ?? ""} export`} description="Manual export only. Exporting is not publishing."
      footer={<><AdminButton variant="secondary" onClick={onClose}>Close</AdminButton><Link to="/description-studio" className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-md bg-adm-primary text-white text-[14px] font-semibold hover:opacity-90">Open Description Studio<AdminIcon name="external-link" /></Link></>}>
      <div className="flex items-center gap-2"><StatusBadge state="manual_export" /></div>
      <p className="text-[14px] leading-[20px] text-adm-ink">AutoLabels writes the text for {row?.label}. You copy or download it from a vehicle in Description Studio and send it yourself. AutoLabels does not transmit it to {row?.label}.</p>
      <dl className="space-y-3">
        <Fact label="Format">{profile?.policy.singleLine ? "Plain text, one line, ASCII only." : "Plain text. Paragraphs are separated by a blank line."}</Fact>
        <Fact label="Character limit">{profile ? `${profile.policy.characterLimit.toLocaleString("en-US")} characters${profile.policy.exactTotal ? `, with a ${profile.policy.exactTotal.toLocaleString("en-US")} character target` : ""}` : "Not set"}</Fact>
        <Fact label="Export from this screen">Not available. Pick a vehicle in Description Studio so the export is that vehicle's saved text.</Fact>
      </dl>
    </DetailDrawer>
  );
};

export const OutputPreviewDrawer = ({ api, open, initialKey, onClose }: { api: DescriptionSettingsApi; open: boolean; initialKey: string | null; onClose: () => void }) => {
  const [chosen, setChosen] = useState<string | null>(null);
  const key = chosen ?? initialKey ?? "vauto";
  const draft = api.edit.draft!;
  const profile = outputProfile(key, api.overrides.data[key]);
  const sample = useMemo(() => (profile ? buildSample(profile, FIXTURE_SAMPLE_NARRATIVE, draft) : null), [profile, draft]);
  const count = sample?.counts?.codePoints ?? null;
  return (
    <DetailDrawer open={open} onClose={() => { setChosen(null); onClose(); }} title="Output preview" description="Draft settings applied to a fixture narrative. Nothing is sent, saved or published."
      footer={<AdminButton variant="primary" onClick={() => { setChosen(null); onClose(); }}>Close preview</AdminButton>}>
      <div className="flex items-center gap-2 flex-wrap"><StatusBadge state="preview_only" /><span className="text-[13px] leading-[18px] text-adm-muted">{FIXTURE_SAMPLE_LABEL}</span></div>
      <label className="block">
        <span className="text-[14px] leading-[20px] font-medium text-adm-ink">Destination</span>
        <SelectField value={key} onChange={(e) => setChosen(e.target.value)} aria-label="Preview destination" wrapperClassName="mt-1.5">
          {OUTPUT_PROFILE_KEYS.map((k) => <option key={k} value={k}>{outputProfile(k)?.label ?? k}</option>)}
        </SelectField>
      </label>
      {sample?.blocker ? (
        <Banner tone="danger" title="This output cannot be built">{sample.blocker.message}</Banner>
      ) : sample ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-adm-divider p-3"><p className="text-[13px] text-adm-muted">Final count</p><p className="text-[24px] leading-[30px] font-bold text-adm-ink tabular-nums" data-final-count={count ?? ""}>{count?.toLocaleString("en-US")}</p><p className="text-[13px] text-adm-muted">characters, spaces included</p></div>
            <div className="rounded-lg border border-adm-divider p-3"><p className="text-[13px] text-adm-muted">{profile?.target ? "Target / limit" : "Limit"}</p><p className="text-[24px] leading-[30px] font-bold text-adm-ink tabular-nums">{profile?.target ? `${profile.target.toLocaleString("en-US")}` : profile?.policy.characterLimit.toLocaleString("en-US")}</p><p className="text-[13px] text-adm-muted">{profile?.target ? `within ${profile.policy.characterLimit.toLocaleString("en-US")}` : "characters"}</p></div>
          </div>
          {sample.parts && <p className="text-[13px] leading-[18px] text-adm-muted">Narrative {sample.parts.narrative.toLocaleString("en-US")} + call to action {sample.parts.cta.toLocaleString("en-US")} + required wording {sample.parts.disclosure.toLocaleString("en-US")}{sample.dropped ? `. ${sample.dropped} optional sentences left out to land on the target.` : "."}</p>}
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-adm-workspace border border-adm-divider p-3 text-[13px] leading-[19px] text-adm-ink max-h-[320px] overflow-y-auto" tabIndex={0} aria-label="Output text">{sample.text}</pre>
          {sample.findings.filter((f) => f.severity !== "info").map((f, i) => <Banner key={`${f.code}-${i}`} tone={f.severity === "blocking" ? "danger" : "warning"} title={f.message} />)}
        </>
      ) : <EditorEmpty title="No profile" description="This destination has no output profile." />}
    </DetailDrawer>
  );
};

export const DeliveryHistoryDrawer = ({ api, row, onClose }: { api: DescriptionSettingsApi; row: DestinationRow | null; onClose: () => void }) => {
  const records = row ? api.deliveries.records.filter((r) => r.destination === row.key).slice(0, 25) : [];
  const unavailable = api.deliveries.state === "unavailable";
  return (
    <DetailDrawer open={!!row} onClose={onClose} title={`${row?.label ?? ""} delivery history`} description="Real delivery records only." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      {unavailable ? (
        <Banner tone="danger" title="Delivery history could not be read">The delivery records did not load, so no last attempt, success or error is shown. This is not a report of zero deliveries.</Banner>
      ) : records.length === 0 ? (
        <EditorEmpty artwork="documents" title="No deliveries recorded" description={row?.delivery === "manual_export" ? "Nothing has been exported for this destination yet. Exports made from Description Studio are recorded here." : "Nothing has been attempted for this destination."} />
      ) : (
        <ul className="divide-y divide-adm-divider rounded-xl border border-adm-divider" aria-label="Delivery records">
          {records.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[14px] font-semibold text-adm-ink">{fmtWhen(r.created_at)}</span>
                <StatusBadge state={r.status === "delivered" ? "delivered" : r.status === "failed" ? "failed" : "unknown"} label={r.status.charAt(0).toUpperCase() + r.status.slice(1)} />
              </div>
              <p className="text-[13px] leading-[18px] text-adm-muted">{r.delivery_mode.replace("_", " ")}. Attempts {r.attempt_count ?? 0}.</p>
              {r.status === "failed" && <p className="text-[14px] leading-[20px] text-adm-danger">{String((r.response_metadata ?? {}).error ?? (r.response_metadata ?? {}).message ?? "No reason was recorded.")}</p>}
            </li>
          ))}
        </ul>
      )}
    </DetailDrawer>
  );
};

