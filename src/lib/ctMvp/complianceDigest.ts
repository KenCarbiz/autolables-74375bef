import { supabase } from "@/integrations/supabase/client";

export type ComplianceDigestIssueType = "missing_ftc" | "missing_k208" | "missing_signature" | "needs_review";

export type ComplianceDigestVehicle = {
  vehicleId: string | null;
  vin: string | null;
  stock: string | null;
  vehicleTitle: string | null;
  issues: ComplianceDigestIssueType[];
  labels: string[];
  certifiedAt: string | null;
};

export type ComplianceDigest = {
  tenantId: string;
  generatedAt: string;
  totalVehicles: number;
  certifiedVehicles: number;
  needsReview: number;
  missingFtc: number;
  missingK208: number;
  missingSignatures: number;
  vehicles: ComplianceDigestVehicle[];
  subject: string;
  summaryText: string;
};

type CertificationCheck = {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
  detail?: string;
};

type CertificationRunRow = {
  id: string;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_title: string | null;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string | null;
};

const issueText = (check: CertificationCheck) => `${check.key || ""} ${check.label || ""} ${check.detail || ""}`.toLowerCase();
const isOpenIssue = (check: CertificationCheck) => !!check.status && check.status !== "pass" && check.status !== "skip";
const hasTerms = (checks: CertificationCheck[], terms: string[]) => checks.some((check) => isOpenIssue(check) && terms.some((term) => issueText(check).includes(term)));

const latestRows = (rows: CertificationRunRow[]) => {
  const seen = new Set<string>();
  const latest: CertificationRunRow[] = [];
  for (const row of rows) {
    const key = row.vehicle_id || row.vin || row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest;
};

const classify = (row: CertificationRunRow): ComplianceDigestVehicle => {
  const checks = Array.isArray(row.checks) ? row.checks : [];
  const issues: ComplianceDigestIssueType[] = [];
  if (!row.ready) issues.push("needs_review");
  if (hasTerms(checks, ["ftc", "buyers guide", "buyer guide"])) issues.push("missing_ftc");
  if (hasTerms(checks, ["k208", "warranty"])) issues.push("missing_k208");
  if (hasTerms(checks, ["signature", "signed", "signing"])) issues.push("missing_signature");

  const labels = checks
    .filter(isOpenIssue)
    .map((check) => check.label || check.key || "Compliance issue")
    .slice(0, 6);

  return {
    vehicleId: row.vehicle_id,
    vin: row.vin,
    stock: row.stock,
    vehicleTitle: row.vehicle_title,
    issues,
    labels,
    certifiedAt: row.certified_at,
  };
};

export const buildCtMvpComplianceDigest = async (tenantId: string): Promise<ComplianceDigest> => {
  const { data, error } = await (supabase as any)
    .from("ct_mvp_certification_runs")
    .select("id,vehicle_id,vin,stock,vehicle_title,ready,checks,certified_at")
    .eq("tenant_id", tenantId)
    .order("certified_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  const rows = latestRows((data || []) as CertificationRunRow[]);
  const vehicles = rows.map(classify).filter((vehicle) => vehicle.issues.length > 0);
  const certifiedVehicles = rows.filter((row) => !!row.ready).length;
  const missingFtc = vehicles.filter((vehicle) => vehicle.issues.includes("missing_ftc")).length;
  const missingK208 = vehicles.filter((vehicle) => vehicle.issues.includes("missing_k208")).length;
  const missingSignatures = vehicles.filter((vehicle) => vehicle.issues.includes("missing_signature")).length;
  const needsReview = vehicles.filter((vehicle) => vehicle.issues.includes("needs_review")).length;

  const subject = needsReview
    ? `Compliance digest: ${needsReview} vehicle${needsReview === 1 ? "" : "s"} need review`
    : "Compliance digest: all checked vehicles certified";

  const summaryText = [
    `${certifiedVehicles} certified`,
    `${needsReview} need review`,
    `${missingFtc} missing FTC`,
    `${missingK208} missing K208`,
    `${missingSignatures} missing signatures`,
  ].join(" · ");

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    totalVehicles: rows.length,
    certifiedVehicles,
    needsReview,
    missingFtc,
    missingK208,
    missingSignatures,
    vehicles,
    subject,
    summaryText,
  };
};

export const renderCtMvpComplianceDigestText = (digest: ComplianceDigest) => {
  const lines = [
    digest.subject,
    "",
    digest.summaryText,
    "",
    "Action Center: /compliance-center?filter=needs_review",
    "",
    "Vehicles needing attention:",
  ];

  for (const vehicle of digest.vehicles.slice(0, 25)) {
    lines.push(`- ${vehicle.stock || "No stock"} ${vehicle.vehicleTitle || "Vehicle"} ${vehicle.vin || ""}: ${vehicle.labels.join(", ") || vehicle.issues.join(", ")}`);
  }

  if (digest.vehicles.length > 25) lines.push(`- Plus ${digest.vehicles.length - 25} more vehicles in the Action Center`);
  return lines.join("\n");
};
