import { describe, it, expect } from "vitest";
import {
  HttpOutcome,
  ModelRecallAnswer,
  NhtsaModelCatalogue,
  VinRecallAnswer,
  classifyMarketcheckVinRecall,
  isVinAnswered,
  matchNhtsaModel,
  mayOverwriteVinWithUnanswered,
  modelRecallColumns,
  nhtsaModelsUrl,
  nhtsaRecallsUrl,
  resolveNhtsaIdentity,
  resolveNhtsaModelRecall,
  vinRecallColumns,
  vinUnknown,
} from "../../../supabase/functions/_shared/recallState.ts";

const AT = "2026-09-09T12:00:00.000Z";
const VIN = "JN8AZ3CC5T9624253";
const prov = { vin: VIN, source: "marketcheck_autorecalls", checkedAt: AT };

const ok = (body: unknown): HttpOutcome => ({ kind: "response", status: 200, body });
const status = (code: number, body: unknown): HttpOutcome => ({ kind: "response", status: code, body });

// The exact body NHTSA returns for both "known model, zero campaigns" and
// "model I have never heard of", captured live on 2026-09-09.
const AMBIGUOUS_400: HttpOutcome = status(400, {
  Count: 0,
  Message: "Results returned successfully",
  results: [],
});

const catalogueBody = (models: string[]) => ({
  count: models.length,
  message: "Results returned successfully",
  results: models.map((model) => ({ modelYear: "2027", make: "INFINITI", model })),
});

const scripted = (routes: Record<string, HttpOutcome>, log: string[] = []) =>
  async (url: string): Promise<HttpOutcome> => {
    log.push(url);
    const hit = routes[url];
    if (!hit) throw new Error(`unscripted url ${url}`);
    return hit;
  };

const campaign = (n: string) => ({
  NHTSACampaignNumber: n,
  Component: "AIR BAGS",
  Summary: "Inflator may rupture.",
  Consequence: "Injury risk.",
  Remedy: "Dealers will replace the inflator.",
  Manufacturer: "Nissan North America, Inc.",
  ReportReceivedDate: "15/07/2026",
});

describe("VIN scope", () => {
  it("a VIN-level answer with zero open campaigns is VERIFIED_CLEAR", () => {
    const a = classifyMarketcheckVinRecall(ok({ recalls: [] }), prov);
    expect(a.scope).toBe("vin");
    expect(a.state).toBe("VERIFIED_CLEAR");
    expect(a.openCount).toBe(0);
    expect(isVinAnswered(a)).toBe(true);

    const cols = vinRecallColumns(a);
    expect(cols.recall_status).toBe("verified_clear");
    expect(cols.open_recall_count).toBe(0);
    expect(cols.recall_checked_at).toBe(AT);
  });

  it("a VIN-level answer with open campaigns is OPEN and counts only the open ones", () => {
    const a = classifyMarketcheckVinRecall(
      ok({ recalls: [campaign("26V455000"), { ...campaign("24V111000"), status: "Closed" }] }),
      prov,
    );
    expect(a.state).toBe("OPEN");
    expect(a.openCount).toBe(1);
    expect(a.closedCount).toBe(1);
    expect(vinRecallColumns(a).recall_status).toBe("open_recalls");
  });

  it("a MarketCheck 404 is UNKNOWN, never clear", () => {
    const a = classifyMarketcheckVinRecall(status(404, null), prov);
    expect(a.state).toBe("UNKNOWN");
    expect(a.openCount).toBeNull();
    expect(a.note).toBe("marketcheck_vin_not_on_file");
    const cols = vinRecallColumns(a);
    expect(cols.open_recall_count).toBeNull();
    expect(cols.recall_checked_at).toBeNull();
    // NULL, not 'unknown': the enrich sweep re-queues on a NULL recall_status,
    // so an unanswered lookup stays on the worklist.
    expect(cols.recall_status).toBeNull();
  });

  it("an unanswered lookup records the attempt and never a check date", () => {
    const check = vinRecallColumns(classifyMarketcheckVinRecall(status(404, null), prov)).recall_check;
    expect(check.scope).toBe("vin");
    expect(check.state).toBe("unknown");
    expect(check.source).toBe("marketcheck_autorecalls");
    expect(check.attempted_at).toBe(AT);
    // The publish gate and the stale worklist key on checked_at. A lookup that
    // answered nothing must not be able to satisfy either of them.
    expect(check).not.toHaveProperty("checked_at");
  });

  it("a 200 whose body has no recognisable recall array is UNKNOWN, not clear", () => {
    const a = classifyMarketcheckVinRecall(ok({ message: "quota exceeded" }), prov);
    expect(a.state).toBe("UNKNOWN");
    expect(a.note).toBe("marketcheck_response_shape_unrecognised");
  });

  it("a transport error is UNKNOWN with no count", () => {
    const a = classifyMarketcheckVinRecall({ kind: "transport_error", reason: "timeout" }, prov);
    expect(a.state).toBe("UNKNOWN");
    expect(a.openCount).toBeNull();
    expect(a.closedCount).toBeNull();
  });

  it("an unanswered VIN lookup may only overwrite a row that has no VIN answer", () => {
    expect(mayOverwriteVinWithUnanswered(null)).toBe(true);
    expect(mayOverwriteVinWithUnanswered("unknown")).toBe(true);
    expect(mayOverwriteVinWithUnanswered("open_recalls")).toBe(false);
    expect(mayOverwriteVinWithUnanswered("verified_clear")).toBe(false);
  });
});

describe("provenance is inseparable from the count", () => {
  it("a VIN answer cannot be built without a source", () => {
    expect(() => vinUnknown({ vin: VIN, source: "", checkedAt: AT }, "x")).toThrow(/source/);
  });

  it("a VIN answer cannot be built without a checked-at time", () => {
    expect(() => vinUnknown({ vin: VIN, source: "marketcheck", checkedAt: "" }, "x")).toThrow(/checked-at/);
  });

  it("every stored VIN count arrives with its scope, source and time", () => {
    const cols = vinRecallColumns(classifyMarketcheckVinRecall(ok({ recalls: [] }), prov));
    const check = cols.recall_check as Record<string, unknown>;
    expect(check.scope).toBe("vin");
    expect(check.source).toBe("marketcheck_autorecalls");
    expect(check.checked_at).toBe(AT);
    expect(check.open_count).toBe(0);
  });

  it("every stored MODEL count arrives with its scope, source and time", async () => {
    const a = await resolveNhtsaModelRecall(
      { year: "2027", make: "INFINITI", model: "QX60" },
      {
        get: scripted({
          [nhtsaRecallsUrl("2027", "INFINITI", "QX60")]: AMBIGUOUS_400,
          [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
        }),
        catalogue: new NhtsaModelCatalogue(scripted({
          [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
        })),
        now: () => AT,
      },
    );
    const payload = modelRecallColumns(a).recall_payload;
    expect(payload.scope).toBe("model");
    expect(payload.source).toBe("nhtsa");
    expect(payload.checked_at).toBe(AT);
    expect(payload.campaign_count).toBe(0);
  });
});

describe("NHTSA is model scope and stays there", () => {
  const deps = (routes: Record<string, HttpOutcome>, log: string[] = []) => {
    const get = scripted(routes, log);
    return { get, catalogue: new NhtsaModelCatalogue(get), now: () => AT };
  };

  it("a 400 whose model IS in the catalogue is NO_MODEL_CAMPAIGNS_FOUND, and the VIN stays UNKNOWN", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX60" }, deps({
      [nhtsaRecallsUrl("2027", "INFINITI", "QX60")]: AMBIGUOUS_400,
      [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
    }));
    expect(a.scope).toBe("model");
    expect(a.state).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    expect(a.campaignCount).toBe(0);

    // Nothing in the model answer can produce a VIN clearance; the VIN state is
    // whatever the VIN-level source said, and no VIN source answered here.
    const vin = vinUnknown(prov, "no_vin_level_source");
    expect(vin.state).toBe("UNKNOWN");
    expect(vinRecallColumns(vin).recall_status).toBeNull();
    expect(vinRecallColumns(vin).open_recall_count).toBeNull();
  });

  it("a 400 whose model is NOT in the catalogue is MODEL_NOT_FOUND, and the VIN stays UNKNOWN", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX65" }, deps({
      [nhtsaRecallsUrl("2027", "INFINITI", "QX65")]: AMBIGUOUS_400,
      [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
    }));
    expect(a.state).toBe("MODEL_NOT_FOUND");
    expect(a.campaignCount).toBeNull();
    expect(modelRecallColumns(a).recall_payload.campaign_count).toBeNull();
    expect(vinUnknown(prov, "no_vin_level_source").state).toBe("UNKNOWN");
  });

  it("a 200 with campaigns is MODEL_CAMPAIGNS_FOUND and costs one call", async () => {
    const log: string[] = [];
    const a = await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX80" }, deps({
      [nhtsaRecallsUrl("2027", "INFINITI", "QX80")]: ok({
        Count: 1,
        Message: "Results returned successfully",
        results: [campaign("26V455000")],
      }),
    }, log));
    expect(a.state).toBe("MODEL_CAMPAIGNS_FOUND");
    expect(a.campaignCount).toBe(1);
    expect(log).toHaveLength(1);
  });

  it("a timeout is LOOKUP_FAILED with no count, and the VIN stays UNKNOWN", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2022", make: "Toyota", model: "Camry" }, {
      get: async () => ({ kind: "transport_error", reason: "timeout" }),
      catalogue: new NhtsaModelCatalogue(async () => ({ kind: "transport_error", reason: "timeout" })),
      now: () => AT,
    });
    expect(a.state).toBe("LOOKUP_FAILED");
    expect(a.campaignCount).toBeNull();
    expect(vinUnknown(prov, "no_vin_level_source").state).toBe("UNKNOWN");
  });

  it("a 5xx is LOOKUP_FAILED, never a zero", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2022", make: "Toyota", model: "Camry" }, deps({
      [nhtsaRecallsUrl("2022", "Toyota", "Camry")]: status(500, "<html>gateway</html>"),
    }));
    expect(a.state).toBe("LOOKUP_FAILED");
    expect(a.campaignCount).toBeNull();
  });

  it("an ambiguous 400 with an unreachable catalogue is LOOKUP_FAILED, not a zero", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX60" }, deps({
      [nhtsaRecallsUrl("2027", "INFINITI", "QX60")]: AMBIGUOUS_400,
      [nhtsaModelsUrl("2027", "INFINITI")]: status(503, ""),
    }));
    expect(a.state).toBe("LOOKUP_FAILED");
    expect(a.campaignCount).toBeNull();
  });

  it("re-queries with the catalogue's own spelling when the feed's model is a marketing string", async () => {
    const log: string[] = [];
    const a = await resolveNhtsaModelRecall({ year: "2023", make: "Jeep", model: "Wrangler 4-Door" }, deps({
      [nhtsaRecallsUrl("2023", "Jeep", "Wrangler 4-Door")]: AMBIGUOUS_400,
      [nhtsaModelsUrl("2023", "Jeep")]: ok({
        count: 2,
        results: [{ model: "WRANGLER" }, { model: "GLADIATOR" }],
      }),
      [nhtsaRecallsUrl("2023", "Jeep", "WRANGLER")]: ok({
        Count: 1,
        results: [campaign("22V768000")],
      }),
    }, log));
    expect(a.state).toBe("MODEL_CAMPAIGNS_FOUND");
    expect(a.matchedModel).toBe("WRANGLER");
    expect(a.matchRule).toBe("trimmed_suffix");
    expect(a.queried.model).toBe("Wrangler 4-Door");
    expect(log).toHaveLength(3);
  });

  it("caches the catalogue per year and make within one run", async () => {
    const get = scripted({
      [nhtsaRecallsUrl("2027", "INFINITI", "QX60")]: AMBIGUOUS_400,
      [nhtsaRecallsUrl("2027", "INFINITI", "QX65")]: AMBIGUOUS_400,
      [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
    });
    const catalogue = new NhtsaModelCatalogue(get);
    await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX60" }, { get, catalogue, now: () => AT });
    await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX65" }, { get, catalogue, now: () => AT });
    expect(catalogue.callCount).toBe(1);
  });
});

describe("model matching", () => {
  it("matches only what the catalogue actually holds", () => {
    expect(matchNhtsaModel("Mazda", "MX-5 Miata", ["MAZDA3", "MX-5"])).toEqual({ model: "MX-5", rule: "trimmed_suffix" });
    expect(matchNhtsaModel("RAM", "Ram 1500 Pickup", ["1500 CREW CAB", "PROMASTER"])).toBeNull();
    expect(matchNhtsaModel("Chrysler", "Town & Country", ["TOWN AND COUNTRY"])).toEqual({
      model: "TOWN AND COUNTRY",
      rule: "ampersand",
    });
  });
});

describe("identity comes from structured fields, not the display string", () => {
  it("prefers the feed's own make and model keys", () => {
    const id = resolveNhtsaIdentity({
      ymm: "2020 Alfa Romeo Stelvio",
      mc_attributes: { year: 2020, make: "Alfa Romeo", model: "Stelvio" },
    });
    expect(id).toEqual({ year: "2020", make: "Alfa Romeo", model: "Stelvio", origin: "mc_attributes" });
  });

  it("falls back to the decode's build block, then to the display string", () => {
    expect(resolveNhtsaIdentity({ ymm: "2023 Jeep Wrangler 4-Door", mc_raw: { build: { year: 2023, make: "Jeep", model: "Wrangler" } } }))
      .toEqual({ year: "2023", make: "Jeep", model: "Wrangler", origin: "mc_raw_build" });
    expect(resolveNhtsaIdentity({ ymm: "2022 Toyota Camry" }))
      .toEqual({ year: "2022", make: "Toyota", model: "Camry", origin: "ymm" });
  });
});

describe("the two scopes cannot be confused", () => {
  it("rejects a model answer where a VIN answer is required", async () => {
    const model: ModelRecallAnswer = await resolveNhtsaModelRecall(
      { year: "2027", make: "INFINITI", model: "QX60" },
      {
        get: scripted({
          [nhtsaRecallsUrl("2027", "INFINITI", "QX60")]: AMBIGUOUS_400,
          [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
        }),
        catalogue: new NhtsaModelCatalogue(scripted({
          [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
        })),
        now: () => AT,
      },
    );

    // @ts-expect-error a MODEL answer is not a VIN answer and never becomes one
    const forbidden: VinRecallAnswer = model;
    expect(forbidden.scope).toBe("model");

    // @ts-expect-error and the VIN column writer refuses it too
    expect(() => vinRecallColumns(model)).toBeTruthy();

    // Hand-rolling the VIN shape does not work either: the brand is private.
    // @ts-expect-error the module-private brand cannot be supplied from outside
    const forged: VinRecallAnswer = {
      scope: "vin",
      state: "VERIFIED_CLEAR",
      vin: VIN,
      source: "nhtsa",
      checkedAt: AT,
      openCount: 0,
      closedCount: 0,
      campaigns: [],
      note: null,
    };
    expect(forged.state).toBe("VERIFIED_CLEAR");
  });

  it("a model answer never carries a VIN vocabulary token", async () => {
    const a = await resolveNhtsaModelRecall({ year: "2027", make: "INFINITI", model: "QX65" }, {
      get: scripted({
        [nhtsaRecallsUrl("2027", "INFINITI", "QX65")]: AMBIGUOUS_400,
        [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
      }),
      catalogue: new NhtsaModelCatalogue(scripted({
        [nhtsaModelsUrl("2027", "INFINITI")]: ok(catalogueBody(["QX80", "QX60"])),
      })),
      now: () => AT,
    });
    const payload = modelRecallColumns(a).recall_payload;
    expect(["verified_clear", "open_recalls", "unknown"]).not.toContain(payload.state);
    expect(payload).not.toHaveProperty("open_recall_count");
  });
});
