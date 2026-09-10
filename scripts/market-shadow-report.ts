// Shadow fleet report runner.
//
// Reads a JSON export of vehicle_listings rows and writes a markdown report.
// It performs no network calls, contacts no provider, and writes nothing back
// to the database — the export is produced by a plain SELECT.
//
//   bun run scripts/market-shadow-report.ts <rows.json> <out.md>

import { readFileSync, writeFileSync } from "node:fs";
import { shadowFleet, type ShadowListingRow } from "../src/lib/market/shadowReport.ts";
import { MARKET_ENGINE_VERSION } from "../src/lib/market/types.ts";

const [, , inputPath, outputPath, nowIso, dealerTypeArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: bun run scripts/market-shadow-report.ts <rows.json> <out.md> [nowIso]");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(inputPath, "utf8")) as ShadowListingRow[];
const generatedAt = nowIso ?? new Date().toISOString();

const report = shadowFleet(
  rows,
  {
    // Harte INFINITI, from MarketCheck's own stored dealer object rather than
    // from a name guess: dealer id 1013372 at harteinfiniti.com, inside the
    // "Harte Auto Group" group, whose second rooftop is 1028492 at
    // hartecars.com. Read-only evidence, not applied to any tenant setting.
    identity: {
      dealerIds: ["1013372"],
      domains: ["harteinfiniti.com"],
      // "Harte Auto Group" is the group's TRADING NAME, not MarketCheck's
      // group_id, so it goes in groupNames. In groupIds it would be compared
      // against dealer.group_id, never match, and still report itself as a
      // stable identification.
      groupIds: [],
      groupNames: ["Harte Auto Group"],
      names: ["Harte Infiniti", "Harte INFINITI"],
    },
    // Not configured for any tenant yet. Null unless the caller supplies one,
    // so the default run says "blocked" instead of assuming franchise.
    dealerType: dealerTypeArg === "franchise" || dealerTypeArg === "independent" ? dealerTypeArg : null,
    // Nobody has answered the mandatory-add-on question for this tenant, so
    // the price basis is ambiguous rather than assumed to be zero. Six Harte
    // vehicles do carry priced installed items, so a tenant-wide zero would be
    // factually wrong as well as unverified.
    mandatoryAddOns: null,
    zip: "06120",
    nowMs: Date.parse(generatedAt),
    providerCallCostUsd: 0.07,
  },
  generatedAt,
  MARKET_ENGINE_VERSION,
);

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");
const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

const lines: string[] = [];
lines.push("# Market Intelligence V2 — Shadow Fleet Report");
lines.push("");
lines.push(`Generated ${report.generatedAt} · engine ${report.engineVersion} · dealer_type ${dealerTypeArg ?? "not configured"}`);
lines.push("");
lines.push("Nothing in this run wrote to the database, called a provider, or changed a");
lines.push("customer-facing surface. Production values are read; V2 is computed beside them.");
lines.push("");
lines.push("## Fleet");
lines.push("");
lines.push("| | count | share |");
lines.push("|---|---:|---:|");
lines.push(`| Vehicles evaluated | ${report.totalEvaluated} | |`);
lines.push(`| V2 available | ${report.available} | ${pct(report.available, report.totalEvaluated)} |`);
lines.push(`| V2 limited | ${report.limited} | ${pct(report.limited, report.totalEvaluated)} |`);
lines.push(`| V2 unavailable | ${report.unavailable} | ${pct(report.unavailable, report.totalEvaluated)} |`);
lines.push(`| Verdict changes vs today | ${report.verdictChanges} | ${pct(report.verdictChanges, report.totalEvaluated)} |`);
lines.push(`| Red / above-market claims suppressed | ${report.redSuppressed} | ${pct(report.redSuppressed, report.totalEvaluated)} |`);
lines.push("");
lines.push("## Findings");
lines.push("");
lines.push("| finding | vehicles | share |");
lines.push("|---|---:|---:|");
for (const [key, count] of Object.entries(report.findingCounts).sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${key} | ${count} | ${pct(count, report.totalEvaluated)} |`);
}
lines.push("");
lines.push("## Largest dollar changes");
lines.push("");
lines.push("| VIN | shown today | V2 | change |");
lines.push("|---|---:|---:|---:|");
for (const c of report.largestDollarChanges) {
  lines.push(`| ${c.vin} | ${money(c.from)} | ${money(c.to)} | ${money(c.change)} |`);
}
if (!report.largestDollarChanges.length) {
  lines.push("| — | — | — | — |");
  lines.push("");
  lines.push("No vehicle produced a comparable V2 dollar difference, because no vehicle");
  lines.push("reached a usable comparable market. That is the finding, not an empty table.");
}
lines.push("");
lines.push("## Provider cost to correct");
lines.push("");
lines.push(`Vehicles needing a corrected provider call: ${report.providerCallsRequired}`);
lines.push(`Estimated one-off cost at $0.07 per call: $${report.providerBudgetUsd.toFixed(2)}`);
lines.push("");
if (report.blockedByConfiguration.length) {
  lines.push("## Blocked by configuration");
  lines.push("");
  for (const b of report.blockedByConfiguration) lines.push(`- ${b}`);
  lines.push("");
}
lines.push("## Per vehicle");
lines.push("");
lines.push("| VIN | today | V2 | V2 confidence | findings |");
lines.push("|---|---|---|---|---|");
for (const v of report.perVehicle) {
  lines.push(`| ${v.vin} | ${v.legacy.view.verdict} ${money(v.legacy.displayedDifference)} | ${v.v2.verdict} | ${v.v2.confidence} | ${v.findings.join(", ") || "—"} |`);
}
lines.push("");

writeFileSync(outputPath, lines.join("\n"));
console.log(JSON.stringify({
  totalEvaluated: report.totalEvaluated,
  available: report.available,
  limited: report.limited,
  unavailable: report.unavailable,
  verdictChanges: report.verdictChanges,
  redSuppressed: report.redSuppressed,
  providerCallsRequired: report.providerCallsRequired,
  providerBudgetUsd: report.providerBudgetUsd,
  findingCounts: report.findingCounts,
}, null, 2));
