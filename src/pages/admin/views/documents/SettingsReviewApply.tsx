import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useAdminFixture, useAdminNow } from "@/lib/admin/dataSource";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import {
  canApply,
  diffFields,
  initialReviewApply,
  isUnchanged,
  newIdempotencyKey,
  reviewApplyReducer,
  type ApplyGate,
  type ImpactSnapshot,
  type ReviewApplyEvent,
  type ReviewApplyState,
} from "@/lib/admin/reviewApply";
import type { CountValue } from "@/lib/admin/health";
import { readActiveVehicleCount, readPolicyVersion, type VersionCheck } from "./readiness";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminButton, AdminTable, InlineNote, StatusChip, Td, Th } from "@/components/admin/v2/primitives";

// Review & Apply over merge_dealer_settings for a group of settings keys. The
// draft lives here; opening the review computes the impact and writes
// nothing; apply re-reads the stored keys for a conflict, sends only the keys
// that changed, and records a client audit entry next to the server's own.

export interface ReviewRow {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface ImpactFixture {
  activeVehicles: CountValue;
  policyVersion: number | null;
}

export interface SettingsReviewOptions<T extends object> {
  scope: string;
  read: (settings: DealerSettings) => T;
  describe: (field: keyof T & string, before: unknown, after: unknown) => ReviewRow;
  validate?: (draft: T) => string[];
  warnings?: (before: T, after: T) => string[];
  toPayload: (draft: T, changed: Array<keyof T & string>) => Partial<DealerSettings>;
  canEdit: boolean;
  fixtureImpact?: ImpactFixture | null;
  /** A draft edit to start from, so a fixture can depict a change pending review. */
  initialDraft?: Partial<T> | null;
}

export interface SettingsReview<T extends object> {
  state: ReviewApplyState<T>;
  draft: T;
  dirty: boolean;
  rows: ReviewRow[];
  reviewedRows: ReviewRow[];
  canEdit: boolean;
  edit: (next: T | ((draft: T) => T)) => void;
  discard: () => void;
  openReview: () => Promise<void>;
  close: () => void;
  apply: () => Promise<void>;
  open: boolean;
  computing: boolean;
  versionCheck: VersionCheck | null;
  gate: ApplyGate;
}

const EXCLUSIONS = ["Approved and signed documents keep their current version.", "Archived vehicles are not changed."];

const asRecord = (v: object): Record<string, unknown> => v as unknown as Record<string, unknown>;
const pickKeys = (v: object, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, asRecord(v)[k]]));
const changedKeys = <T extends object>(a: T, b: T): Array<keyof T & string> => diffFields(asRecord(a), asRecord(b)).map((d) => d.field as keyof T & string);

export function useSettingsReview<T extends object>(o: SettingsReviewOptions<T>): SettingsReview<T> {
  const { settings, updateSettings } = useDealerSettings();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const { log } = useAudit();
  const fixture = useAdminFixture();
  const now = useAdminNow();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const optionsRef = useRef(o);
  optionsRef.current = o;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const original = useMemo(() => optionsRef.current.read(settings), [settings]);
  const [state, dispatch] = useReducer(
    (s: ReviewApplyState<T>, e: ReviewApplyEvent<T>) => reviewApplyReducer(s, e),
    original,
    (init: T) => {
      const base = initialReviewApply(init);
      const seed = optionsRef.current.initialDraft;
      return seed ? reviewApplyReducer(base, { type: "edit", draft: { ...init, ...seed } }) : base;
    },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const [open, setOpen] = useState(false);
  const [computing, setComputing] = useState(false);
  const [versionCheck, setVersionCheck] = useState<VersionCheck | null>(null);
  const [reviewedRows, setReviewedRows] = useState<ReviewRow[]>([]);
  const runRef = useRef(0);

  // The stored policy moved under a clean editor: follow it. A dirty draft is
  // kept and the apply-time conflict check decides.
  useEffect(() => {
    const s = stateRef.current;
    if (isUnchanged(s.original, original)) return;
    if (isUnchanged(s.draft, s.original) && (s.phase === "editing" || s.phase === "applied")) dispatch({ type: "reset", original });
  }, [original]);

  const dirty = !isUnchanged(state.draft, state.original);
  const rows = useMemo(
    () => diffFields(asRecord(state.original), asRecord(state.draft)).map((d) => optionsRef.current.describe(d.field as keyof T & string, d.before, d.after)),
    [state.original, state.draft],
  );

  const edit = useCallback((next: T | ((draft: T) => T)) => {
    const d = typeof next === "function" ? (next as (draft: T) => T)(stateRef.current.draft) : next;
    dispatch({ type: "edit", draft: d });
  }, []);

  const discard = useCallback(() => dispatch({ type: "reset" }), []);

  const computeImpact = useCallback(async (draft: T, run: number) => {
    setComputing(true);
    try {
      const opts = optionsRef.current;
      let activeVehicles: CountValue;
      let version: number | null;
      let check: VersionCheck;
      if (fixture) {
        activeVehicles = opts.fixtureImpact?.activeVehicles ?? { kind: "failed" };
        version = opts.fixtureImpact?.policyVersion ?? null;
        check = "fixture";
      } else if (!tenantId) {
        activeVehicles = { kind: "failed" };
        version = null;
        check = "unavailable";
      } else {
        const [count, v] = await Promise.all([readActiveVehicleCount(tenantId), readPolicyVersion(tenantId)]);
        activeVehicles = count;
        version = v.version;
        check = v.check;
      }
      if (run !== runRef.current) return;
      setVersionCheck(check);
      const impact: ImpactSnapshot = {
        computedAt: new Date(now).toISOString(),
        version,
        counts: { active_vehicles: activeVehicles.kind === "known" ? activeVehicles.value : null },
        samples: [],
        warnings: opts.warnings ? opts.warnings(stateRef.current.original, draft) : [],
        exclusions: EXCLUSIONS,
      };
      dispatch({ type: "review", impact, idempotencyKey: newIdempotencyKey(opts.scope) });
    } finally {
      if (run === runRef.current) setComputing(false);
    }
  }, [fixture, tenantId, now]);

  const openReview = useCallback(async () => {
    const s = stateRef.current;
    if (isUnchanged(s.draft, s.original)) return;
    const errors = optionsRef.current.validate ? optionsRef.current.validate(s.draft) : [];
    dispatch({ type: "validate", errors });
    setReviewedRows(diffFields(asRecord(s.original), asRecord(s.draft)).map((d) => optionsRef.current.describe(d.field as keyof T & string, d.before, d.after)));
    setOpen(true);
    if (errors.length) return;
    const run = ++runRef.current;
    await computeImpact(s.draft, run);
  }, [computeImpact]);

  const close = useCallback(() => {
    runRef.current += 1;
    setComputing(false);
    setOpen(false);
    const s = stateRef.current;
    if (s.phase === "applied") dispatch({ type: "reset" });
    else if (s.phase === "conflict") dispatch({ type: "reset", original: optionsRef.current.read(settingsRef.current) });
    else if (s.phase !== "editing") dispatch({ type: "edit", draft: s.draft });
  }, []);

  const apply = useCallback(async () => {
    const s = stateRef.current;
    const opts = optionsRef.current;
    if (!opts.canEdit) {
      dispatch({ type: "error", message: "Your role cannot apply this policy." });
      return;
    }
    if (fixture) {
      dispatch({ type: "error", message: "Apply is disabled in the design fixture; nothing is written." });
      return;
    }
    if (!tenantId) {
      dispatch({ type: "error", message: "No dealership is selected." });
      return;
    }
    const current = opts.read(settingsRef.current);
    const elsewhere = changedKeys(s.original, current);
    if (elsewhere.length) {
      dispatch({ type: "conflict", changedFields: elsewhere });
      return;
    }
    let currentVersion: number | null | undefined;
    if (versionCheck === "ok") {
      const v = await readPolicyVersion(tenantId);
      currentVersion = v.check === "ok" ? v.version : undefined;
    }
    const gate = canApply(s, currentVersion);
    if (!gate.ok) {
      dispatch({ type: "error", message: gate.reason ?? "The change cannot be applied." });
      return;
    }
    dispatch({ type: "apply" });
    const changed = changedKeys(s.original, s.draft);
    const payload = opts.toPayload(s.draft, changed);
    let ok = false;
    try {
      ok = await updateSettings(payload);
    } catch {
      ok = false;
    }
    if (!ok) {
      dispatch({ type: "result", result: { status: "failed", affected: null, message: "The server did not accept the change. Nothing was written." } });
      return;
    }
    log({
      action: "settings_updated",
      entity_type: "dealer_settings",
      entity_id: opts.scope,
      store_id: tenantId,
      user_id: user?.id ?? "",
      details: {
        scope: opts.scope,
        keys: Object.keys(payload),
        before: pickKeys(s.original, changed),
        after: pickKeys(s.draft, changed),
        idempotency_key: s.idempotencyKey,
        policy_version: s.impact?.version ?? null,
      },
    });
    dispatch({ type: "result", result: { status: "applied", affected: s.impact?.counts.active_vehicles ?? null, message: "Applied. Documents generated from now on follow the new policy." } });
  }, [fixture, tenantId, versionCheck, updateSettings, log, user?.id]);

  const gate = canApply(state);

  return { state, draft: state.draft, dirty, rows, reviewedRows, canEdit: o.canEdit, edit, discard, openReview, close, apply, open, computing, versionCheck, gate };
}

const versionLabel = (check: VersionCheck | null, version: string | number | null | undefined, computing: boolean): string => {
  if (computing) return "…";
  if (check === "ok" || check === "fixture") return version === null || version === undefined ? "Unknown" : `Version ${version}`;
  if (check === "pending_migration") return "Not tracked until the authority migration is applied";
  if (check === "unavailable") return "Unavailable";
  return "Unknown";
};

export function SettingsReviewDialog<T extends object>({ review, title, description }: { review: SettingsReview<T>; title: string; description?: ReactNode }) {
  const { state, reviewedRows, open, computing, gate, versionCheck, canEdit } = review;
  const onCloseAutoFocus = useReturnFocus(open);
  const phase = state.phase;
  const impact = state.impact;
  const applied = phase === "applied";
  const active = impact?.counts.active_vehicles;
  const activeLabel = computing ? "…" : impact ? (active === null || active === undefined ? "Unavailable" : active.toLocaleString()) : "Unknown";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) review.close(); }}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="sm:max-w-2xl rounded-[8px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-adm-border text-left">
          <DialogTitle className="text-[18px] leading-[26px] font-semibold text-adm-ink">{title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[18px] text-adm-muted">
            {description ?? "Nothing is written until you apply. The server checks your role again before saving."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {state.validation.length > 0 && <InlineNote tone="danger" title="Fix before review">{state.validation.join(" ")}</InlineNote>}

          <AdminTable caption="Changes under review">
            <thead>
              <tr>
                <Th>Setting</Th>
                <Th>Before</Th>
                <Th>After</Th>
              </tr>
            </thead>
            <tbody>
              {reviewedRows.map((r) => (
                <tr key={r.field}>
                  <Td className="font-semibold">{r.label}</Td>
                  <Td className="text-adm-muted">{r.before}</Td>
                  <Td>{r.after}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-[6px] border border-adm-border px-4 py-3">
              <p className="text-[12px] leading-[18px] text-adm-muted">Active vehicles that follow the policy going forward</p>
              <p className="text-[20px] leading-[28px] font-bold text-adm-ink tabular-nums">{activeLabel}</p>
            </div>
            <div className="rounded-[6px] border border-adm-border px-4 py-3">
              <p className="text-[12px] leading-[18px] text-adm-muted">Policy version at review</p>
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{versionLabel(versionCheck, impact?.version, computing)}</p>
            </div>
          </div>

          {impact?.warnings.map((w) => (
            <InlineNote key={w} tone="warning">{w}</InlineNote>
          ))}

          <ul className="text-[12px] leading-[18px] text-adm-muted list-disc pl-5">
            {(impact?.exclusions ?? EXCLUSIONS).map((x) => <li key={x}>{x}</li>)}
          </ul>

          {phase === "conflict" && (
            <InlineNote tone="danger" title="Changed elsewhere" action={<AdminButton size="sm" onClick={review.close}>Reload</AdminButton>}>
              These settings changed since you opened this review: {state.changedElsewhere.join(", ")}. Reload and review again.
            </InlineNote>
          )}
          {phase === "failed" && <InlineNote tone="danger" title="Not applied">{state.result?.message}</InlineNote>}
          {applied && <InlineNote tone="success" title="Applied">{state.result?.message}</InlineNote>}
          {state.error && phase !== "failed" && <InlineNote tone="danger">{state.error}</InlineNote>}
          {!canEdit && !applied && <InlineNote tone="warning">Your role can review this policy but not apply it.</InlineNote>}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-adm-border sm:justify-between gap-3">
          <p className="text-[12px] leading-[18px] text-adm-muted self-center">
            {!applied && !computing && !gate.ok && phase !== "conflict" ? gate.reason : ""}
            {computing ? "Computing impact…" : ""}
          </p>
          <div className="flex gap-2">
            <AdminButton onClick={review.close}>{applied ? "Close" : "Cancel"}</AdminButton>
            {!applied && (
              <AdminButton
                variant="primary"
                onClick={review.apply}
                disabled={!gate.ok || !canEdit || computing || phase === "applying" || phase === "conflict"}
              >
                {phase === "applying" ? "Applying…" : "Apply"}
              </AdminButton>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const PendingChip = ({ dirty, className }: { dirty: boolean; className?: string }) => (
  <StatusChip tone={dirty ? "warning" : "neutral"} className={className}>{dirty ? "Pending review" : "None"}</StatusChip>
);
