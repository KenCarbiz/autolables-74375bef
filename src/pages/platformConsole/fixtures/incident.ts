import type { IncidentModel } from "@/lib/platformConsole/live/incident";

// Synthetic data for references D16 and M04.

export const INCIDENT_FIXTURE: IncidentModel = {
  kind: "incident",
  id: "INC-028",
  status: "investigating",
  severity: "high",
  badge: "HIGH · DATA HELD",
  subtitle: "Store A · inventory import held · observed 09:14 local",
  impactHelper: "Prior good inventory remains published. New file has not changed listings.",
  scope: "Affected scope: Store A · 130 incoming rows",
  cause: "Cause observed: missing odometer and renamed selling-price column",
  next: "Next step: mapping review → retained-file validation → replay preview",
  note: "Acknowledged does not mean resolved. Resolution needs fresh evidence.",
  timeline: [
    { id: "1", tone: "warn", title: "Detected 09:14", detail: "Validation held publication" },
    { id: "2", tone: "good", title: "Assigned 09:16", detail: "Owner: Operator A" },
    { id: "3", tone: "warn", title: "Current status", detail: "Investigating · no automatic replay" },
    { id: "4", tone: "info", title: "Resolution condition", detail: "Validated replay and publication" },
  ],
  evidenceHelper: "Private payloads are redacted; retain source records and audit accesses.",
  importId: "IMP-1042",
  importLabel: "Open import IMP-1042",
  internalNote: "Mapping correction proposed; not yet applied",
  actions: ["assign", "acknowledge"],
};

export const INCIDENT_PHONE_FIXTURE: IncidentModel = {
  kind: "incident",
  id: "INC-028",
  status: "investigating",
  severity: "high",
  badge: "HIGH · INVESTIGATING",
  subtitle: "Store A · inventory import held · observed 09:14 local",
  impactHelper: "Prior good inventory stays published.",
  scope: "Store A · new file held",
  owner: "Owner: Operator A",
  next: "Next: mapping review, then validate.",
  note: "Acknowledged ≠ resolved",
  timeline: [
    { id: "1", tone: "warn", title: "Detected 09:14", detail: "Validation failure" },
    { id: "2", tone: "good", title: "Assigned 09:16", detail: "Operator A investigating" },
    { id: "3", tone: "info", title: "Resolution required", detail: "Successful reviewed replay" },
  ],
  evidenceHelper: "",
  importId: "IMP-1042",
  importLabel: "Open affected import",
  internalNote: "",
  actions: ["assign", "acknowledge"],
};
