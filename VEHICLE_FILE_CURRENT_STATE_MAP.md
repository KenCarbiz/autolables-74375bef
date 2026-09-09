# VEHICLE FILE — CURRENT STATE MAP (Gate 1, Agent 3)

Repo `KenCarbiz/autolables-74375bef`, HEAD `83baf7cc`, mapped 2026-09-09. Descriptive only; no redesign.

Count scope: unless a figure is marked "all tenants", every count in this map is the pilot tenant (Harte Infiniti, `3f0f97f5-4151-4e32-88ef-e2d6fc5a3142`): 130 active = 130 published = 130 `archived_at IS NULL` listings (live Q17). All tenants: 131 published / 131 non-archived across 2 tenants; the one extra row is VIN `JN8AZ3DB6T9435410` in tenant `93ae75c1-2071-4a5a-95c4-6095de55fe1f` ("AutoLabels.io"), `price` $171.00 (Section 15 item 6). Totals 285 listings / 284 `vehicle_files` (Gate 0 report; Q17).

## Executive summary

1. The internal Vehicle File is one route, `/vehicle-file/:id`, rendered by `src/pages/VehicleFile.tsx` inside `GatedLayout` (`src/App.tsx:353`, `:322`). It has five tabs: Overview, Documents, Get Ready, Customer, Compliance (`VehicleFile.tsx:35-41`); seven legacy tab names alias onto them (`src/components/vehicleFile/types.ts:17-25`).
2. The record is a single `vehicle_listings` row fetched with `select("*")` (`VehicleFile.tsx:88-92`), patched with `vehicle_files.stock_number` (`:105-110`). There is no server-side read model; every tab and every embedded card issues its own Supabase queries with plain `useState`/`useEffect`, not TanStack Query, so nothing is cached or shared between cards.
3. Query fan-out for one vehicle: 15-16 requests on open (Overview), roughly 27 on Documents, 2 on Get Ready, 14-15 on Customer, 28-30 on Compliance — about 89 requests and ~35 distinct tables if all five tabs are visited (Section 5). `vehicle_listings` for the same id is read by 5 distinct reader paths (7 requests over all five tabs, because `useDealRecord` runs three times); the 6-query `useDealRecord` bundle runs 3 separate times; `useVehicleTruth`, `useVehicleSignatures`, `useVehicleEvidence`, `useShopperActivity` each run twice.
4. Of the twelve critical fields, the header and Overview show VIN, year/make/model (as one unsplit `ymm` string), trim, stock, mileage, advertised retail (`vehicle_listings.price`) and condition, all from `vehicle_listings`. MSRP, engine and drivetrain are rendered only inside the Overview `VehicleTruthCard` (through the `factory-sticker-orchestrate` `vehicle_truth` action) and, for MSRP, as a reconciliation pill on the Documents `FactoryStickerCard` (`src/components/vehicle/FactoryStickerCard.tsx:339-345`); the page does hold candidates for all three in `vehicle_listings.mc_attributes` (`msrp`, `base_msrp`, `total_msrp`, `engine`, `drivetrain`; `msrp` present on 128 of 130 pilot active listings) but never renders them. The truth card's `advertised_price` fact is STALE against `vehicle_listings.price` on 99 of the 117 pilot active listings that have one (sample: fact 63,495 observed 2026-08-10 vs price 58,382), with no freshness marker and no conflict raised, and its `Dealer stated` badge is a provenance mislabel: `ingest.ts:135-138` stamps `dealer_confirmed`/`VERIFIED` on values that `marketcheck-sync` wrote (Section 6).
5. Stock number is resolved client-side from seven candidate locations (`src/lib/vehicleStockNumber.ts:32-47`); in the pilot tenant the only populated source is `vehicle_files.stock_number` (130/130 active), the truth engine never reads it, so no `stock_number` fact exists and the truth card's Identity row is permanently empty; `vehicle_listings` has no `stock_number`, `msrp`, `engine`, `drivetrain`, `year`, `make` or `model` column (live `information_schema` query, Section 6).
6. The persistent header answers "what is this" and "what does it cost" but has no truth/freshness state, no named blocker, no owner, and no Truth/AutoFilm/Edit actions (Section 3 vs directive §13).
7. Role handling: no role-aware composition. `RouteCapabilityGuard` has no rule for `/vehicle-file` (`src/components/layout/RouteCapabilityGuard.tsx:14-32`); individual buttons are gated by `hasDealerCapability` and the `compliance_pro` tier. None of the six role home pages links to `/vehicle-file` (grep count 0 in each); they route to the specialist per-vehicle screens (`/service/vehicle/:vin`, `/vin-command/:id`, `/get-ready-command/:id`) or to list pages, so the roles named in directive §45 have no entry path into the Vehicle File today (Section 8).
8. Mobile: one responsive page (Tailwind `sm`/`lg` breakpoints) with a fixed bottom action bar (`VehicleFile.tsx:389`, `z-30`) that shares `bottom-0` with the AppShell bottom nav (`AppShell.tsx:1076`, `z-40`); the shell suppresses its nav only on `/inventory` (`AppShell.tsx:412`), so below `lg` the nav paints over Publish / View shopper page / Copy link — CONFIRMED FROM CODE (Section 9; inspector I3, code change proposed, owner decision). `InventoryMobileRestored` is not routed; `PrepMobile` (`/prep/:vin`) and `ServiceVehicleWorkspace` (`/service/vehicle/:vin`) are separate per-vehicle screens, not Vehicle File variants (Section 9).
9. Timeline surfaces exist as fragments (Get Ready "Stage history", Compliance "Audit evidence", truth-snapshot "What changed", description version history). `vehicle_change_history` (6,703 rows; 628 `price` events) is not read by any client surface; `vehicle_value_history` is read only by the customer Passport (Section 10). There is no single chronology (directive §44: MISSING).
10. Against directive §12, the current IA is: OVERVIEW PRESENT (composition differs from §14), PRICING & MARKET MISSING as an area (its cards live under Compliance), GET READY PRESENT, DOCUMENTS & COMPLIANCE split across two tabs, CUSTOMER & PUBLISHING split between Customer tab, header and Documents tab. The Vehicle Truth workspace is an inline Overview card, not reachable from the header (Section 13).

---

## 1. Route, page component, composition

| Item | Evidence |
|---|---|
| Route | `<Route path="/vehicle-file/:id" element={<VehicleFile />} />` — `src/App.tsx:353`, inside `GatedLayout` (`:322`) = `EntitlementGate` + `AppShell` + `RouteCapabilityGuard` (`src/App.tsx:21-27`) |
| Page | `src/pages/VehicleFile.tsx` (422 lines), lazy-loaded (`src/App.tsx:77`) |
| Tab components | `src/components/vehicleFile/{OverviewTab,DocumentsTab,GetReadyTab,CustomerTab,ComplianceTab}.tsx` |
| Shared shapes | `src/components/vehicleFile/types.ts` (`VehicleRow`, readiness model), `lifecycle.ts` (`useVehicleLifecycle`, rail), `primitives.tsx` (Card, Pair, StatRow, DeepLink, EmptyNote) |
| Tab state | `?tab=` query param kept in sync both directions (`VehicleFile.tsx:61-83`); `resolveTab` maps legacy `deal/labels/addendum/scan -> documents`, `prep -> getready`, `sign/evidence -> compliance` (`types.ts:17-31`) |
| Entry points | InventoryModern rows/actions (`src/pages/InventoryModern.tsx:435,447,449,450,614,647,669,716`), InventoryCommandCenterV2 (`:213-214,412`), CommandPalette (`src/components/layout/CommandPalette.tsx:155`), PrintQueue (`src/pages/PrintQueue.tsx:26-27`), ReadyBoard (`:386`), DealDocumentsPanel self-links (`src/components/vehicle/DealDocumentsPanel.tsx:149,173`), VehicleEvidenceTimeline (`src/components/vehicle/VehicleEvidenceTimeline.tsx:35`) |
| Alternate per-vehicle surfaces (not the Vehicle File) | `/vin-command/:vehicleId` (`src/pages/VinCommandCenter.tsx`, `useVinCommand`), `/get-ready-command/:vehicleId` (`src/pages/GetReadyCommand.tsx`), `/print-center/:vehicleId`, `/factory-sticker/:vehicleId`, `/description-intelligence/:vehicleId`, `/service/vehicle/:vin`, `/prep/:vin`, `/k208/:vin` (`src/App.tsx:354,394,399-406,414,420`) |
| Unused sibling | `src/components/vehicle/VehicleFileConnectedHero.tsx` — no importer found (`grep -rn VehicleFileConnectedHero src`); REVIEW REQUIRED whether it is dead code |
| Recent history | `git log -- src/pages/VehicleFile.tsx`: 5a126a80 2026-09-08 (history facts), 9019de6d/919259ad/24decda3/2a8e1b45/7511c9bd 2026-09-07; `src/components/vehicleFile/`: 1f7745b4 2026-09-09 (evidence links), 4820b87d 2026-09-08 (fee-inclusive compare) |

Page-level hooks (fire on every open, before any tab):

| # | Hook / call | Table | Columns | Filter | File:line |
|---|---|---|---|---|---|
| P1 | `load()` | `vehicle_listings` | `*` | `id = :id`, `maybeSingle` | `VehicleFile.tsx:88-92` |
| P2 | `load()` (after P1) | `vehicle_files` | `stock_number` | `tenant_id = row.tenant_id AND vin = row.vin` | `VehicleFile.tsx:105-110` |
| P3 | `useRecallTask(vin, tenant_id)` | `recall_service_tasks` | id, vin, status, outcome, open_recall_count, employee_name, service_date, ro_number, notes, documents, completed_at | `vin, tenant_id`, newest 1 | `src/hooks/useRecallTask.ts:56-62` |
| P4 | `useVehicleLifecycle(tenant_id, id, condition)` | `vehicle_lifecycle` | state, previous_state, state_changed_at, gate_reason, authorized_at, retail_ready_at, updated_at | `tenant_id, vehicle_id`; skipped when condition is `new` | `src/components/vehicleFile/lifecycle.ts:293-303` |

Page-level derived state: `readinessSummary(vehicle, recall)` (`types.ts:132-162`) — nine boolean checks read from the listing row (created, ymm decoded, published, recall checked, prep signed, documents, service_records, warranty_info, available_accessories) plus the recall task; only "Published" and an open recall task carry `blocks: true`.

---

## 2. Tab-by-tab section map (in render order)

### 2.1 Header (always rendered) — `VehicleFile.tsx:242-359`

| Order | Element | Reads | Writes / actions |
|---|---|---|---|
| 1 | "Back to inventory" | — | `navigate("/inventory")` (`:235-240`) |
| 2 | Photo gallery (prev/next, counter) | `listingGallery(vehicle)` -> `vehicle_listings.photos` (string or `{url}` shapes) else `hero_image_url` (`src/lib/photos.ts:226-230`) | — |
| 3 | Eyebrow `condition · status` | `vehicle_listings.condition`, `.status` (`:279`) | — |
| 4 | H1 `ymm`; trim line | `vehicle_listings.ymm`, `.trim` (`:282-284`) | — |
| 5 | Stock / VIN (+copy) / mileage / price row | `vehicleStockNumber(vehicle)` (`:161`), `vin` (`:301`), `mileage` (`:308`), `price` (`:311`) | Copy VIN (`:181-188`) |
| 6 | `VehicleHistoryFacts` (1-Owner, Clean Title badges) | `mc_attributes`, `certification`, `condition`, `history_report_url` via `historyFactBadges` (`src/components/vehicle/VehicleHistoryFacts.tsx:115-119`, `src/components/listing/TrustStrip.tsx:59-66`) | link to `history_report_url` |
| 7 | Action stack | `status === "published"` | Publish (`vehicle_listings.update({status:'published', published_at})`, `:198-201`; blocked client-side by `recall.blocking`, server-side by `prep_gate_blocked` / `recall_gate_blocked` errors `:208-212`), View shopper page (`/v3/{VIN}`), Generate document (switches to Documents tab), Copy shopper link (`/v/{VIN}`) |
| 8 | Three chips | Lifecycle stage (`vehicle_lifecycle.state` -> `STATE_LABEL`, `:163-169`), Retail readiness (`readinessLabel`, `:354`), Digital status (`status`, `:355`) | — |

Not in the header: MSRP, engine, drivetrain, market value, truth/freshness status, named blocker, owner, next action, DOM.

### 2.2 Overview tab — `src/components/vehicleFile/OverviewTab.tsx`

| Order | Card | Component | Queries issued (on mount) | Reads | Writes / actions |
|---|---|---|---|---|---|
| 1 | Status | inline (`:109-158`) | none (uses P3/P4) | lifecycle state/owner/time-in-stage (`STATE_LABEL/STATE_OWNER/STATE_NEXT_ACTION`, `src/lib/lifecycle/states.ts`), `status`, readiness blockers | DeepLink `/get-ready-command/:id` (tracked only) |
| 2 | Vehicle information | inline (`:160-168`) | none | VIN, ymm, trim, stock, condition, mileage, price, created_at, `enriched_at` ("Last inventory sync") | "Re-pull market data" -> `functions.invoke("vehicle-enrich", {tenant_id, vin})` (`:89-91`) then `onReload()` |
| 3 | Description | `DescriptionCard` -> `useDescriptionCase` | O3-O11 (see Section 5) | `description_cases` status/eligibility/fact_confidence, published version text, exceptions | Edit (`/description-intelligence/:id`), Regenerate -> `functions.invoke("description-orchestrate", {action:"regenerate"})` (`src/hooks/useDescriptionOps.ts:265-267`), History toggle |
| 4 | Media | inline (`:172-199`) | none | photo/video counts, first 16 photos | "Manage packet" -> Documents tab |
| 5 | Vehicle Truth | `src/components/vehicle/VehicleTruthCard.tsx` -> `useVehicleTruth` | O12: `functions.invoke("factory-sticker-orchestrate", {action:"vehicle_truth"})` (`src/hooks/useVehicleTruth.ts:70-72`) | snapshot version, facts grouped Identity/Mechanical/Appearance/Manufacturer pricing/Dealership/Equipment (`:45-52`), status badge per fact (`:80-86`; `Dealer stated` = `source_kind dealer_confirmed`, which `src/lib/vehicleTruth/ingest.ts:135-138` stamps on condition/mileage/advertised_price/stock_number from the listing row regardless of which writer populated the column, Section 6), blocking conflicts, sources list, material changes; `observed_at`/`evidence` not rendered | Rebuild -> `invoke(..., {action:"refresh_truth"})` (`useVehicleTruth.ts:98-100`), which server-side rewrites `vehicle_facts`, `vehicle_fact_conflicts`, `vehicle_exceptions`, `vehicle_snapshots`, `stale_document_flags` (Section 7) |
| 6 | Customer interest | inline + `useCustomerInterest` (`:19-49`) | O1 `audit_log` (`created_at`, `action='listing_viewed'`, `or(entity_id, details->>vin, details->>slug)`, newest 1); O2 `leads` count head (`vehicle_vin`) | `view_count` (listing), last view, lead count | "Open Customer" tab |
| 7 | Website ad link | inline (`:217-226`) | none | `source_url` | `window.open(source_url)` |

### 2.3 Documents tab — `src/components/vehicleFile/DocumentsTab.tsx`

| Order | Section (`id`) | Component | Queries on mount | Writes / actions |
|---|---|---|---|---|
| 0 | "Generate document" picker | inline (`:66-114`) | none | scroll-to or navigate to builders (`/used-car-sticker?vehicleId`, `/addendum-label/:id`, `/cpo-sheet?vehicleId`, `?tab=compliance`) |
| 1 | OEM window sticker (build record) `vf-doc-oem` | `src/components/vehicle/FactoryStickerCard.tsx` | D1 `factory_sticker_records` (15 cols, `tenant_id, vehicle_id`, `:140-143`); D2 `generated_documents` by `current_document_id` (`:148-152`) and D3 `factory-sticker-orchestrate` document-assets invoke (`:175-187` via `useWindowSticker.documentAssets`) both fire only when `current_document_id` exists | Regenerate (`invoke factory-sticker-orchestrate`, `:203`), version history drawer (`StickerVersionHistory`, mounted only when opened `:414`, one more invoke `StickerVersionHistory.tsx:40-50`) |
| 2 | Official forms & deal documents `vf-doc-forms` | `src/components/vehicle/DealDocumentsPanel.tsx` -> `useDealRecord` | D4-D9 (6 queries, `src/hooks/useDealRecord.ts:33-41`): `vehicle_listings(id,condition,deal_processed_at)`, `addendums`, `safety_inspections`, `get_ready_records`, `detail_signoffs`, `generated_documents(buyers_guide)` | Fill official forms / Official PDF -> `invoke("generate-vehicle-forms")` (`:76,97`); Certify K-208 -> `rpc("certify_safety_inspection")` (`:52-55`) |
| 3 | Stickers & labels `vf-doc-stickers` | `StickerGenerators.tsx` (2× `TemplateSlotRow`, defined `:18`, mounted `:119-120`) | D10-D13: each row instance runs `useStickerCatalog` (`:21` -> `sticker_templates`, `src/lib/stickerStudio/useStickerCatalog.ts:17-25`) and `useStickerPrefs` (`:22` -> `dealer_sticker_template_prefs`, `useStickerPrefs.ts:23-31`) with no shared cache — 4 queries | "Set store default" -> `DealerSettings.updateSettings({label_defaults})` (`:60`) -> `rpc merge_dealer_settings`; Generate -> navigate to builder |
| 4 | Addendum `vf-doc-addendum` | `AddendumSection.tsx` | D14 `addendums` (`vehicle_vin`, 50, `:120-124`, fallback select `:127-129`); D15 `install_proofs(verified_at,is_verified)` (`:137-138`) | Accept -> `rpc("accept_addendum")` (`:159`), then `invoke("notify-getready")` + `rpc("mark_addendum_getready_dispatched")` (`:164-168`); copy signing link; open builder |
| 5 | Brochure finder / Owner's manual finder | `OemDocFinders.tsx` (2 rows) | D16-D21: `useOemDocState` per row = 3 reads (`src/lib/oem/resolveOemDocLink.ts:82,116,160`: OEM doc table by kind, `oem_hosted_documents`, `oem_document_copy_attempts`) — 6 queries | Search -> `functions.invoke(fn, {make, model, year})` (`:110`) |
| 6 | Uploads & links `vf-doc-uploads` | `DocumentUploads.tsx` | none | Upload -> Storage `vehicle-docs` + `createSignedUrl` + `rpc("append_vehicle_document")` (`:243-266`); Add link -> same RPC (`:216-219`); Remove -> `rpc("remove_vehicle_document")` (`:227-229`) |
| 7 | Generated documents, versions & print history `vf-doc-generated` | `src/components/vehicle/GeneratedDocumentsSection.tsx` | D22 `useVehicleDocuments` (`generated_documents`, `useVehicleDocuments.ts:20`); D23-24 `useVehicleQrScans` (`qr_scan_events`, `useQrAnalytics.ts:122-125`; `qr_codes` at `:130-131` only when scan rows exist — the pilot tenant has 0 `qr_scan_events`, so D24 never fires there); D25 `useVehicleStaleFlags` (`stale_document_flags`, `useStaleFlags.ts:57`); D26-27 `reconcileVehicleStale` (`vehicle_listings *` + `generated_documents`, `staleDetection.ts:71-72`, then one `stale_document_flags` delete per live document `:82` and an insert when findings exist `:85`) and a `reloadStale` re-read; per-document asset refresh via `fetchFiledDocumentAssets` (edge invoke; count UNKNOWN, one per document) | document actions gated by `allowedActions(status, manager)` and dealer document rules (`:76-81`) |
| 8 | Shopper packet / Service history / Remaining factory warranty / Available accessories `vf-doc-packet` | `PassportPacketSection.tsx` | none (reads listing row + `DealerSettingsContext`) | "Save packet" -> `vehicle_listings.update({service_records, warranty_info, available_accessories, packet_modules, suppressed_programs, passport_version})` with schema-error fallbacks (`:50-62`) |

### 2.4 Get Ready tab — `src/components/vehicleFile/GetReadyTab.tsx`

| Order | Card | Queries on mount | Reads | Writes / actions |
|---|---|---|---|---|
| 0 | New-stock empty state (condition `new`) | none | `tracked` | DeepLinks `/prep/:vin`, `?tab=compliance` |
| 1 | Off-rail banner | none | `vehicle_lifecycle.state in ON_HOLD/WHOLESALE/REMOVED`, `gate_reason` | — |
| 2 | Stage rail (Intake/Service/Recon/Prep/Verified/Ready) | none | `RAIL` grouping of the 22 states (`lifecycle.ts:216-250`) | — |
| 3 | Current stage | none | state, owner, time in stage, since, next action, blocker (`gate_reason`) | — |
| 4 | Publishing gate | G1 `prep_sign_offs` (13 cols, `vin`, 20 newest, `:131-133`) | `listing_unlocked`, `foreman_name`, `signed_at` | — |
| 5 | Prep & install records | (G1) | per-row status, installs, photos | Open -> `/prep/:vin` |
| 6 | Stage history | G2 `audit_log` (`action='vehicle_lifecycle_gate_set'`, `entity_id = vin`, 25, `:134-138`) + `previous_state` | manager gate events | — |
| 7 | Work the specialist screens | none | — | DeepLinks: `/get-ready-command/:id`, `/service/vehicle/:vin`, `/k208/:vin`, `/recon`, `/prep/:vin`, `/ready-board` |

No write to `vehicle_lifecycle` from this tab (the row is written only by `recompute_vehicle_lifecycle` / `set_vehicle_lifecycle_gate`, `lifecycle.ts:183-187`).

### 2.5 Customer tab — `src/components/vehicleFile/CustomerTab.tsx`

| Order | Card | Queries on mount | Reads | Writes / actions |
|---|---|---|---|---|
| — | tab header | C1 `vehicle_files(id, customer_info, sold_at)` by `vehicle_file_id` or `tenant_id+vin` (`:90-94`); C2 `leads` (9 cols, `vehicle_vin`, 50, `:111-116`); C3-C6 `useShopperActivity` (`passport_engagement`, `customer_engagement_events`, `leads`, `qr_scan_events`; `src/hooks/useShopperActivity.ts:76-119`) + C7 phase-2 `customer_engagement_events` by visitor ids (`:140-147`); C8-C9 `useVehicleSignatures` (`deal_signing_tokens` by `vehicle_payload->>vin`, `addendum_signings` by `vin`; `SignaturesSection.tsx:47-57`); C10-C15 `useDealRecord` (6, via `DealProgressPanel`) | | "Shopper activity" opens `ShopperActivityDrawer` (Sheet), which runs `useShopperActivity` again with `enabled: open` |
| 1 | Interested customers | (C2) | leads list, response state | — |
| 2 | Assigned salesperson | none | `routed_agent_id` presence only; states no assignment exists (`:202-212`) | — |
| 3 | Engagement | (C3-C7) | views/sessions/returns/time, last seen, CTA clicks, lead forms | — |
| 4 | Passport, sticker, payment & trade activity | (C3-C7) | event counts by `ACTIVITY_GROUPS` (`:61-69`) | — |
| 5 | Deal flow | `src/components/vehicle/DealProgressPanel.tsx` | (C10-C15) five-stage rail from `deriveFlow`, next action | "Process this deal" -> `invoke("process-deal")` (`:39`) |
| 6 | Signatures | (C8-C9) | counts | — |
| 7 | Sold-to record | (C1) | buyer / co-buyer / sold date | Save -> `vehicle_files.upsert({tenant_id, vin, customer_info, sold_at, customer_*, cobuyer_*}, onConflict tenant_id,vin)` (`:136-147`) |

### 2.6 Compliance tab — `src/components/vehicleFile/ComplianceTab.tsx`

| Order | Card | Component | Queries on mount | Writes / actions |
|---|---|---|---|---|
| — | tab header | | K1-K2 `useVehicleSignatures` (dup of C8-C9); K3-K7 `useVehicleEvidence` (`src/lib/stickerStudio/useVehicleEvidence.ts:45-51`: `generated_documents` by vehicle_id, `qr_scan_events` 25, `addendums` by vin, `vehicle_listings(created_at, ymm)`, `audit_log` store-wide newest 400 then filtered client-side); K8 `useVehicleTruth` invoke (dup of O12) | "Build VIN defense packet" -> client-side JSON download (`:114-170`), no write |
| 1 | Compliance status | inline | none | readiness list; "blocks publish" tags |
| 2 | Advertised price consistency | `PriceIntegrityCard.tsx` `AdvertisedPriceCard` | K9 `advertised_prices` (advertised_price, source_channel, source_url, captured_at, screenshot_url, screenshot_bucket; `tenant_id, vin`, 100 newest, `:41-47`) | Open source_url; "Evidence" -> `signPriceEvidenceUrl` signed URL on private `price-evidence` bucket (`:70-79`, `src/lib/evidence/priceEvidenceUrl.ts:56-75`) |
| 3 | Market position | `PriceIntegrityCard.tsx` `MarketPositionCard` | none (reads `market_value`, `market_position`, `market_payload.source`, `comparables`) | "Check market price" -> `invoke("marketcheck-market-pricing")` (`:178`); result held in component state only, not reloaded from DB |
| 4 | Recall | `RecallCard.tsx` | none (reads `recall_status`, `recall_checked_at`, `open_recall_count`, `recall_payload`) | "Run recall check" -> `invoke("marketcheck-recalls")` (`:130`); details Sheet with `RecallReviewActions` -> `rpc("submit_recall_service_outcome")` (`useRecallTask.ts:74-82`) + Storage `service-docs` upload (`:34`) |
| 5 | Buyers Guide & safety inspection | `OfficialFormsCard` -> `useDealRecord` | K10-K15 (6, third instance) | "Open Documents" |
| 6 | Delivery sign-offs | `src/components/vehicle/DeliverySignoffs.tsx` | K16-K20: `safety_inspections`, `prep_sign_offs`, `detail_signoffs`, `install_proofs`, `recall_service_tasks` (`:42-46`) | read-only |
| 7 | Signatures (audit trail) | `SignaturesSection.tsx` | (K1-K2) | — |
| 8 | Install proof | `src/components/admin/InstallProofList.tsx` | K21 `install_proofs` by `vehicle_vin` (`:37-41`) + one signed URL per photo (`install-proofs` bucket) | — |
| 9 | Title / MCO | `src/components/vehicle/TitleMcoPanel.tsx` | K22 `vehicle_documents(doc_type,url,created_at)` (`:36-40`) | email title request -> `invoke("email-title-request")` (`:55`); signed URL on open |
| 10 | Title verification (NMVTIS) | `src/components/vehicle/TitleVerificationPanel.tsx` | K23 `invoke("marketcheck-title-report", {action:"load"})` on mount for non-new vehicles regardless of `enabled` (`:77-86`; mounted unconditionally `ComplianceTab.tsx:228-236`). `load` is a stats read only (`supabase/functions/marketcheck-title-report/index.ts:175-178` returns `pullStats()`; no VINData call, no charge); `generate` is the billed path (`:189-203`) | view/generate (`:93`, $0.49 confirm), attest -> `vehicle_listings.update({title_verification})` (`:124,135`) |
| 11 | Vehicle truth conflicts | `TruthConflictsCard` | (K8) | — |
| 12 | Audit evidence | `src/components/vehicle/VehicleEvidenceTimeline.tsx` (rendered only when `events.length > 0`) | K24-K28 `useVehicleEvidence` AGAIN (own instance, `:27`); K29 `VehicleCtMvpStatusCard` -> `ct_mvp_certification_runs` (`:38-45`) | category filter, raw-JSON expander, "Export evidence packet" (FeatureGate `evidence_packet_export`) + `logStickerAudit` write to `audit_log` |

---

## 3. Persistent header vs directive §13

| §13 question | Present? | Evidence |
|---|---|---|
| What is this? | PRESENT — `ymm`, `trim`, stock, VIN, mileage, condition | `VehicleFile.tsx:279-311` |
| What does it cost? | PARTIAL — single `vehicle_listings.price`; no MSRP, discount, doc fee, total | `:311` |
| Is the data trustworthy/current? | MISSING — no truth status, freshness or source stamp in the header; `enriched_at` appears only on Overview "Last inventory sync" (`OverviewTab.tsx:76`) | — |
| Where in the lifecycle? | PRESENT — "Lifecycle stage" chip | `:353` |
| What is blocking it? | PARTIAL — "Retail readiness" chip says `NOT READY - n BLOCKERS` without naming the blocker | `:354`, `types.ts:168-176` |
| Who owns the next action? | MISSING in header (present on Overview Status card via `STATE_OWNER`, `OverviewTab.tsx:119`) | — |
| Actions | Publish / View shopper page, Generate document, Copy shopper link, Copy VIN. No Edit, Truth, AutoFilm, Documents-as-action-menu, More | `:318-349` |

The header is not sticky; it scrolls with the page (`section` at `:242`, no `sticky`). The AppShell supplies its own chrome: desktop `h-16` header (`src/components/layout/AppShell.tsx:810`), mobile header with store switcher (`:737`), and mobile bottom nav (`:1076`, items at `:577-581`).

---

## 4. Loading, skeleton and error behaviour

| State | Behaviour | Evidence |
|---|---|---|
| Initial load | Whole page replaced by a centered spinner until `vehicle_listings` returns; no skeleton mirroring the layout (`Skeleton` not imported anywhere under `src/components/vehicleFile`) | `VehicleFile.tsx:131-137` |
| Stock number | Header renders first with "Stock # not on the feed" if `mc_attributes` lacks it, then re-renders when `vehicle_files.stock_number` arrives (second await) | `:104-113`, `:291-298` |
| Not found / RLS denied | "Vehicle not found" card with Back button (error and null both map to `notFound`) | `:93-97`, `:139-155` |
| Per-card loading | Each card shows its own text ("Reading lifecycle…", "Loading the description record…", "Loading captured prices…", "Loading engagement…", "Loading the deal record…") and paints independently | e.g. `OverviewTab.tsx:117,207`, `PriceIntegrityCard.tsx:96`, `ComplianceTab.tsx:63`, `GetReadyTab.tsx:193` |
| Reload after write | `onReload` re-runs the page `load()` (P1+P2) only; child hooks re-run on their own dependency changes, so a header publish does not refresh e.g. `useDealRecord` | `VehicleFile.tsx:85-116`, `:203` |
| Realtime | none in the Vehicle File (no `useRealtimeInvalidate` / `.channel(` under `src/components/vehicleFile`; grep) | — |
| Tab switching | Tabs are conditionally rendered (`:382-386`), so leaving a tab unmounts it and returning re-issues every query | — |

Contrast: the locked customer Passport has an owner-approved layout-mirroring skeleton (CLAUDE.md, `VehiclePassportGoverned.tsx`); the Vehicle File has none.

---

## 5. Query fan-out for one vehicle

Counting browser requests to Supabase (PostgREST rows, RPCs, edge functions, Storage) issued by the Vehicle File and its descendants. Shell/provider queries that run once per session (`TenantContext`, `DealerSettingsContext`, `useEntitlements`: `tenant_members`, `tenants`, `onboarding_profiles`, `app_entitlements`, `dealer_profiles`) are excluded. Sample vehicle for row sizes: pilot tenant, most recently updated published listing, VIN tail `358865` (live query, Section 16).

### 5.1 On open (Overview tab, default)

| # | Request | Hook / component | Table or function | Notes |
|---|---|---|---|---|
| 1 | `vehicle_listings` `*` by id | `VehicleFile.load` | `vehicle_listings` | the record |
| 2 | `vehicle_files.stock_number` | `VehicleFile.load` | `vehicle_files` | sequential after 1 |
| 3 | `recall_service_tasks` newest | `useRecallTask` | `recall_service_tasks` | |
| 4 | `vehicle_lifecycle` | `useVehicleLifecycle` | `vehicle_lifecycle` | used/CPO only (sample: 0 rows; 173 rows tenant-wide) |
| 5 | `audit_log` listing_viewed newest 1 | `useCustomerInterest` | `audit_log` | `or()` on entity_id / details->>vin / details->>slug; 1,414 such rows |
| 6 | `leads` count | `useCustomerInterest` | `leads` | head count |
| 7 | `vehicle_listings` `*` by id (DUPLICATE of 1) | `useDescriptionCase` | `vehicle_listings` | `useDescriptionOps.ts:220-221` |
| 8 | `description_cases` | `useDescriptionCase` | `description_cases` | sequential |
| 9 | `description_settings` | `useDescriptionCase` | `description_settings` | sequential |
| 10-15 | versions, channel_versions, validation_results, exceptions, fact_snapshots, deliveries | `useDescriptionCase` | six `description_*` tables | parallel, only when a case exists (278 cases tenant-wide) |
| 16 | `factory-sticker-orchestrate` `vehicle_truth` | `useVehicleTruth` (VehicleTruthCard) | edge function | returns snapshot + facts + conflicts + sources |

Total on open: 15 (new vehicle) / 16 (used vehicle with a description case). Three of the description reads are sequential (7 -> 8 -> 9 -> 10-15), so the Description card paints after four round trips.

### 5.2 Per tab (each visit re-issues)

| Tab | Requests | Distinct tables/functions | Duplicates of something already fetched |
|---|---|---|---|
| Documents | ~27 (25 unconditional; D2/D3 only when a current sticker document exists, D24 only when scans exist, plus one `stale_document_flags` delete per live document; sample vehicle = 28) + one asset invoke per generated document | factory_sticker_records, generated_documents (x4 readers), factory-sticker-orchestrate, vehicle_listings (x2), addendums, safety_inspections, get_ready_records, detail_signoffs, sticker_templates (x2), dealer_sticker_template_prefs (x2), install_proofs, OEM doc tables (x3 kinds x2), qr_scan_events, qr_codes, stale_document_flags (x2) | `vehicle_listings` twice more (D4, D26); `generated_documents` four times with different filters |
| Get Ready | 2 | prep_sign_offs, audit_log | — |
| Customer | 14-15 (+4-5 when the drawer opens) | vehicle_files, leads (x2), passport_engagement, customer_engagement_events (x2), qr_scan_events, deal_signing_tokens, addendum_signings, + the 6-table `useDealRecord` bundle | `leads` by VIN read twice on this tab (three times per page including Overview); `useDealRecord` second instance |
| Compliance | 28-30 | advertised_prices, generated_documents, qr_scan_events, addendums, vehicle_listings, audit_log (store-wide 400), safety_inspections, prep_sign_offs, detail_signoffs, install_proofs (x2), recall_service_tasks, vehicle_documents, ct_mvp_certification_runs, marketcheck-title-report, factory-sticker-orchestrate, + `useDealRecord` bundle | `useVehicleEvidence` runs twice (ComplianceTab + VehicleEvidenceTimeline); `useVehicleSignatures` again; `useVehicleTruth` again; `useDealRecord` third instance; `recall_service_tasks` and `prep_sign_offs` again |

All five tabs visited once: about 89 requests; ~35 distinct tables plus 4 edge functions (`factory-sticker-orchestrate`, `marketcheck-title-report`, description/document asset invokes) and 2 Storage buckets on read (`install-proofs`, `price-evidence`).

### 5.3 Duplicate read paths (input to DUPLICATE_READ_PATHS)

| Data | Readers of the same row(s) | Files |
|---|---|---|
| `vehicle_listings` by id | 5 reader paths, 7 requests over a full visit: page load; `useDescriptionCase`; `useDealRecord` (x3 by tenant+vin, narrow columns); `useVehicleEvidence`; `reconcileVehicleStale` | `VehicleFile.tsx:88`; `useDescriptionOps.ts:220`; `useDealRecord.ts:34`; `useVehicleEvidence.ts:49`; `staleDetection.ts:71` |
| `useDealRecord` 6-query bundle | 3 instances: DealDocumentsPanel (Documents), DealProgressPanel (Customer), OfficialFormsCard (Compliance) | `DealDocumentsPanel.tsx:35`; `DealProgressPanel.tsx:32`; `ComplianceTab.tsx:61` |
| `useVehicleTruth` edge call | 2: VehicleTruthCard (Overview), ComplianceTab | `OverviewTab.tsx:201`; `ComplianceTab.tsx:106` |
| `useVehicleSignatures` (2 queries) | 2: CustomerTab, ComplianceTab | `CustomerTab.tsx:85`; `ComplianceTab.tsx:104` |
| `useVehicleEvidence` (5 queries incl. 400 audit rows) | 2: ComplianceTab, VehicleEvidenceTimeline | `ComplianceTab.tsx:105`; `VehicleEvidenceTimeline.tsx:27` |
| `useShopperActivity` (4-5 queries) | 2: CustomerTab, ShopperActivityDrawer | `CustomerTab.tsx:82`; `ShopperActivityDrawer.tsx:66` |
| `leads` by VIN | 3: Overview count, CustomerTab list, useShopperActivity | `OverviewTab.tsx:34`; `CustomerTab.tsx:111`; `useShopperActivity.ts:93` |
| `recall_service_tasks` | 2: useRecallTask, DeliverySignoffs | `useRecallTask.ts:56`; `DeliverySignoffs.tsx:46` |
| `prep_sign_offs` | 2: GetReadyTab, DeliverySignoffs | `GetReadyTab.tsx:131`; `DeliverySignoffs.tsx:43` |
| `install_proofs` | 3: AddendumSection, DeliverySignoffs, InstallProofList | `AddendumSection.tsx:137`; `DeliverySignoffs.tsx:45`; `InstallProofList.tsx:37` |
| `addendums` by VIN | 3: AddendumSection, useDealRecord, useVehicleEvidence | `AddendumSection.tsx:120`; `useDealRecord.ts:35`; `useVehicleEvidence.ts:48` |
| `generated_documents` by vehicle | 5: FactoryStickerCard, useDealRecord, useVehicleDocuments, reconcileVehicleStale, useVehicleEvidence | as above |
| `sticker_templates` + `dealer_sticker_template_prefs` | 2 each (one per `TemplateSlotRow` instance) | `StickerGenerators.tsx:18-22, 119-120` |
| `audit_log` | 3 different filters: listing_viewed (or-filter), gate_set by `entity_id=vin`, store-wide newest 400 filtered in JS (`store_id` is `text`; pilot tenant has 9,790 rows). The matcher (`useVehicleEvidence.ts:80`) tests only `entity_id === vehicleId`, document ids and `details.vehicle_id`, never `details.vin` or `factory_sticker_record` entity ids; the sample vehicle matched 0 rows although 13 rows reference it by `details->>vin` (6 inside the window at ranks 342-347, 7 outside at 5,937-5,943; live Q10) | `OverviewTab.tsx:28`; `GetReadyTab.tsx:134`; `useVehicleEvidence.ts:50` |

### 5.4 Payload and index coverage (added after Gate 1 inspection, I3)

The fan-out counts above are request counts; this table weighs the duplicated payloads and checks whether the filters the Vehicle File issues can use an index. All figures live, pilot tenant, 2026-09-09 (Q13-Q15).

| Read | Measured weight | Readers (`select`) | Index available for the filter | Consequence |
|---|---|---|---|---|
| `vehicle_listings` row by id | avg 21.1 KB, max 29.0 KB per pilot active row; `mc_attributes` alone avg 11.1 KB (Q13, n = 130) | `select('*')` three times per Overview + Documents visit: `VehicleFile.tsx:88-92`, `useDescriptionOps.ts:220-221`, `staleDetection.ts:71` (the `useDealRecord`/`useVehicleEvidence` reads project narrow columns) | primary key — fine | about 63 KB of duplicate payload per car per visit, of which about 33 KB is `mc_attributes` that no section renders (Section 6) |
| `audit_log` store-wide newest 400 (`useVehicleEvidence.ts:50`) | avg row 539 B (inspector measured 570 B a few hours earlier; the table grows continuously); pilot newest-400 tail = 254 KB (Q14) | fetched twice per Compliance visit (`ComplianceTab.tsx:105`, `VehicleEvidenceTimeline.tsx:27`) — about 0.5 MB — to surface 0 matched events for the sample vehicle (Q10) | `idx_audit_store_created (store_id, created_at DESC)` serves the tail read itself | the payload, not the scan, is the cost; the matcher then discards it (Section 15 item 8) |
| `audit_log` listing_viewed `or(entity_id, details->>vin, details->>slug)` (`OverviewTab.tsx:28-34`) | 1,414 `listing_viewed` rows of 11,602 total (Q14) | Overview, every open | NONE: indexes are `created_at`, `(entity_type, entity_id)`, `store_id`, `(store_id, created_at)`, `row_hash`, `user_id` (Q15); no index covers `action` or `details->>'vin'`/`details->>'slug'` | sequential scan over a continuously growing table on every Vehicle File open |
| `audit_log` `action='vehicle_lifecycle_gate_set' AND entity_id = vin` (`GetReadyTab.tsx:134-138`) | 0 matching rows live (Q3) | Get Ready tab | `(entity_type, entity_id)` cannot be used because the filter omits `entity_type`; no index on `action` (Q15) | sequential scan |
| `qr_scan_events` by `vehicle_id` | 0 rows in the pilot tenant (Q3) | three readers: `useVehicleEvidence.ts:47`, `useShopperActivity.ts:108-113` (`tenant_id` + `vehicle_id`, limit 2000), `useQrAnalytics.ts:122-125` | indexes are `code`, `(tenant_id, scanned_at DESC)`, pk (Q15); no `vehicle_id` index | harmless today (0 rows); scan cost grows with scan volume |
| `vehicle_change_history` by tenant + VIN | 12 rows for the sample (Q5) | no client reader (Section 10) | `(tenant_id, vin, changed_at DESC)` exists (Q15) | the indexed chronology source the Vehicle File does not use |
| `vehicle_value_history` by VIN | 11 rows for the sample (Q5) | Passport only (Section 10) | `(vin, captured_at DESC)` exists (Q15) | same |
| `advertised_prices` by tenant + VIN (`PriceIntegrityCard.tsx:41-47`) | 1 row for the sample (Q5) | Compliance | `(tenant_id, vin, captured_at DESC)` and `(tenant_id, upper(vin), captured_at DESC)` exist (Q15) | fine |
| `customer_engagement_events` / `passport_engagement` | 1,994 / 578 tenant rows (Q3) | `useShopperActivity` (x2) | `(vehicle_id, occurred_at DESC)`, `(vin, occurred_at DESC)` / `(tenant_id, vin)` exist (Q15) | fine |
| `vehicle_facts` by vehicle | 19 rows for the sample (Q5) | edge fn only | `(vehicle_id, fact_key)` and unique `(vehicle_id, fact_key, source_kind)` exist (Q15) | fine |

Inspector finding — code change proposed (owner decision), I3: (a) the Vehicle File and its hooks should project named columns instead of `select('*')` on `vehicle_listings` and return `mc_attributes` sub-objects only where a section needs them; (b) `recentChanges`/timeline reads should come from `vehicle_change_history` and `vehicle_value_history` (both indexed) and from `audit_log` only through `(entity_type, entity_id)`; (c) MIGRATION proposed: if per-VIN `audit_log` reads by `details->>'vin'` are required, add an expression index `(store_id, (details->>'vin'))` first, and consider a `vehicle_id` index on `qr_scan_events`. None of this is implemented here; it is carried into Section 17 and must also be added to `DUPLICATE_READ_PATHS.md` section G.

---

## 6. The twelve critical fields — what each surface shows and from where

Live `information_schema.columns` for `vehicle_listings` (project `onnbmmdbrsgytfozfozn`, 2026-09-09) confirms the columns `vin, ymm, trim, condition, mileage, price, advertised_price_before_doc, website_sale_price, doc_fee, dealer_discount, retail_cash, key_specs` exist and `stock_number, engine, drivetrain, msrp, year, make, model` do NOT. `vehicle_files` has `year, make, model, trim, stock_number, mileage, msrp, market_value, condition` (`src/integrations/supabase/types.ts` vehicle_files Row). `vehicle_facts` fact keys present live (all tenants; pilot-only in parentheses): `advertised_price` 248 (247), `base_msrp` 260 (259), `total_msrp` 260 (259), `condition` 260 (259), `drivetrain` 260 (259), `engine` 256 (255), `make` 259 (258), `model` 259 (258), `model_year` 259 (258), `mileage` 205 (205), `trim` 258 (257); no `stock_number` or `vin` fact rows; 0 `(vehicle_id, fact_key)` pairs with more than one row. `vehicle_listings.mc_attributes` on the sample vehicle carries `msrp, base_msrp, total_msrp, engine, engine_size, drivetrain, transmission, year, make, model, dom, dom_180, dom_active, ref_price, in_transit` (live Q8); of 130 pilot active listings, 128 have `mc_attributes.msrp`, 127 `engine`, 129 `drivetrain`, 128 `dom`. The truth engine itself derives `engine`/`drivetrain` from these keys (`src/lib/vehicleTruth/ingest.ts:151-153`), so the page holds the candidates it does not render.

| Field | Header | Overview "Vehicle information" | VehicleTruthCard (Overview) | Other Vehicle File surfaces | Source column/table actually read |
|---|---|---|---|---|---|
| VIN | yes (`:301`) | yes (`OverviewTab.tsx:68`) | no fact row (none in `vehicle_facts`) | every child keys by `vehicle.vin` | `vehicle_listings.vin` |
| Year | inside `ymm` string (`:282`) | inside `ymm` (`:69`) | `model_year` fact | `OemDocFinders` parses `ymm` token 0 (`:36`) | `vehicle_listings.ymm` (unsplit); `vehicle_facts.model_year` via edge fn; `vehicle_files.year` NOT read |
| Make | inside `ymm` | inside `ymm` | `make` fact | `OemDocFinders` token 1 (`:37`) | as above; `vehicle_files.make` NOT read |
| Model | inside `ymm` | inside `ymm` | `model` fact | `OemDocFinders` tokens 2+ (`:38`) | as above; `vehicle_files.model` NOT read |
| Trim | yes (`:284`) | yes (`:70`) | `trim` fact | ShopperActivityDrawer title | `vehicle_listings.trim` |
| Stock | yes via `vehicleStockNumber` (`:161,291-298`) | yes (`:71`) | key listed in Identity group (`VehicleTruthCard.tsx:46`) but no fact exists live — READER MISSING: `ingest.ts:138` builds the fact from `listing.stock_number ?? mc.stock_no`; `refresh_truth` passes `vehicle_listings select('*')` (`factory-sticker-orchestrate/index.ts:1593-1594`), which has no `stock_number` column (Q2), `mc_attributes.stock_no` is null on all 131 non-archived listings, and nothing under `factory-sticker-orchestrate/` reads `vehicle_files` (grep; only `truth.ts:445`, same null), so the Identity row is permanently empty | CustomerTab drawer `stock` | precedence `mc_attributes.stock_no` > `mc_attributes.dealer.stock_no` > `vehicle_files.stock_number` (P2) > `sticker_snapshot.stock_number` > `.stock` > `sticker_snapshot.decoded.stock_number` > `.stock` (`src/lib/vehicleStockNumber.ts:32-47`). Effective source in the pilot tenant is `vehicle_files.stock_number` for 130/130 active vehicles (`mc_attributes.stock_no`, `mc_attributes.dealer.stock_no` and `sticker_snapshot.stock_number` are null on all non-archived listings; `vehicle_files.stock_number` populated 284/284; live Q9), written by `supabase/functions/marketcheck-sync/index.ts:1020` and `supabase/functions/crawl-advertised-prices/index.ts:1497` |
| Mileage | yes (`:308`) | yes (`:73`) | `mileage` fact | MarketPositionCard comp-miles note (`PriceIntegrityCard.tsx:239`) | `vehicle_listings.mileage` |
| Advertised retail | yes (`:311`) | yes "Advertised price" (`:74`) | `advertised_price` fact | AdvertisedPriceCard "Lot / sticker price" (`PriceIntegrityCard.tsx:57,90`) vs `advertised_prices` per channel; MarketPositionCard (`:230`); StickerGenerators readiness (`:89`); defense packet (`ComplianceTab.tsx:130`) | `vehicle_listings.price`; `advertised_prices.advertised_price` (Compliance only); `website_sale_price` + `advertised_price_before_doc` only inside `feeExclusiveEquivalent` (`complianceData.ts:295-308`). `dealer_discount`, `doc_fee`, `retail_cash` columns exist but are not read by the Vehicle File (grep). What `vehicle_listings.price` represents: the MarketCheck feed listing price, written only by `marketcheck-sync` (`index.ts:1058-1064`, comment `:1062` "Feed price is the fee-INCLUSIVE website price"; update `:1084`); `crawl-advertised-prices` writes only the breakdown columns (`index.ts:1701-1714`) and, when the scraped figure exceeds the feed by >2%, leaves `price` untouched with `price_parse_status 'warning'` (`:1666-1679`). Live Q11 (pilot, non-archived): `price = website_sale_price` on 123 of 130, differs on 5, `website_sale_price` null on 2; sample: 58,382 = 57,487 + 895 doc fee. So `price` is fee-inclusive in this tenant, `advertised_price_before_doc` is the fee-exclusive figure, and the header (`VehicleFile.tsx:311`) and Overview (`OverviewTab.tsx:74`) label the bare number "Advertised price" without stating which. The `VehicleTruthCard` `advertised_price` fact is the same number as of the last `refresh_truth`/orchestrate run: STALE on 99 of the 117 pilot active listings that have the fact (99 older than 14 days; oldest `observed_at` 2026-07-28; live Q7). Sample: fact 63,495 observed 2026-08-10 (`dealer_confirmed`, `VERIFIED`), `vehicle_snapshots` v1 `pricing.advertisedPrice` 63,495, `vehicle_listings.price` 58,382 (updated 2026-09-09), `vehicle_fact_conflicts` 0. `observed_at` is returned (`useVehicleTruth.ts:29`) but not rendered (grep `observed_at` in `VehicleTruthCard.tsx`: none); no conflict is raised because `vehicle_facts` is rewritten only on Rebuild. Directive status: CONFLICTED between the two surfaces, fact STALE |
| MSRP | no | no | `base_msrp`, `destination_charge`, `factory_options_total`, `total_msrp` facts (`VehicleTruthCard.tsx:49`) | Documents `FactoryStickerCard` renders an "MSRP {reconciliation_status} ($difference)" pill from `factory_sticker_records.reconciliation_status/reconciliation_difference` (`FactoryStickerCard.tsx:339-345`, read at `:140-143`); card subtitle "Factory Configuration & MSRP" (`:232-233`) | rendered only via `vehicle_facts` (edge fn) and the reconciliation pill; candidates present but unrendered in `vehicle_listings.mc_attributes.{msrp,base_msrp,total_msrp}` (128/130 pilot active have `msrp`); `vehicle_files.msrp` NOT read |
| Engine | no | no | `engine` fact (Mechanical group, `:47`) | none | rendered only via `vehicle_facts.engine` (edge fn); candidate present but unrendered in `mc_attributes.engine`/`engine_size` (127/130 pilot active), which is what `ingest.ts:151` reads |
| Drivetrain | no | no | `drivetrain` fact (`:47`) | none | rendered only via `vehicle_facts.drivetrain` (edge fn); candidate present but unrendered in `mc_attributes.drivetrain` (129/130 pilot active), which is what `ingest.ts:153` reads |
| Condition | yes eyebrow (`:279`) | yes (`:72`) | `condition` fact (`:50`) | drives lifecycle tracking, document slots, form applicability | `vehicle_listings.condition` |

Trust presentation for these fields: the header and Overview show bare values with no source, freshness or status. Only the VehicleTruthCard attaches a per-fact badge (`Verified / Dealer stated / Feed / Calculated / Inferred`, derived in `VehicleTruthCard.tsx:80-86` from `source_kind` + `confidence`), without the source name or observation date per fact (the `evidence` and `observed_at` fields are returned by the hook, `useVehicleTruth.ts:28-29`, but not rendered).

Provenance mislabel — PROVENANCE: UNKNOWN-REVIEW REQUIRED. The facts `condition`, `mileage`, `advertised_price` (and `stock_number` when it could be built) are pushed with `source_kind 'dealer_confirmed'` and `confidence 'VERIFIED'` by `src/lib/vehicleTruth/ingest.ts:135-138` straight from the `vehicle_listings` row, regardless of which writer populated the column. In the pilot tenant those columns are written by `supabase/functions/marketcheck-sync/index.ts` (`:1041` condition, `:1054` mileage, `:1059` price, update `:1084`; header comment `:70` "upserts vehicle_listings (price ...)"; feed-sourced exceptions at `:1270`, `:1301`); `crawl-advertised-prices` never writes `price` (`:1701-1714`). `VehicleTruthCard.tsx:81` maps `dealer_confirmed` to `dealer_entered` -> label "Dealer stated" (`:36`). Live sample fact row: `advertised_price` `source_kind dealer_confirmed`, `authority dealer`. Net effect: the Vehicle File labels MarketCheck feed values "Dealer stated" (directive §8: the feed must not masquerade as the dealer; never hard-code a provider label that can disagree with the code path that ran). Neither Gate 0 report mentions `dealer_confirmed` (grep: 0 hits in `P0_INTEGRITY_REMEDIATION_REPORT.md` and `AUTOLABELS_VEHICLE_TRUTH_EXPANSION_ASSESSMENT.md`). Hand-off to Agents 1/2 for the source-kind fix; no Passport change.

---

## 7. Write actions by surface (table written)

| Surface | Action | Target |
|---|---|---|
| Header | Publish | `vehicle_listings.status/published_at` (`VehicleFile.tsx:198-201`) |
| Overview | Re-pull market data | edge `vehicle-enrich` (writes `vehicle_listings` server-side) |
| Overview / DescriptionCard | Regenerate | edge `description-orchestrate` |
| Overview / VehicleTruthCard | Rebuild | edge `factory-sticker-orchestrate refresh_truth` (`index.ts:1592-1600`) -> `truth.ts refreshVehicleTruth` (`:153-326`): upserts `vehicle_facts` (`:213-214`, onConflict `vehicle_id,fact_key,source_kind`), upserts `vehicle_fact_conflicts` (`:240`), `syncConflictException` -> `vehicle_exceptions` insert/update (`:257`, `:413`, `:450`), inserts `vehicle_snapshots` (`:273`), `flagStaleDocuments` -> `stale_document_flags` delete/insert (`:309`, `:363`, `:389-391`), `audit_log` insert on fact-write failure (`:216`, `:335`). The Rebuild button therefore rewrites every fact and conflict row for the vehicle, not just the snapshot |
| Documents / FactoryStickerCard | Regenerate, restore version | edge `factory-sticker-orchestrate` |
| Documents / DealDocumentsPanel | Fill forms, Certify K-208 | edge `generate-vehicle-forms`; `rpc certify_safety_inspection` |
| Documents / StickerGenerators | Set store default | `rpc merge_dealer_settings` via `DealerSettingsContext` (`DealerSettingsContext.tsx:701`) |
| Documents / AddendumSection | Accept, dispatch | `rpc accept_addendum`, edge `notify-getready`, `rpc mark_addendum_getready_dispatched` |
| Documents / DocumentUploads | Upload / link / remove | Storage `vehicle-docs`; `rpc append_vehicle_document`, `rpc remove_vehicle_document` -> `vehicle_listings.documents` |
| Documents / GeneratedDocumentsSection | approve/print/publish/archive per document; stale reconcile | `generated_documents` (via `src/lib/stickerStudio/api.ts`), `stale_document_flags` delete/insert (`staleDetection.ts:82-85`) |
| Documents / PassportPacketSection | Save packet | `vehicle_listings` (service_records, warranty_info, available_accessories, packet_modules, suppressed_programs, passport_version) |
| Get Ready | none | — |
| Customer | Save sold-to; Process deal | `vehicle_files` upsert; edge `process-deal` |
| Compliance / MarketPositionCard | Check market price | edge `marketcheck-market-pricing` (component state only) |
| Compliance / RecallCard | Run recall check; record outcome | edge `marketcheck-recalls`; `rpc submit_recall_service_outcome`; Storage `service-docs` |
| Compliance / TitleMcoPanel | Email title request | edge `email-title-request` |
| Compliance / TitleVerificationPanel | View / generate / attest | edge `marketcheck-title-report`; `vehicle_listings.title_verification` |
| Compliance / VehicleEvidenceTimeline | Export packet | `audit_log` insert via `logStickerAudit` |

No surface writes `vehicle_facts` or `vehicle_fact_conflicts` directly from the browser (no manual override or conflict resolution UI); the Rebuild action does so server-side. No surface writes `vehicle_lifecycle`, `advertised_prices`, or `vehicle_change_history`.

---

## 8. Role handling

| Mechanism | Finding | Evidence |
|---|---|---|
| Route access | `RouteCapabilityGuard.RULES` has no `/vehicle-file` prefix; any accepted tenant member with an autolabels entitlement reaches the page | `src/components/layout/RouteCapabilityGuard.tsx:14-32` |
| Role source | `tenant_members.role` via `useEntitlements().member` (`src/hooks/useEntitlements.ts:176-181`); 15 `DealerRole` values (`src/lib/permissions/dealerRoleCapabilities.ts:1-15`) |
| Composition by role | NONE — the same five tabs, same card order, same header for every role (`VehicleFile.tsx:35-41`, `:382-386`). Role-specific home pages exist (`/home/gm`, `/home/sales`, `/home/used-cars`, `/home/service`, `/home/technician`, `/home/vendor`, `src/App.tsx:329-334`) but they do NOT link into the Vehicle File: they route to the specialist per-vehicle screens (`ServiceVehicleWorkspace`, `VinCommandCenter`, `GetReadyCommand`) or to list pages (corrected after Gate 1 inspection, I3; earlier text said "they link into the one Vehicle File") |
| Entry path by role | `grep -c 'vehicle-file'` = 0 in each of `GmHome.tsx`, `SalesManagerHome.tsx`, `UsedCarManagerHome.tsx`, `ServiceManagerHome.tsx`, `TechnicianHome.tsx`, `ServiceWriterDesk.tsx`. Targets actually used: GmHome `/vin-command/:id` (`:467`), `/inventory`, `/service/approvals`, `/recon`, `/returns`, `/get-ready-command`, `/service`, `/prep`, `/ready-board` (`:215-317`); SalesManagerHome `vehicleHref` = `/v/:slug` when published, else `/vin-command/:id`, else `/inventory` (`:258-259`), plus `/addendum?id=` (`:386`); UsedCarManagerHome `/get-ready-command/:id` (`:148, :502`), `/service/approvals`, `/ready-board`, `/service/vehicle/:vin` (`:151-156`, `:803`); ServiceManagerHome, TechnicianHome, ServiceWriterDesk `/service/vehicle/:vin` (`:492`, `:445`, `:497`). Consequence for directive §45: Service Manager, Technician, Used Car Manager, GM and Sales Manager have no entry path into the Vehicle File from their home page today | files and lines as listed |
| Lifecycle-first role homes | ServiceWriterDesk, TechnicianHome, ServiceManagerHome and ManagerIntake each start their load from `vehicle_lifecycle` (`ServiceWriterDesk.tsx:195`, `TechnicianHome.tsx:170`, `ServiceManagerHome.tsx:180`, `ManagerIntake.tsx:72`). Live (Q16), pilot non-archived listings joined to `vehicle_lifecycle`: `AWAITING_MANAGER_AUTHORIZATION` 32, `SERVICE_UNASSIGNED` 17, `REMOVED` 9 — all 58 are `status published`. The 9 published-but-REMOVED cars are invisible on every lifecycle-first role home; they need the lifecycle re-evaluation named in `DUPLICATE_READ_PATHS.md` section G rank 4 (§45 gap, Section 17) | as cited |
| Per-action capability gates | AddendumSection Accept: `can_approve_print` (`AddendumSection.tsx:104`); DealDocumentsPanel / DealProgressPanel Fill/Certify/Process: `can_approve_print` (`DealDocumentsPanel.tsx:34`, `DealProgressPanel.tsx:31`); DescriptionCard Edit/Regenerate: `can_create_documents` (`useDescriptionOps.ts:66-67`); GeneratedDocumentsSection actions: manager + dealer document rules (`GeneratedDocumentsSection.tsx:76-81`) |
| Tier gates | TitleVerificationPanel `enabled` only when `tier("autolabels") === "compliance_pro"` (`ComplianceTab.tsx:102-103`); evidence export behind `FeatureGate feature="evidence_packet_export"` (`VehicleEvidenceTimeline.tsx:83`) |
| Advanced/compare-sources mode (§17) | MISSING |

---

## 9. Mobile / tablet handling

| Aspect | Finding | Evidence |
|---|---|---|
| Strategy | Single responsive page; no separate mobile Vehicle File component | `VehicleFile.tsx` |
| Breakpoints | `lg` (1024px) switches header from stacked to row (`flex-col lg:flex-row`, photo `lg:w-[320px]`, actions `lg:w-[240px]`), padding `p-4 lg:px-7`; `sm` for the 3-chip grid and card grids; container `max-w-[1500px]` | `:234-244`, `:318`, `:352` |
| Tab strip | horizontal scroll (`overflow-x-auto`), no collapse | `:361-379` |
| Mobile action bar | `lg:hidden fixed bottom-0 z-30` with Publish / View / Copy; page adds `pb-24 lg:pb-8` | `:389-417`, `:234` |
| AppShell chrome | mobile header (`lg:hidden`, `:737`), bottom nav `fixed inset-x-0 bottom-0 z-40 lg:hidden` with 4 side items + raised Scan (`:1076`, `:577-581`). Both bars claim `bottom-0`. Overlap CONFIRMED FROM CODE (Gate 1 inspection, I3; re-verified): the shell suppresses its bottom nav only when `location.pathname === "/inventory"` (`const inventoryHasOwnMobileChrome`, `AppShell.tsx:412`, used at `:736` and `:1075`), so on `/vehicle-file/:id` below `lg` the AppShell nav (`z-40`, `pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3`, `:1076`) and the Vehicle File action bar (`z-30`, `VehicleFile.tsx:389`) mount together and the nav paints over Publish / View shopper page / Copy link; the page's `pb-24` (`:234`) offsets only one bar. Not verified in a browser, but no code path prevents it |
| `useIsMobile` (768px) | used only by `src/components/ui/sidebar.tsx` and `InventoryMobileRestored`; not by the Vehicle File | `src/hooks/use-mobile.tsx:3`, grep |
| `InventoryMobileRestored` | separate mobile inventory list (`vehicle_listings` + `addendums` + `advertised_price_snapshots` + `marketcheck_sync_config`, `:67-109`); NOT referenced by any route in `src/App.tsx` (grep) — orphaned |
| `PrepMobile` (`/prep/:vin`) | QR-launched mobile prep flow, own reads (`vehicle_listings` by VIN newest 1, `prep_sign_offs` by `store_id+vin`) and writes (`prep_sign_offs` insert/update) | `src/pages/PrepMobile.tsx:55-61`, `:99-136` |
| `ServiceVehicleWorkspace` (`/service/vehicle/:vin`) | separate 1,744-line per-vehicle screen with its own 8-query load (`vehicle_listings`, `get_ready_records`, `safety_inspections`, `service_requests`, `list_tenant_members`, `audit_log`, `vehicle_files.stock_number`, `vehicle_delivery_clearance`) | `src/pages/ServiceVehicleWorkspace.tsx:133-152` |
| `GetReadyCommand` / `VinCommandCenter` | separate command surfaces with their own loaders (`loadVinCommand`: 12 queries `useCommandCenter.ts:520-602`; `loadGetReadyCommand`: 9-10 queries `:933-996`) | as cited |

Inspector finding — code change proposed (owner decision), I3 (severity major, UI-only, not a read-model item): either extend the AppShell chrome exception at `AppShell.tsx:412` to `/vehicle-file` so the page's own action bar is the only bottom chrome, or position the Vehicle File action bar above the nav (bottom offset = nav height + safe-area inset) and raise the page bottom padding; verify at 390 px and 768 px widths. Not implemented at Gate 1.

---

## 10. Timeline / recent-changes surfaces

| Surface | Location | Source | Content | Gaps vs §44 |
|---|---|---|---|---|
| Stage history | Get Ready tab | `vehicle_lifecycle.previous_state/state_changed_at` + `audit_log action='vehicle_lifecycle_gate_set'` (`GetReadyTab.tsx:134-138`, `:300-330`) | last transition + manager gate events | live count of gate events: 0; operational transitions are not journaled (`:306`) |
| Audit evidence | Compliance tab | `useVehicleEvidence`: `generated_documents` milestones, `qr_scan_events`, `addendums`, listing `created_at`, `audit_log` store-wide newest 400 filtered by `entity_id`/doc id/`details.vehicle_id` (`useVehicleEvidence.ts:45-93`) | document/signing/QR/vehicle/compliance events | price, mileage, provider sync, website observation, market update, recall update, description, Passport publish, AutoFilm, customer actions absent; 400-row window vs 9,790 tenant rows |
| Truth "What changed in vN" | Overview VehicleTruthCard expander | `vehicle_snapshots.material_changes` via edge fn (`VehicleTruthCard.tsx:234-245`) | field previous -> next for the current snapshot only | one snapshot, not a chronology |
| Description History | Overview DescriptionCard | `description_versions` (`DescriptionCard.tsx:384-400`) | last 8 versions | — |
| Sticker version history | Documents (drawer) | `factory-sticker-orchestrate` versions (`StickerVersionHistory.tsx:40-50`) | document versions | — |
| Shopper activity | Customer tab + drawer | `customer_engagement_events`, `passport_engagement`, `qr_scan_events`, `leads` | customer events | not merged into a vehicle chronology |
| Price history | none in Vehicle File | `vehicle_value_history`: no client reader (grep under `src` hits only comments at `src/lib/passportV2Data.ts:323,377`, `types.ts` and a test); read by `supabase/functions/public-listing-view/index.ts:444` (newest 60 by VIN) and attached as `listing.value_history`, which `passportV2Data.computePriceHistory` consumes (`:376-379`, customer Passport); written by `supabase/functions/vehicle-enrich/index.ts:917`, `marketcheck-market-pricing/index.ts:101`, `marketcheck-sync/index.ts:1203` (all insert; `:1194` reads the last row to skip same-price duplicates) | — | MISSING internally |
| `vehicle_change_history` | not read by any client file (`grep -rn vehicle_change_history src` -> only `types.ts`); written by `supabase/functions/marketcheck-sync/index.ts:692`, read back at `:732` | live: 6,703 rows; `field_key` = `_lifecycle` 6,067, `price` 628, `condition` 4, `mileage` 2, `stock_number` 2 | — | the one table that holds price/mileage change events is unsurfaced |
| Overview "Recent changes" (§14 E) | — | — | — | MISSING |

---

## 11. Source / evidence drawers and deep views (§16 Level 3)

| Drawer / deep view | Component | Opens as | Evidence offered |
|---|---|---|---|
| Advertised-price evidence | `AdvertisedPriceCard` "Evidence" | new tab via short-lived signed URL (600 s) on private bucket `price-evidence` (`priceEvidenceUrl.ts:10-11,56-75`); "Open" = `source_url` | screenshot per channel; `captured_at`; delta vs lot price with $1 tolerance (`PriceIntegrityCard.tsx:17,64-66`); fee-inclusive comparison via `feeExclusiveEquivalent` (`:62-63`) |
| Truth sources | `VehicleTruthCard` "Where this came from" | inline expander | `vehicle_source_records` (source_kind, retrieved_at, billable) + material changes; no per-fact evidence, candidates, prior value, raw reference or dealer confirmation. The per-fact badge is derived from `source_kind` alone, so the `dealer_confirmed` stamp from `ingest.ts:135-138` surfaces as "Dealer stated" for feed-written values (Section 6, provenance mislabel) |
| Truth conflicts | `VehicleTruthCard` banner; `TruthConflictsCard` (Compliance) | inline | candidates `value (sourceKind)`; no resolve action |
| Recall details | `RecallCard` | shadcn `Sheet` (`RecallCard.tsx:179-205`) | campaigns from `recall_payload` + outcome form |
| Shopper activity | `ShopperActivityDrawer` | `Sheet` right, 620px (`ShopperActivityDrawer.tsx:69-72`) | sessions, sections, triggers, similar-vehicle interest |
| Audit event raw | `VehicleEvidenceTimeline` row | inline `<pre>` JSON (`:106-108`) | raw row incl. `ip_address`, `content_hash` |
| Sticker regeneration / versions | `RegenerateStickerDrawer`, `StickerVersionHistory` | drawer (`FactoryStickerCard.tsx:400-415`) | reason capture, version list |
| Title / MCO | `TitleMcoPanel` | signed URL open | `vehicle_documents` |
| Compare Sources matrix (§17) | — | — | MISSING |

---

## 12. Directive §14 Overview questions vs current Overview

| §14 | Status | Evidence |
|---|---|---|
| A. Needs attention | PARTIAL — Status card lists readiness `blockers` (only "Published" / open recall task can block, `types.ts:136,146-153`) and "other open items"; price mismatch, stale inventory source, truth conflict, missing compliance requirement are not surfaced here (price mismatch is on Compliance `AdvertisedPriceCard`; truth conflicts on the truth card banner) | `OverviewTab.tsx:131-153` |
| B. Retail position | PARTIAL — advertised price only; market value / position live on Compliance `MarketPositionCard`; DOM and MDS MISSING as rendered values (no `days_on_market`/`mds`/`dom` read anywhere in `src/components/vehicleFile`; grep), although DOM candidates exist unread in `vehicle_listings.mc_attributes.dom/dom_180/dom_active` (128/130 pilot active; live Q8) | `OverviewTab.tsx:74`, `PriceIntegrityCard.tsx:159-248` |
| C. Readiness | PRESENT — stage, owner, time in stage, next action (lifecycle-derived); blocker = readiness list | `OverviewTab.tsx:114-129` |
| D. Customer activity | PARTIAL — views, last view, leads; no AutoFilm engagement (no `autofilm` reference under `src/components/vehicleFile`, grep) | `OverviewTab.tsx:203-215` |
| E. Recent changes | MISSING | — |

---

## 13. Current IA vs directive §12 five areas

| §12 area | Status | Where the pieces are today |
|---|---|---|
| 1. OVERVIEW | PRESENT (tab) — composition per Section 12 | `OverviewTab.tsx` |
| 2. PRICING & MARKET | MISSING as a top-level area. Dealer pricing ladder (MSRP -> discount -> selling -> doc fee -> total) MISSING; public website observation PARTIAL (`AdvertisedPriceCard`: latest capture per channel, MATCH/MISMATCH by $1, "No advertised price captured" empty state; no STALE OBSERVATION status, no observed discount/fee breakdown); market intelligence PARTIAL (`MarketPositionCard`: `market_value`, `market_position`, comps count; no range, MDS, velocity, geography); listing timeline MISSING (no first/last observed, DOM, price/mileage history, relisting) | `PriceIntegrityCard.tsx` under Compliance tab |
| 3. GET READY | PRESENT | `GetReadyTab.tsx` |
| 4. DOCUMENTS & COMPLIANCE | PARTIAL — two tabs (Documents, Compliance); official forms status appears on both (`DealDocumentsPanel` and `OfficialFormsCard`) | `DocumentsTab.tsx`, `ComplianceTab.tsx` |
| 5. CUSTOMER & PUBLISHING | PARTIAL — Customer tab holds leads/engagement/deal/sold-to; publishing controls are in the header (Publish, links) and Documents tab (`PassportPacketSection`: packet modules, dealer programs, passport_version); AutoFilm MISSING | `CustomerTab.tsx`, `VehicleFile.tsx:318-349`, `PassportPacketSection.tsx` |
| VEHICLE TRUTH / WHY THIS VALUE workspace (header + Overview) | PARTIAL — inline `VehicleTruthCard` fifth on Overview; conflicts card on Compliance; not reachable from the header; no drawer/deep view; Levels 1-2 present as value + status badge, Level 3 only as a sources list | `OverviewTab.tsx:201`, `ComplianceTab.tsx:238` |

Old tab sprawl: consolidated already (legacy aliases `deal, labels, addendum, scan, prep, sign, evidence` still arrive from Inventory, Print Queue, Ready Board, Command Palette, `types.ts:14-25`).

---

## 14. Directive §11 read-model sections vs what the browser assembles today

| §11 section | Status | Current source in the Vehicle File |
|---|---|---|
| identity | PRESENT | `vehicle_listings` vin/ymm/trim/condition + `vehicle_files.stock_number`; ymm unsplit |
| dealerState | PARTIAL | mileage, price, condition, status from `vehicle_listings`; dealer-installed items only via `sticker_snapshot`/addendums; no structured inventory state |
| resolvedFacts | PRESENT (via edge fn) | `useVehicleTruth` -> `factory-sticker-orchestrate vehicle_truth` (facts, snapshot, conflicts, sources) |
| pricing | PARTIAL | `price` only; `dealer_discount`, `doc_fee`, `advertised_price_before_doc`, `website_sale_price` not presented |
| publicAdvertisement | PARTIAL | `advertised_prices` latest per channel (Compliance) with evidence link |
| marketIntelligence | PARTIAL | `market_value`, `market_position`, `market_payload.source`, `comparables` length |
| listingLifecycle | MISSING | only `enriched_at` "Last inventory sync" |
| getReady | PRESENT | `vehicle_lifecycle`, `prep_sign_offs`, deal record get-ready fields |
| documents | PRESENT | `generated_documents`, `vehicle_listings.documents`, `vehicle_documents`, `factory_sticker_records` |
| compliance | PRESENT | readiness checks, recall, sign-offs, forms, title, evidence |
| media | PARTIAL | photo/video counts and thumbnails; no management |
| customer | PRESENT | leads, engagement, deal flow, sold-to (`vehicle_files.customer_info`) |
| publishing | PARTIAL | `status`/`published_at`, `packet_modules`, `passport_version`, `suppressed_programs` |
| description | PRESENT | `useDescriptionCase` (9 queries) |
| autofilm | MISSING | no reference |
| sourceHealth | MISSING | truth sources list shows retrieved_at/billable only |
| conflicts | PRESENT | truth card banner + `TruthConflictsCard`; no resolution action |
| recentChanges | MISSING | fragments only (Section 10) |
| currentOwner | PRESENT (used/CPO only) | `STATE_OWNER[state]` |
| blocker | PARTIAL | readiness blockers, `gate_reason`, recall task; not one named blocker |
| nextAction | PRESENT | `STATE_NEXT_ACTION[state]`; `nextDealAction` for the deal |

---

## 15. Unknowns / review required

1. Overlap of the Vehicle File's fixed bottom action bar (`VehicleFile.tsx:389`, z-30) with the AppShell bottom nav (`AppShell.tsx:1076`, z-40) below `lg` — CONFIRMED FROM CODE after Gate 1 inspection (`AppShell.tsx:412` exempts only `/inventory`; Section 9). Still not verified in a browser. Code change proposed; owner decision.
2. `VehicleFileConnectedHero.tsx` has no importer; whether it is intentionally retained is UNKNOWN.
3. `InventoryMobileRestored.tsx` is not routed in `src/App.tsx`; whether it is reachable elsewhere or dead is UNKNOWN.
4. Exact count of per-document `fetchFiledDocumentAssets` edge invokes in `GeneratedDocumentsSection` depends on the number of live documents per vehicle (sample: 1; 832 tenant-wide) — not measured.
5. Whether the four provider contexts (`TenantContext`, `DealerSettingsContext`, `useEntitlements`, `AuthContext`) re-fetch on route change was not traced; they are excluded from the fan-out counts.
6. RESOLVED (live Q12): the one `vehicle_listings` row without a `vehicle_files` row is `03fbcebf-c240-4f4b-b315-10d9b7f54676`, VIN `JN8AZ3DB6T9435410`, "2026 INFINITI QX80", in tenant `93ae75c1-2071-4a5a-95c4-6095de55fe1f` (`tenants.name` "AutoLabels.io"), NOT the pilot tenant; the pilot has 284 listings and 284 files, so no pilot vehicle falls back for stock number. That row is `status published` (`published_at` 2026-06-29), `condition new`, `price 171.00`, `advertised_price_before_doc 171.00`, `website_sale_price 1066.00`, `doc_fee 895`, `mileage null`, `source_url null`, 0 `advertised_prices` rows, 17 `vehicle_facts`, `enriched_at` 2026-07-05, `updated_at` 2026-09-08; `mc_attributes.stock_no` and `sticker_snapshot.stock_number` null, so its Vehicle File header would read "Stock # not on the feed" (`VehicleFile.tsx:297`) and show $171. Re-verified 2026-09-09 after Gate 1 inspection (Q18): `slug` `infiniti-qx80-enm0`, `view_count` 0, `mc_attributes.msrp` null, 0 `vehicle_files` rows on `(tenant_id, upper(vin))`, 0 `advertised_prices` rows; tenant 93ae75c1 has 2 `tenant_members`, entitlement `autolabels:unlimited:active`, `onboarding_profiles.source` `manual`, 1 listing. It is the only listing in the database outside the pilot tenant and the only one with no `vehicle_files` row, and it is the difference between "131 published (all tenants)" and "130 (pilot)" in every Gate 1 map. Customer exposure (Q19): `get_vehicle_listing_by_slug(_slug)` is `SECURITY DEFINER`, matches `slug = _slug OR vin = upper(_slug)` with `status = 'published'` (or archived with `archived_at`) and no tenant filter, so `/v/infiniti-qx80-enm0` and `/v/JN8AZ3DB6T9435410` serve this $171 row to anyone (Passport not assessed further, §4). REVIEW REQUIRED for the Gate 0 owner as a price-integrity item: a published record with a placeholder or mis-parsed price and no evidence row; whether tenant 93ae75c1 is a demo/test tenant or customer-visible is UNKNOWN (live signals — 0 views, manual profile source, platform name — suggest internal). Not mentioned in `P0_INTEGRITY_REMEDIATION_REPORT.md` (grep `9435410`: 0 hits). Owner decision (inspectors I2, I3): archive/unpublish the row or confirm the tenant is non-customer; until then the shadow read model must carry this VIN as UNEXPLAINED (Section 17). Cross-map: `SOURCE_TO_FACT_MATRIX.md` Unknown 10 ("the extra VIN was not identified") should be closed by citing this item and Q12/Q18.
7. Payload size and latency of the `factory-sticker-orchestrate vehicle_truth` call (issued twice per full visit) is Agent 1 scope; not measured here.
8. FINDING (was an unknown): `useVehicleEvidence` misses vehicle events for two reasons. (1) The JS matcher (`src/lib/stickerStudio/useVehicleEvidence.ts:80`) tests `entity_id === vehicleId`, document ids and `details.vehicle_id` only; it ignores `details.vin` and `factory_sticker_record` entity ids, so the sample vehicle's six `description_*` rows of 2026-09-08 at ranks 342-347 — inside the 400-row window (`:50`) — are dropped. (2) The 400-row window (9,790 pilot rows live) excludes the vehicle's seven `factory_sticker.*` / `vehicle_truth.snapshot_recorded` rows of 2026-08-10 at ranks 5,937-5,943. Truncation is proven for the sample (13 rows reference it by `details->>vin`, 0 surface), not merely likely (live Q10).
9. Live `audit_log.store_id` is `text` while `tenants.id` is `uuid`; the client passes the string, so the filter works, but any server-side join needs a cast (discovered while querying).
10. Whether the `/v3/` "View shopper page" link and `/v/` "Copy shopper link" divergence (`VehicleFile.tsx:120-129`) is intentional is out of scope (§4 Passport locked) and not assessed.
11. PROVENANCE: UNKNOWN-REVIEW REQUIRED — `condition`, `mileage`, `advertised_price` facts carry `source_kind dealer_confirmed` / `authority dealer` although the pilot tenant's listing columns are feed-written (Section 6). Whether any dealer confirmation path (manual edit, `manual_dealer_confirmation` capture) ever wrote these columns for any pilot vehicle was not traced; hand-off to Agents 1/2.
12. STALE truth facts — REVIEW REQUIRED: `advertised_price` facts disagree with `vehicle_listings.price` on 99/117 pilot active listings (Section 6, Q7) with no conflict rows; the same rewrite-only-on-Rebuild behaviour presumably applies to `mileage` and `condition` facts but was not measured.
13. The `$171` published QX80 listing in tenant 93ae75c1 (item 6): origin UNKNOWN; customer visibility CONFIRMED by the `get_vehicle_listing_by_slug` definition (Q19); escalated as an owner decision, not assessed further here.
14. Lifecycle-first role homes hide published cars: 9 pilot published listings have `vehicle_lifecycle.state = 'REMOVED'` (Q16) and are invisible on ServiceWriterDesk, TechnicianHome, ServiceManagerHome and ManagerIntake, which read `vehicle_lifecycle` first (Section 8). Whether REMOVED-while-published is a valid state or a stale gate is UNKNOWN; needs the lifecycle re-evaluation in `DUPLICATE_READ_PATHS.md` section G rank 4.

---

## 16. Evidence index

Code (repo-relative, file:line):

- `src/App.tsx:21-27, 77, 322, 329-334, 353-354, 394, 399-406, 414, 420`
- `src/pages/VehicleFile.tsx:35-41, 54-55, 61-83, 85-116, 120-129, 131-137, 139-155, 157-169, 181-188, 190-218, 234-244, 242-359, 279-311, 315, 318-349, 352-356, 361-379, 382-386, 389-417`
- `src/components/vehicleFile/types.ts:10-31, 56-101, 125-176`
- `src/components/vehicleFile/lifecycle.ts:183-187, 216-250, 271-272, 282-317`
- `src/components/vehicleFile/primitives.tsx:354-449`
- `src/components/vehicleFile/OverviewTab.tsx:19-49, 67-77, 82-100, 109-158, 160-168, 170, 172-199, 201, 203-215, 217-226`
- `src/components/vehicleFile/DocumentsTab.tsx:34-42, 52-80, 116-158`
- `src/components/vehicleFile/DocumentUploads.tsx:179-198, 210-274`
- `src/components/vehicleFile/GetReadyTab.tsx:125-150, 172-186, 222-261, 265-281, 283-298, 300-330, 332-339`
- `src/components/vehicleFile/CustomerTab.tsx:61-69, 82-85, 87-120, 132-151, 168-212, 214-258, 260-268, 270-311, 313-324`
- `src/components/vehicleFile/ComplianceTab.tsx:21-57, 59-94, 102-106, 114-170, 184-254`
- `src/components/vehicleFile/PriceIntegrityCard.tsx:17, 36-51, 54-66, 70-79, 82-147, 159-248, 250-255`
- `src/components/vehicleFile/RecallCard.tsx:29-42, 60-70, 118-149, 179-205`
- `src/components/vehicleFile/DescriptionCard.tsx:282-293, 322-334, 384-400`
- `src/components/vehicleFile/PassportPacketSection.tsx:19-28, 41-67, 88-181`
- `src/components/vehicleFile/StickerGenerators.tsx:18-22, 60, 89, 119-120` (file is 150 lines; the earlier `:281-336, 349-366, 284-285, 323` citations were wrong — reviewer correct)
- `src/components/vehicleFile/AddendumSection.tsx:100-148, 159-168`
- `src/components/vehicleFile/SignaturesSection.tsx:40-57`
- `src/components/vehicleFile/OemDocFinders.tsx:36-38, 57-75, 104-116`
- `src/components/vehicle/VehicleTruthCard.tsx:14-52, 80-86, 94, 113-121, 161-180, 185-211, 213-247`
- `src/hooks/useVehicleTruth.ts:21-31, 60-116`
- `src/components/vehicle/VehicleHistoryFacts.tsx:102-119`; `src/components/listing/TrustStrip.tsx:59-99`
- `src/lib/vehicleStockNumber.ts:32-47` (file is 48 lines; the earlier `:168-201`/`:185-200` citations were wrong — reviewer correct, precedence order unchanged); `src/lib/photos.ts:210-239`
- `src/hooks/useRecallTask.ts:47-94`
- `src/hooks/useDescriptionOps.ts:60-74, 204-267`
- `src/components/vehicle/FactoryStickerCard.tsx:132, 140-152, 175-187, 203, 400-415`; `src/components/vehicle/StickerVersionHistory.tsx:40-50`; `src/hooks/useWindowSticker.ts:79-82`
- `src/components/vehicle/DealDocumentsPanel.tsx:29-35, 52-55, 69-105, 149, 173`; `src/hooks/useDealRecord.ts:23-59, 62-75`
- `src/components/vehicle/DealProgressPanel.tsx:24-52, 69-78`
- `src/components/vehicle/ShopperActivityDrawer.tsx:65-72`; `src/hooks/useShopperActivity.ts:50-163`
- `src/components/vehicle/DeliverySignoffs.tsx:36-46`; `src/components/vehicle/TitleMcoPanel.tsx:36-55`; `src/components/vehicle/TitleVerificationPanel.tsx:77-93, 124, 135`
- `src/components/vehicle/VehicleEvidenceTimeline.tsx:25-50, 83, 94-110`; `src/lib/stickerStudio/useVehicleEvidence.ts:35-107`; `src/components/vehicle/VehicleCtMvpStatusCard.tsx:38-45`
- `src/components/admin/InstallProofList.tsx:32-62`
- `src/components/vehicle/GeneratedDocumentsSection.tsx:1-20, 60-81`; `src/lib/stickerStudio/useVehicleDocuments.ts:9-33`; `src/lib/stickerStudio/useQrAnalytics.ts:110-131`; `src/lib/stickerStudio/useStaleFlags.ts:52-67`; `src/lib/stickerStudio/staleDetection.ts:71-85`
- `src/lib/stickerStudio/useStickerCatalog.ts:13-23`; `src/lib/stickerStudio/useStickerPrefs.ts:17-29`
- `src/lib/oem/resolveOemDocLink.ts:74-82, 116, 160`
- `src/components/compliance/complianceData.ts:295-308`; `src/lib/evidence/priceEvidenceUrl.ts:10-11, 45, 56-75`
- `src/components/layout/RouteCapabilityGuard.tsx:14-32, 40-90`; `src/lib/permissions/dealerRoleCapabilities.ts:1-15, 24-38, 256-273`; `src/hooks/useEntitlements.ts:170-185`
- `src/components/layout/AppShell.tsx:412, 577-581, 588-590, 736, 737, 810, 1075-1076`
- Role homes (Section 8): `src/pages/GmHome.tsx:215-317, 467`; `src/pages/SalesManagerHome.tsx:258-259, 318, 353, 386`; `src/pages/UsedCarManagerHome.tsx:146-156, 502, 803`; `src/pages/ServiceManagerHome.tsx:180, 492`; `src/pages/TechnicianHome.tsx:170, 445`; `src/pages/ServiceWriterDesk.tsx:195, 497`; `src/pages/ManagerIntake.tsx:72`; `grep -c 'vehicle-file'` = 0 in each of the six home files
- `src/hooks/useShopperActivity.ts:104-113`; `src/lib/stickerStudio/useQrAnalytics.ts:122-125` (qr_scan_events by `vehicle_id`)
- `src/hooks/use-mobile.tsx:3-19`; `src/pages/Inventory.tsx:1-11`; `src/pages/InventoryModern.tsx:435-450, 614, 647, 669, 716`; `src/pages/InventoryCommandCenterV2.tsx:213-214, 412`; `src/pages/InventoryMobileRestored.tsx:62-109`; `src/pages/PrepMobile.tsx:55-61, 95-136`; `src/pages/ServiceVehicleWorkspace.tsx:133-152`
- `src/hooks/useCommandCenter.ts:468-469, 520-602, 759, 933-996, 1278`
- `src/lib/lifecycle/states.ts:17-72`
- `src/components/layout/CommandPalette.tsx:155`; `src/pages/PrintQueue.tsx:26-27`; `src/pages/ReadyBoard.tsx:386`
- `src/lib/passportV2Data.ts:323, 377` (comments only), `:376-379` (`computePriceHistory` reads `listing.value_history`); `supabase/functions/public-listing-view/index.ts:444`; `supabase/functions/vehicle-enrich/index.ts:917`; `supabase/functions/marketcheck-market-pricing/index.ts:101`; `supabase/functions/marketcheck-sync/index.ts:70, 692, 732, 1020, 1041, 1054, 1058-1064, 1084, 1194, 1203, 1270, 1301`
- `src/lib/vehicleTruth/ingest.ts:130-138, 151-153`
- `supabase/functions/factory-sticker-orchestrate/index.ts:1355-1378, 1592-1600`; `supabase/functions/factory-sticker-orchestrate/truth.ts:153-160, 213-216, 240, 257, 273, 309, 335, 363, 389-391, 413, 445, 450`
- `supabase/functions/crawl-advertised-prices/index.ts:1497, 1666-1679, 1701-1714`
- `src/components/vehicle/FactoryStickerCard.tsx:232-233, 339-345`
- `src/lib/stickerStudio/useVehicleEvidence.ts:50, 80`
- `supabase/functions/marketcheck-title-report/index.ts:175-178, 189-203`
- `src/components/vehicleFile/ComplianceTab.tsx:228-236`; `src/lib/stickerStudio/useQrAnalytics.ts:122-131`; `src/lib/stickerStudio/staleDetection.ts:82, 85`
- `src/integrations/supabase/types.ts` (`vehicle_listings` Row at 9003; `vehicle_files` Row; `vehicle_change_history` Row at 8349)
- `src/components/vehicleFile/__tests__/PriceIntegrityCard.test.tsx` (only test under vehicleFile)
- `git log --date=short -- src/pages/VehicleFile.tsx` and `-- src/components/vehicleFile/` (Section 1)

Live read-only queries (Lovable project `1a2a5abf-4218-480d-aac9-d7bd0d3cfb73`, Supabase `onnbmmdbrsgytfozfozn`, 2026-09-09):

- Q1 `information_schema.columns` for `vehicle_lifecycle`, `recall_service_tasks`, `prep_sign_offs`, `vehicle_change_history` (column lists used in Sections 2, 10).
- Q2 `information_schema.columns` for `vehicle_listings` filtered to the twelve-field candidates: present = `advertised_price_before_doc, condition, dealer_discount, doc_fee, key_specs, mileage, price, retail_cash, trim, vin, website_sale_price, ymm`; absent = `stock_number, engine, drivetrain, msrp, year, make, model`.
- Q3 counts: `vehicle_lifecycle` 173 (pilot tenant), `recall_service_tasks` 157, `prep_sign_offs` 0, `audit_log listing_viewed` 1,414, `audit_log vehicle_lifecycle_gate_set` 0, `description_cases` 278, `leads` 0, `passport_engagement` 578, `customer_engagement_events` 1,994, `qr_scan_events` 0, `generated_documents` 832, `audit_log` total 11,600 at first query (11,602 on the 2026-09-09 re-run; the table grows continuously, so treat the total as a point-in-time figure).
- Q4 `vehicle_change_history` by `field_key`: `_lifecycle` 6,067, `price` 628, `condition` 4, `mileage` 2, `stock_number` 2.
- Q5 sample vehicle (pilot tenant, newest updated published listing, VIN tail 358865): `vehicle_facts` 19, `vehicle_snapshots` 1, `advertised_prices` 1, `vehicle_change_history` 12, `vehicle_value_history` 11, `audit_log` rows for tenant 9,790, `audit_log` rows referencing the vehicle id 0, `vehicle_lifecycle` 0, `factory_sticker_records` 1, `generated_documents` 1, `recall_service_tasks` 0.
- Q6 `vehicle_facts` counts by key for the twelve fields, all tenants and pilot-only (Section 6); 0 duplicate `(vehicle_id, fact_key)` pairs.
- Q7 pilot tenant, `vehicle_listings status <> 'archived'` LEFT JOIN LATERAL newest `vehicle_facts` row with `fact_key = 'advertised_price'`: 130 active, 117 with a fact, 99 where `(fact_value->>'v')::numeric IS DISTINCT FROM price`, 99 with `observed_at` older than 14 days, oldest `observed_at` 2026-07-28, newest 2026-09-08. Sample id `2c64a0bf-b1ff-4874-833b-e0ac7a267fd9`: fact 63,495 (`dealer_confirmed`, `VERIFIED`, `authority dealer`, observed 2026-08-10T04:07Z), newest `vehicle_snapshots.snapshot_json->pricing->advertisedPrice` 63,495, `price` 58,382 (`updated_at` 2026-09-09), `website_sale_price` 58,382, `advertised_price_before_doc` 57,487, `doc_fee` 895, `vehicle_fact_conflicts` 0.
- Q8 `jsonb_object_keys(mc_attributes)` on the sample (keys listed in Section 6); non-archived listings with `mc_attributes->>'msrp'`: 128 of 131 all tenants, 128 of 130 pilot; pilot `engine` 127, `drivetrain` 129, `dom` 128.
- Q9 stock sources, non-archived: `mc_attributes->>'stock_no'` non-null 0, `mc_attributes->'dealer'->>'stock_no'` 0, `sticker_snapshot->>'stock_number'` 0; `vehicle_files.stock_number` populated 284 of 284; pilot active listings with a populated file stock 130 of 130; `vehicle_facts fact_key='stock_number'` 0; listings with no stock in any source 1 (the QX80 in tenant 93ae75c1 — reviewer's "129/130 active" counted that other-tenant row as pilot; corrected here).
- Q10 `audit_log` for the pilot tenant ranked by `created_at DESC`, rows where `details->>'vin'` ends 358865 OR `entity_id` = sample id OR `details->>'vehicle_id'` = sample id: 13 rows, all by VIN, none by id; ranks 342-347 (`description_*`, `entity_type description_case`, 2026-09-08) and 5,937-5,943 (`factory_sticker.*`, `vehicle_truth.snapshot_recorded`, `entity_type factory_sticker_record`, 2026-08-10).
- Q11 non-archived listings, `price` vs `website_sale_price`: pilot 123 equal / 5 differ / 2 null (130); all tenants 123 / 6 / 2 (131); pilot `price = advertised_price_before_doc + doc_fee` on 123.
- Q12 `vehicle_listings` rows with no `vehicle_files` row on `(tenant_id, vin)` (case-insensitive VIN also checked): 1 row, id `03fbcebf-c240-4f4b-b315-10d9b7f54676`, tenant `93ae75c1-2071-4a5a-95c4-6095de55fe1f` ("AutoLabels.io": 1 listing, 0 files); pilot tenant 284 listings / 284 files; totals 285 / 284. Column values in Section 15 item 6. Reviewer note: the reviewer presented this row as an active-lot vehicle without stating its tenant; it is not in the pilot tenant, so the map's pilot-tenant claims ("117 of 130", "130/130 stock") exclude it.

Gate 1 inspection re-verification queries (2026-09-09, read-only):

- Q13 `pg_column_size` on pilot `vehicle_listings` with `archived_at IS NULL` (n = 130): avg row 21.1 KB, max 29.0 KB, `mc_attributes` avg 11.1 KB.
- Q14 `audit_log`: 11,602 rows total; 9,790 with `store_id` = pilot; 1,414 `listing_viewed`; avg row 539 B; sum of `pg_column_size` over the pilot newest 400 by `created_at DESC` = 254 KB.
- Q15 `pg_indexes` (public) for `audit_log` (pk, `created_at DESC`, `(entity_type, entity_id)`, `row_hash`, `store_id`, `(store_id, created_at DESC)`, `user_id`), `qr_scan_events` (pk, `code`, `(tenant_id, scanned_at DESC)`), `vehicle_change_history` (pk, `(tenant_id, field_key, changed_at DESC)`, `(tenant_id, vin, changed_at DESC)`), `vehicle_value_history` (pk, `tenant_id`, `(vin, captured_at DESC)`), `advertised_prices` (pk, `(tenant_id, captured_method, captured_at DESC)`, `(tenant_id, vin, captured_at DESC)`, `(tenant_id, upper(vin), captured_at DESC)`, `(vin, captured_at DESC)`), `passport_engagement` (pk, `(tenant_id, vin)`, unique `(session_id, vin, module)`), `customer_engagement_events` (pk, `(document_type, document_id, occurred_at)`, `(event_type, occurred_at)`, `(ip_address, created_at)`, gin `metadata`, `(session_id, occurred_at)`, `(tenant_id, occurred_at)`, `(vehicle_id, occurred_at)`, `(vin, occurred_at)`), `vehicle_facts` (pk, `overridden_by`, `source_record_id`, `tenant_id`, `(vehicle_id, fact_key)`, unique `(vehicle_id, fact_key, source_kind)`).
- Q16 `vehicle_lifecycle` JOIN pilot `vehicle_listings` with `archived_at IS NULL`, grouped by `state`: `AWAITING_MANAGER_AUTHORIZATION` 32, `SERVICE_UNASSIGNED` 17, `REMOVED` 9; every one of the 58 has `status = 'published'`.
- Q17 status counts: `status = 'published'` 131 all tenants / 130 pilot; `archived_at IS NULL` 131 / 130; `count(DISTINCT tenant_id)` 2; `vehicle_listings` 285; `vehicle_files` 284.
- Q18 the one published row outside the pilot tenant (`tenant_id <> pilot AND status = 'published'`, exactly 1 row): id `03fbcebf-c240-4f4b-b315-10d9b7f54676`, VIN `JN8AZ3DB6T9435410`, tenant `93ae75c1-…` (`tenants.name` "AutoLabels.io"), `slug` `infiniti-qx80-enm0`, `condition` new, `price` 171.00, `advertised_price_before_doc` 171.00, `website_sale_price` 1066.00, `doc_fee` 895, `mileage` null, `published_at` 2026-06-29, `updated_at` 2026-09-08, `view_count` 0, `mc_attributes->>'msrp'` null, 0 `advertised_prices` rows by VIN, 0 `vehicle_files` rows by `(tenant_id, upper(vin))`; tenant 93ae75c1: 2 `tenant_members`, `app_entitlements` `autolabels:unlimited:active`, `onboarding_profiles.source` `manual`, 1 listing, 17 `vehicle_facts` for the vehicle.
- Q19 `pg_get_functiondef` + `prosecdef` for `public.get_vehicle_listing_by_slug(_slug text)`: `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`; body `SELECT * FROM public.vehicle_listings WHERE (slug = _slug OR vin = upper(_slug)) AND (status = 'published' OR (status = 'archived' AND archived_at IS NOT NULL)) ORDER BY (slug = _slug) DESC, (status = 'published') DESC, published_at DESC NULLS LAST LIMIT 1` — no tenant predicate.

Gate 0 citations: P0_INTEGRITY_REMEDIATION_REPORT.md (row counts: `vehicle_listings` 285, `vehicle_files` 284, `vehicle_change_history` 6,703, `vehicle_value_history` 6,523); gate1_context.md (Passport locked; truth engine location).

---

## 17. What the shadow read model must resolve (consolidation)

Items the shadow read model (directive §50-§51) must settle before its comparison against the served Vehicle File is meaningful. Each line names the inspector that raised it; nothing here is implemented at Gate 1.

| # | Requirement | Why | Raised by |
|---|---|---|---|
| 1 | Declare the VIN population explicitly: pilot tenant only (130 published / 130 non-archived) or all tenants (131 / 131). The §51 "100% explained" standard for current retail must be computed on a named population, never on an unstated mix of the two | The only difference between the two populations is `JN8AZ3DB6T9435410` (Section 15 item 6); every Gate 1 map that says "131" is counting it | I2, I3 |
| 2 | Carry `JN8AZ3DB6T9435410` (tenant 93ae75c1, `price` $171.00, `website_sale_price` $1,066.00, 0 `advertised_prices`, 0 `vehicle_files`) as UNEXPLAINED under §51 until the owner archives it or explains it; report it as a named row, never averaged into a rate | It is publicly served by `get_vehicle_listing_by_slug` (Q19) and has no evidence row | I1, I2, I3 |
| 3 | Tolerate a listing with no `vehicle_files` row: the stock-number candidate is simply absent (status UNEXPLAINED for the `stock` field), not a crash or a silent null. Live: exactly one such listing (Q12/Q18), none in the pilot | `vehicle_files.stock_number` is the only populated stock source in the pilot (Section 6) | I1 |
| 4 | Build `recentChanges` / the timeline from `vehicle_change_history` (index `(tenant_id, vin, changed_at DESC)`) and `vehicle_value_history` (`(vin, captured_at DESC)`), and read `audit_log` only through `(entity_type, entity_id)` — never from the tenant-wide newest-400 tail that `useVehicleEvidence` uses today (254 KB, 0 matches for the sample; Section 5.4) | No index serves `action` or `details->>'vin'`/`details->>'slug'` on `audit_log` (Q15); if per-VIN audit reads by `details->>'vin'` are required, an expression index `(store_id, (details->>'vin'))` is a MIGRATION the owner must approve first | I3 |
| 5 | Project named columns from `vehicle_listings`, not `select('*')`; return `mc_attributes` sub-objects (`msrp`, `base_msrp`, `total_msrp`, `engine`, `drivetrain`, `dom*`) only to the sections that need them | Pilot rows average 21.1 KB (max 29.0 KB), `mc_attributes` 11.1 KB, fetched whole three times per visit (Section 5.4) | I3 |
| 6 | §45 role composition: either the read model becomes the shared source for the specialist per-vehicle screens the role homes actually open (`ServiceVehicleWorkspace`, `VinCommandCenter`, `GetReadyCommand`), or the role homes gain a Vehicle File deep link. Today no role home links to `/vehicle-file` (Section 8) | Otherwise the read model serves a page the directive's named roles never reach | I3 |
| 7 | Re-evaluate lifecycle for the 9 pilot listings that are `status published` with `vehicle_lifecycle.state = 'REMOVED'` (Q16); lifecycle-first role homes hide them. Ties to `DUPLICATE_READ_PATHS.md` section G rank 4 | A published car that no role home can see | I3 |
| 8 | Split `ymm` into year / make / model; resolve MSRP, engine, drivetrain from the candidates already held in `mc_attributes` and `vehicle_facts`; expose `observed_at` and source per fact; raise a CONFLICTED state when `vehicle_facts.advertised_price` disagrees with `vehicle_listings.price` (99 of 117 pilot listings with the fact, Q7); relabel `dealer_confirmed` values that were feed-written (Section 6 provenance mislabel) | Carried forward from Sections 6, 14 and 15 (items 11-12); unchanged by the inspection | this map |

Cross-map notes: `SOURCE_TO_FACT_MATRIX.md` Unknown 10 must be closed by citing Section 15 item 6 / Q12 / Q18 and restated on the pilot population (130); `DUPLICATE_READ_PATHS.md` section G needs the payload-and-index row from Section 5.4 and the §45 entry-path gap; `FACT`, `LICENSE`, `PROVIDER` and `DUPLICATE` maps that count "131" should name the extra VIN.

---

## Inspector corrections (Gate 1, 2026-09-09)

Each finding from `insp_VEHICLE_FILE_CURRENT_STATE_MAP.md.json`, re-verified read-only against the repo and the live database before writing (Q13-Q19; code lines re-read).

1. I1-db (minor) — cross-map inconsistency on the 131st published listing: APPLIED. Section 15 item 6 re-verified and extended (slug, view_count, tenant facts, `vehicle_files`/`advertised_prices` = 0); Section 17 items 2-3 record that the shadow comparison must tolerate a listing with no `vehicle_files` row and report the $171 row explicitly. The SOURCE-side edit (close Unknown 10 by citing this map) is noted as a cross-map change; that file is not modified here.
2. I2-truth (major, must fix) — extra row is not new and not Harte; `get_vehicle_listing_by_slug` serves it publicly: APPLIED for this map. Q18/Q19 confirm every quoted value and the `SECURITY DEFINER` / no-tenant-filter definition; Section 15 items 6 and 13 updated; Section 17 item 1-2 declare the VIN-scope and UNEXPLAINED requirements. The archive/unpublish action is RECORDED AS OWNER DECISION (data action, not performed). The SOURCE Unknown 10 correction is a cross-map note.
3. I3-product (minor) — Section 8 wrongly said role homes link into the Vehicle File: APPLIED. Re-verified (`grep -c 'vehicle-file'` = 0 in all six files; targets listed per file:line); Section 8 corrected, two rows added (entry path by role, lifecycle-first homes), Section 15 item 14 and Section 17 items 6-7 record the §45 gap and the 9 REMOVED-on-published cars (Q16 confirms 32/17/9, all published).
4. I3-product (major) — mobile bottom-bar overlap provable from code: APPLIED as a status change (REVIEW REQUIRED -> CONFIRMED FROM CODE) in Executive summary item 8, Section 9 and Section 15 item 1, after re-reading `AppShell.tsx:412, 736, 1075-1076` and `VehicleFile.tsx:234, 389`. The proposed fix (extend the chrome exception or offset the action bar) is RECORDED AS PROPOSAL — code change, owner decision; not implemented; browser verification still outstanding.
5. I3-product (major, must fix) — counts must be explicit about pilot (130) vs all tenants (131): APPLIED. A count-scope statement was added under the title; Section 15 item 6 now carries the tenant facts (2 members, `autolabels:unlimited:active`, profile source `manual`, 0 views), re-verified by Q18. The restatement of SOURCE_TO_FACT counts is a cross-map note; Section 17 item 1 carries the shadow-model scope requirement.
6. I3-product (major, must fix) — payload weight and index coverage missing: APPLIED. New Section 5.4 with live measurements (Q13: 21.1 KB avg / 29.0 KB max / 11.1 KB `mc_attributes`; Q14: 254 KB newest-400 tail, 11,602 rows, avg row 539 B versus the inspector's 570 B measured earlier the same day — figure updated, conclusion unchanged; Q15: index lists match the inspector's). The `select('*')` projection change and the expression-index / `qr_scan_events` index are RECORDED AS PROPOSAL (code and MIGRATION changes, owner decision); Section 17 items 4-5 carry the read-model requirements. `DUPLICATE_READ_PATHS.md` section G must also gain this row (cross-map note).

No finding was rejected. No file other than this map was modified; nothing committed.
