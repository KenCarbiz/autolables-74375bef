import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { getDealerDocumentRules } from "@/lib/documentRules";
import { normalizeContactRouting, type PassportAgent } from "@/lib/passportRouting";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";

// Read-only derivations of the policy in force. Every row names the canonical
// writer it was read from and links to that editor. Nothing here is a second
// editor and nothing here is enforcement: the server guards named in the
// detail text are the enforcement.

export type PolicyRowState = "ok" | "incomplete" | "conflict" | "unknown";

export interface EffectivePolicyRow {
  key: "price_basis" | "publishing" | "used_cpo" | "routing";
  title: string;
  value: string;
  detail: string;
  state: PolicyRowState;
  href: string;
  /** The settings keys this row was derived from. */
  sources: string[];
}

export interface RoutingReadiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: Array<{ key: string; label: string; state: "ok" | "missing" | "warning"; detail: string }>;
}

const nonEmpty = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

/**
 * Whether the customer routing configuration can be relied on. Activation
 * requires every public route to end at a working destination; a draft that
 * is missing one stays incomplete.
 */
export function deriveRoutingReadiness(
  routing: DealerSettings["passport_contact_routing"] | null | undefined,
  agents: PassportAgent[] | null | undefined,
): RoutingReadiness {
  const cfg = normalizeContactRouting(routing);
  const roster = (agents ?? []).filter((a) => nonEmpty(a.name));
  const available = roster.filter((a) => a.acceptsPassportLeads !== false && a.manualOverride !== "unavailable");
  const checks: RoutingReadiness["checks"] = [];

  const dc = cfg.dealershipDefaultContact;
  const hasDefault = nonEmpty(dc?.salesPhone) || nonEmpty(dc?.salesEmail);
  checks.push({
    key: "default_contact",
    label: "Default contact",
    state: hasDefault ? "ok" : "missing",
    detail: hasDefault ? "Store contact for unassigned requests is set." : "Store contact for unassigned requests is missing.",
  });

  const rotationOn = !!cfg.salesRotationSettings?.enabled;
  checks.push({
    key: "sales_rotation",
    label: "Sales rotation",
    state: !rotationOn ? "ok" : available.length >= 1 ? (available.length >= 2 ? "ok" : "warning") : "missing",
    detail: !rotationOn
      ? "Rotation is off."
      : available.length === 0
        ? "Rotation is on but no salesperson can receive leads."
        : `${available.length} ${available.length === 1 ? "salesperson" : "salespeople"} can receive leads.`,
  });

  const mgr = cfg.managerFallback;
  const mgrOn = !!mgr?.enabled;
  const mgrOk = nonEmpty(mgr?.managerEmail) || nonEmpty(mgr?.managerPhone);
  checks.push({
    key: "manager_recipient",
    label: "Manager recipient",
    state: !mgrOn ? "ok" : mgrOk ? "ok" : "missing",
    detail: !mgrOn ? "Manager fallback is off." : mgrOk ? "Manager for escalations is set." : "Manager for escalations is missing.",
  });

  const bdc = cfg.bdcSettings;
  const bdcOn = !!bdc?.enabled;
  const bdcOk = nonEmpty(bdc?.bdcEmail) || nonEmpty(bdc?.bdcPhone);
  checks.push({
    key: "bdc_destination",
    label: "BDC destination",
    state: !bdcOn ? "ok" : bdcOk ? "ok" : "missing",
    detail: !bdcOn ? "BDC fallback is off." : bdcOk ? "BDC destination is set." : "BDC is enabled without a destination.",
  });

  const hoursSet = (cfg.businessHours ?? []).length > 0;
  checks.push({
    key: "after_hours",
    label: "After-hours routing",
    state: hoursSet ? "ok" : "warning",
    detail: hoursSet ? "Business hours are configured; after-hours behavior applies outside them." : "No business hours are set, so after-hours behavior never applies.",
  });

  const esc = cfg.escalationRules;
  if (esc?.enabled) {
    const tiers = [
      { after: esc.escalateToBdcAfterMinutes ?? esc.firstResponseSlaMinutes, ok: bdcOk },
      { after: esc.escalateToManagerAfterMinutes, ok: mgrOk },
    ].filter((t) => t.after != null && t.after > 0);
    const valid = tiers.filter((t) => t.ok);
    checks.push({
      key: "escalation",
      label: "Escalation destinations",
      state: tiers.length === 0 ? "warning" : valid.length === tiers.length ? "ok" : "missing",
      detail: tiers.length === 0 ? "Escalation is on but no tier has a time." : valid.length === tiers.length ? "Every escalation tier has a destination." : "An escalation tier has no valid destination.",
    });
  }

  const blockers = checks.filter((c) => c.state === "missing").map((c) => c.detail);
  const warnings = checks.filter((c) => c.state === "warning").map((c) => c.detail);
  return { ready: blockers.length === 0, blockers, warnings, checks };
}

export interface EffectivePolicyInput {
  settings: Pick<
    DealerSettings,
    | "doc_fee_enabled"
    | "doc_fee_amount"
    | "price_display_mode"
    | "ingest_auto_publish"
    | "require_safety_inspection"
    | "require_install_verification"
    | "document_rules"
    | "passport_contact_routing"
    | "passport_agents"
  >;
}

export function deriveEffectivePolicy({ settings }: EffectivePolicyInput): EffectivePolicyRow[] {
  const rules = getDealerDocumentRules(settings as DealerSettings);
  const feeOn = !!settings.doc_fee_enabled && Number(settings.doc_fee_amount) > 0;
  const fee = Number(settings.doc_fee_amount) || 0;
  const showsTotal = settings.price_display_mode === "website_sale_price";

  const priceBasis: EffectivePolicyRow = {
    key: "price_basis",
    title: "Price basis",
    value: feeOn ? "Doc fee included" : "No doc fee",
    detail: feeOn
      ? `Advertised total is the selling price plus a $${fee.toLocaleString()} doc fee${showsTotal ? ", shown as the total" : ", disclosed separately"}.`
      : "No documentation fee is added; the advertised price is the selling price.",
    state: "ok",
    href: adminTabHref("price-rules", "doc-fee"),
    sources: ["doc_fee_enabled", "doc_fee_amount", "price_display_mode"],
  };

  const reviewBeforePublish = rules.requireApprovalBeforePublish;
  const autoPublish = settings.ingest_auto_publish !== false;
  const publishing: EffectivePolicyRow = {
    key: "publishing",
    title: "Publishing",
    value: reviewBeforePublish ? "Review rules" : autoPublish ? "Auto-publish on intake" : "Manual publish",
    detail: reviewBeforePublish
      ? "Listings require manual review before the Passport is published."
      : autoPublish
        ? "The Passport goes live when a vehicle is ingested; recall safety still applies."
        : "A person publishes each Passport.",
    state: reviewBeforePublish && autoPublish ? "conflict" : "ok",
    href: adminTabHref("effective-policy"),
    sources: ["document_rules.requireApprovalBeforePublish", "ingest_auto_publish"],
  };
  if (publishing.state === "conflict") {
    publishing.detail = "Intake auto-publish is on while manager review before publishing is also on. The review rule is enforced; auto-publish still applies to intake.";
  }

  const k208 = settings.require_safety_inspection === true;
  const installs = settings.require_install_verification === true;
  const usedCpo: EffectivePolicyRow = {
    key: "used_cpo",
    title: "Used / CPO",
    value: k208 ? "K208 where applicable" : "No inspection gate",
    detail: k208
      ? `Signing waits for a completed K-208 on used and CPO inventory${installs ? " and verified installs" : ""}.`
      : installs
        ? "Signing waits for verified installs; no inspection gate is set."
        : "Customer disclosures can be signed without an inspection gate.",
    state: "ok",
    href: adminTabHref("service-policy"),
    sources: ["require_safety_inspection", "require_install_verification"],
  };

  const readiness = deriveRoutingReadiness(settings.passport_contact_routing, settings.passport_agents);
  const routing: EffectivePolicyRow = {
    key: "routing",
    title: "Routing",
    value: readiness.ready ? "Ready" : "Fallback incomplete",
    detail: readiness.ready
      ? `Every customer request has an owner and a working fallback${readiness.warnings.length ? "; " + readiness.warnings[0] : "."}`
      : `Primary rules configured. ${readiness.blockers[0]}`,
    state: readiness.ready ? "ok" : "incomplete",
    href: ADMIN_CHILD_ROUTES.escalation,
    sources: ["passport_contact_routing", "passport_agents"],
  };

  return [priceBasis, publishing, usedCpo, routing];
}
