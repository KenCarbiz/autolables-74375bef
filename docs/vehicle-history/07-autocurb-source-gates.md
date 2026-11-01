# AutoCurb source-of-truth gates for RooftopOS — evidence audit

**Status: documentation-only / unmerged / no live integration.** This document supplements #47's compatibility audit and is based on static read-only inspection of the **real AutoCurb Lovable app**, project `a2d5c626-83ce-4902-bc12-3d7d08134e23` (display name **Build My App**), on 2026-11-01. AutoCurb's external GitHub remote is not verified and this project is connected to a live backend. No database records were read or modified.

## Verified domain fields and status vocabulary

Source: `src/lib/adminConstants.ts` declares `Submission` with `dealership_id`, `store_location_id`, `id`, `token`, `vin`, `progress_status`, `offered_price`, `estimated_offer_high`, `acv_value`, `appraisal_finalized`, `appraisal_finalized_at`, `appraisal_finalized_by`, `inspection_completed_at`, `check_request_done`, `status_updated_by`, and `status_updated_at`, as well as numerous customer PII fields. The published code also defines the following exact `ALL_STATUS_OPTIONS` values. None of the PII fields belongs in the vehicle event envelope.

| AutoCurb `progress_status` | Meaning supported by source label | Proposed event effect |
|---|---|---|
| `new`, `contacted`, `no_contact`, `partial` | Lead or abandoned state | No authoritative appraisal/acquisition event |
| `offer_accepted`, `price_agreed` | Customer agreement/acceptance | **Not** final appraisal or acquired vehicle |
| `inspection_scheduled`, `inspection_completed`, `manager_approval_inspection` | Inspection workflow | Condition evidence only after separate verification; no title/ownership implication |
| `appraisal_completed` | Final Appraisal Completed | Candidate `appraisal.completed` **only if** `appraisal_finalized=true` with trusted audit/timestamp and completed record |
| `deal_finalized` | Deal Finalized | Transaction progression only; **not** `acquisition.closed` |
| `title_ownership_verified` | Title / Ownership Verified | Separate verification event; not purchase complete |
| `check_request_submitted` | Check Request Submitted | Payment workflow, not purchase complete |
| `purchase_complete` | Purchased | Candidate `acquisition.closed` only with trusted auditable purchase/custody completion evidence, explicit authorized tenant and instance/episode mapping |
| `dead_lead` | Dead Deal | Cancellation/closed-lost, not inventory or sold |

Sources: `src/lib/adminConstants.ts` (exact status list and Submission fields); `src/pages/AppraisalWorkbench.tsx` (sets `sub.acv_value` and `sub.offered_price`; manager appraiser role check), and `supabase/functions/autofilm-crm/index.ts` (existing separate CRM bridge with server-side `tenants.dealership_id` resolution). These are code facts; live production status transitions or database constraints have **not** been inspected or verified.

## Producer responsibilities (proposal requiring independent staging tests)

1. AutoCurb produces acquisition/appraisal **facts**, not AutoLabels' listing price. An accepted offer or an ACV calculation alone cannot emit a completed appraisal. A status set to `purchase_complete` cannot by itself authorize title/custody transfer without a trusted transaction record and server-side tenant determination.
2. Bind the producer to its authenticated dealership ID and mapped store, then resolve VIN + immutable custody instance + episode. A VIN alone is not enough; a previous sale or service visit must never reopen inventory.
3. Enqueue canonical envelope in the same database transaction as the authoritative state change, with immutable source event ID, source aggregate revision, event type, payload hash, and evidence references. Never enqueue off the browser from a UI status display or post-hoc polling alone.
4. Consumer handling from AutoLabels and AutoFilm writes **only** new verified AutoCurb-owned evidence/cache projections; it cannot overwrite appraised ACV, the customer offer, or other original appraisal/finance fields. Inspection complete is distinct from technician-verified MPI completion.
5. Existing `autofilm-crm` customer-lookup/upsert is a **separate PII-purpose integration**. Its x-lookup-secret and customer consent/DNC checks must not be reused or bypassed by the vehicle event channel; no customer names, emails, phones, addresses, documents, finance data or raw binary media in vehicle events.

## Tenant-boundary review item

Static source inspection showed the first VIN lookup in `src/pages/InspectionCheckIn.tsx` reads fields including `name`, `phone`, `email`, and `token` with `WHERE vin = cleanVin` but no explicit `dealership_id` filter, while the last-6 lookup in that same file **does** constrain `dealership_id`. `src/pages/AppraisalWorkbench.tsx` validates a manager/appraiser role then fetches `submissions` by `token` without an explicit `dealership_id` filter. These observations **do not prove a tenant data leak**: Supabase RLS may restrict both queries. Before enabling RooftopOS cross-tenant data, independently audit actual RLS and staff-role tenancy, add explicit tenant scoping where appropriate, and run authenticated one-tenant/two-tenant negative tests in a genuinely isolated backend. Do not test against production customer records.

## Release gates

- [ ] Resolve/verify exact production repo mapping for AutoCurb; avoid assuming `KenCarbiz/hartecash-e85cc4d1` is linked.
- [ ] Choose canonical protocol and explicit signed AutoCurb-to-Gateway translation; Gateway DEV numeric schema differs from AutoLabels PR #46 semver and AutoCurb draft provisional dialect.
- [ ] Verify appraisal finalization and acquisition closing against authoritative persisted transaction transitions, not display labels alone.
- [ ] Add customer-PII denial tests, tenant RLS and role-boundary tests, duplicate/replay/out-of-order tests, sold-then-MPI tests.
- [ ] Prove original AutoFilm/AutoCurb CRM behavior and consent controls are unaffected.
- [ ] Confirm vendor calls, migration execution, endpoint activation and production deployment are separately gated; all new transport OFF until synthetic staging acceptance.

Do **not** merge this review document alone as an integration release; it is a staged architecture evidence record only.