import { StatusText, type Tone } from "@/components/product";
import type { ReconEstimate, ReconLine } from "@/hooks/useReconEstimates";

export const money = (n: number | null | undefined) => (n == null ? "Unknown" : `$${Math.round(n).toLocaleString("en-US")}`);

export const photoUrls = (p: unknown[]): string[] =>
  (Array.isArray(p) ? p : []).map((x) => (typeof x === "string" ? x : (x as { url?: string })?.url || "")).filter(Boolean);

export const LINE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  auto_approved: { label: "Auto-approved", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  deferred: { label: "Deferred", tone: "neutral" },
};

// HTML-escape every tenant-supplied field before interpolation: recon line
// descriptions/categories and vehicle ymm/vin all come from user-writable
// rows, so unescaped interpolation was a stored-XSS sink in the print window.
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const printWorkOrder = (est: ReconEstimate, lines: ReconLine[]) => {
  const todo = lines.filter((l) => l.approval_status === "approved" || l.approval_status === "auto_approved");
  const rows = todo.map((l) => `<tr><td>${esc(l.category || "")}</td><td>${esc(l.description)}</td><td style="text-align:right">${esc(money(l.line_total))}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=700,height=800");
  if (!w) return;
  w.document.write(`<html><head><title>Recon Work Order — ${esc(est.vin)}</title>
    <style>body{font-family:Inter,Arial,sans-serif;color:#0F172A;padding:32px}h1{font-size:20px;margin:0}p{color:#64748B;margin:4px 0 16px}
    table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #E6E8EC;font-size:14px;text-align:left}
    tfoot td{font-weight:700;border-top:2px solid #0F172A}</style></head><body>
    <h1>Recon Work Order</h1><p>${esc(est.ymm || "Vehicle")} &middot; VIN ${esc(est.vin)} &middot; Approved work to perform</p>
    <table><thead><tr><th>Category</th><th>Work</th><th style="text-align:right">Cost</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No approved work.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">Approved total</td><td style="text-align:right">${esc(money(est.approved_total))}</td></tr></tfoot></table>
    </body></html>`);
  w.document.close(); w.focus(); w.print();
};

export const ageOf = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h` : "<1h";
};

export const ESTIMATE_STATE: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Pending review", tone: "warning" },
  approved: { label: "Authorized", tone: "success" },
  partially_approved: { label: "Partly authorized", tone: "info" },
  declined: { label: "Declined", tone: "danger" },
  completed: { label: "Completed", tone: "neutral" },
  voided: { label: "Voided", tone: "neutral" },
};

export function EstimateState({ status }: { status: string }) {
  const s = ESTIMATE_STATE[status] || { label: status, tone: "neutral" as Tone };
  return <StatusText tone={s.tone}>{s.label}</StatusText>;
}
