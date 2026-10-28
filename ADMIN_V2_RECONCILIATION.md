# Administration V2: reconciliation against current main

Build program for the Administration refresh handoff (V2, 97 percent parity
package). This document is the package's step 1 and 2: every October 20
finding classified against the code and the live database as they stood when
the build started, and every current Administration control mapped to its
V2 owner. Counts are point-in-time reads; no tenant, VIN, price or person
from production appears here.

| Anchor | Commit |
|---|---|
| Handoff package verified against | `acf979b6` |
| Main when this build started (2026-10-28) | `763b524` |
| Keystone (shell, contracts, Overview) | `4ceac63` |

The package's four verdicts are used as written in its
`docs/06_CURRENT_REPO_RECONCILIATION_2026-10-27.md`:
FIXED BEFORE THIS BUILD, STILL OPEN AND FIXED IN THIS BUILD, SUPERSEDED BY
CURRENT ARCHITECTURE, OUT OF SCOPE WITH SAFE CURRENT STATE. A finding can
split across verdicts when parts of it were already repaired.

## 1. Internal logic review (October 20), finding by finding

### P0-A Doc-fee recalculation on hydration

| Part | Verdict | Evidence |
|---|---|---|
| Admin page calls `recalc_tenant_doc_fee` from a fee-signature effect | STILL OPEN, FIXED IN THIS BUILD | The effect was present at `763b524` (Admin.tsx, the block after the product icon key). Removed in `4ceac63`; the fee amount field now saves the setting only and says so. Recalculation becomes an explicit Review & Apply step on Pricing & Products (stream S4). |
| Function guard accepts any member | FIXED BEFORE THIS BUILD | The live function now requires an accepted owner, admin, general manager or GSM membership, or a platform admin. It still does not check `accepted_at`. |
| No changed-value predicate; repeated runs touch every row | FIXED BEFORE THIS BUILD | The live function updates only rows where the fee or the derived total differs. |
| Archived stock included | STILL OPEN, prepared in this build | The live predicate has no `archived_at` filter. The replacement RPCs (stream S10, migration prepared, not applied) exclude archived stock unless explicitly authorized. |
| Verification stamp and parser status rewritten by recalculation | STILL OPEN, prepared in this build | The live function sets `price_last_verified_at = now()` and `price_parse_status = 'ok'`. The replacement records recalculation separately and leaves source verification untouched. |
| Review, version, idempotency, audit | STILL OPEN, FIXED IN THIS BUILD (UI) and prepared (SQL) | Review & Apply reducer in `src/lib/admin/reviewApply.ts`; fee review child (S4); policy version, idempotency ledger and audit rows in the S10 migration. Until that migration is applied, Apply may use the current function only after explicit review and states its two remaining limitations. |

### P0-B Backend authority parity

| Part | Verdict | Evidence (live catalog, 2026-10-28) |
|---|---|---|
| `dealer_profiles` writable by any accepted member | CURRENT, prepared in this build | UPDATE policy: platform admin or any accepted member of the tenant; the `authenticated` role holds the table UPDATE grant. |
| `merge_dealer_settings` protects a narrow key set | CURRENT, prepared in this build | Protects eight service and signer keys for manager roles; every other key is writable by any accepted member; direct table writes bypass it. |
| `vehicle_listings` UPDATE not role-aware | CURRENT, prepared in this build | UPDATE policy: the current tenant, creator-owned tenantless rows, or platform admin. No column or role distinction. |
| `products` and `product_rules` writable by any member | CURRENT, prepared in this build | `ALL` policies for accepted tenant members on both tables. |
| Frontend tab visibility treated as permission | SUPERSEDED BY CURRENT ARCHITECTURE for navigation, CURRENT for writes | `adminTabAccess.ts` already gates tabs by capability; V2 keeps the same any-of sets (`sections.ts` test proves no widening). Server-side parity is the S10 migration. |

Stream S10 prepares the migration (key-level authority in the merge RPC,
RPC-only path for settings, role-scoped product writes, a column guard for
price and recall override fields) with a dry-run and rollback plan. It is
applied only on the owner's authorization and is called out separately.

### P0-C Price facts and audit confidence

| Part | Verdict | Evidence |
|---|---|---|
| Per-fact observation, authority, freshness and conflict contract | SUPERSEDED BY CURRENT ARCHITECTURE | The Vehicle Intelligence contracts on main (`src/lib/intelligence/contracts.ts`: `Fact<T>`, authority classes, freshness resolution, price integrity summary) and the Passport read models carry this. Admin renders them; it does not recreate them. |
| Price Audit reads mismatch from the parser flag, caps at 500, hides query errors | STILL OPEN, FIXED IN THIS BUILD | The panel at `763b524` shows "Couldn't load" on error (a partial fix landed earlier) but still derives mismatch from `price_parse_status` and caps silently. The Price rules view (S4) separates numerical consistency, parser state and source agreement, shows Unknown on a failed read, and discloses the cap. |
| Public MSRP source identified (`mc_attributes.msrp`) | FIXED BEFORE THIS BUILD | Documented in the MarketCheck reconciliation; unchanged by Admin. |

### P0-D Feed outcomes and last success

| Part | Verdict | Evidence |
|---|---|---|
| "Never" derived from a 50-row window | CURRENT, FIXED IN THIS BUILD | `InventorySyncCenter.tsx` at `763b524` reads 50 rows and searches for a success inside them. The feed tab (S8) and the kept alias page query last success over the whole ledger. |
| HTTP 429 reported as rooftop mismatch, pin clearing advised, run missing from the ledger | FIXED BEFORE THIS BUILD | The October 27 containment (`_shared/pinnedFeedOutcome.ts`, `marketcheck-sync`) classifies refusals as `provider_refused_<status>`, writes a terminal run row and keeps the pin. |
| Transport, auth, provider error, valid empty, identity, skip as distinct outcomes | STILL OPEN, FIXED IN THIS BUILD | `classifyRunOutcome` in `src/lib/admin/health.ts` reads the HTTP status before any text, so a 429 is a rate limit even when an older row's text says otherwise; every outcome carries inventory-preserved and next-safe-action metadata. |
| Scheduled skip shown as health | FIXED BEFORE THIS BUILD, kept | The sync center already refused to let a skip stand in for the last real run; the V2 derivation keeps that rule and adds freshness against cadence. |

### P0-E Publishing domains

| Part | Verdict | Evidence |
|---|---|---|
| `enforce_prep_gate` does not read foreman sign-off | SUPERSEDED BY CURRENT ARCHITECTURE | Live definition reads no `listing_unlocked`; it blocks a transition into published on a do-not-drive recall. The project instruction describing a foreman gate is historical. The Publishing effective matrix (S6) documents the real enforcers and composes nothing new. |
| `unpublish_on_do_not_drive_recall`, `publish_description_internal`, `description_publish_allowed`, `enforce_price_verified_before_sign` | FIXED BEFORE THIS BUILD (exist and are preserved) | All four present in the live catalog; none touched. |
| Effective policy by condition, artifact and action | STILL OPEN, FIXED IN THIS BUILD | Stream S6. Overrides are shown as the manager roles the settings name; historical artifacts are not touched. |

### P0-F Descriptions

OUT OF SCOPE WITH SAFE CURRENT STATE for the Administration refresh. The
Overview counts blocked description jobs as a ranked attention row with an
exact queue destination and never as zero; the "variants live" wording lives
in Description Operations, not Administration, and stays an open item there.

### P0-G Lead escalation

| Part | Verdict | Evidence |
|---|---|---|
| 500-profile cap, one store per tenant, 20 leads per tier, `notifyMethods` ignored, no response check, level advanced on a failed send | CURRENT, prepared in this build | All six present in `passport-lead-escalation/index.ts` at `763b524`. Stream S5 prepares the corrected function on a pure shared module with tests; deploy is called out separately. |
| Scheduler proves intent, not delivery | STILL OPEN, FIXED IN THIS BUILD (UI) | The escalation child shows Attempted, Accepted, Delivered and Failed as separate states and labels the current sender's rows Attempted, because acceptance is not recorded today. |

### P1-H Settings lifecycle

| Part | Verdict | Evidence |
|---|---|---|
| Full-snapshot upsert fallback on a broad error regex | CURRENT, FIXED IN THIS BUILD | `DealerSettingsContext.tsx` at `763b524` falls back when the message matches `function|merge_dealer_settings|schema cache`. Stream S2 removes the fallback and keeps the visible unsaved error. |
| Branding hydration once-only, not keyed by tenant | CURRENT, FIXED IN THIS BUILD | Admin.tsx `brandingHydratedRef` at `763b524`. S2 keys hydration by tenant and server load generation. |
| Nested object ownership | STILL OPEN, partly in this build | Each V2 editor saves only the keys it owns through the merge RPC; nested stores (`document_rules`, `passport_contact_routing`) are owned by exactly one editor each (S6, S7, S5). Granular patch semantics below one key remain a follow-up. |

### Entitlement and loading behavior (P1)

NOT RE-VERIFIED in this pass. `useFeatureGate` and `RouteCapabilityGuard`
were not re-read; the safe current state stands: they decide presentation,
and server authority (the S10 migration once applied) is the gate.

### National rules governance (P0 for compliance copy)

OUT OF SCOPE WITH SAFE CURRENT STATE. `src/data/docFees.ts` is still a static
reference list; the Price rules view labels the jurisdiction and the fee the
dealer configured and makes no compliance claim. A reviewed, versioned rule
registry needs the owner's product and legal decision before import.

## 2. National launch assessment (October 20), item by item

| Item | Verdict | Where |
|---|---|---|
| 01 Settings must be safe to open (P0 recalculation, P1 hydration, P1 save contract) | FIXED IN THIS BUILD | Keystone removed the effect; S2 hydration and save states; Review & Apply contract. |
| 02 One vehicle, one explainable price; price audit overconfident; comparison basis | SUPERSEDED (facts contract) and FIXED IN THIS BUILD (audit display) | Intelligence contracts on main; S4 Price rules. |
| 03 Verification language on the Passport; four states; one effective policy | OUT OF SCOPE for the first (Passport is locked by the owner); FIXED IN THIS BUILD for the matrix | S6 effective matrix separates listing visibility, document publication, retail readiness and signing. |
| 04 Integration health trustworthy; safe feed recovery; operator console | FIXED BEFORE (containment) and FIXED IN THIS BUILD (health center) | S8; `/admin/exceptions` stays the exceptions workbench. |
| 05 National rules need an owner and a version | OUT OF SCOPE WITH SAFE CURRENT STATE | See above. |
| 06 Organize the daily workspace around jobs (global sidebar groups) | OUT OF SCOPE | The global navigation is the product shell; the package itself says Administration is one destination inside it. Owner decision. |
| 07 A clearer Administration structure; control contract; validate before enabling | FIXED IN THIS BUILD | Eight sections, five children, control-consumer matrix assembled from stream reports, readiness rule in `effectivePolicy.ts`. |
| 08 Give each employee a complete work path; required role proof | FIXED IN THIS BUILD (People & Access) and OPEN (restricted-account runtime proof) | S3 renders capability from the server contract and names unverified enforcement honestly; real restricted-account tests need accounts the owner provisions. |
| 09 Finish the handoffs and operating views | OUT OF SCOPE | Not Administration. |
| 10 Reporting and operational definitions | OUT OF SCOPE, except counts in Administration carry scope and state | `CountValue` never renders unknown as zero. |
| 11 Visual direction (navy, blue, cool neutrals, tokens) | FIXED IN THIS BUILD | `adm-*` tokens scoped to Administration. |
| 12 Implementation sequence | Followed | Write safety first, then operational truth, then facts and policies, then the rebuild, then measurement. |
| 13 Description automation needs recovery | OUT OF SCOPE WITH SAFE CURRENT STATE | Overview row only. |
| 14 Evidence and limits | Noted | Nothing in this document is a compliance, security or capacity certification. |

## 3. Current Administration controls and their V2 owner

Every legacy `?tab=` id resolves through `src/lib/admin/sections.ts`; the
test `sections.test.ts` fails the build if an id is stranded or a child tab
widens who can see it. Disposition at the keystone commit:

| Legacy tab | Label today | V2 section and tab | Disposition |
|---|---|---|---|
| home | Home | Overview | Replaced by the Overview control center (setup progress kept as the Setup tile; quick actions live on their own pages). |
| branding | Branding | Dealership & Brand, Identity | Embedded legacy body until S2 lands Identity, Appearance, Hours & Contact. |
| passport-trust | Why Buy From Us | Dealership & Brand, Why Buy | Reused as is. |
| settings | Store Settings | Dealership & Brand, Store settings (unpictured) | Embedded; its cards are being split by owner: paper size to Templates (S7), product default mode to Products (S4), title/MCO, recon approval, K-208 gate, install verification, dispatch to Service policy (S7), shopper engagement to Customer Experience (S5), integration status to Providers (S8), feature toggles to Plan & features. |
| team | Team | People & Access, Team | Reused data path; S3 restructures the view. |
| products, rules | Products, Rules | Pricing & Products, Products and Applicability | Embedded until S4 moves them. |
| programs, factory-warranty | Benefits, Factory Warranty & CPO | Pricing & Products, Benefits and Warranty programs | Reused as is. |
| incentives | Pricing & Incentives | Pricing & Products, Price rules (plus an unpictured Incentives child) | Embedded until S4 splits it. |
| warranty | Warranty Records | Pricing & Products, Warranty records (unpictured) | Reused as is. |
| passport-ctas | Passport Buttons | Customer Experience, Passport modules | Reused; S5 separates Calls to action. |
| passport-routing | Lead Routing | Customer Experience, Contact & Routing | S5 replaces autosave with Review & Apply. |
| merchandising-seo | Merchandising & SEO | Publishing, Destinations | Reused as is. |
| labels | Label Templates | Documents & Service, Templates | Embedded until S7. |
| print-settings | Printer Calibration | Documents & Service, Print & Calibration | Reused as is. |
| document-rules | Approval & Review Rules | Documents & Service, Approval rules | S7 restructures the view; same writer. |
| getready | Get-Ready Setup | Documents & Service, Service policy | Embedded until S7. |
| inventory | (redirected to Inventory) | Integrations, Inventory feed | Now the feed health tab, per the package route map. |
| audit | Audit Log | Integrations, Activity | Embedded until S8. |
| files | Vehicle Files | Integrations, Vehicle files (unpictured) | Reused as is. |
| features | Plan & Billing | Integrations, Plan & features (unpictured) | Reused as is. |
| invoices | Invoices | Integrations, Invoices (unpictured) | Reused as is; the sidebar row keeps its deep link. |
| analytics, funnel, leads, queue | redirects | standalone screens | Unchanged redirects. |

Standalone Administration routes: `/admin/inventory-sync` becomes an alias of
the feed tab (S8 keeps the page and fixes its last-success query);
`/admin/exceptions`, `/admin/command-center`, `/admin/source-authority`,
`/admin/description-voice`, `/admin/website-embed`, `/admin/specs-backfill`,
`/admin/certification-history`, `/admin/smoke-test` and the addendum icon
library are unchanged and linked from the sections that own their subject.

New child routes: `/admin/people/:memberId`, `/admin/pricing/fee-review`,
`/admin/products/:productId/applicability`,
`/admin/customer-experience/escalation`, `/admin/integrations/runs/:runId`.

## 4. Settings stores observed

Five tenant-scoped settings tables exist beside `dealer_profiles.settings`:
`dealer_settings`, `dealer_passport_settings`, `passport_delivery_settings`,
`dealer_automation_settings`, `dealer_print_settings`. Administration V2
writes only through the writers each legacy panel already used; the
control-consumer matrix names the store for every control so duplicate
editors can be retired deliberately rather than by accident.

## 5. Scheduled jobs observed (22 active, 1 paused)

The feed (`marketcheck-sync`, hourly), the price crawl (daily), the
enrichment sweep (paused since October 27), incentives, specs backfill,
description reconcile, factory sticker and OEM document sweeps, get-ready and
install safety nets, the passport delivery flush and the five-minute lead
escalation, compliance digests and forms sweeps, title reminders, price-drop
re-engagement, CARFAX link and EPA sweeps, intake and ingest sweeps, equipment
proof sweep, packet backfill. Jobs & Pipelines (S8) shows each from the
scheduler's own status and the ledgers; a cron row alone never renders
healthy.

## 6. What this build does not change

The customer Passport at `/v/:slug` and its skeleton; the MarketCheck
reconciliation, provider registry, policy engine and Vehicle Intelligence
modules; the global navigation rail and header (parity is reported for the
Administration content region and for the full frame separately); any
existing migration or live database object (new migrations are prepared and
applied only on authorization).
