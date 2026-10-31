import type { AccessModel } from "@/lib/platformConsole/live/access";

// Synthetic data for reference D12.
export const ACCESS_FIXTURE: AccessModel = {
  rows: [
    { id: "1", member: "Alex Example", scope: "Store A", role: "Manager", lastSignIn: "Today 08:52", state: { label: "Active", tone: "good" }, actionLabel: "Open member", href: "/platform-console/access" },
    { id: "2", member: "Jordan Example", scope: "Store B", role: "Staff", lastSignIn: "Yesterday 16:24", state: { label: "Active", tone: "good" }, actionLabel: "Open member", href: "/platform-console/access" },
    { id: "3", member: "Taylor Example", scope: "Platform", role: "Support read-only", lastSignIn: "Today 09:00", state: { label: "MFA verified", tone: "good" }, actionLabel: "Inspect access", href: "/platform-console/access" },
    { id: "4", member: "Unresolved identity", scope: "Store C", role: "Owner", lastSignIn: "Unknown", state: { label: "Needs review", tone: "warn" }, actionLabel: "Inspect identity", href: "/platform-console/access" },
  ],
  rowsNote: "",
  privilegedHelper: "Platform permissions are explicit, audited and separate from dealer ownership.",
  signalsHelper: "No raw secrets or unrestricted customer payloads in diagnostics.",
  signalsLine: "Cross-store denials · credential failures · session revocations",
  signalsNote: "Monitor rejected access and verify isolation with synthetic tests.",
};
