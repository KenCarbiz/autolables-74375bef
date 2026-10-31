import type { AuditModel } from "@/lib/platformConsole/live/audit";

// Synthetic data for reference D14.
export const AUDIT_FIXTURE: AuditModel = {
  rows: [
    { id: "1", at: "2026-10-31T09:14:00", timeActor: "09:14 / Operator A", scope: "Store A", action: "Import held", outcome: { label: "Schema validation", tone: "warn" }, correlation: "SYN-TRACE-1042" },
    { id: "2", at: "2026-10-31T09:10:00", timeActor: "09:10 / Operator B", scope: "Platform", action: "Budget changed", outcome: { label: "Optional cap reviewed" }, correlation: "SYN-AUD-202" },
    { id: "3", at: "2026-10-31T08:45:00", timeActor: "08:45 / Operator A", scope: "Store B", action: "Access override", outcome: { label: "Expires Nov 7" }, correlation: "SYN-AUD-201" },
    { id: "4", at: "2026-10-31T08:14:00", timeActor: "08:14 / Feed worker", scope: "Store A", action: "Import published", outcome: { label: "128 records", tone: "good" }, correlation: "SYN-TRACE-1040" },
    { id: "5", at: "2026-10-31T08:00:00", timeActor: "08:00 / Support C", scope: "Store C", action: "Evidence viewed", outcome: { label: "Incident investigation" }, correlation: "SYN-AUD-199" },
  ],
  rowsNote: "",
  footnote: "Append-only operational history. Privileged reads and exports are audited; credentials are excluded.",
  unreadable: [],
};
