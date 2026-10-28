import type { AdminScreenFixture } from "./index";
import type { OverviewFixture } from "@/pages/admin/views/OverviewView";
import { knownCount } from "@/lib/admin/health";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";

// Screen 01, Administration Overview. Synthetic data only: the counts, names
// and times are illustrative and are masked by the parity harness.

const NOW = Date.parse("2026-10-19T23:30:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const overview: OverviewFixture = {
  feed: {
    state: "degraded",
    headline: "Provider rate limited",
    detail: "Provider rate limited · Inventory preserved",
    affectedOutput: "Inventory freshness and availability",
    inventoryPreserved: true,
  },
  activeInventory: knownCount(128),
  setup: { done: 4, total: 6 },
  policyReviews: knownCount(3),
  openExceptions: knownCount(1012),
  attention: [
    {
      id: "feed",
      title: "Review provider rate limit",
      detail: "Inventory sync is being rate limited by provider.",
      owner: "Inventory manager",
      status: "needs_review",
      action: { label: "Open diagnostics", href: adminTabHref("inventory-feed") },
    },
    {
      id: "price-missing",
      title: "Confirm price evidence",
      detail: "3 vehicles missing supporting price evidence.",
      owner: "Store admin",
      status: "review_required",
      action: { label: "Review pricing", href: adminTabHref("price-rules", "price-consistency") },
    },
    {
      id: "descriptions",
      title: "Recover description cases",
      detail: "12 vehicles with incomplete descriptions.",
      owner: "Merchandising",
      status: "blocked",
      action: { label: "Open queue", href: "/description-operations?status=blocked" },
    },
    {
      id: "routing",
      title: "Complete routing fallback",
      detail: "Fallback not configured for this rooftop.",
      owner: "Sales manager",
      status: "incomplete",
      action: { label: "Configure", href: ADMIN_CHILD_ROUTES.escalation },
    },
  ],
  policy: [
    { key: "price_basis", title: "Price basis", value: "Doc fee included", detail: "Based on selling price (doc fee included).", state: "ok", href: adminTabHref("price-rules", "doc-fee"), sources: ["doc_fee_enabled", "doc_fee_amount"] },
    { key: "publishing", title: "Publishing", value: "Review rules", detail: "Listings require manual review.", state: "ok", href: adminTabHref("effective-policy"), sources: ["document_rules.requireApprovalBeforePublish"] },
    { key: "used_cpo", title: "Used / CPO", value: "K208 where applicable", detail: "Apply K208 to used inventory where applicable.", state: "ok", href: adminTabHref("service-policy"), sources: ["require_safety_inspection"] },
    { key: "routing", title: "Routing", value: "Fallback incomplete", detail: "Primary rules configured · Fallback not set.", state: "incomplete", href: ADMIN_CHILD_ROUTES.escalation, sources: ["passport_contact_routing"] },
  ],
  activity: [
    { id: "a1", action: "Inventory sync rate limited", detail: "Provider rate limited · Inventory preserved", at: minutesAgo(24), tone: "warning" },
    { id: "a2", action: "Price rule updated", detail: "Used vehicle rule \"K208 where applicable\"", at: minutesAgo(2 * 60), tone: "success" },
    { id: "a3", action: "User added", detail: "example.user@example.test · Sales Manager", at: minutesAgo(5 * 60), tone: "info" },
    { id: "a4", action: "Publishing rule changed", detail: "Listings now require manual review", at: minutesAgo(26 * 60), tone: "neutral" },
  ],
};

export const fixture01: AdminScreenFixture = {
  tabId: "overview",
  fixture: { label: "01 Admin Overview", now: NOW, views: { overview } },
};
