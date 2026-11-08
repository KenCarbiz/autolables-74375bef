import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdvancedDisclosure, BlockedFeatureNotice, DraftActionBar, EditorEmpty, EditorLayout, FieldRow, INPUT_CLASS, LeaveGuardDialog, ReviewChangesDialog, ScopeLabel, SectionCard, SelectField, StatusBadge, SwitchField,
  deriveDraftBarState, useIsNarrow, useLeaveGuard,
} from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import { useSaveFlow } from "@/lib/admin/useSaveFlow";
import { DEFAULT_CALIBRATION, type PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";
import {
  PAPER_FORMATS, VERIFY_MIGRATION_ID, adjustedRect, calibrationChanges, calibrationFromFields, canNudge, confirmationView, fieldsFromCalibration, formatLength, formatStep, isAdjusted, nudge, paperLabel,
  resetAdjustments, stepToInches, validateAlignment, STEPS_BY_UNIT, type AlignmentFields, type Direction, type PrintProfile, type Unit,
} from "@/lib/admin/printWizard";
import { ConfirmDialog } from "@/pages/admin/views/brand/editor/parts";
import { AlignmentPreview } from "./AlignmentPreview";
import { Callout, DirectionPad, FormatPicker, STEP_LABELS, StepPicker, Stepper, UnitToggle } from "./wizardParts";
import { openTestSheet } from "./testSheet";
import { usePrintProfiles } from "./usePrintProfiles";

const DEFAULT_KEY = "default";
const keyOf = (locationId: string | null) => locationId ?? DEFAULT_KEY;
const locationOf = (key: string) => (key === DEFAULT_KEY ? null : key);

export default function PrintSetupWizard() {
  const data = usePrintProfiles();
  const [params] = useSearchParams();
  const fixtureStep = data.isFixture ? Math.min(4, Math.max(1, Number(params.get("step")) || 1)) : 1;
  const [step, setStep] = useState(fixtureStep);
  const [scopeKey, setScopeKey] = useState<string | null>(params.get("profile"));
  const [unit, setUnit] = useState<Unit>("in");
  const [stepIdx, setStepIdx] = useState(2);
  const [format, setFormat] = useState<StickerType>("window");
  const [draft, setDraft] = useState<PrintCalibration | null>(null);
  const [typed, setTyped] = useState<AlignmentFields | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const flow = useSaveFlow(scopeKey ?? "none");
  const narrow = useIsNarrow();

  const profiles = data.profiles;
  const selectedKey = scopeKey ?? (profiles[0] ? keyOf(profiles[0].locationId) : DEFAULT_KEY);
  const profile: PrintProfile | undefined = profiles.find((p) => keyOf(p.locationId) === selectedKey);
  const baseline: PrintCalibration = profile?.calibration ?? DEFAULT_CALIBRATION;
  const cal = draft ?? baseline;

  useEffect(() => {
    if (data.isFixture && data.variant === "invalid" && !typed) setTyped({ ...fieldsFromCalibration(baseline, "in"), xOffsetIn: "1.8", scalePct: "130" });
  }, [data.isFixture, data.variant, typed, baseline]);

  const fields = typed ?? fieldsFromCalibration(cal, unit);
  const errors = useMemo(() => validateAlignment(fields, unit), [fields, unit]);
  const firstError = Object.values(errors)[0];
  const changes = useMemo(() => calibrationChanges(baseline, cal, unit), [baseline, cal, unit]);
  const dirty = changes.length > 0;
  const guard = useLeaveGuard(dirty);
  const incrementIn = stepToInches(STEPS_BY_UNIT[unit][stepIdx], unit);
  const view = profile ? confirmationView(profile) : null;

  const commit = useCallback((next: PrintCalibration) => { setDraft(next); setTyped(null); }, []);
  const edit = (patch: Partial<PrintCalibration>) => commit({ ...cal, ...patch });
  const onField = (key: keyof AlignmentFields, value: string) => {
    const next = { ...fields, [key]: value };
    setTyped(next);
    if (Object.keys(validateAlignment(next, unit)).length === 0) setDraft(calibrationFromFields(cal, next, unit));
  };
  const switchUnit = (u: Unit) => { setUnit(u); setStepIdx(2); setTyped(null); };

  const canWrite = data.canEdit && !data.isFixture;
  const blockedReason = !data.canEdit ? data.readOnlyReason : data.isFixture ? data.readOnlyReason : null;
  const barState = deriveDraftBarState({ phase: flow.phase, dirty, changeCount: changes.length, firstError, message: flow.message });

  const apply = async () => {
    if (!canWrite || firstError || !dirty) return;
    const ok = await flow.run(async () => {
      const r = await data.save(locationOf(selectedKey), cal);
      if (!r.ok) throw new Error(r.error || "The server did not accept the change");
    });
    if (ok) { setDraft(null); setTyped(null); setReviewing(false); }
  };
  const discard = () => { setDraft(null); setTyped(null); flow.dismiss(); };

  const scopeLabel = data.rooftopLabel(locationOf(selectedKey));
  const scopeNode = <ScopeLabel scope="rooftop" rooftopName={locationOf(selectedKey) === null ? `${scopeLabel}, dealership default` : scopeLabel} />;

  if (data.state === "loading" || data.state === "no-tenant") {
    return <div role="status" aria-busy="true" className="h-64 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" aria-label="Loading printer profiles" />;
  }
  if (data.state === "failed") {
    return <div className="rounded-xl bg-adm-surface border border-adm-divider"><EditorEmpty tone="danger" title="Could not load printer profiles" description={data.error ?? "Try again in a moment. Nothing was changed."} action={<AdminButton variant="secondary" onClick={data.reload}>Try again</AdminButton>} /></div>;
  }

  if (!data.canEdit && !data.isFixture) {
    return (
      <div className="space-y-4">
        <Callout icon="lock" tone="neutral" title="You can view this profile but not change it">{data.readOnlyReason}</Callout>
        <ReadOnlySummary profile={profile} scope={scopeNode} unit={unit} onTest={() => { const r = openTestSheet(format, cal); if (!r.ok) setNotice(r.reason ?? null); }} notice={notice} />
      </div>
    );
  }

  const scopesWithoutProfile = [
    ...(profiles.some((p) => p.locationId === null) ? [] : [{ key: DEFAULT_KEY, label: `${data.rooftopLabel(null)} (dealership default)` }]),
    ...data.rooftops.filter((r) => !profiles.some((p) => p.locationId === r.id)).map((r) => ({ key: r.id, label: r.name })),
  ];
  const options = [
    ...profiles.map((p) => ({ key: keyOf(p.locationId), label: `${p.printerName || "Unnamed printer"}, ${data.rooftopLabel(p.locationId)}` })),
    ...(profile ? [] : scopesWithoutProfile.filter((s) => s.key === selectedKey)),
  ];

  const stepNav = (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <AdminButton variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}><AdminIcon name="arrow-left" />Back</AdminButton>
      {step < 4 && <AdminButton variant="primary" onClick={() => setStep((s) => Math.min(4, s + 1))}>Next: {STEP_LABELS[step]}<AdminIcon name="arrow-right" /></AdminButton>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {scopeNode}
      </div>
      <Stepper step={step} onGo={setStep} />

      {step === 1 && (
        <>
          <EditorLayout previewLabel="Selected paper" preview={<SectionCard title="Selected paper" description={paperLabel(format)}><AlignmentPreview type={format} cal={cal} unit={unit} /></SectionCard>}>
          <SectionCard icon="printer" title="Choose printer and paper" description="A profile stores this printer's alignment. It does not connect to or test the printer; your browser's print dialog picks the physical printer.">
            <FieldRow label="Printer profile" help={dirty ? "Apply or discard your unsaved changes before switching profile." : undefined}>
              {(p) => (
                <SelectField {...p} value={selectedKey} disabled={dirty} onChange={(e) => { setScopeKey(e.target.value); setDraft(null); setTyped(null); }}>
                  {options.length === 0 && <option value={DEFAULT_KEY}>{data.rooftopLabel(null)} (dealership default, new profile)</option>}
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  {scopesWithoutProfile.filter((s) => !options.some((o) => o.key === s.key)).map((s) => <option key={s.key} value={s.key}>New profile: {s.label}</option>)}
                </SelectField>
              )}
            </FieldRow>
            {!profile && <p className="text-[14px] leading-[20px] text-adm-muted">No profile is saved for this location yet. Applying your changes creates one.</p>}
            <FieldRow label="Printer label" required error={errors.printerName} help="The name people will recognise, for example the printer's place and model. It is a label only.">
              {(p) => <input {...p} className={INPUT_CLASS} value={fields.printerName} disabled={!data.canEdit} onChange={(e) => { onField("printerName", e.target.value); }} maxLength={120} placeholder="Printer label" />}
            </FieldRow>
            <FieldRow label="Paper format" help="Both formats share this profile's alignment. Pick the one you want to test now.">
              {() => <FormatPicker value={format} onChange={setFormat} />}
            </FieldRow>
            <Callout title="Match the printer in your browser">When the print dialog opens, choose the printer named above and the paper listed here. AutoLabels cannot see which printer you pick.</Callout>
          </SectionCard>
          </EditorLayout>
          {stepNav}
        </>
      )}

      {step === 2 && (
        <>
          <SectionCard icon="file" title="Print test" description={`A ruled test sheet for ${paperLabel(format)}. It uses the adjustments shown in this wizard, saved or not.`}>
            <ol className="space-y-3 text-[14px] leading-[20px] text-adm-ink list-decimal pl-5">
              <li>Open the test sheet. Opening it does not print it.</li>
              <li>Press Print this sheet, then choose the same printer as the profile and the paper size above.</li>
              <li>Set Scale to <strong>Actual size</strong> (100%). Do not use Fit to page.</li>
              <li>Turn off <strong>Headers and footers</strong> in the browser dialog.</li>
              <li>Print, then measure the border from each paper edge.</li>
            </ol>
            <div className="flex flex-wrap gap-3 items-center">
              <AdminButton variant="primary" onClick={() => { const r = openTestSheet(format, cal); setNotice(r.ok ? null : r.reason ?? null); }}><AdminIcon name="external-link" />Open test sheet</AdminButton>
            </div>
            {notice && <p role="alert" className="text-[14px] font-medium text-adm-danger">{notice}</p>}
            <Callout tone="neutral" icon="info" title="Cancelling a print changes nothing">Closing or cancelling the print dialog records nothing and does not mark this profile verified.</Callout>
          </SectionCard>
          <SectionCard icon="database" title="Record that the test sheet was printed">
            <BlockedFeatureNotice migrationId={VERIFY_MIGRATION_ID} feature="Test sheet printed record">
              <p className="text-[13px] leading-[18px] text-adm-muted">This step would store who printed a test sheet and when.</p>
            </BlockedFeatureNotice>
            <div><AdminButton variant="secondary" disabled aria-disabled="true">Record test sheet printed</AdminButton></div>
          </SectionCard>
          {stepNav}
        </>
      )}

      {step === 3 && (
        <>
          <div className="grid gap-4 lg:gap-6 items-start grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <aside aria-label="Alignment preview" className="min-w-0 lg:order-2 lg:sticky lg:top-4">
              <SectionCard title="Alignment preview" description={paperLabel(format)}>
                <FormatPicker value={format} onChange={setFormat} compact />
                <AlignmentPreview type={format} cal={cal} unit={unit} compact={narrow} />
              </SectionCard>
            </aside>
            <div className="min-w-0 space-y-4 lg:order-1">
            <SectionCard icon="move" title="Adjust alignment" description="Shift the printed sheet until the border from your test sheet lands where it should. Right and down are positive, the same as the print.">
              <div className="flex flex-wrap items-center gap-3">
                <UnitToggle unit={unit} onChange={switchUnit} />
                <p className="text-[14px] text-adm-muted">Edit values in {unit === "in" ? "inches" : "millimeters"}. Saved in inches.</p>
              </div>
              <FieldRow label="Move by">{() => <StepPicker unit={unit} index={stepIdx} onChange={setStepIdx} />}</FieldRow>
              <div className="flex flex-wrap items-center gap-6">
                <DirectionPad stepLabel={formatStep(STEPS_BY_UNIT[unit][stepIdx], unit)} disabled={!data.canEdit} can={(d: Direction) => canNudge(cal, d, incrementIn)} onMove={(d) => commit(nudge(cal, d, incrementIn))} />
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px] leading-[20px]" aria-label="Current adjustment">
                  <dt className="text-adm-muted">Horizontal</dt><dd className="font-semibold tabular-nums">{formatLength(Math.abs(cal.xOffsetIn), unit)} {cal.xOffsetIn === 0 ? "" : cal.xOffsetIn > 0 ? "right" : "left"}</dd>
                  <dt className="text-adm-muted">Vertical</dt><dd className="font-semibold tabular-nums">{formatLength(Math.abs(cal.yOffsetIn), unit)} {cal.yOffsetIn === 0 ? "" : cal.yOffsetIn > 0 ? "down" : "up"}</dd>
                  <dt className="text-adm-muted">Scale</dt><dd className="font-semibold tabular-nums">{cal.scalePct} percent</dd>
                  <dt className="text-adm-muted">Border at</dt><dd className="tabular-nums">{formatLength(adjustedRect(format, cal).x, unit)}, {formatLength(adjustedRect(format, cal).y, unit)} from the corner</dd>
                </dl>
              </div>
              <div><AdminButton variant="secondary" disabled={!isAdjusted(cal)} onClick={() => setConfirmReset(true)}><AdminIcon name="refresh" />Reset adjustments</AdminButton></div>
              <AdvancedDisclosure title="Advanced: numeric offsets, scale and guides" defaultOpen={data.isFixture && data.variant === "invalid"}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FieldRow label={`Horizontal offset (${unit})`} error={errors.xOffsetIn} help="Positive moves right.">
                    {(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={fields.xOffsetIn} onChange={(e) => onField("xOffsetIn", e.target.value)} />}
                  </FieldRow>
                  <FieldRow label={`Vertical offset (${unit})`} error={errors.yOffsetIn} help="Positive moves down.">
                    {(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={fields.yOffsetIn} onChange={(e) => onField("yOffsetIn", e.target.value)} />}
                  </FieldRow>
                  <FieldRow label="Scale (percent)" error={errors.scalePct} help="80 to 120. Scales from the top-left corner.">
                    {(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={fields.scalePct} onChange={(e) => onField("scalePct", e.target.value)} />}
                  </FieldRow>
                  <FieldRow label={`Top safe margin (${unit})`} error={errors.topSafeMarginIn}>
                    {(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={fields.topSafeMarginIn} onChange={(e) => onField("topSafeMarginIn", e.target.value)} />}
                  </FieldRow>
                  <FieldRow label={`Side safe margin (${unit})`} error={errors.leftSafeMarginIn}>
                    {(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={fields.leftSafeMarginIn} onChange={(e) => onField("leftSafeMarginIn", e.target.value)} />}
                  </FieldRow>
                  <FieldRow label="Label stock">
                    {(p) => (
                      <SelectField {...p} value={cal.labelMode} onChange={(e) => edit({ labelMode: e.target.value === "black" ? "black" : "white" })}>
                        <option value="white">White label</option>
                        <option value="black">Black label</option>
                      </SelectField>
                    )}
                  </FieldRow>
                </div>
                <SwitchField label="Show crop marks on print" checked={cal.showCropMarks} onChange={(v) => edit({ showCropMarks: v })} />
                <SwitchField label="Show safe-area guide on print" checked={cal.showSafeArea} onChange={(v) => edit({ showSafeArea: v })} />
              </AdvancedDisclosure>
              <Callout tone="neutral" title="Print again to check">The preview is a drawing. After you apply, print another test sheet to see where the printer lands the page.</Callout>
            </SectionCard>
            </div>
          </div>
          {stepNav}
        </>
      )}

      {step === 4 && (
        <>
          <SectionCard icon="shield-check" title="Verify and save" description="A person confirms the printed sheet. AutoLabels does not measure the printer.">
            <dl className="grid grid-cols-[minmax(110px,160px)_1fr] gap-x-6 gap-y-2 text-[14px] leading-[20px]">
              <dt className="text-adm-muted">Printer label</dt><dd>{cal.printerName || "Not set"}</dd>
              <dt className="text-adm-muted">Offset</dt><dd className="tabular-nums">{formatLength(cal.xOffsetIn, unit)} right, {formatLength(cal.yOffsetIn, unit)} down</dd>
              <dt className="text-adm-muted">Scale</dt><dd>{cal.scalePct} percent</dd>
              <dt className="text-adm-muted">Saved adjustments</dt><dd>{profile ? (dirty ? "Different from what is shown here" : "Same as shown here") : "No profile saved yet"}</dd>
            </dl>
            {dirty && <Callout tone="warning" icon="alert" title="You have unsaved adjustments">They are not part of verification. Go back to Adjust alignment to review and apply them.</Callout>}
            <BlockedFeatureNotice migrationId={VERIFY_MIGRATION_ID} feature="Confirm alignment and record who verified it">
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <StatusBadge state={view?.state === "confirmed" ? "enabled" : "unavailable"} label={view?.state === "confirmed" ? view.label : "Not verified"} />
                <span className="text-[13px] leading-[18px] text-adm-muted">{view && view.state !== "unavailable" ? view.reason : "The confirmation below is preview only and is never saved."}</span>
              </div>
            </BlockedFeatureNotice>
            <div className="space-y-3 opacity-70">
              <SwitchField label="I printed the test sheet at Actual size and the border sits where it should" checked={false} onChange={() => undefined} disabled />
              <div><AdminButton variant="primary" disabled aria-disabled="true">Confirm alignment unavailable</AdminButton></div>
            </div>
          </SectionCard>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <AdminButton variant="secondary" onClick={() => setStep(3)}><AdminIcon name="arrow-left" />Back to adjust</AdminButton>
            <Link to={adminTabHref("print-calibration")} className="inline-flex items-center gap-2 min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline">Back to printer profiles</Link>
          </div>
        </>
      )}

      {step < 4 && (dirty || flow.phase !== "idle") && (
        <DraftActionBar state={barState} onDiscard={discard} onReview={() => { flow.openReview(); setReviewing(true); }} onRetry={() => void apply()} retryDisabled={!!firstError} extra={!data.canEdit || data.isFixture ? <span className="text-[13px] text-adm-muted">{blockedReason}</span> : undefined} />
      )}

      <ReviewChangesDialog
        open={reviewing}
        title="Review printer changes"
        scope={<>{scopeLabel}. Printer profile for {profile ? "this location" : "a new location profile"}.</>}
        timing="Takes effect for the next print."
        changes={changes.map((c) => ({ id: c.id, label: c.label, before: c.before, after: c.after }))}
        impact={<p>Changes the offset applied when documents print for this profile. Templates and saved documents are not changed. Verification is not recorded.</p>}
        applyLabel="Apply changes"
        applying={flow.phase === "saving"}
        applyDisabled={!canWrite || !!firstError}
        error={flow.phase === "failed" ? flow.message : blockedReason}
        onCancel={() => { setReviewing(false); flow.closeReview(); }}
        onApply={() => void apply()}
      />
      <ConfirmDialog open={confirmReset} title="Reset adjustments?" confirmLabel="Reset adjustments" onCancel={() => setConfirmReset(false)} onConfirm={() => { commit(resetAdjustments(cal)); setConfirmReset(false); }}>
        <p>Horizontal and vertical offsets return to 0 and scale to 100 percent in this draft. Safe margins, label stock and the printer label stay as they are.</p>
        <p>Nothing is saved until you review and apply.</p>
      </ConfirmDialog>
      <LeaveGuardDialog open={guard.pending} onStay={guard.stay} onLeave={guard.leave} />
    </div>
  );
}

function ReadOnlySummary({ profile, scope, unit, onTest, notice }: { profile?: PrintProfile; scope: React.ReactNode; unit: Unit; onTest: () => void; notice: string | null }) {
  if (!profile) return <EditorEmpty artwork="documents" title="No printer profile yet" description="Someone with settings access can set one up." />;
  const cal = profile.calibration;
  return (
    <SectionCard icon="printer" title={profile.printerName || "Unnamed printer"} description={scope}>
      <dl className="grid grid-cols-[minmax(110px,160px)_1fr] gap-x-6 gap-y-2 text-[14px] leading-[20px]">
        <dt className="text-adm-muted">Offset</dt><dd>{formatLength(cal.xOffsetIn, unit)} right, {formatLength(cal.yOffsetIn, unit)} down</dd>
        <dt className="text-adm-muted">Scale</dt><dd>{cal.scalePct} percent</dd>
        <dt className="text-adm-muted">Confirmation</dt><dd>{confirmationView(profile).label}</dd>
      </dl>
      <div><AdminButton variant="secondary" onClick={onTest}>Open test sheet</AdminButton></div>
      {notice && <p role="alert" className="text-[14px] font-medium text-adm-danger">{notice}</p>}
    </SectionCard>
  );
}
