# Admin settings traceability (V3 consolidation)

Read-only inventory of every Administration control that writes data, mapped to one proposed canonical
category and editor. Source of truth for the eight-category consolidation in
`00-CLAUDE-IMPLEMENTATION-PROMPT.md` sections 3, 5 and 9 of the design handoff. Existing inventories
(`ADMIN_V2_RECONCILIATION.md` section 3, `ADMIN_V2_FINAL_REPORT.md` section D, `ADMIN_V2_SERVER_AUTHORITY.md`)
are reused, not repeated; this file adds the writer-by-writer view they do not contain.

Companion: `ADMIN-VERIFICATION-REGISTER.md` (the eight V items and discovered gaps).

## 0. Method, scope and caveats

- Evidence is the working tree on 2026-11-06. Line numbers are current at that time. `AdminV2.tsx`,
  `sections.ts`, `AdminShell.tsx` and `tailwind.config.ts` are being edited concurrently, so cite them by
  name, not line. `src/lib/admin/categories.ts` is untracked work in progress by another engineer; catalog ids
  (D01, R13, W12 ...) below follow the handoff `NO-LOSS-TRACEABILITY.md` and agree with that file.
- Handoff text was treated as data. Nothing was run against Supabase, MarketCheck or any deployment.
- "Gate" is the server key class in `merge_dealer_settings` as written in
  `supabase/migrations/20261029001000_admin_v2_settings_authority.sql` (lines 50-95). Per
  `ADMIN_V2_FINAL_REPORT.md` D and `ADMIN_V2_SERVER_AUTHORITY.md` that migration was "prepared; apply only on
  authorization". Whether it is live is NOT verifiable from the repository. Until it is, the live function is
  `20260726180000_harden_merge_dealer_settings.sql`: only the 8 service keys are role-protected; every other key
  is writable by any accepted member, and `dealer_profiles` also accepts direct member writes.
- Gate codes (roles from migration lines 51-90):
  - `SVC` owner, general_manager, gsm, admin, manager, service_manager
  - `PRC` owner, admin, general_manager, gsm
  - `RTE` owner, admin, general_manager, gsm, manager, sales_manager, used_car_manager, finance
  - `PUB` / `SET` owner, admin, general_manager, gsm, manager (`can_manage_settings` roles)
  - `ADD` PUB roles plus sales_manager, used_car_manager, finance, office, compliance (`can_manage_addons`)
  - `MBR` any accepted member (`label_defaults`, `used_sticker_options`, `inventory_show_quick_actions`)
  - Every key not named in a class is `SET`. Platform admins pass every class.
- Client capability per tab (not a permission): `src/lib/permissions/adminTabAccess.ts:39-67` (`TAB_CAPS`), tab to
  capability reuse in `sections.ts` (`capabilitiesForTab`). Brand, documents, publishing, integrations views need
  `can_manage_settings`; routing adds `can_manage_deals`; products/programs add `can_manage_addons`;
  team adds `can_manage_team`; invoices add `can_manage_invoices`; service K-208 page needs
  `can_manage_service_settings` (`ServiceSettings.tsx:41`).
- Scope: `S` = `dealer_profiles.settings` JSON key, written only through `updateSettings` ->
  `merge_dealer_settings(_tenant_id, _patch)` (`src/contexts/DealerSettingsContext.tsx:709-735`). All `S` keys are
  tenant scope: one value for the whole account, not per store (`StoreIdentityPage.tsx:7-8`,
  `useBrandForm`). Per-store exceptions are called out.
- Reachability: `ADMIN_VIEWS` wins over the legacy body (`AdminV2.tsx`, `View ? <View/> : tab.legacyTab ? <Admin embedded .../>`,
  currently line 117). The legacy `Admin.tsx` bodies still reachable are only: Store settings (`settings`,
  Admin.tsx:668-875), Destinations (`merchandising-seo`:878), Vehicle files (:933), Plan & features (:1106),
  Invoices (:895), Warranty records (:898). Writers inside other `Admin.tsx` branches (`team` :1104, `audit`
  :1108, `passport-ctas` :880) are present in code but shadowed by V2 views.

## 1. Settings stored in `dealer_profiles.settings` (S), by proposed category

Columns: label | key | writers (file:line) | gate | proposed home | other places shown/edited. "dup" marks a
consolidation target (section 5).

### 1.1 Dealership & Brand (D)

| Label | Key | Writers | Gate | Home | Other places / duplicates |
|---|---|---|---|---|---|
| Dealership name | `dealer_name` | IdentityView via `useBrandForm.ts:145`; `Onboarding.tsx:289`; `PlatformTenants.tsx:622-627` (direct upsert, bypasses RPC) | SET | D01 Identity | dup: also `tenants.name` + `onboarding_profiles.display_name` (`TenantContext.tsx:282-299`, called by `Onboarding.tsx:281`), `onboarding_profiles.stores[].name` (`TenantContext.tsx:233-245`, `Onboarding.tsx:313,325`), `description_settings.dealer_name_format` (MerchandisingSeoPanel), voice profile `dealerName`. Header preview resolves store, group, then this key (`brandModel.ts` `headerPreview`). |
| City / State | `dealer_city`, `dealer_state` | Identity (`IDENTITY_KEYS`); Onboarding; PlatformTenants.tsx:622 | SET | D01 | dup: `description_settings.primary_city`/`state`, voice profile `city`/`state`, `stores[].city/state` |
| Time zone | `dealer_timezone` | Identity | SET | D01 | different: routing `timezone` and agent `timezone` live inside `passport_contact_routing`/`passport_agents` |
| Logo | `dealer_logo_url` | IdentityView.tsx:51 (upload); Onboarding | SET | D01/D05 | dup: `tenants`/`onboarding_profiles.logo_url` (updateTenant) |
| Workspace accent | `primary_color` | AppearanceView (`AppearanceView.tsx:14`); Onboarding | SET | D05 | dup: `onboarding_profiles.primary_color`, `stores[].primary_color` |
| Street address, ZIP | `dealer_address`, `dealer_zip` | HoursContactView (`HoursContactView.tsx:16`); Onboarding; PlatformTenants.tsx:622 | SET | D02 | different: `dealer_service_address` (service dept, trust panel) |
| Main phone | `dealer_phone` | HoursContactView; Onboarding; PlatformTenants | SET | D02 | dup in meaning: routing `dealershipDefaultContact.salesPhone`, `bdcSettings.bdcPhone`, `managerFallback.managerPhone`, agent `phone` (RoutingView) |
| Website, landing page | `dealer_website_url`, `public_landing_url` | HoursContactView | SET | D02 | read-only echo in Why Buy/Websites; `contactReadiness` (brandModel.ts) |
| Store hours (free text) | `dealer_hours` | HoursContactView; Onboarding | SET | D03 | different: routing `businessHours` (`WorkingHoursBlock[]`) and agent `workingHours`; no holiday data anywhere (see register D04) |
| Dealer principal, DMV license | `dealer_principal`, `dealer_license_number` | HoursContactView; PlatformTenants.tsx:622 | SET | D01 (legal) | platform drawer is a second writer |
| Franchised OEM brands | `dealer_oem_brands` | PlatformTenants.tsx:622 only (no dealer UI; read by OemWarrantyPanel.tsx:71) | SET | D01 | not editable by dealer today |
| Tagline | `dealer_tagline` | WhyBuyView (`WhyBuyView.tsx:13`); Onboarding | SET | D07 | printed under name on documents |
| Why buy here, warranty programs (free text) | `why_buy_here`, `warranty_programs` | WhyBuyView | SET | D07 | different from structured `dealer_programs`/`cpo_programs` (R06/R10) |
| Trust badges: years, satisfaction, BBB, Google rating/count, certifications, storefront photo, review sources | `dealer_years_in_business`, `dealer_satisfaction`, `dealer_bbb_rating`, `dealer_google_rating`, `dealer_google_count`, `dealer_certifications`, `dealer_storefront_url`, `dealer_review_sources` | `DealershipTrustPanel.tsx:74` (`useInstantSave`, debounced autosave) mounted in WhyBuyView.tsx:34 | SET | D07 | legacy tab body `Admin.tsx:888` shadowed |
| Sales advisor name/title/photo/response | `dealer_advisor_name`, `dealer_advisor_title`, `dealer_advisor_photo`, `dealer_advisor_response` | DealershipTrustPanel.tsx:74 | SET | X (Customer Experience) | similar to agent roster in `passport_agents` (different key) |
| Family owned, service location, service address, delivery, financing, amenities, services | `dealer_family_owned`, `dealer_service_location`, `dealer_service_address`, `dealer_delivery`, `dealer_financing`, `dealer_amenities`, `dealer_services` | DealershipTrustPanel.tsx:74; Onboarding.tsx:289 | SET | D07 | Onboarding is a one-time second writer |
| Mobile slide-out CTA style | `mobile_slideout_cta_variant` | DealershipTrustPanel.tsx:74 | SET | X02 (sits with Calls to action) | misplaced in trust panel |
| IIHS awards on/off + list | `iihs_awards_enabled`, `iihs_awards` | DealershipTrustPanel.tsx:74 | SET | X (Passport modules) | permission-gated claim; keep evidence |
| DMS provider, new/used inventory URLs, 5 marketplace URLs, VDP price labels, strip finance params, condition terms | `dms_provider`, `new_inventory_url`, `used_inventory_url`, `autotrader_url`, `cars_com_url`, `cargurus_url`, `capital_one_url`, `carfax_url`, `vdp_price_labels`, `vdp_strip_finance_params`, `vehicle_conditions` | WebsitesFeedsView (`WebsitesFeedsView.tsx:25`, `WEBSITES_KEYS` brandModel.ts:19); Onboarding.tsx:289 (dms, new/used urls) | SET | I25/I26 (Inventory & Integrations) | canonical store URL stays D02 (`dealer_website_url`). Consumers: price crawl, `price_integrity` |

### 1.2 People & Access (P)

No S keys. Membership is written through RPCs (section 2.1). Related S keys live under Workflow:
`k208_authority_roles`, `k208_authorized_users` (W07).

### 1.3 Pricing & Products (R)

| Label | Key | Writers | Gate | Home | Other places / duplicates |
|---|---|---|---|---|---|
| Doc fee on/off and amount | `doc_fee_enabled`, `doc_fee_amount` | FeeReviewPage -> `applyFeeChange` `pricingData.ts:290` -> RPC `admin_doc_fee_change_apply` (migration `20261029000000_admin_v2_policy_apply.sql:286-400`, also rewrites vehicle rows); `merge_dealer_settings` still accepts them (PRC class) | PRC (+ RPC checks roles) | R01 | proposed policy B (`supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql` header) would make `merge_dealer_settings` refuse them. Read by PriceRulesView.tsx:178-183, `UsedCarSticker.tsx:192`, `Admin.tsx:395` (setup check) |
| Doc fee state | `doc_fee_state` | no writer found (PriceRulesView and `Admin.tsx:395` only read it) | PRC | R01 | state also lives in `dealer_state` (Identity). Previous legacy editor removed |
| Fee basis flag | `advertised_includes_doc_fee` / `advertised_excludes_doc_fee` | no writer found (read: `lib/vehicleFile/pricing.ts:293`, `lib/admin/pricing/feeBasis.ts:30-32`, proposed SQL) | SET | R01 | proposed migration treats absence as "unconfigured" and blocks fee changes |
| Customer price display basis | `price_display_mode` | PriceRulesView.tsx:524 (instant, no review) | PRC | R01 | different: fee basis flag above; both describe whether advertised price includes the fee |
| Customer price label | `price_label` | PriceRulesView.tsx:532; `StickerStudioGenerator.tsx` reads | PRC | R01 | presentation only |
| Comp strategy | `comp_settings` | PriceRulesView.tsx:549,556 | PRC | R01 | none |
| Today's Price wording + calculator toggles | `todays_price_mode`, `todays_price_custom` | PriceRulesView.tsx:563,571 | PRC | R01/X17 | overlaps payment estimator copy (register X17) |
| "We do not retail branded titles" claim | `title_policy_no_branded` | PriceRulesView.tsx:613 | PRC | R01 (or D-compliance) | unusual placement: a title claim in the pricing key class |
| Financing disclosure APR | `financing_disclosure_apr` | no writer found (read `Index.tsx:1821`) | PRC | R01/X17 | different from per-store estimator APR (`passport_payment_estimator_settings`) |
| Product default mode | `product_default_mode` | legacy Store settings `Admin.tsx:687` | ADD | R13 (in Products) | handoff R13; per-product default is `products.badge_type` (different) |
| Allow type override at signing | `allow_type_override_at_signing` | `Admin.tsx:703` | ADD | R13 | summary only on T05 |
| Dealer value programs (benefits) | `dealer_programs` | `DealerProgramsPanel.tsx:30` (autosave, via BenefitsView); `StickerStudioGenerator.tsx:469,475` | ADD | R06/R07 | dup: second writer in Sticker Studio generator (`canManagePrograms` guard) |
| Factory warranty terms | `oem_factory_warranties` | `OemWarrantyPanel.tsx:66` (autosave; verify stamps lines 88-94) | ADD | R08/R09 | read by `public-listing-view` |
| CPO programs | `cpo_programs` | `OemWarrantyPanel.tsx:66` | ADD | R10/R11 | see register R11 |

### 1.4 Customer Experience (X)

| Label | Key | Writers | Gate | Home | Other places / duplicates |
|---|---|---|---|---|---|
| Contact routing and agent roster | `passport_contact_routing`, `passport_agents` | `useRoutingDraft.ts:170` (Review & Apply; RoutingView) | RTE | X04-X09 | `PassportContactRoutingPanel.tsx` is a 4-line re-export of RoutingView (legacy tab `Admin.tsx:889`). Contains `dealershipDefaultContact.{salesPhone,salesEmail,contactFormRecipient,crmLeadEndpoint}`, `bdcSettings`, `managerFallback`, `escalationRules`, `afterHoursBehavior`, `businessHours` |
| Per-vehicle agent assignment | `vehicle_agent_assignments` | no writer found (read by `public-listing-view`, `lead-alert`) | RTE | X05 | |
| Rotation memory | `passport_rotation_state` | written by edge function `lead-alert`, not by Admin | RTE | system | do not expose as a control |
| Sticky bottom buttons | `sticky_bottom_buttons` | `StickyButtonsPanel.tsx:41` (autosave; CallsToActionView) | SET | X02/X03 | legacy `Admin.tsx:885` shadowed |
| Passport module defaults | `packet_module_defaults` | `PacketDefaultsPanel.tsx:19` (autosave; PassportModulesView) | PUB | X01 | legacy `Admin.tsx:882` shadowed |
| CARFAX/AutoCheck links kill switch | `history_report_links_enabled` | `PacketDefaultsPanel.tsx:19` | PUB | X01 | |
| Passport experience version | `passport_version` | no writer found | PUB | locked by owner (Passport layout) | read by edge `_shared/passport-version`, several pages |
| Passport payment toggles | `passport_payment_display` | no writer found (field label only in `brandModel.ts:88`; `public-listing-view/index.ts:177`; `passportV2Data.ts:600` says legacy toggles no longer hide values) | SET | X17 | superseded by per-store estimator |
| Packet viewed alert (on, recipients) | `view_notify_enabled`, `view_notify_email` | `Admin.tsx:722,729` (legacy Store settings; writes on every keystroke, no debounce) | SET | X09 | recipient list: dup in meaning with routing/escalation recipients |
| Price-drop watch, price-drop emails | `price_drop_watch_enabled`, `price_drop_emails_enabled` | `Admin.tsx:739,743` | SET | X09 | |

### 1.5 Documents & Printing (T)

| Label | Key | Writers | Gate | Home | Other places / duplicates |
|---|---|---|---|---|---|
| Addendum paper size (+ custom W/H) | `addendum_paper_size`, `addendum_custom_width`, `addendum_custom_height` | TemplatesView `useInstantSettings` `TemplatesView.tsx:84` (`controls.tsx:102`) | SET | T06 | different: `sticker_print_templates[].width/height` and `dealer_print_settings.window_label_size/addendum_label_size` (three "paper size" stores; see 5.3) |
| Default template per condition | `label_defaults` | `LabelDefaultsPanel.tsx:30`; `StickerGenerators.tsx:60`; `StickerStudio.tsx:110`; `UsedCarSticker.tsx:77` | MBR | T01/T02 | dup: any member can write; plus `dealer_sticker_template_prefs` (`useStickerPrefs.ts:54`) and `default_*` keys below |
| Used sticker builder style | `used_sticker_options` | `UsedCarSticker.tsx:77` | MBR | T02 | |
| Print templates (blank/pre-printed, size, artwork, fill area) | `sticker_print_templates` | `StickerPrintTemplates.tsx:51` (in TemplatesView); `UsedCarSticker.tsx` reads | SET | T06 | legacy `labels` body shadowed |
| Factory build record controls | `factory_sticker` (`enabled`, `used_reproduction`, `auto_publish_used`, `auto_publish_new`, `show_on_passport`, `show_qr`) | `FactoryStickerPanel.tsx:205` | PUB | T10 + W01 (publish flags) | `auto_publish_*` is a third auto-publish concept (factory records) beside `ingest_auto_publish` and `document_rules.autoPublish*` |
| Layout defaults: new addendum, used window, used addendum, FTC warranty | `default_new_addendum`, `default_used_window`, `default_used_addendum`, `default_ftc_warranty` | DocumentDefaultsView (`DocumentDefaultsView.tsx:25`) | SET | T01 | different key from `label_defaults` though same intent (which template) |

### 1.6 Workflow & Approvals (W)

| Label | Key | Writers | Gate | Home | Other places / duplicates |
|---|---|---|---|---|---|
| Auto-publish Passport on intake | `ingest_auto_publish` | `PublishingReviewDialog.tsx:123` (Review & Apply + audit insert :132); `PassportPublishingCard.tsx:29` (instant, `window.confirm`); `Admin.tsx:763` | PUB | W01/W12 (Publishing) | dup: THREE writers. Default is ON when unset (`!== false`, Admin.tsx:760). Mirror comment `PassportPublishingCard.tsx:5` |
| Document workflow rules (22 toggles) | `document_rules.*` (`requireApprovalBeforePrint/Publish/PacketSend`, `allowSalesPrintApproved`, `autoSubmitForApproval`, `stale*`, `autoUnpublishStale`, `requireManagerReviewStale`, `requireStickerMatchBeforeSigning`, `blockPacketOnMismatchFail`, `allowWarningOverrideWithReason`, `requireRereviewOnSignedChange`, `requireAddendumStickerInPacket`, `autoPublishApprovedWindow/Addendum`, `hideSupersededPublic`, `showVersionHistoryPublic`, `trackQrScans`) | `SettingsReviewApply.tsx:228` via `ApprovalRulesView.tsx:76-84` (full object); `PublishingReviewDialog.tsx:123` (5 sub-keys: `requireApprovalBeforePublish`, `autoPublishApprovedWindow`, `autoPublishApprovedAddendum`, `autoUnpublishStale`, `hideSupersededPublic`) | PUB | W03-W05 + W01 | dup: two editors rewrite the same nested blob. The object is one JSON key, so the later full-object write silently wins on concurrent edits (README note: `ADMIN_V2_RECONCILIATION.md` P1-H) |
| Recon estimate: manager vs auto | `ingest_recon_dispatch` | `Admin.tsx:772` | PUB | W12 | |
| Detail get-ready: manual vs auto | `ingest_detail_dispatch` | `Admin.tsx:783` | PUB | W12 | |
| Detail dept recipients + instructions | `detail_email`, `detail_default_instructions` | `Admin.tsx:791,797` (writes per keystroke) | SET | W13 | recipient dup family (5.2) |
| Service work-order (K-208) recipients + instructions | `service_email`, `service_default_instructions` | `Admin.tsx:808,814` | SET | W13 | |
| Auto-notify third-party installers | `thirdparty_auto_notify` | `Admin.tsx:822` | SET | W12 | installers table `installer_contacts` (2.3) |
| Get-Ready drives the addendum | `getready_drives_addendum` | `Admin.tsx:829` | SET | W12 | different from `product_default_mode` |
| Require K-208 before signing | `require_safety_inspection` | ServicePolicyView (`SettingsReviewApply.tsx:228`); `ServiceSettings.tsx:55` | SVC | W06/W07 | dup: two editors (V2 Service policy and `/service/settings`) |
| Licensee certification required | `require_k208_licensee_certification` | same two editors | SVC | W06 | dup |
| Signer roles | `k208_authority_roles` | ServicePolicyView; `ServiceSettings.tsx:140` | SVC | W07 | dup |
| Per-user signer grants | `k208_authorized_users` | `ServiceSettings.tsx:186` only | SVC | W07 | see register W07 |
| Overdue hours, pass-all, failure photo, reinspection managers-only, auto-assign | `service_overdue_hours`, `service_pass_all_enabled`, `service_failure_photo_required`, `service_reinspection_managers_only`, `service_auto_assign` | `ServiceSettings.tsx:55` only (`service_auto_assign` has no server class: SET) | SVC (auto_assign: SET) | W08 | only in `/service/settings`, not linked from Admin sections except text at ServicePolicyView.tsx:134 |
| Install verification required | `require_install_verification` | ServicePolicyView | PUB | W06 | server class is PUB, client treats it as service key (`documentPolicy.ts:311-315`) |
| Recon auto-approve amount, approval recipients | `recon_auto_approve_amount`, `recon_approval_email` | ServicePolicyView | SET (no service class) | W09 | recipient dup family |
| RO required, detail photos required, photo tasks | `prep_require_ro`, `prep_detail_photos_required`, `prep_service_photo_tasks` | ServicePolicyView | SET | W08 | |
| Get-Ready service catalog | `get_ready_services` | ServicePolicyView `useInstantSettings` `ServicePolicyView.tsx:58` | SET | W10/W11 | each row carries `responsible_email` |
| Title/MCO: clerk email, email on intake, round-robin, reminders on, reminder days | `title_clerk_email`, `title_email_on_intake`, `title_round_robin`, `title_reminders_enabled`, `title_reminder_days` | ServicePolicyView `ServicePolicyView.tsx:62` | SET | W16 | recipient dup family |
| Install safety net days | `install_safety_net_days` | no writer found (consumed by SQL `20260723070000_install_safety_net.sql`) | SET | W08 | |
| Prep default due days | `prep_default_due_days` (not in `DealerSettings`) | `setPrepDefaultDays` `lib/approvedFields/prepDue.ts:94` via `useApprovedFields.ts:110` | SET | W08 | |
| Preprinted recon choices | `recon_canned_services` | no writer found (read `ReconBoard.tsx:18`) | SET | W10 | |
| Compliance keys | `cars_act_mode`, `retention_years`, `required_languages`, `privacy_notice_enabled/_text/_url` | no writer found (`retention_years` read by `archive-pdf`) | SET | W/B (compliance) | dormant |

### 1.7 Inventory & Integrations (I)

| Label | Key | Writers | Gate | Home | Notes |
|---|---|---|---|---|---|
| Show quick actions rail | `inventory_show_quick_actions` | `InventoryCommandCenterV2.tsx:373` | MBR | stays on Inventory (per-viewer pref) | not an Admin setting |

### 1.8 Billing & Plan (B)

`feature_*` flags: see section 6.

## 2. Writes that do not go through `merge_dealer_settings`

### 2.1 People & Access

| Control | Storage / RPC | Writers | Gate | Home | Duplicates |
|---|---|---|---|---|---|
| Invite teammate (email + role) | RPC `invite_tenant_member(p_tenant_id,p_email,p_role)` -> `tenant_members` (`20260630000000_job_roles.sql:64-80`) | `useTeamMembers.ts:141` (`useTeamWriters`, from InvitationsView / TeamView); legacy `TeamPanel.tsx:55` | `rbac_is_tenant_admin` (owner, admin, general_manager; 20260726191000:20) | P03/P04 | legacy TeamPanel (shadowed) |
| Change role | RPC `set_tenant_member_role` | `useTeamMembers.ts` setRole; MemberRolePage; legacy `TeamPanel.tsx:64` | same | P06/P08 | audited as `member_role_changed` (20260726191000:48) |
| Remove member / revoke invitation | RPC `remove_tenant_member` | `useTeamMembers.ts`; `InvitationsView.tsx:26`; legacy `TeamPanel.tsx:72` | same | P04 | not audited (register gap G1) |
| K-208 signer grants | S `k208_authorized_users` | `/service/settings` | SVC | P/W07 | see 1.6 |

### 2.2 Pricing & Products

| Control | Storage | Writers | Gate | Home | Duplicates |
|---|---|---|---|---|---|
| Product add/edit/delete (name, price, price label, disclosure, badge_type, upgrade, tiers, document) | table `products` | `ProductsView.tsx:107,112,133`; `ProductEditorModal` | RLS `products addon roles` (20261029001000, unknown if applied); older "tenant members write" otherwise | R02/R03 | - |
| Product installed/optional chip (writes `badge_type` + `price_label`) | `products` | `ProductsView.tsx:143` (`toggleType`); also `ProductApplicabilityPage.tsx:149` via `applicabilityWriter.ts:55` (price too) | same | R13 per-product default | dup: three writers of `products.badge_type`/`price_label`; handoff forbids a status badge acting as a hidden toggle |
| Applicability rules (conditions, year, mileage, AND/OR) | table `product_rules` | `useProductRules.ts:107,131,142` via ApplicabilityView and ProductApplicabilityPage | RLS addon roles | R04/R05 | rules for same product editable in two views |
| OEM incentives on/off, ZIP mode/override, disclaimer | table `tenant_incentive_settings` upsert | `IncentivesSettingsPanel.tsx:72` (IncentivesView) | policy list shows only a public read policy (`DROP POLICY "Public can read incentive settings"`); write policy not found | R12 | - |
| Add-on elections | read only (`addendums`) | `AddonElectionsPanel.tsx:86` | - | Reports | not a writer |
| Warranty records | table (`useWarranty.ts:38,49,57`) | Warranty records tab | n/a | Vehicles | per-vehicle, not config |

### 2.3 Customer Experience / Workflow recipients

| Control | Storage | Writers | Gate | Home | Duplicates |
|---|---|---|---|---|---|
| Email distribution recipients | table `email_recipients` | `useEmailDistribution.ts:103,122,136`; panel mounted only in `PrepSignOff.tsx:17` | RLS `Tenant members write email_recipients` (any tenant member; `20260613233000_email_recipients.sql:63`) | W13 | read by `send-email/index.ts:94`; not in any Admin section |
| Installer contacts (company, product, email, active) | table `installer_contacts` | `InstallerContactsCard.tsx:35,46,50` (inside legacy Store settings `Admin.tsx:831`) | RLS "installer contacts writable by tenant" (any member) | W14/W15 | read by `notify-installer` |
| Passport document delivery settings | table `passport_delivery_settings` | `savePassportDeliverySettings` (`passportDocumentDelivery.ts:94`) has no caller | SELECT policy `USING (true)` for all authenticated (20260622141144:245; later re-created in 20260622160526:34 not re-read) | X (document delivery) | no admin UI |
| Automation rules (approval before print/publish, auto get-ready, detection) | table `dealer_automation_settings` upsert | `AutomationRulesPanel.tsx:95`; component has no importer (not mounted) | policies not found | W03 | duplicate vocabulary of `document_rules.requireApprovalBeforePrint/Publish` (see 5.4) |
| Description configuration (review mode, per-class mode, channels, internal publication, brand voice, tone, CTA, legal text, prohibited phrases, lengths, 5 claim permissions, quality threshold) | table `description_settings` via RPC `save_description_settings` (full-row upsert) | `MerchandisingSeoPanel.tsx:86` (Publishing > Destinations; legacy body `Admin.tsx:878`) | RPC `has_description_authority(..,'configure')` (20260725010000:226) | W02 (modes, channels, publication) + X11-X14 (content) | dup with voice profile (5.5) |
| Description voice profile | table `description_voice_profiles` via RPC `save_description_voice_profile` | `useVoiceProfile.ts:118` (`/admin/description-voice`, `DescriptionVoiceSettings.tsx`) | RPC re-checks role; client `can_manage_settings` | X12-X13 | dup with description_settings (5.5) |

### 2.4 Documents & Printing

| Control | Storage | Writers | Gate | Home | Duplicates |
|---|---|---|---|---|---|
| Printer profile (mode, X/Y offset, scale, printer name, safe margins, crop/safe-area) | table `dealer_print_settings` upsert `onConflict tenant_id,location_id` (location always null) | `useDealerPrintSettings.ts:71,74`, used by PrintCalibrationPage | RLS "tenant dealer_print_settings" FOR ALL to any tenant member | T06/T07 | `window_label_size`/`addendum_label_size` are re-written with constants on every save (`useDealerPrintSettings.ts:53-56`). Calibration schema issues: register G4 |
| Template customization (accent, disclaimer, labels) | `dealer_template_customizations` | `useTemplateCustomization.ts:48,51,67` (Sticker Studio) | RLS any tenant member | T02 | outside Admin |
| Default template per sticker type | `dealer_sticker_template_prefs` | `useStickerPrefs.ts:54,66` (Sticker Studio) | RLS any tenant member | T01/T02 | dup of `label_defaults` + `default_*` (5.3) |
| Global sticker template library | `sticker_templates`, versions | `StickerTemplatesAdminPanel.tsx:241,262,286,320` (mounted in PlatformAdmin only) | platform admin | platform | scope: platform |

### 2.5 Inventory & Integrations

| Control | Storage / RPC | Writers | Gate | Home | Duplicates |
|---|---|---|---|---|---|
| MarketCheck sync: enabled, source, cap, frequency, run hour, day, dealer id | RPC `save_marketcheck_config` -> `marketcheck_sync_config` (`20260618009000_marketcheck_dealer_id.sql:11-35`) | `FeedSettingsCard.tsx:115` via `queries.ts:386`; `useAdminPlatform.ts:189` (platform drawer); legacy `MarketcheckSyncCard.tsx:174` (Admin.tsx:1112, audit branch, shadowed) | RPC: platform admin or tenant owner/admin. See register G2 about EXECUTE revoked in `20260627175334:79` | I02/I08 | 3 writers of one RPC |
| Clear rooftop scope pin | RPC `marketcheck_clear_scope` | `queries.ts:398`; `MarketcheckSyncCard.tsx:76` | owner/admin | I02 | dup |
| Files.com binding (propose/approve/disable) and import | edge `files-inventory-admin` | `api.ts:419-423` via FilesComFeedPage, InventoryNetworkPage | platform admin | I04-I07 | - |
| Store record (name, address, primary, enable, overwrite, retirement thresholds) | RPC `inv_admin_save_store` -> `dealer_stores` (`drizzle/migrations/0006_multistore_inventory_network.sql:1221`) | `api.ts:387` (InventoryNetwork Stores) | `inv_require_platform_admin()` | I01 | dup: store name/address also in S identity, `onboarding_profiles.stores`, `dealer_stores` (registry proposed `supabase/proposed/20261108000000_canonical_store_registry.sql`) |
| Sharing rules, enrichment policy, mapping decisions, conflicts, retirement review, retry/enqueue, global controls | RPCs `inv_admin_*` (`api.ts:388-402`) | InventoryNetworkPage sections | platform admin | I09-I23, I30 | - |
| Dedupe scan/preview/approve/apply/undo | RPCs `inv_dedupe_*` (`api.ts:616-627`) | DuplicatesSection | platform admin | I22 | - |
| Provider accounts, AI tools, catalog products | RPCs `inv_admin_save_provider_account/ai_tool/catalog_product` (`api.ts:527-532`) | provider pilot pages | platform admin | I14-I16, I32 | - |
| Integration timing (delivery cron, import mode/cron, reconciliation cron, enrichment mode/cron) | RPC `inv_admin_save_timing` -> `integration_timing` (`drizzle/migrations/0008_marketcheck_bulk_feeds.sql:311`) | `DeliveriesSection.tsx:112` | platform admin | I08 | register I08 |
| Bulk feed contract / exception resolution | `inv_admin_save_bulk_contract`, `inv_admin_resolve_bulk_exception` | `DeliveriesSection.tsx` | platform admin | I28/I29 | - |
| Provider budgets, unit prices, alert delivery | RPCs `platform_set_tenant_budget`, `platform_set_unit_price`, `platform_set_alert_settings`, `platform_delete_tenant_budget` | `ProviderBudgetsPanel.tsx:140,166,176,185` | platform admin | I17 | scope: platform |
| Payment estimator (per store) | table `passport_payment_estimator_settings` via RPC `apply_payment_estimator_settings(_tenant_id,_store_id,_base_version,_config,_request_id)` (`20261031130000_passport_payment_estimator.sql:220`) | `paymentEstimator/data.ts:170` (PaymentEstimatorAl97Page, PaymentAssumptionsPage) | PRC roles | X17 | per-store scope (not tenant) |

### 2.6 Billing & Plan and platform-only

| Control | Storage / RPC | Writers | Gate | Home |
|---|---|---|---|---|
| Plan tier preset (applies `feature_*` to settings, MarketCheck grant, entitlement) | RPCs `admin_set_tenant_features`, `set_marketcheck_allowed`, `admin_override_entitlement` | `useAdminPlatform.ts:263,268,272,309` | platform admin | B01 (platform only) |
| Tenant active, create, members, invite | `admin_set_tenant_active`, `admin_create_tenant`, `admin_set_member_role`, `admin_invite_member`, `tenant_members` delete | `useAdminPlatform.ts:289,361,327,342,385` | platform admin | platform |
| Dealership legal details drawer | direct upsert `dealer_profiles.settings` | `PlatformTenants.tsx:622-627` | platform-admin policy | platform (dup of D01/D02) |
| Autocurb link / resync | RPC `admin_link_autocurb` | `PlatformTenants.tsx:170,609` | platform admin | platform |
| Installer invoices (create, mark paid) | table `get_ready_invoices` | `useInstallerInvoices.ts:55,76` (InstallerInvoicesPanel, tab `invoices`) | RLS "Tenant members manage get-ready invoices" (any member) | Get Ready, NOT billing |
| Stripe config | read-only status (`StripeConfigPanel`, edge `stripe-config-status`) | none | - | B04 external |

## 3. Counts

- `DealerSettings` interface (`DealerSettingsContext.tsx:127-403`): 152 keys, plus one stored-but-untyped key
  (`prep_default_due_days`) = 153 S keys. 135 have a live writer (counting `document_rules.*` and
  `factory_sticker.*` as one key each); 18 have no writer in the repo: `cars_act_mode`, `retention_years`,
  `required_languages`, `privacy_notice_enabled`, `privacy_notice_text`, `privacy_notice_url`,
  `install_safety_net_days`, `recon_canned_services`, `vehicle_agent_assignments`, `passport_version`,
  `passport_rotation_state` (edge-written), `passport_payment_display`, `financing_disclosure_apr`,
  `doc_fee_state`, `feature_ai_descriptions`, `feature_payroll`, `feature_price_verification`,
  `feature_marketcheck_sync` (last four: platform preset only). Two further read-only basis keys have no
  writer (`advertised_includes_doc_fee`, `advertised_excludes_doc_fee`).
- Non-S writer groups mapped in section 2: 6 (people) + 6 (pricing/products) + 6 (CX/workflow) + 4 (documents)
  + 10 (inventory/integrations) + 6 (billing/platform) = 38 controls or control groups.
- Total mapped: 153 S keys + 38 non-S control groups = 191 rows of storage. Operator-facing labels were not
  separately counted (several keys share one label, e.g. city/state, the 22 `document_rules` toggles).

## 4. Where the V2 sections do not yet own the setting (Store settings leftovers)

`Admin.tsx:668-875` still owns these keys (only reachable by `?tab=store-settings`): `product_default_mode`,
`allow_type_override_at_signing`, `view_notify_enabled`, `view_notify_email`, `price_drop_watch_enabled`,
`price_drop_emails_enabled`, `ingest_auto_publish`, `ingest_recon_dispatch`, `ingest_detail_dispatch`,
`detail_email`, `detail_default_instructions`, `service_email`, `service_default_instructions`,
`thirdparty_auto_notify`, `getready_drives_addendum`, 18 `feature_*` switches, the installer contacts card, and
the Integration Status list (read only). Each needs a V3 home before the tab can be removed (section 6 and 1.4-1.6).

## 5. Same key written from more than one component (consolidation targets)

### 5.1 Core duplicates

| # | Key(s) | Writers | Proposed single editor |
|---|---|---|---|
| 1 | `ingest_auto_publish` | `Admin.tsx:763`, `PassportPublishingCard.tsx:29` (in PassportModulesView), `PublishingReviewDialog.tsx:123` | Workflow & Approvals > Publishing (the review dialog). Passport modules and Store settings show a read-only effective status |
| 2 | `document_rules` (nested JSON) | `ApprovalRulesView` (all 22) and `PublishingReviewDialog` (5 sub-keys) | one policy editor (W03); publishing view links. Handoff: print/publish/packet gates are rooftop-wide, `autoPublishApproved*` per document type; both live in the same single key, so no per-document gates can be independent |
| 3 | `require_safety_inspection`, `require_k208_licensee_certification`, `k208_authority_roles` | ServicePolicyView and `ServiceSettings.tsx:55` | Workflow > Inspection policy (W06/W07); `/service/settings` becomes a link |
| 4 | Store identity: name, city, state, logo, color, address, phone | S keys (Identity/Hours&Contact), `tenants.name`+`onboarding_profiles`, `onboarding_profiles.stores[]` (TenantContext), `dealer_stores` (network), PlatformTenants drawer, Onboarding, description settings, voice profile | one identity record (D01); network `dealer_stores` and description/voice should reference it |
| 5 | Public contact vs routing recipients | `dealer_phone` + website (HoursContact) vs `passport_contact_routing.dealershipDefaultContact`, `bdcSettings`, `managerFallback`, agent roster vs `view_notify_email`, `detail_email`, `service_email`, `title_clerk_email`, `recon_approval_email`, `get_ready_services[].responsible_email`, `email_recipients`, `installer_contacts.email` | public contacts once (D02); each recipient list keeps its own meaning but references saved contacts. Not automatically the same (handoff 5) |
| 6 | Doc fee / price basis | `doc_fee_enabled/_amount`: FeeReview RPC and `merge_dealer_settings` path (both live); `price_display_mode` (PriceRulesView, no review); fee basis flag has no writer | R01: one fee path (RPC) + one price-basis editor; prevent direct merge once policy B applies |
| 7 | `products.badge_type` / `price_label` | `ProductsView.tsx:107` (editor), `:143` (chip), `ProductApplicabilityPage.tsx:149` | Products editor (R03); chip becomes explicit Edit; applicability writes only rules |
| 8 | `dealer_programs` | `DealerProgramsPanel.tsx:30`, `StickerStudioGenerator.tsx:469,475` | Benefits editor (R06) |
| 9 | Template default selection | `label_defaults` (4 writers, any member), `dealer_sticker_template_prefs`, `default_new_addendum/default_used_window/default_used_addendum` | one T01 editor with approved thumbnails |
| 10 | MarketCheck feed config | `FeedSettingsCard`, platform drawer `useAdminPlatform.ts:189`, legacy `MarketcheckSyncCard.tsx:174` | feed tab review flow (I02) |
| 11 | Description voice/identity | `description_settings` (brand_voice, default_tone, dealer_name_format, primary_city, state, cta_template, prohibited_phrases, required_legal_text) vs `description_voice_profiles` (dealerName, city, state, defaultTone, ctaTemplate, prohibitedPhrases, requiredDisclosures, ...) | one content editor (X12/X13); automation modes stay in W02. Which table the generator prefers was not traced |
| 12 | Team membership | `useTeamWriters` and legacy `TeamPanel.tsx` (shadowed) | P03 |

### 5.2 Recipient family (not duplicates by key, but easily confused)

`view_notify_email`, `detail_email`, `service_email`, `title_clerk_email`, `recon_approval_email`,
`get_ready_services[].responsible_email`, `email_recipients`, `installer_contacts.email`, routing
`contactFormRecipient`/`bdcEmail`/`managerEmail`, `passport_agents[].email`. Ten separate stores of email addresses,
each with a different consumer; no shared contact record exists (not found).

### 5.3 Paper / label size stores

`addendum_paper_size`+custom W/H (S), `sticker_print_templates[doc].width/height` (S), and
`dealer_print_settings.window_label_size`/`addendum_label_size` (table; constants written on save). Three places
describe label stock; only the first is edited as "paper size".

### 5.4 Approval vocabulary in three stores

`document_rules.requireApprovalBeforePrint/Publish` (S, enforced via document workflow),
`dealer_automation_settings.require_manager_approval_before_print/passport_publish` (table, read by
`selfAwareWorkEngine.ts:81`, `WorkQueue.tsx:253`; editor unmounted), and `factory_sticker.auto_publish_*`.

### 5.5 Description settings overlap

See row 11. `description_settings` is saved as a full-row upsert (`save_description_settings`), so a partial client
payload would blank other columns; the voice profile has versioning and approval, `description_settings` has
neither.

## 6. Similar label, DIFFERENT key (do not merge)

| Label A | Label B | Why they differ |
|---|---|---|
| Auto-publish Passport on intake (`ingest_auto_publish`) | Auto-publish approved window/addendum (`document_rules.autoPublishApproved*`), Factory record auto-publish (`factory_sticker.auto_publish_used/new`) | listing visibility vs document publication vs factory build record |
| Manager approval before print/publish (`document_rules`) | same words in `dealer_automation_settings` | different tables; only the first is enforced by the document workflow (second is read by work-queue engine) |
| Product default mode (`product_default_mode`) | Installed/Optional chip (`products.badge_type`) | global policy vs per-product default; actual install proof is per vehicle (`getready_drives_addendum`) |
| Store hours (`dealer_hours`) | routing `businessHours`, agent `workingHours` | public text vs routing schedule vs employee availability (handoff 5) |
| Phone (`dealer_phone`) | `dealershipDefaultContact.salesPhone`, BDC phone | public store vs sales vs BDC destination |
| Street address (`dealer_address`) | service address (`dealer_service_address`) | service department only |
| Doc fee amount | price display basis, fee basis flag | fee value vs how advertised price is shown vs authoritative price |
| `financing_disclosure_apr` | estimator APR per term | addendum disclosure vs per-store Passport estimator |
| K-208 roles (`k208_authority_roles`) | per-user grants (`k208_authorized_users`) | role list vs named users; server OR-combines them (`k208_signer_allowed`) |
| Installer invoices (`get_ready_invoices`) | subscription billing (Autocurb) | work billing vs plan billing; sections.ts places "Invoices" under Integrations |
| `required_languages` / Buyers Guide language flags | `feature_spanish_buyers_guide` | dormant key vs entitlement flag |
| Description "Allow CPO language" | `cpo_programs` | claim permission vs factual program definition |

## 7. Old Store Settings feature flags and flag-like controls: disposition

`feature_*` keys live in S. They are written by (a) the legacy Store settings switch list (`Admin.tsx:238,867`, 18 shown,
2 hidden as `coming_soon`) and (b) platform tier presets (`applyTierPreset`, `planTiers.ts:158-226`,
`useAdminPlatform.ts:263`). They are in no protected key class, so `merge_dealer_settings` treats them as `SET`:
a manager role can write any of them directly (gap G3). Dispositions follow `NO-LOSS-TRACEABILITY.md`.

| Flag | Consumer found | Disposition |
|---|---|---|
| `feature_vin_decode` | `VehicleStrip.tsx:144,175` | I14/I16 decode product + store policy; keep key |
| `feature_vin_barcode` | `Index.tsx:1673` | T05 signing/document presentation |
| `feature_product_icons` | `ProductRow.tsx:21`, `ProductsView.tsx:205` | T05 |
| `feature_product_rules` | `Index.tsx:393`, nav `adminNav.tsx:541`, tab gate `sections.ts` (applicability) | R04 eligibility; preserve entitlement flag, Applicability tab hidden when false |
| `feature_buyers_guide` | `Index.tsx:1167` | T04 form availability |
| `feature_spanish_buyers_guide`, `feature_multilang_buyers_guide` | none found by name | T04 language availability; do not imply verified translations (default multilang OFF, `DealerSettingsContext.tsx` comment lines 217-220) |
| `feature_lead_capture` | `Index.tsx:1526`; nav comment `adminNav.tsx:312` | T05 customer signing contact collection |
| `feature_cobuyer_signature` | `Index.tsx:1176,1667` | T05 |
| `feature_ink_saving` | `Index.tsx:1489` | T06 printing appearance |
| `feature_url_scrape` | `VehicleStrip.tsx:64` | I25 source configuration |
| `feature_custom_branding` | `AddendumHeader.tsx:44` | D05 brand appearance; plan entitlement read-only in B03 |
| `feature_inventory` | none found | B03 availability summary |
| `feature_invoicing` | tab gate `sections.ts` (invoices), nav `adminNav.tsx:324,542` | W14/B03; actual invoices remain Get Ready |
| `feature_warranty` | tab gate `sections.ts` (warranty-records), nav | R08-R11/B03 |
| `feature_analytics` | none found | B03 availability |
| `feature_sms` (beta) | `LeadCaptureModal.tsx:138`; used as status proxy for email distribution in `Admin.tsx:841` | I12/T05; no imaginary sender fallback |
| `feature_blackbook` (beta) | `VehicleStrip.tsx:162`, `integrations/common.tsx:40` | I12/I14 |
| `feature_ai_descriptions` (hidden `coming_soon`) | `Admin.tsx:840` status row only | X11/I12; configuration (description settings) and provider availability are separate |
| `feature_payroll` (hidden `coming_soon`) | none found | retire from UI; keep stored value (comment `Admin.tsx:108-112`) |
| `feature_price_verification` | `Index.tsx:1018,1105,1252,1300,1580`, `InventoryModern.tsx:588`, SQL gate `20260618008000_price_verification_tier_gate.sql`, `publishingPolicy.ts:131` | B03 read-only; platform-set only (no dealer toggle in UI) |
| `feature_marketcheck_sync` | none in src; separate grant `set_marketcheck_allowed` | B03 read-only |

Non-flag Store-settings controls (disposition from `NO-LOSS-TRACEABILITY.md`): product default mode and override ->
R13; packet-viewed alert, price-drop watch/emails -> X09; auto-publish -> W01; recon and detail dispatch -> W12;
detail recipients -> W13; service K-208 recipients -> W13; third-party notify -> W12; Get-Ready drives addendum ->
W12; installer contacts -> W14/W15; integration status list -> I12 (read-only; secret names shown as text only,
`Admin.tsx:840-846`).

## 8. Gate and enforcement notes useful for the V3 work

- `dealer_profiles` direct member writes are removed only by migration 2 (prepared). Evidence that a direct
  write path still exists in code: `PlatformTenants.tsx:622-627` (platform admin) and the policy comment in
  `ADMIN_V2_RECONCILIATION.md` P0-B.
- Several V2 views save immediately with no review for consequential keys: price presentation
  (`PriceRulesView.tsx:524-613`), PassportPublishingCard, Store settings switches. Instant-save components
  (`useInstantSave`, `useInstantSettings`) write only changed keys, but nested keys (`factory_sticker`,
  `label_defaults`, `sticker_print_templates`, `document_rules`) are replaced whole, so concurrent editors
  overwrite each other's sub-keys.
- `merge_dealer_settings` audits only the policy classes; identity, brand and feature keys leave no
  `audit_log` row.
