import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { DEFAULT_CONTACT_ROUTING } from "@/lib/passportRouting";
import {
  IDENTITY_KEYS,
  accentLabel,
  changedKeys,
  contactReadiness,
  describeValue,
  fieldLabel,
  headerPreview,
  normalizeHex,
  patchOf,
  pickSettings,
  validateAppearance,
  validateHoursContact,
  validateIdentity,
  validateLogoFile,
  validateWebsites,
} from "./brandModel";

const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe("brand drafts", () => {
  it("picks only the owned keys and diffs structurally", () => {
    const s = settings({ dealer_name: "Example Motors", dealer_city: "Example City" });
    const draft = pickSettings(s, IDENTITY_KEYS);
    expect(Object.keys(draft).sort()).toEqual([...IDENTITY_KEYS].sort());
    expect(changedKeys(draft, pickSettings(s, IDENTITY_KEYS), IDENTITY_KEYS)).toEqual([]);
    const edited = { ...draft, dealer_city: "Other City" };
    expect(changedKeys(edited, draft, IDENTITY_KEYS)).toEqual(["dealer_city"]);
    expect(patchOf(edited, draft, IDENTITY_KEYS)).toEqual({ dealer_city: "Other City" });
  });

  it("never writes a key that did not change", () => {
    const s = settings({ dealer_name: "Example Motors" });
    const draft = pickSettings(s, IDENTITY_KEYS);
    expect(patchOf({ ...draft }, draft, IDENTITY_KEYS)).toEqual({});
  });
});

describe("validation", () => {
  it("requires a dealership name and a real state code", () => {
    expect(validateIdentity({ dealer_name: " ", dealer_city: "", dealer_state: "", dealer_timezone: "", dealer_logo_url: "" })).toEqual(["Dealership name is required."]);
    expect(validateIdentity({ dealer_name: "Example", dealer_city: "", dealer_state: "ZZ", dealer_timezone: "", dealer_logo_url: "" })).toHaveLength(1);
    expect(validateIdentity({ dealer_name: "Example", dealer_city: "", dealer_state: "ct", dealer_timezone: "", dealer_logo_url: "" })).toEqual([]);
  });

  it("accepts an empty accent and a six-digit hex only", () => {
    expect(validateAppearance({ primary_color: "" })).toEqual([]);
    expect(validateAppearance({ primary_color: "#2457D6" })).toEqual([]);
    expect(validateAppearance({ primary_color: "blue" })).toHaveLength(1);
    expect(normalizeHex("2457d6")).toBe("#2457D6");
    expect(accentLabel("")).toBe("Blue (#2457D6)");
    expect(accentLabel("#142338")).toBe("Navy (#142338)");
    expect(accentLabel("#ABCDEF")).toBe("Custom (#ABCDEF)");
  });

  it("checks zip, placeholder phones and web addresses", () => {
    const base = { dealer_hours: "", dealer_phone: "", dealer_website_url: "", public_landing_url: "", dealer_address: "", dealer_zip: "", dealer_principal: "", dealer_license_number: "" };
    expect(validateHoursContact(base)).toEqual([]);
    expect(validateHoursContact({ ...base, dealer_zip: "1234" })).toHaveLength(1);
    expect(validateHoursContact({ ...base, dealer_zip: "06120-1234" })).toEqual([]);
    expect(validateHoursContact({ ...base, dealer_phone: "5555555555" })).toHaveLength(1);
    expect(validateHoursContact({ ...base, dealer_phone: "(860) 555-0100" })).toEqual([]);
    expect(validateHoursContact({ ...base, dealer_website_url: "not a site" })).toHaveLength(1);
    expect(validateHoursContact({ ...base, dealer_website_url: "www.example-dealer.test" })).toEqual([]);
  });

  it("checks marketplace addresses and logo files", () => {
    const base = { dms_provider: "", new_inventory_url: "", used_inventory_url: "", autotrader_url: "", cars_com_url: "", cargurus_url: "", capital_one_url: "", carfax_url: "", vdp_price_labels: "", vdp_strip_finance_params: true, vehicle_conditions: "" };
    expect(validateWebsites(base)).toEqual([]);
    expect(validateWebsites({ ...base, cargurus_url: "nope" })).toEqual(["CarGurus address is not valid."]);
    expect(validateLogoFile({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateLogoFile({ type: "application/pdf", size: 1024 })).toMatch(/PNG, JPG or SVG/);
    expect(validateLogoFile({ type: "image/png", size: 3 * 1024 * 1024 })).toMatch(/2 MB/);
  });

  it("describes values for the review panel in words", () => {
    expect(describeValue("")).toBe("(empty)");
    expect(describeValue(true)).toBe("On");
    expect(describeValue({ payment: true, downPayment: false, term: true, interestRate: false })).toBe("payment on, down payment off, term on, APR off");
    expect(describeValue("x".repeat(100))).toHaveLength(90);
    expect(fieldLabel("dealer_phone")).toBe("Main phone");
    expect(fieldLabel("unknown_key")).toBe("unknown_key");
  });
});

describe("contact readiness", () => {
  it("reads incomplete rows from an empty routing contact and no website", () => {
    const rows = contactReadiness(settings());
    expect(rows.map((r) => r.state)).toEqual(["incomplete", "incomplete", "incomplete"]);
    expect(rows.every((r) => r.value === "Not configured")).toBe(true);
    expect(rows[0].editHref).toBe("/admin?tab=routing");
    expect(rows[2].editHref).toBe("/admin?tab=hours-contact");
  });

  it("reads ready rows from the routing default contact and a normalized website", () => {
    const rows = contactReadiness(settings({
      passport_contact_routing: { ...DEFAULT_CONTACT_ROUTING, dealershipDefaultContact: { salesPhone: "8605550100", salesEmail: "sales@example-dealer.test" } },
      dealer_website_url: "www.example-dealer.test/inventory/used?x=1",
    }));
    expect(rows[0]).toMatchObject({ state: "ready", value: "(860) 555-0100" });
    expect(rows[1]).toMatchObject({ state: "ready", value: "sales@example-dealer.test" });
    expect(rows[2]).toMatchObject({ state: "ready", value: "https://www.example-dealer.test" });
  });

  it("never calls a blank fallback ready", () => {
    const rows = contactReadiness(settings({ passport_contact_routing: { ...DEFAULT_CONTACT_ROUTING, dealershipDefaultContact: { salesPhone: "0000000000", salesEmail: "not-an-email" } } }));
    expect(rows[0].state).toBe("incomplete");
    expect(rows[1].state).toBe("incomplete");
  });
});

describe("header preview", () => {
  const store = { id: "s1", name: "Example INFINITI", city: "Example City", state: "CT" };

  it("names the header by the active store and the documents by the saved dealership name", () => {
    const p = headerPreview(settings({ dealer_name: "Example INFINITI of Example City", dealer_city: "Other City", dealer_state: "NY" }), { tenantName: "Example Auto Group", stores: [store], activeStoreId: "s1" });
    expect(p).toMatchObject({ name: "Example INFINITI", nameSource: "store", documentName: "Example INFINITI of Example City", location: "Example City, CT" });
  });

  it("falls back to the group, then the saved name, never to the placeholder", () => {
    expect(headerPreview(settings({ dealer_name: "Example Motors" }), { tenantName: "Example Auto Group" })).toMatchObject({ name: "Example Auto Group", nameSource: "group" });
    expect(headerPreview(settings({ dealer_name: "Example Motors", dealer_city: "Example City", dealer_state: "CT" }))).toMatchObject({ name: "Example Motors", nameSource: "settings", location: "Example City, CT" });
    expect(headerPreview(settings({ dealer_name: "Your Dealership" }))).toMatchObject({ name: "", nameSource: "none" });
  });

  it("reports what documents are missing", () => {
    const p = headerPreview(settings({ dealer_name: "", dealer_phone: "" }), { tenantName: "Example Auto Group" });
    expect(p.documentName).toBe("Example Auto Group");
    expect(p.warnings.join(" ")).toMatch(/phone/i);
  });
});
