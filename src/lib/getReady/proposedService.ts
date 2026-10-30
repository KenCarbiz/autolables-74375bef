export interface ProposedServiceLine {
  id: string;
  type: string;
  description: string;
  cost: number;
  status: "proposed" | "approved" | "declined" | "completed";
}

interface RawLine {
  id: string;
  category: string | null;
  description: string | null;
  line_total: number | string | null;
  approval_status: string | null;
  completed_at?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  mechanical: "Service",
  service: "Service",
  cosmetic: "Detail",
  detail: "Detail",
  tires: "Tires",
  glass: "Glass",
};

const typeLabel = (category: string | null): string => {
  const key = String(category ?? "").trim().toLowerCase();
  if (!key) return "Other";
  return TYPE_LABEL[key] ?? "Other";
};

const statusOf = (raw: RawLine): ProposedServiceLine["status"] => {
  if (raw.completed_at) return "completed";
  if (raw.approval_status === "approved") return "approved";
  if (raw.approval_status === "declined") return "declined";
  return "proposed";
};

/** Lines of the estimates already filed for a vehicle, as the intake review shows them. */
export const proposedServiceLines = (raw: RawLine[]): ProposedServiceLine[] =>
  raw
    .filter((l) => l && l.description)
    .map((l) => ({
      id: l.id,
      type: typeLabel(l.category),
      description: String(l.description).trim(),
      cost: Number(l.line_total) || 0,
      status: statusOf(l),
    }));

export const proposedServiceTotal = (lines: ProposedServiceLine[]): number =>
  lines.filter((l) => l.status !== "declined").reduce((sum, l) => sum + l.cost, 0);
