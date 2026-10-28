import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { type CountValue, type HealthVerdict, needsAttention } from "@/lib/admin/health";
import type { RoutingReadiness } from "@/lib/admin/effectivePolicy";

// The ranked attention queue on Overview. Bounded, ordered by what a manager
// should act on first, and every row carries an exact destination. A count
// that could not be read produces a "could not be checked" row, never a zero
// and never silence.

export type AttentionStatus = "blocked" | "needs_review" | "review_required" | "incomplete" | "unknown";

export const ATTENTION_STATUS_META: Readonly<Record<AttentionStatus, { label: string; tone: "danger" | "warning" | "neutral" | "info"; rank: number }>> = {
  blocked: { label: "Blocked", tone: "danger", rank: 0 },
  needs_review: { label: "Needs review", tone: "warning", rank: 1 },
  review_required: { label: "Review required", tone: "warning", rank: 2 },
  incomplete: { label: "Incomplete", tone: "neutral", rank: 3 },
  unknown: { label: "Could not check", tone: "info", rank: 4 },
};

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  owner: string | null;
  status: AttentionStatus;
  action: { label: string; href: string };
}

export interface AttentionInput {
  feed: HealthVerdict | null;
  priceEvidence: { missing: CountValue; mismatched: CountValue } | null;
  descriptions: { blocked: CountValue } | null;
  routing: RoutingReadiness | null;
  recall: HealthVerdict | null;
  publishing: { incomplete: string[] } | null;
  documents: { missingTemplates: string[] } | null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function buildAttentionQueue(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.feed && needsAttention(input.feed.state)) {
    const status: AttentionStatus = input.feed.state === "down" ? "blocked" : input.feed.state === "unknown" ? "unknown" : "needs_review";
    items.push({
      id: "feed",
      title: input.feed.state === "unknown" ? "Inventory feed health could not be checked" : `Review inventory feed: ${input.feed.headline}`,
      detail: input.feed.detail,
      owner: "Inventory manager",
      status,
      action: { label: "Open diagnostics", href: adminTabHref("inventory-feed") },
    });
  }

  if (input.priceEvidence) {
    const { missing, mismatched } = input.priceEvidence;
    if (missing.kind === "failed" || mismatched.kind === "failed") {
      items.push({ id: "price-unknown", title: "Price evidence could not be checked", detail: "The price audit did not load, so no vehicle is confirmed.", owner: "Store admin", status: "unknown", action: { label: "Review pricing", href: adminTabHref("price-rules", "price-consistency") } });
    } else {
      if (mismatched.kind === "known" && mismatched.value > 0) {
        items.push({ id: "price-mismatch", title: "Resolve advertised price mismatches", detail: `${plural(mismatched.value, "vehicle", "vehicles")} where the website price and the stored price disagree.`, owner: "Store admin", status: "review_required", action: { label: "Review pricing", href: adminTabHref("price-rules", "price-consistency") } });
      }
      if (missing.kind === "known" && missing.value > 0) {
        items.push({ id: "price-missing", title: "Confirm price evidence", detail: `${plural(missing.value, "vehicle", "vehicles")} missing supporting price evidence.`, owner: "Store admin", status: "review_required", action: { label: "Review pricing", href: adminTabHref("price-rules", "price-consistency") } });
      }
    }
  }

  if (input.descriptions) {
    const b = input.descriptions.blocked;
    if (b.kind === "failed") {
      items.push({ id: "descriptions-unknown", title: "Description cases could not be checked", detail: "The description queue did not load.", owner: "Merchandising", status: "unknown", action: { label: "Open queue", href: "/description-operations" } });
    } else if (b.kind === "known" && b.value > 0) {
      items.push({ id: "descriptions", title: "Recover description cases", detail: `${plural(b.value, "vehicle", "vehicles")} with blocked or incomplete descriptions.`, owner: "Merchandising", status: "blocked", action: { label: "Open queue", href: "/description-operations?status=blocked" } });
    }
  }

  if (input.routing && !input.routing.ready) {
    items.push({ id: "routing", title: "Complete routing fallback", detail: input.routing.blockers[0] ?? "Fallback not configured for this rooftop.", owner: "Sales manager", status: "incomplete", action: { label: "Configure", href: ADMIN_CHILD_ROUTES.escalation } });
  }

  if (input.recall && needsAttention(input.recall.state)) {
    items.push({ id: "recall", title: `Recall verification: ${input.recall.headline}`, detail: input.recall.detail, owner: "Inventory manager", status: input.recall.state === "unknown" ? "unknown" : "needs_review", action: { label: "Open providers", href: adminTabHref("providers") } });
  }

  if (input.publishing?.incomplete.length) {
    items.push({ id: "publishing", title: "Complete publishing configuration", detail: input.publishing.incomplete[0], owner: "Store admin", status: "incomplete", action: { label: "Review policy", href: adminTabHref("effective-policy") } });
  }

  if (input.documents?.missingTemplates.length) {
    items.push({ id: "documents", title: "Required document template missing", detail: input.documents.missingTemplates.join(", "), owner: "Store admin", status: "blocked", action: { label: "Open templates", href: adminTabHref("templates") } });
  }

  return rankAttention(items);
}

export function rankAttention(items: AttentionItem[], limit = 6): AttentionItem[] {
  return [...items]
    .sort((a, b) => ATTENTION_STATUS_META[a.status].rank - ATTENTION_STATUS_META[b.status].rank || a.title.localeCompare(b.title))
    .slice(0, limit);
}
