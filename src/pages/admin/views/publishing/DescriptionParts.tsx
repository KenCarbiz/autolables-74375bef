import { useEffect, useId, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import {
  AdminIcon,
  ChipInput,
  DetailDrawer,
  EditorEmpty,
  FieldRow,
  INPUT_CLASS,
  useIsNarrow,
  SelectField,
  StatusBadge,
  SwitchField,
} from "@/components/admin/v3/editor";
import { Banner } from "../brand/feeds/bits";
import {
  CLAIMS,
  FINDING_FIX,
  OUTPUT_PROFILE_KEYS,
  TONE_OPTIONS,
  buildSample,
  changedProfileNumbers,
  displayRange,
  outputProfile,
  profileProblems,
  profileValues,
  phraseMatches,
  validateProfileEdit,
  type OutputProfile,
} from "@/lib/admin/descriptionSettingsModel";
import { FIXTURE_SAMPLE_LABEL, FIXTURE_SAMPLE_NARRATIVE } from "@/lib/admin/descriptionSample";
import type { DescriptionSettingsApi } from "./useDescriptionSettings";
import { fmtWhen } from "./DestinationParts";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "Not set" : v.toLocaleString("en-US"));

export const AutoTextarea = ({ value, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <textarea ref={ref} rows={1} value={value} className={cn(INPUT_CLASS, "resize-none overflow-hidden leading-[22px] min-h-[44px]", className)} {...rest} />;
};

export const Managed45Notice = () => (
  <Banner tone="info" icon="eye" title="Managed in the Description Engine (coming soon)">
    <span className="sm:hidden">This page edits only the settings that exist today.</span>
    <span className="max-sm:hidden">The vehicle Description Engine, the vAuto export gate and per-rooftop description profiles are not part of this build. This page edits only the settings that exist today and does not duplicate the engine.</span>
  </Banner>
);

type Identity = { name: string; city: string; state: string };

const IdentityOverride = ({ label, source, value, onChange, onClear, field, disabled, help }: { label: string; source: string; value: string; onChange: (v: string) => void; onClear: () => void; field: string; disabled: boolean; help: string }) => {
  const [open, setOpen] = useState(value !== "");
  const on = open || value !== "";
  return (
    <div className="rounded-lg border border-adm-divider p-3 sm:p-4 space-y-2" data-identity-field={field}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[14px] leading-[20px] font-medium text-adm-ink">{label}</p>
          <p className="text-[14px] leading-[20px] text-adm-ink break-words">{source || <span className="italic text-adm-muted">Not set in the dealership profile</span>}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted max-sm:hidden">Source: Dealership &amp; Brand, Identity</p>
        </div>
        <Link to={adminTabHref("identity")} className="inline-flex items-center gap-1 min-h-[40px] max-sm:min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline">Edit source<AdminIcon name="chevron-right" size="inline" /></Link>
      </div>
      <SwitchField label="Use different wording in descriptions" checked={on} disabled={disabled} onChange={(v) => { setOpen(v); if (!v) onClear(); }} ariaLabel={`Override ${label} in descriptions`} />
      {on && (
        <FieldRow label={`${label} in descriptions`} htmlFor={`desc-${field}`} help={help}>
          {(p) => <input {...p} className={INPUT_CLASS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </FieldRow>
      )}
    </div>
  );
};

const IdentityWrap = ({ narrow, children }: { narrow: boolean; children: React.ReactNode }) =>
  narrow ? (
    <details className="rounded-xl border border-adm-divider">
      <summary className="cursor-pointer min-h-[44px] px-4 flex items-center text-[15px] font-semibold text-adm-ink">Name, city and state wording</summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  ) : <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">{children}</div>;

export const BrandVoiceSection = ({ api, onEditPhrases }: { api: DescriptionSettingsApi; onEditPhrases: () => void }) => {
  const d = api.edit.draft!;
  const e = api.edit.errors;
  const off = !api.canEdit;
  const id: Identity = api.identity;
  const legalCount = [...d.required_legal_text].length;
  const narrow = useIsNarrow();
  return (
    <div className="space-y-4 sm:space-y-5">
      <IdentityWrap narrow={narrow}>
        <IdentityOverride label="Dealership name" field="name" source={id.name} value={d.dealer_name_format} disabled={off} onChange={(v) => api.edit.set("dealer_name_format", v)} onClear={() => api.edit.set("dealer_name_format", "")} help="Written exactly like this in the copy." />
        <IdentityOverride label="City" field="city" source={id.city} value={d.primary_city} disabled={off} onChange={(v) => api.edit.set("primary_city", v)} onClear={() => api.edit.set("primary_city", "")} help="Used for local wording only." />
        <IdentityOverride label="State" field="state" source={id.state} value={d.state} disabled={off} onChange={(v) => api.edit.set("state", v)} onClear={() => api.edit.set("state", "")} help="Use the two letter abbreviation." />
      </IdentityWrap>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
        <FieldRow label="Default tone" htmlFor="desc-tone" error={e.default_tone} help={narrow ? undefined : "Changes wording only. It never adds a claim."}>
          {(p) => <SelectField {...p} value={d.default_tone} disabled={off} onChange={(ev) => api.edit.set("default_tone", ev.target.value)}>{TONE_OPTIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</SelectField>}
        </FieldRow>
        <FieldRow label="Brand voice" htmlFor="desc-voice" optional help={narrow ? undefined : "How the dealership sounds, in a few sentences. Guidance for the writer, not text that is copied into the output."}>
          {(p) => <AutoTextarea {...p} value={d.brand_voice} disabled={off} onChange={(ev) => api.edit.set("brand_voice", ev.target.value)} />}
        </FieldRow>
      </div>

      <FieldRow label="Call to action" htmlFor="desc-cta" optional error={e.cta_template} help={narrow ? undefined : "Added once at the end of each description that allows a call to action. Counted in every total."}>
        {(p) => <AutoTextarea {...p} value={d.cta_template} disabled={off} onChange={(ev) => api.edit.set("cta_template", ev.target.value)} />}
      </FieldRow>

      <FieldRow label="Required wording" htmlFor="desc-legal" optional error={e.required_legal_text} help={`Published word for word. A description without it is blocked, and it is never shortened. ${legalCount.toLocaleString("en-US")} characters, counted once in every total.`}>
        {(p) => <AutoTextarea {...p} value={d.required_legal_text} disabled={off} onChange={(ev) => api.edit.set("required_legal_text", ev.target.value)} />}
      </FieldRow>

      <div className="rounded-lg border border-adm-divider p-3 sm:p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[14px] leading-[20px] font-medium text-adm-ink">Prohibited phrases</p>
            <p className="text-[13px] leading-[18px] text-adm-muted">A match blocks publication. Matching ignores capitals and finds the phrase anywhere in the text, including inside a longer word.</p>
          </div>
          <AdminButton variant="secondary" className="min-h-[44px]" onClick={onEditPhrases}>{off ? "View phrases" : "Edit phrases"}</AdminButton>
        </div>
        {d.prohibited_phrases.length === 0 ? (
          <p className="text-[14px] leading-[20px] text-adm-muted">No phrases of your own. The platform list still applies to every destination.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Prohibited phrases">{d.prohibited_phrases.map((p) => <li key={p} className="rounded-full bg-adm-selected text-adm-primary px-3 min-h-[32px] inline-flex items-center text-[14px] font-medium break-all">{p}</li>)}</ul>
        )}
        {e.prohibited_phrases && <p role="alert" className="text-[13px] font-medium text-adm-danger">{e.prohibited_phrases}</p>}
      </div>
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0"><dt className="text-[13px] leading-[18px] text-adm-muted">{label}</dt><dd className="text-[14px] leading-[20px] text-adm-ink">{children}</dd></div>
);

const PROVENANCE: Record<string, string> = {
  provider_required: "Required by the provider",
  connector_required: "Required by the connector",
  tenant_required: "Your requirement",
  autolabels_best_practice: "AutoLabels default",
  seo_recommendation: "SEO recommendation",
  awaiting_confirmation: "Default, not yet verified",
};

export const OutputProfilesSection = ({ api, onEdit, onPreview, onValidate }: { api: DescriptionSettingsApi; onEdit: (k: string) => void; onPreview: (k: string) => void; onValidate: (k: string) => void }) => {
  const d = api.edit.draft!;
  const narrow = useIsNarrow();
  const latest = useMemo(() => {
    const m: Record<string, { count: number | null; at: string }> = {};
    for (const c of api.cached.data) m[c.channel] ??= { count: c.character_count, at: c.created_at };
    return m;
  }, [api.cached.data]);
  return (
    <div className="space-y-5">
      <ul className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-stretch" aria-label="Output profiles">
        {OUTPUT_PROFILE_KEYS.map((k) => {
          const pr = outputProfile(k, api.overrides.data[k]);
          if (!pr) return null;
          const sample = buildSample(pr, FIXTURE_SAMPLE_NARRATIVE, d);
          const problems = profileProblems(pr);
          const blocking = problems.length > 0 || !!sample.blocker || sample.findings.some((f) => f.severity === "blocking");
          const warned = sample.findings.some((f) => f.severity === "warning");
          const saved = latest[k];
          const range = displayRange(pr);
          return (
            <li key={k} data-profile={k} className={cn("rounded-xl border bg-adm-surface p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 min-w-0 h-full", pr.target ? "border-adm-primary/40" : "border-adm-divider")}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{pr.label}</h3>
                  <p className="text-[13px] leading-[18px] text-adm-muted max-sm:hidden">{PROVENANCE[pr.provenance?.lengthLimit ?? "awaiting_confirmation"]}{pr.overridden ? ". Customized." : ""}</p>
                </div>
                {blocking ? <StatusBadge state="failed" label={problems.length ? "Profile invalid" : "Sample blocked"} /> : warned ? <StatusBadge state="stale" label="Sample has warnings" /> : <StatusBadge state="enabled" label="Sample passes" />}
              </div>
              {narrow ? (
                <p className="text-[14px] leading-[20px] text-adm-ink">{pr.target ? `Target ${n(pr.target)}. ` : ""}Limit {n(pr.policy.characterLimit)}. Sample {sample.counts ? `${n(sample.counts.codePoints)} characters` : "cannot be built"}.</p>
              ) : (
                <>
                  <dl className={cn("grid gap-3", pr.target ? "grid-cols-3" : "grid-cols-2")}>
                    {pr.target && <Row label="Target">{n(pr.target)}</Row>}
                    <Row label={pr.target ? "Draft pool" : "Readable range"}>{n(range.min)} to {n(range.max)}</Row>
                    <Row label="Limit">{n(pr.policy.characterLimit)}</Row>
                  </dl>
                  {range.clamped && <p className="text-[13px] leading-[18px] text-adm-muted">The registry sizes the draft pool up to {n(range.registryMax)}, past the limit. It is shown here capped at the limit.</p>}
                  {pr.target && <p className="text-[14px] leading-[20px] text-adm-ink">Your target is {n(pr.target)} characters in total, including spaces, the call to action and the required wording, inside the {n(pr.policy.characterLimit)} limit. The limit is reported by your account and has not been verified with the provider.</p>}
                  <dl className="grid grid-cols-2 gap-3">
                    <Row label="Sample count">{sample.counts ? `${n(sample.counts.codePoints)} characters` : "Cannot be built"}</Row>
                    <Row label="Last generated">{saved ? `${saved.count === null ? "Count not recorded" : `${n(saved.count)} characters`}, ${fmtWhen(saved.at)}` : "No saved output"}</Row>
                  </dl>
                </>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <AdminButton variant="secondary" className="min-h-[44px] flex-1 min-w-0 px-2" onClick={() => onEdit(k)}>{api.canEdit ? "Edit" : "View"}</AdminButton>
                {narrow ? (
                  <details className="group relative flex-1 min-w-0">
                    <summary className="list-none cursor-pointer min-h-[44px] flex items-center justify-center rounded-md border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink px-2 [&::-webkit-details-marker]:hidden">More</summary>
                    <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-adm-divider bg-adm-surface shadow-lg p-1 flex flex-col">
                      <button type="button" className="min-h-[44px] px-3 text-left text-[14px] font-medium text-adm-ink rounded-md hover:bg-adm-workspace" onClick={() => onPreview(k)}>Sample</button>
                      <button type="button" className="min-h-[44px] px-3 text-left text-[14px] font-medium text-adm-ink rounded-md hover:bg-adm-workspace" onClick={() => onValidate(k)}>Validation</button>
                    </div>
                  </details>
                ) : (
                  <>
                    <AdminButton variant="secondary" className="min-h-[44px] flex-1 min-w-0 px-2" onClick={() => onPreview(k)}><AdminIcon name="eye" />Sample</AdminButton>
                    <AdminButton variant="secondary" className="min-h-[44px] flex-1 min-w-0 px-2" onClick={() => onValidate(k)}><AdminIcon name="shield-check" />Validation</AdminButton>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {narrow ? (
        <details className="rounded-xl border border-adm-divider">
          <summary className="cursor-pointer min-h-[44px] px-4 flex items-center text-[15px] font-semibold text-adm-ink">Master length and quality limits</summary>
          <div className="px-4 pb-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FieldRow label="Master minimum length" htmlFor="desc-min" error={api.edit.errors.min_length} help={narrow ? undefined : "Characters. Shorter copy is flagged, never padded."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.min_length) ? d.min_length : ""} onChange={(e) => api.edit.set("min_length", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
        <FieldRow label="Master maximum length" htmlFor="desc-max" error={api.edit.errors.max_length} help={narrow ? undefined : "Characters. The Passport has its own limit above."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.max_length) ? d.max_length : ""} onChange={(e) => api.edit.set("max_length", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
        <FieldRow label="Quality review threshold" htmlFor="desc-quality" error={api.edit.errors.quality_threshold} help={narrow ? undefined : "Below this score a description goes to a person, never straight to a shopper."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.quality_threshold) ? d.quality_threshold : ""} onChange={(e) => api.edit.set("quality_threshold", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
      </div>
          </div>
        </details>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FieldRow label="Master minimum length" htmlFor="desc-min" error={api.edit.errors.min_length} help={narrow ? undefined : "Characters. Shorter copy is flagged, never padded."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.min_length) ? d.min_length : ""} onChange={(e) => api.edit.set("min_length", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
        <FieldRow label="Master maximum length" htmlFor="desc-max" error={api.edit.errors.max_length} help={narrow ? undefined : "Characters. The Passport has its own limit above."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.max_length) ? d.max_length : ""} onChange={(e) => api.edit.set("max_length", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
        <FieldRow label="Quality review threshold" htmlFor="desc-quality" error={api.edit.errors.quality_threshold} help={narrow ? undefined : "Below this score a description goes to a person, never straight to a shopper."}>
          {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canEdit} value={Number.isFinite(d.quality_threshold) ? d.quality_threshold : ""} onChange={(e) => api.edit.set("quality_threshold", e.target.value === "" ? NaN : Number(e.target.value))} />}
        </FieldRow>
      </div>
      )}
    </div>
  );
};

export const ClaimsSection = ({ api }: { api: DescriptionSettingsApi }) => {
  const d = api.edit.draft!;
  const narrow = useIsNarrow();
  return (
    <div className="space-y-4">
      <Banner tone="info" icon="shield-check" title="A permission is not proof">Turning a claim on lets descriptions use verified data about it. It never makes the claim true, and nothing is invented without the vehicle's own record.</Banner>
      <ul className="divide-y divide-adm-divider rounded-xl border border-adm-divider" aria-label="Claim permissions">
        {CLAIMS.map((c) => (
          <li key={c.key} className="px-4 py-2 sm:py-3 space-y-0.5" data-claim={c.key}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 basis-[220px]"><p className="text-[15px] leading-[22px] font-semibold text-adm-ink">{c.label}</p><p className="text-[14px] leading-[20px] text-adm-muted max-sm:hidden">{c.help}</p></div>
              <div className="flex items-center gap-3">
                <span className="max-sm:hidden"><StatusBadge state={d[c.key] ? "enabled" : "disabled"} label={d[c.key] ? "Permitted" : "Not permitted"} /></span>
                <SwitchField label={narrow ? (d[c.key] ? "Permitted" : "Off") : ""} ariaLabel={`Allow ${c.label}`} checked={d[c.key]} disabled={!api.canEdit} onChange={(v) => api.edit.set(c.key, v)} />
              </div>
            </div>
            <details className="group">
              <summary className="cursor-pointer min-h-[40px] flex items-center text-[14px] font-semibold text-adm-primary">What it still needs</summary>
              <dl className="space-y-1.5 pb-2">
                <Row label="What it allows">{c.help}</Row>
                <Row label="Still needs">{c.needs}</Row>
                <Row label="When off">{c.off}</Row>
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const PhraseEditorDrawer = ({ api, open, onClose }: { api: DescriptionSettingsApi; open: boolean; onClose: () => void }) => {
  const d = api.edit.draft!;
  const [text, setText] = useState("");
  const hits = d.prohibited_phrases.map((p) => ({ p, at: phraseMatches(text, p) })).filter((h) => h.at.length > 0);
  const marks = useMemo(() => {
    const ranges = d.prohibited_phrases.flatMap((p) => phraseMatches(text, p).map((i) => [i, i + p.trim().length] as const)).sort((a, b) => a[0] - b[0]);
    const out: Array<{ t: string; hit: boolean }> = [];
    let at = 0;
    for (const [s, e] of ranges) {
      if (s < at) continue;
      if (s > at) out.push({ t: text.slice(at, s), hit: false });
      out.push({ t: text.slice(s, e), hit: true });
      at = e;
    }
    if (at < text.length) out.push({ t: text.slice(at), hit: false });
    return out;
  }, [text, d.prohibited_phrases]);
  return (
    <DetailDrawer open={open} onClose={onClose} title="Prohibited phrases" description="One phrase per entry. Changes wait in your draft until you review and apply them." footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      {!api.canEdit && <Banner tone="neutral" icon="lock" title="Read only">You can see these phrases but not change them.</Banner>}
      <Banner tone="neutral" icon="info" title="How matching works">The text is compared without regard to capitals. A phrase matches anywhere it appears, even inside a longer word, so keep each phrase specific. There are no wildcards.</Banner>
      <ChipInput label="Your phrases" values={d.prohibited_phrases} disabled={!api.canEdit} onChange={(v) => api.edit.set("prohibited_phrases", v)} placeholder="Type a phrase and press Enter" validate={(v) => (v.trim().length < 3 ? "Use at least three characters so the phrase is specific." : null)} />
      {api.edit.errors.prohibited_phrases && <p role="alert" className="text-[13px] font-medium text-adm-danger">{api.edit.errors.prohibited_phrases}</p>}
      <FieldRow label="Check some text" htmlFor="phrase-test" optional help="Paste a description to see which phrases it would trigger. Nothing is saved or sent.">
        {(p) => <textarea {...p} rows={4} value={text} onChange={(e) => setText(e.target.value)} className={cn(INPUT_CLASS, "resize-y")} />}
      </FieldRow>
      {text && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-[14px] leading-[20px] font-medium text-adm-ink">{hits.length === 0 ? "No prohibited phrase found in this text." : `${hits.length} prohibited ${hits.length === 1 ? "phrase" : "phrases"} found. This text would be blocked.`}</p>
          <p className="rounded-lg bg-adm-workspace border border-adm-divider p-3 text-[14px] leading-[22px] text-adm-ink break-words">{marks.map((m, i) => m.hit ? <mark key={i} className="bg-adm-danger-bg text-adm-danger font-semibold underline decoration-2 px-0.5 rounded">{m.t}</mark> : <span key={i}>{m.t}</span>)}</p>
        </div>
      )}
    </DetailDrawer>
  );
};

export const OutputProfileDrawer = ({ api, profileKey, onClose }: { api: DescriptionSettingsApi; profileKey: string | null; onClose: () => void }) => {
  const pr: OutputProfile | null = profileKey ? outputProfile(profileKey, api.overrides.data[profileKey]) : null;
  const initial = pr ? profileValues(pr) : null;
  const [edit, setEdit] = useState<{ key: string; v: { recommendedMin: number; recommendedMax: number; characterLimit: number } } | null>(null);
  const [reason, setReason] = useState("");
  const rid = useId();
  const current = edit && edit.key === profileKey ? edit.v : initial;
  const errs = profileKey && current ? validateProfileEdit(profileKey, current) : {};
  const changed = !!current && !!initial && (["recommendedMin", "recommendedMax", "characterLimit"] as const).filter((k) => current[k] !== initial[k]);
  const dirty = !!changed && changed.length > 0;
  const mayApply = api.canSaveProfiles && dirty && Object.keys(errs).length === 0 && !api.saveProfile.isPending;
  const close = () => { setEdit(null); setReason(""); api.saveProfile.reset(); onClose(); };
  const set = (k: "recommendedMin" | "recommendedMax" | "characterLimit", raw: string) => current && profileKey && setEdit({ key: profileKey, v: { ...current, [k]: raw === "" ? NaN : Number(raw) } });
  const label: Record<string, string> = { recommendedMin: "Readable minimum", recommendedMax: "Readable maximum", characterLimit: "Hard limit" };
  return (
    <DetailDrawer open={!!profileKey} onClose={close} title={`${pr?.label ?? ""} output profile`} description="Length rules for this destination."
      footer={<><AdminButton variant="secondary" onClick={close}>{api.canSaveProfiles ? "Cancel" : "Close"}</AdminButton>{api.canSaveProfiles && <AdminButton variant="primary" disabled={!mayApply} onClick={() => profileKey && current && api.saveProfile.mutate({ channel: profileKey, policy: { ...(api.overrides.data[profileKey] ?? {}), ...changedProfileNumbers(initial!, current) }, reason }, { onSuccess: close })}>{api.saveProfile.isPending ? "Applying" : "Apply profile"}</AdminButton>}</>}>
      {pr && current && (
        <>
          {!api.canSaveProfiles && <Banner tone="neutral" icon="lock" title={api.isFixture ? "Design fixture" : "Read only"}>{api.isFixture ? "Saving is disabled in this preview." : "Changing an output profile needs the manage settings permission."}</Banner>}
          <div className="rounded-lg bg-adm-workspace border border-adm-divider p-4 space-y-1">
            <p className="text-[13px] leading-[18px] text-adm-muted">Where this rule comes from</p>
            <p className="text-[14px] leading-[20px] text-adm-ink">{PROVENANCE[pr.provenance?.lengthLimit ?? "awaiting_confirmation"]}. {pr.provenance?.sourceNote}</p>
          </div>
          {pr.target && <Banner tone="info" icon="lock" title={`Fixed target: ${n(pr.target)} characters in total`}>Counted as one line of plain ASCII text, including spaces, the call to action and the required wording. The target is set by the platform and is not edited here.</Banner>}
          {(["recommendedMin", "recommendedMax", "characterLimit"] as const).map((k) => (
            <FieldRow key={k} label={(pr.target && k !== "characterLimit" ? `${label[k]} (draft pool)` : label[k])} htmlFor={`${rid}-${k}`} error={errs[k]} help={k === "characterLimit" ? (pr.target ? `Can be tightened, never below the ${n(pr.target)} target or raised past the shipped value.` : "Can be tightened, never raised past the shipped value.") : pr.target ? "Sizes the draft the writer starts from. It does not move the target and may run past the limit." : "Characters. Aim for useful detail, never filler."}>
              {(p) => <input {...p} type="number" inputMode="numeric" className={INPUT_CLASS} disabled={!api.canSaveProfiles} value={Number.isFinite(current[k]) ? current[k] : ""} onChange={(e) => set(k, e.target.value)} />}
            </FieldRow>
          ))}
          {dirty && api.canSaveProfiles && (
            <>
              <FieldRow label="Reason for the change" htmlFor={`${rid}-reason`} optional help="Kept in the change history.">
                {(p) => <input {...p} className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </FieldRow>
              <div className="rounded-lg border border-adm-divider p-3" aria-label="Review of the profile change">
                <p className="text-[14px] font-semibold text-adm-ink mb-1">Review</p>
                <ul className="space-y-1">{(changed || []).map((k) => <li key={k} className="text-[14px] leading-[20px] text-adm-ink">{label[k]}: {n(initial![k])} to <strong>{n(current[k])}</strong></li>)}</ul>
                <p className="text-[13px] leading-[18px] text-adm-muted">Only the numbers you changed are sent. Earlier overrides for this destination are kept.</p>
                <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Applies to descriptions written from now on. Saved descriptions keep the profile they were written under.</p>
              </div>
            </>
          )}
          {api.saveProfile.isError && <Banner tone="danger" title="Not applied">{(api.saveProfile.error as Error).message}</Banner>}
        </>
      )}
    </DetailDrawer>
  );
};

export const ValidationDrawer = ({ api, profileKey, onClose }: { api: DescriptionSettingsApi; profileKey: string | null; onClose: () => void }) => {
  const d = api.edit.draft!;
  const pr = profileKey ? outputProfile(profileKey, api.overrides.data[profileKey]) : null;
  const sample = pr ? buildSample(pr, FIXTURE_SAMPLE_NARRATIVE, d) : null;
  const items = sample ? [...(sample.blocker ? [{ code: sample.blocker.code, severity: "blocking", message: sample.blocker.message }] : []), ...sample.findings] : [];
  return (
    <DetailDrawer open={!!profileKey} onClose={onClose} title={`${pr?.label ?? ""} validation`} description="Checks the draft call to action and required wording against this destination." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="flex items-center gap-2 flex-wrap"><StatusBadge state="preview_only" /><span className="text-[13px] text-adm-muted">{FIXTURE_SAMPLE_LABEL}</span></div>
      {items.length === 0 ? (
        <EditorEmpty artwork="documents" title="No findings" description="The draft output has no blocking or warning findings for this destination. This checks the settings, not any vehicle's facts." />
      ) : (
        <ul className="space-y-3" aria-label="Findings">
          {items.map((f, i) => (
            <li key={`${f.code}-${i}`} className="rounded-lg border border-adm-divider p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap"><StatusBadge state={f.severity === "blocking" ? "failed" : "stale"} label={f.severity === "blocking" ? "Blocks publication" : f.severity === "info" ? "Note" : "Warning"} /><code className="text-[13px] text-adm-muted">{f.code}</code></div>
              <p className="text-[14px] leading-[20px] text-adm-ink">{f.message}</p>
              {FINDING_FIX[f.code] && <p className="text-[14px] leading-[20px] text-adm-ink"><span className="font-semibold">Fix: </span>{FINDING_FIX[f.code]}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] leading-[18px] text-adm-muted">Vehicle facts, unsupported claims and missing data are checked per vehicle when a description is written, in Description Operations.</p>
    </DetailDrawer>
  );
};

