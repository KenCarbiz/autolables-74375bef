import { describe, expect, it } from "vitest";
import { buildCompliance, buildDocuments, buildGetReady } from "./operations.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VEHICLE = "b31c2f60-6f9a-4f6d-9d4c-9a2a2a1f1001";
const VIN = "5N1AT3CB7MC736556";

// Shapes copied from the pilot tenant on 2026-09-09: a published used Nissan
// whose Get Ready record was minted by the nightly seeder, whose delivery
// clearance has never left blocked_inspection_not_started, whose Buyers Guide
// exists only as a draft with an archived PDF, and whose recall answer is an
// NHTSA campaign list with ten open campaigns.

const listingRow = (over: Row = {}): Row => ({
  id: VEHICLE,
  vin: VIN,
  status: "published",
  condition: "used",
  oem_sticker_url: null,
  recall_status: "open_recalls",
  recall_checked_at: "2026-08-19T19:17:45.960Z",
  open_recall_count: 10,
  closed_recall_count: 0,
  recall_override_by: null,
  recall_payload: {
    source: "nhtsa",
    checked_at: "2026-08-19T19:17:45.960Z",
    campaigns: [
      {
        campaign: "21V957000",
        component: "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP",
        summary: "Abnormal wear inside the fuel pump may cause it to overheat and fail.",
        consequence: "Fuel pump failure may cause an engine stall, increasing the risk of a crash.",
        remedy: "Dealers will replace the fuel pump assembly, free of charge.",
      },
    ],
  },
  recall_check: null,
  mc_attributes: { carfax_clean_title: null, dom: 130 },
  ...over,
});

const getReadyRow = (over: Row = {}): Row => ({
  vin: VIN,
  stock_number: "13120",
  condition: "used",
  status: "pending",
  created_by: "ingest_autogen",
  reconciliation_state: "current",
  inspection_required: false,
  inspection_complete: false,
  get_ready_start_date: "2026-09-08T16:46:07.196Z",
  get_ready_complete_date: null,
  items: [
    { id: "4343c053", label: "Interior detail", status: "pending", category: "detail", department: "detail" },
    { id: "9eb8a8fd", label: "Exterior detail", status: "pending", category: "detail", department: "detail" },
  ],
  accessories_to_install: [],
  created_at: "2026-09-08T16:46:07.196Z",
  updated_at: "2026-09-08T16:46:07.196Z",
  ...over,
});

const clearanceRow = (over: Row = {}): Row => ({
  vin: VIN,
  state: "blocked_inspection_not_started",
  reason_codes: ["INSPECTION_NOT_STARTED"],
  computed_at: "2026-09-08T16:46:08.000Z",
  ...over,
});

const inspectionRow = (over: Row = {}): Row => ({
  id: "insp-1",
  vin: VIN,
  form_type: "CT-K208",
  status: "pending",
  inspection_state: "not_started",
  result: null,
  result_initial: null,
  signed_at: null,
  voided_at: null,
  created_at: "2026-07-22T19:44:12.908Z",
  ...over,
});

const generatedDoc = (over: Row = {}): Row => ({
  id: "gd-buyers-guide-1",
  vehicle_id: VEHICLE,
  document_type: "buyers_guide",
  document_status: "draft",
  version: 1,
  pdf_url: "https://example.invalid/signed/buyers_guide.pdf",
  online_url: "https://example.invalid/signed/buyers_guide.pdf",
  published_at: null,
  approved_at: null,
  printed_at: null,
  created_at: "2026-09-08T09:15:45.000Z",
  updated_at: "2026-09-08T09:15:45.000Z",
  ...over,
});

const archiveRow = (over: Row = {}): Row => ({
  id: "sda-1",
  doc_type: "buyers_guide",
  entity_id: VEHICLE,
  vin: VIN,
  storage_bucket: "signed-archives",
  storage_path: `${TENANT}/buyers_guide/2021/${VIN}-91819f74eec6.pdf`,
  content_hash: "91819f74eec634b2",
  byte_size: 217897,
  created_by: null,
  created_at: "2026-09-08T09:15:45.892Z",
  ...over,
});

const staleFlagRow = (over: Row = {}): Row => ({
  id: "flag-1",
  vehicle_id: VEHICLE,
  generated_document_id: "e777df2e-9cd9-402c-8e35-0878803416cb",
  changed_field: "price",
  severity: "warning",
  reason: "Vehicle price changed after this sticker was generated.",
  old_value: 3238.99,
  new_value: 45474,
  status: "open",
  created_at: "2026-08-03T18:59:28.785Z",
  ...over,
});

const src = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  ...over,
});

const origins = (field: { candidates: Array<{ origin: string }> }) =>
  field.candidates.map((c) => c.origin);

const blockerMatching = (blockers: string[], pattern: RegExp) =>
  blockers.find((entry) => pattern.test(entry));

describe("buildGetReady", () => {
  it("reports a seeded record as not-work-done, with the real blockers", () => {
    const section = buildGetReady(src({
      listing: listingRow(),
      getReady: getReadyRow(),
      deliveryClearance: clearanceRow(),
      safetyInspections: [inspectionRow()],
      lifecycle: { state: "SERVICE_UNASSIGNED", state_changed_at: "2026-08-01T00:00:00.000Z" },
      workItems: [
        { id: "wi-1", status: "open", source: "vehicle_exception", work_type: "exception_price_change" },
        { id: "wi-2", status: "open", source: "vehicle_exception", work_type: "exception_new_vehicle" },
      ],
    }));

    expect(section.status).toBe("pending");
    expect(section.stage).toBe("SERVICE_UNASSIGNED");
    expect(section.fromCompletedWork).toBe(false);
    expect(section.inspectionSigned).toBe(false);
    expect(section.prepSignedOff).toBe(false);
    expect(section.reconApproved).toBe(false);
    expect(section.deliveryCleared).toBe(false);
    expect(section.openWorkItems).toBe(2);

    expect(blockerMatching(section.blockers, /blocked_inspection_not_started/)).toBeTruthy();
    expect(blockerMatching(section.blockers, /published to the customer Passport/)).toBeTruthy();
    expect(blockerMatching(section.blockers, /Safety inspection not signed/)).toBeTruthy();
    expect(blockerMatching(section.blockers, /seeded record is not work done/)).toBeTruthy();
    expect(blockerMatching(section.blockers, /prep sign-off/)).toBeTruthy();
    expect(blockerMatching(section.blockers, /2 open work item/)).toBeTruthy();
  });

  it("does not count a seeder-approved recon estimate as approved work", () => {
    const section = buildGetReady(src({
      listing: listingRow(),
      getReady: getReadyRow(),
      deliveryClearance: clearanceRow(),
      reconEstimates: [{
        id: "recon-1",
        vin: "5TFLA5DA9NX018831",
        status: "approved",
        origin: "ingest",
        submitted_by: "Auto-ingest",
        submitted_role: "system",
        subtotal: 400,
        approved_total: 400,
      }],
    }));

    expect(section.reconApproved).toBe(false);
    expect(section.fromCompletedWork).toBe(false);
    expect(blockerMatching(section.blockers, /origin = 'ingest'/)).toBeTruthy();
  });

  it("counts real completed work: a signed inspection and a signed prep sheet", () => {
    const section = buildGetReady(src({
      listing: listingRow(),
      getReady: getReadyRow({ get_ready_complete_date: "2026-09-08T20:00:00.000Z" }),
      deliveryClearance: clearanceRow({ state: "cleared_for_delivery", reason_codes: [] }),
      safetyInspections: [inspectionRow({
        status: "signed",
        inspection_state: "passed",
        result: "pass",
        result_initial: "A",
        signed_at: "2026-09-08T09:15:00.000Z",
      })],
      prepSignOffs: [{
        id: "prep-1",
        vin: VIN,
        status: "signed",
        listing_unlocked: true,
        foreman_name: "R. Alvarez",
        signed_at: "2026-09-08T10:00:00.000Z",
      }],
      reconEstimates: [{ id: "recon-2", status: "approved", origin: "service_writer" }],
      workItems: [{ id: "wi-3", status: "completed", completed_at: "2026-09-01T00:00:00.000Z" }],
    }));

    expect(section.fromCompletedWork).toBe(true);
    expect(section.inspectionSigned).toBe(true);
    expect(section.prepSignedOff).toBe(true);
    expect(section.reconApproved).toBe(true);
    expect(section.deliveryCleared).toBe(true);
    expect(section.openWorkItems).toBe(0);
    expect(blockerMatching(section.blockers, /seeded record is not work done/)).toBeUndefined();
    expect(blockerMatching(section.blockers, /Safety inspection not signed/)).toBeUndefined();
  });

  it("flags a signed inspection that failed, and never treats a voided row as signed", () => {
    const section = buildGetReady(src({
      listing: listingRow(),
      getReady: getReadyRow(),
      deliveryClearance: clearanceRow(),
      safetyInspections: [
        inspectionRow({ id: "insp-void", status: "voided", inspection_state: "voided", signed_at: "2026-08-01T00:00:00.000Z", voided_at: "2026-08-02T00:00:00.000Z" }),
        inspectionRow({ id: "insp-fail", status: "signed", result: "fail", failure_notes: "Rear brake wear", signed_at: "2026-09-01T00:00:00.000Z" }),
      ],
    }));

    expect(section.inspectionSigned).toBe(true);
    expect(blockerMatching(section.blockers, /signed safety inspection failed: Rear brake wear/)).toBeTruthy();
  });

  it("separates a missing source from an empty one", () => {
    const absent = buildGetReady(src({ listing: listingRow(), missing: ["get_ready_records", "vehicle_delivery_clearance"] }));
    expect(blockerMatching(absent.blockers, /get_ready_records could not be read/)).toBeTruthy();
    expect(blockerMatching(absent.blockers, /vehicle_delivery_clearance could not be read/)).toBeTruthy();

    const empty = buildGetReady(emptySources(TENANT));
    expect(empty.stage).toBeNull();
    expect(empty.status).toBeNull();
    expect(empty.fromCompletedWork).toBe(false);
    expect(blockerMatching(empty.blockers, /No get_ready_records row exists/)).toBeTruthy();
    expect(blockerMatching(empty.blockers, /No vehicle_delivery_clearance row exists/)).toBeTruthy();
  });
});

describe("buildDocuments", () => {
  it("reports both stores for the Buyers Guide and names what each one said", () => {
    const section = buildDocuments(src({
      listing: listingRow(),
      generatedDocuments: [generatedDoc()],
      signedDocuments: [archiveRow()],
    }));

    expect(section.buyersGuide.present).toBe(true);
    expect(section.buyersGuide.documentId).toBe("gd-buyers-guide-1");
    expect(section.buyersGuide.source).toContain("buyers_guide draft v1 with a PDF");
    expect(section.buyersGuide.source).toContain("does not count it as filed");
    expect(section.buyersGuide.source).toContain("signed_document_archive: 1 retained PDF");
    expect(section.buyersGuide.source).toContain("retention evidence, not a signature");
  });

  it("prefers a published document over a draft and reports the retired ones", () => {
    const section = buildDocuments(src({
      listing: listingRow(),
      generatedDocuments: [
        generatedDoc({ id: "gd-old", document_status: "superseded", version: 1 }),
        generatedDoc({ id: "gd-draft", document_status: "draft", version: 3, created_at: "2026-09-08T09:15:45.000Z" }),
        generatedDoc({ id: "gd-live", document_status: "published", version: 2, published_at: "2026-08-01T00:00:00.000Z" }),
      ],
    }));

    expect(section.buyersGuide.documentId).toBe("gd-live");
    expect(section.buyersGuide.source).toContain("counts it as filed");
    expect(section.buyersGuide.source).toContain("1 retired");
    expect(section.counts.generated).toBe(2);
  });

  it("ranks the window sticker across both document types and keeps the OEM original separate", () => {
    const section = buildDocuments(src({
      listing: listingRow({ oem_sticker_url: null }),
      generatedDocuments: [
        generatedDoc({ id: "gd-window", document_type: "window", document_status: "draft", pdf_url: null, online_url: null }),
        generatedDoc({ id: "gd-factory", document_type: "factory_sticker", document_status: "published" }),
      ],
    }));

    expect(section.windowSticker.documentId).toBe("gd-factory");
    expect(section.windowSticker.source).toContain("factory_sticker published");
    expect(section.windowSticker.present).toBe(true);
    expect(section.oemSticker).toEqual({ present: false, url: null });
  });

  it("de-duplicates stale flags per (document, field) and keeps the oldest open flag", () => {
    const duplicates: Row[] = Array.from({ length: 7079 }, (_, index) =>
      staleFlagRow({
        id: `flag-${index}`,
        created_at: new Date(Date.parse("2026-08-03T18:59:28.785Z") + index * 1000).toISOString(),
      }));
    const section = buildDocuments(src({
      listing: listingRow(),
      staleFlags: [
        ...duplicates,
        staleFlagRow({
          id: "flag-engine",
          generated_document_id: "e054aac9-1111-2222-3333-444444444444",
          changed_field: "mechanical.transmission",
          created_at: "2026-08-11T20:15:09.208Z",
        }),
        staleFlagRow({ id: "flag-reviewed", status: "reviewed", changed_field: "price" }),
        staleFlagRow({ id: "flag-orphan", generated_document_id: null }),
      ],
    }));

    expect(section.staleFlags).toHaveLength(2);
    expect(section.counts.stale).toBe(2);
    expect(section.staleFlags[0]).toEqual({
      documentId: "e777df2e-9cd9-402c-8e35-0878803416cb",
      field: "price",
      since: "2026-08-03T18:59:28.785Z",
    });
    expect(section.staleFlags[1].field).toBe("mechanical.transmission");
  });

  it("says nothing exists when nothing exists", () => {
    const section = buildDocuments(emptySources(TENANT));
    expect(section.buyersGuide.present).toBe(false);
    expect(section.buyersGuide.documentId).toBeNull();
    expect(section.buyersGuide.source).toContain("no buyers_guide row");
    expect(section.buyersGuide.source).toContain("signed_document_archive: no retained PDF");
    expect(section.windowSticker.present).toBe(false);
    expect(section.addendum).toEqual({ present: false, documentId: null });
    expect(section.oemSticker).toEqual({ present: false, url: null });
    expect(section.counts).toEqual({ generated: 0, signed: 0, stale: 0 });
  });
});

describe("buildCompliance", () => {
  it("emits all three recall stores as candidates and ages the winner from the writer's stamp", () => {
    const section = buildCompliance(src({ listing: listingRow() }), { now: NOW });

    // resolveField keeps only the candidates that carried a value once any of
    // them did, so the empty recall_check store is named in `blockers` instead.
    expect(origins(section.recallStatus)).toEqual([
      "vehicle_listings.recall_status",
      "vehicle_listings.recall_payload",
    ]);
    expect(blockerMatching(section.blockers, /recall_check holds no answer/)).toBeTruthy();
    expect(section.recallStatus.value).toBe("open_recalls");
    expect(section.recallStatus.freshness).toBe("CURRENT");
    expect(section.recallStatus.chosen?.provider).toContain("NHTSA");
    expect(section.recallStatus.chosen?.license).toBe("CUSTOMER_DISPLAY_CLEARED");
    expect(section.openRecallCount.value).toBe(10);
    expect(section.doNotDrive).toBe(false);
    expect(blockerMatching(section.blockers, /10 open recall/)).toBeTruthy();
  });

  it("takes the freshness stamp from the greatest of recall_checked_at and recall_payload.checked_at", () => {
    const onlyPayload = buildCompliance(src({
      listing: listingRow({ recall_checked_at: null }),
    }), { now: NOW });
    expect(onlyPayload.recallStatus.chosen?.observedAt).toBe("2026-08-19T19:17:45.960Z");
    expect(onlyPayload.recallStatus.freshness).toBe("CURRENT");

    const columnNewer = buildCompliance(src({
      listing: listingRow({ recall_checked_at: "2026-09-08T00:00:00.000Z" }),
    }), { now: NOW });
    expect(columnNewer.recallStatus.chosen?.observedAt).toBe("2026-09-08T00:00:00.000Z");

    // A VIN-level answer is the only kind that can BE stale: a model-level
    // zero never became this car's answer in the first place.
    const stale = buildCompliance(src({
      listing: listingRow({
        recall_checked_at: "2026-06-29T15:43:25.467Z",
        recall_payload: {
          source: "marketcheck", scope: "vin", checked_at: "2026-06-29T15:43:25.467Z",
          campaigns: [], openRecallCount: 0,
        },
        recall_status: "clear",
        open_recall_count: 0,
      }),
    }), { now: NOW });
    expect(stale.recallStatus.freshness).toBe("STALE");
    expect(blockerMatching(stale.blockers, /Recall answer is stale/)).toBeTruthy();
  });

  // The forbidden collapse, at the Vehicle File. NHTSA recognises the model and
  // returns zero campaigns; that is a real answer about the MODEL LINE, and it
  // may not emit a clear status or a zero count for this VIN.
  it("emits no clear status and no zero count from a model-level NHTSA answer", () => {
    const section = buildCompliance(src({
      listing: listingRow({
        recall_status: "clear",
        recall_checked_at: "2026-09-08T03:00:00.000Z",
        open_recall_count: 0,
        recall_payload: {
          source: "nhtsa", checked_at: "2026-09-08T03:00:00.000Z",
          model_in_catalog: true, openRecallCount: 0, campaigns: [],
        },
      }),
    }), { now: NOW });

    expect(section.recall.model?.state).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    expect(section.recall.vin.state).toBe("UNKNOWN");
    expect(section.recall.vin.checkComplete).toBe(false);
    expect(section.recallStatus.value).toBeNull();
    expect(section.openRecallCount.value).toBeNull();
    expect(blockerMatching(section.blockers, /No store holds a VIN-level answer/)).toBeTruthy();
  });

  it("never reports a failed lookup as a clean car", () => {
    const section = buildCompliance(src({
      listing: listingRow({
        recall_status: null,
        recall_checked_at: null,
        open_recall_count: 0,
        recall_payload: {
          note: "no_nhtsa_record_http_400",
          source: "nhtsa",
          campaigns: [],
          checked_at: "2026-08-08T14:03:33.901Z",
        },
      }),
    }), { now: NOW });

    expect(section.recallStatus.value).toBeNull();
    expect(section.recallStatus.freshness).toBe("UNKNOWN");
    // Nothing answered, so every store stays named in the result.
    expect(origins(section.recallStatus)).toEqual([
      "vehicle_listings.recall_status",
      "vehicle_listings.recall_check->has_open",
      "vehicle_listings.recall_payload",
    ]);
    expect(section.openRecallCount.value).toBeNull();
    expect(origins(section.openRecallCount)).toContain("vehicle_listings.open_recall_count");
    expect(section.openRecallCount.candidates.some((c) => (c.note ?? "").includes("failed lookup, not a clean car"))).toBe(true);
    expect(blockerMatching(section.blockers, /no_nhtsa_record_http_400/)).toBeTruthy();
  });

  it("labels a MarketCheck AutoRecalls answer as MarketCheck and holds its licence for review", () => {
    const section = buildCompliance(src({
      listing: listingRow({
        recall_status: "clear",
        recall_checked_at: "2026-09-04T16:43:52.593Z",
        open_recall_count: 0,
        recall_payload: {
          vin: "JN8AZ3CC5T9624253",
          recalls: [],
          checkedAt: "2026-09-04T16:43:52.593Z",
          rawProvider: "marketcheck_autorecalls",
          recallStatus: "clear",
          openRecallCount: 0,
          closedRecallCount: 0,
        },
      }),
    }), { now: NOW });

    // This is the live shape of JN8AZ3CC5T9624253, a published customer page
    // whose "clear" came from MarketCheck answering 404. The row is
    // byte-identical to a genuine clearance, so the only thing that separates
    // them is that this one predates the writer that declares its own scope.
    // It must not clear, and it must not carry a count: a fabricated zero is
    // exactly what the two-scope model exists to stop.
    expect(section.recallStatus.value).not.toBe("clear");
    expect(section.openRecallCount.value).toBeNull();
  });

  it("surfaces a disagreement between two recall stores without inventing a dispute", () => {
    const section = buildCompliance(src({
      listing: listingRow({
        recall_status: "open_recalls",
        recall_checked_at: "2026-09-01T00:00:00.000Z",
        open_recall_count: 3,
        recall_payload: { source: "nhtsa", checked_at: "2026-09-01T00:00:00.000Z", campaigns: [{ campaign: "21V957000" }] },
        recall_check: { has_open: false, do_not_drive: false, campaigns: [], checked_at: "2026-09-05T00:00:00.000Z" },
      }),
    }), { now: NOW });

    // The newer `recall_check` reports no open campaign, but three campaigns
    // are on record in the older stores. A clear value can no longer be
    // emitted while any store reports a campaign, so the open answer stands
    // and the disagreement is still reported as a disagreement. This
    // correction must never hide a risk to stop manufacturing a clean claim.
    expect(section.recallStatus.value).toBe("open_recalls");
    expect(section.recall.conflict).toBe(true);
    expect(section.recall.vin.clearClaimAllowed).toBe(false);
    expect(section.recallStatus.disputed).toBe(false);
    expect(section.openRecallCount.value).toBe(3);
  });

  it("raises do-not-drive from any store, including campaign text with no recall_check", () => {
    const fromCheckFlag = buildCompliance(src({
      listing: listingRow({ recall_check: { has_open: true, do_not_drive: true, campaigns: [], checked_at: "2026-09-05T00:00:00.000Z" } }),
    }), { now: NOW });
    expect(fromCheckFlag.doNotDrive).toBe(true);

    const fromPayloadText = buildCompliance(src({
      listing: listingRow({
        recall_check: null,
        recall_payload: {
          source: "nhtsa",
          checked_at: "2026-09-05T00:00:00.000Z",
          campaigns: [{ campaign: "25V437000", summary: "Owners are advised to park outside away from structures." }],
        },
      }),
    }), { now: NOW });
    expect(fromPayloadText.doNotDrive).toBe(true);
    expect(blockerMatching(fromPayloadText.blockers, /do-not-drive language/)).toBeTruthy();

    const fromTask = buildCompliance(src({
      listing: listingRow({ recall_check: null }),
      recallTasks: [{
        id: "task-1",
        status: "open_review",
        recall_payload: { recalls: [{ title: "Stop sale: do not drive", description: "", consequence: "" }] },
      }],
    }), { now: NOW });
    expect(fromTask.doNotDrive).toBe(true);
    expect(blockerMatching(fromTask.blockers, /1 recall service task/)).toBeTruthy();
  });

  it("resolves titleVerification to UNKNOWN and says the column does not exist", () => {
    const section = buildCompliance(src({ listing: listingRow() }), { now: NOW });

    expect(section.titleVerification.value).toBeNull();
    expect(section.titleVerification.freshness).toBe("UNKNOWN");
    expect(section.titleVerification.candidates).toHaveLength(0);
    expect(section.titleVerification.reason).toContain("does not exist in the live database");
    expect(section.titleVerification.reason).toContain("never applied");
  });

  it("does not read a null carfax_clean_title key as a branded title", () => {
    const section = buildCompliance(src({ listing: listingRow() }), { now: NOW });

    expect(section.titleStatus.value).toBeNull();
    expect(origins(section.titleStatus)).toEqual([
      "vehicle_listings.mc_attributes->title_brand",
      "vehicle_listings.mc_attributes->title_status",
      "vehicle_listings.mc_attributes->carfax_clean_title",
    ]);
    expect(blockerMatching(section.blockers, /No title source answers/)).toBeTruthy();
  });

  it("blocks a published used car with no filed Buyers Guide, whatever the archive holds", () => {
    const draftOnly = buildCompliance(src({
      listing: listingRow(),
      generatedDocuments: [generatedDoc()],
      signedDocuments: [archiveRow()],
    }), { now: NOW });
    expect(blockerMatching(draftOnly.blockers, /no Buyers Guide in an approved, printed or published state/)).toBeTruthy();

    const filed = buildCompliance(src({
      listing: listingRow(),
      generatedDocuments: [generatedDoc({ document_status: "published" })],
    }), { now: NOW });
    expect(blockerMatching(filed.blockers, /no Buyers Guide in an approved/)).toBeUndefined();

    const newCar = buildCompliance(src({ listing: listingRow({ condition: "new" }) }), { now: NOW });
    expect(blockerMatching(newCar.blockers, /no Buyers Guide in an approved/)).toBeUndefined();
  });

  it("reports UNKNOWN rather than clear when no listing row was read", () => {
    const section = buildCompliance(emptySources(TENANT), { now: NOW });

    expect(section.recallStatus.freshness).toBe("UNKNOWN");
    expect(section.recallStatus.value).toBeNull();
    expect(section.openRecallCount.value).toBeNull();
    expect(section.doNotDrive).toBe(false);
    expect(section.titleStatus.value).toBeNull();
    expect(section.titleVerification.reason).toContain("does not exist in the live database");
    expect(section.ctMvpStatus).toBeNull();
    expect(section.blockers).toEqual(["No vehicle_listings row was read for this vehicle."]);
  });

  it("leaves ctMvpStatus null because the bundle carries no ct_mvp_certification_runs", () => {
    expect(buildCompliance(src({ listing: listingRow() }), { now: NOW }).ctMvpStatus).toBeNull();
  });
});
