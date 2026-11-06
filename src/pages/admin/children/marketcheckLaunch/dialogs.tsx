import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, InlineNote } from "@/components/product";
import { inputClass } from "../inventoryNetwork/shared";
import { MAX_USD_CAP, validUsdCap } from "@/lib/marketcheckLaunch/viewModel";
import type { AttestInput, FailedCheck, QuotaFigures, ReadinessCheck, AttestKey } from "@/lib/marketcheckLaunch/types";

export type Outcome = { ok: true } | { ok: false; message: string; failed?: FailedCheck[] };
export type Perform = (fn: () => Promise<{ ok: boolean; reason?: string; failed?: FailedCheck[] }>, success: string) => Promise<Outcome>;

const Failure = ({ outcome }: { outcome: Outcome | null }) =>
  outcome && !outcome.ok ? (
    <InlineNote tone="danger" title={outcome.message}>
      {outcome.failed && outcome.failed.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {outcome.failed.map((f) => <li key={f.key}>{f.label ?? f.key}{f.summary ? `: ${f.summary}` : ""}</li>)}
        </ul>
      )}
    </InlineNote>
  ) : null;

interface ShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  disabled: boolean;
  onSubmit: () => Promise<Outcome>;
}

function Shell({ open, onClose, title, description, children, confirmLabel, danger, disabled, onSubmit }: ShellProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const close = () => { setOutcome(null); onClose(); };
  const submit = async () => {
    setBusy(true);
    const r = await onSubmit();
    setBusy(false);
    if (r.ok) close(); else setOutcome(r);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[6px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div className="text-[13px] text-adm-muted">{description}</div></DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          {children}
          <Failure outcome={outcome} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={disabled || busy} onClick={submit}>{busy ? "Working" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TypedConfirmDialog({ open, onClose, title, description, word, confirmLabel, danger, children, onConfirm }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; word: string; confirmLabel: string; danger?: boolean; children?: ReactNode;
  onConfirm: () => Promise<Outcome>;
}) {
  const [typed, setTyped] = useState("");
  return (
    <Shell open={open} onClose={() => { setTyped(""); onClose(); }} title={title} description={description} confirmLabel={confirmLabel} danger={danger} disabled={typed !== word} onSubmit={async () => { const r = await onConfirm(); if (r.ok) setTyped(""); return r; }}>
      {children}
      <label className="block text-[13px] font-semibold text-adm-ink" htmlFor={`confirm-${word}`}>Type {word} to confirm</label>
      <input id={`confirm-${word}`} className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
    </Shell>
  );
}

export function ReasonDialog({ open, onClose, title, description, confirmLabel, danger, onConfirm }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<Outcome>;
}) {
  const [reason, setReason] = useState("");
  return (
    <Shell open={open} onClose={() => { setReason(""); onClose(); }} title={title} description={description} confirmLabel={confirmLabel} danger={danger} disabled={reason.trim().length < 3} onSubmit={async () => { const r = await onConfirm(reason.trim()); if (r.ok) setReason(""); return r; }}>
      <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="launch-reason">Reason (required)</label>
      <textarea id="launch-reason" className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Shell>
  );
}

const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);

export function QuotaDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (q: QuotaFigures) => Promise<Outcome> }) {
  const [f, setF] = useState({ limit: "", used: "", remaining: "", resetAt: "", evidence: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.limit !== "" && f.used !== "" && f.remaining !== "" && f.evidence.trim().length >= 5;
  const field = (k: "limit" | "used" | "remaining", label: string) => (
    <div>
      <label className="block text-[13px] font-semibold text-adm-ink" htmlFor={`q-${k}`}>{label}</label>
      <input id={`q-${k}`} type="number" min={0} className={inputClass} value={f[k]} onChange={set(k)} />
    </div>
  );
  return (
    <Shell open={open} onClose={onClose} title="Record provider figures" description="Type the figures shown on the MarketCheck account page. They are stored as provider-reported and the budget gate enforces against them." confirmLabel="Record figures" disabled={!valid}
      onSubmit={() => onSubmit({ limit: Number(f.limit), used: Number(f.used), remaining: Number(f.remaining), resetAt: toIso(f.resetAt), evidence: f.evidence.trim() })}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{field("limit", "Monthly limit")}{field("used", "Used")}{field("remaining", "Remaining")}</div>
      <div>
        <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="q-reset">Provider reset date (optional)</label>
        <input id="q-reset" type="datetime-local" className={inputClass} value={f.resetAt} onChange={set("resetAt")} />
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="q-evidence">Evidence (required)</label>
        <textarea id="q-evidence" className={inputClass} rows={2} value={f.evidence} onChange={set("evidence")} placeholder="Where these figures were read, for example the account page and time" />
      </div>
    </Shell>
  );
}

export function UsdCapDialog({ open, current, onClose, onSubmit }: { open: boolean; current: number | null; onClose: () => void; onSubmit: (usdCap: number) => Promise<Outcome> }) {
  const [raw, setRaw] = useState("");
  const cap = validUsdCap(raw);
  return (
    <Shell open={open} onClose={() => { setRaw(""); onClose(); }} title="Set account dollar cap" description={`Monthly account dollar cap for this plan, greater than 0 and at most ${MAX_USD_CAP.toLocaleString()}. It is applied to the MarketCheck account when the plan is started.${current != null ? ` Current: $${current}.` : ""}`} confirmLabel="Set dollar cap" disabled={cap === null}
      onSubmit={async () => { const r = await onSubmit(cap!); if (r.ok) setRaw(""); return r; }}>
      <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="usd-cap">Account dollar cap per month</label>
      <input id="usd-cap" type="number" min={0} step="0.01" className={inputClass} value={raw} onChange={(e) => setRaw(e.target.value)} />
      {raw !== "" && cap === null && <p className="text-[13px] text-adm-danger">Enter an amount greater than 0 and no more than {MAX_USD_CAP.toLocaleString()}.</p>}
    </Shell>
  );
}

export function AttestDialog({ check, onClose, onSubmit }: { check: ReadinessCheck | null; onClose: () => void; onSubmit: (a: AttestInput) => Promise<Outcome> }) {
  const [status, setStatus] = useState<"passed" | "failed">("passed");
  const [summary, setSummary] = useState("");
  const [evidence, setEvidence] = useState("");
  const valid = summary.trim().length >= 5 && (status === "failed" || evidence.trim().length >= 5);
  return (
    <Shell open={check !== null} onClose={onClose} title={check ? `Record evidence: ${check.label}` : "Record evidence"} description="Your name and the time are stored with this record. Evidence older than 7 days no longer counts." confirmLabel="Record evidence" disabled={!valid}
      onSubmit={async () => { const r = await onSubmit({ key: check!.key as AttestKey, status, summary: summary.trim(), evidenceRef: evidence.trim() }); if (r.ok) { setSummary(""); setEvidence(""); setStatus("passed"); } return r; }}>
      <div>
        <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="a-status">Result</label>
        <select id="a-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as "passed" | "failed")}>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="a-summary">Summary</label>
        <textarea id="a-summary" className={inputClass} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-adm-ink" htmlFor="a-evidence">Evidence reference</label>
        <input id="a-evidence" className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Link, ticket, test run or document name" />
      </div>
    </Shell>
  );
}
