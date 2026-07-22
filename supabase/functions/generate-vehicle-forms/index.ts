import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// generate-vehicle-forms — fills the EXACT official government forms for a
// vehicle from real data, using pdf-lib against the AcroForm templates in
// /public/forms, and files the results.
//
//   FTC Buyers Guide (16 CFR 455): fills the EXACT official form and keeps the
//     correct 2 pages — As-Is front [p1]+back [p3], or Implied front [p2]+back
//     [p3] — driven by the warranty box already resolved by
//     create_draft_buyers_guide. English fills the AcroForm; Spanish (16 CFR
//     455.5, sale conducted in Spanish) overlays the flat government artwork at
//     measured coordinates. Four exact variants: EN/ES × As-Is/Implied.
//   CT K-208: fills the header AcroForm (year/make/model/body/VIN×17/mileage +
//     dealer name/phone/address/town/state/zip/principal/license). The pass/fail
//     grid + signatures are overlaid in a later pass once the inspection signs.
//
// Body: { tenant_id, vin, kinds?: ("buyers_guide"|"k208")[] }
// Auth: service-role/cron OR a signed-in manager member of the tenant.
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const BUCKET = "signed-archives";

const MANAGER_ROLES = new Set([
  "owner", "general_manager", "gsm", "admin", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
]);
// deno-lint-ignore no-explicit-any
async function isManagerMember(admin: any, req: Request, tenantId: string): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return false;
  const { data: pa } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  if (pa) return true;
  const { data: m } = await admin.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", uid).not("accepted_at", "is", null).maybeSingle();
  return !!m && MANAGER_ROLES.has(String(m.role).trim().toLowerCase());
}

// K-208 VIN is 17 individual character boxes, left to right.
const K208_VIN_FIELDS = ["FillText14","FillText15","FillText16","FillText17","FillText18","FillText19","FillText20","FillText21","FillText22","FillText23","FillText24","FillText25","FillText26","FillText27","FillText28","FillText30","FillText3"];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadTemplate(name: string): Promise<ArrayBuffer> {
  const res = await fetch(`${APP_BASE}/forms/${name}`);
  if (!res.ok) throw new Error(`template ${name} ${res.status}`);
  return await res.arrayBuffer();
}

// deno-lint-ignore no-explicit-any
function setText(form: any, name: string, value: string) {
  try { form.getTextField(name).setText(value || ""); } catch { /* field absent on this variant */ }
}
// deno-lint-ignore no-explicit-any
function selectRadio(form: any, name: string, option: string) {
  try { form.getRadioGroup(name).select(option); } catch { /* absent */ }
}

interface Vehicle { year: string; make: string; model: string; body: string; vin: string; mileage: string }
interface Dealer { name: string; address: string; city: string; state: string; zip: string; phone: string; email: string; principal: string; license: string }

// Standard covered-systems language (specific, per FTC guidance — never
// shorthand like "powertrain"). Matches the dealer-approved default copy.
const COVERED_SYSTEMS = [
  "Engine — All lubricated internal engine parts, water pump, fuel pump, manifolds, engine block, cylinder heads, rotary engine housings and flywheel.",
  "Transmission — All lubricated internal transmission parts, torque converter, drive shaft, universal joints, rear axle, and all internally lubricated parts.",
  "Steering — The steering gear housing and all internal parts, power steering pump, valve body, piston and rack.",
  "Brakes — Master cylinder, vacuum assist booster, wheel cylinders, hydraulic lines and fittings, and disc brake calipers.",
  "Electrical — Alternator, voltage regulator, starter, ignition switch, and electronic ignition.",
];

async function fillFtc(box: string, pct: number, days: number, miles: number, v: Vehicle, d: Dealer): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await loadTemplate("ftc-buyers-guide-en.pdf"));
  const form = pdf.getForm();
  const implied = box === "implied";
  const sub = implied ? "topmostSubform[0].BG-Implied[0]" : "topmostSubform[0].BG-AsIs[0]";
  setText(form, `${sub}.VehicleMake[0]`, v.make);
  setText(form, `${sub}.Model[0]`, v.model);
  setText(form, `${sub}.Year[0]`, v.year);
  setText(form, `${sub}.VIN[0]`, v.vin);
  if (box === "warranty") {
    // Dealer warranty (CT/MA/NY/NJ statutory): check DEALER WARRANTY / Limited,
    // 100% parts + labor, the specific covered systems, and the term with both
    // time and mileage ("whichever occurs first").
    selectRadio(form, `${sub}.Warranty[0]`, "Dealer");
    selectRadio(form, `${sub}.DealerWarranty[0]`, "Limited");
    setText(form, `${sub}.Labor[0]`, String(pct || 100));
    setText(form, `${sub}.Parts[0]`, String(pct || 100));
    const term = days ? `${days} days${miles ? ` or ${miles.toLocaleString("en-US")} miles` : ""}, whichever occurs first` : "";
    setText(form, `${sub}.Duration1[0]`, term);
    COVERED_SYSTEMS.forEach((sysLine, i) => setText(form, `${sub}.SystemsCovered${i + 1}[0]`, sysLine));
  } else {
    // As-Is or Implied Warranties Only: the top front box (same field, whose
    // export value is 'As Is' on both the As-Is and Implied fronts).
    selectRadio(form, `${sub}.Warranty[0]`, "As Is");
  }
  // Back page (dealer identity + complaint contact) — always.
  setText(form, "topmostSubform[0].BG-Back[0].DealerName[0]", d.name);
  setText(form, "topmostSubform[0].BG-Back[0].DealerAddress[0]", [d.address, [d.city, d.state, d.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · "));
  setText(form, "topmostSubform[0].BG-Back[0].DealerPhone[0]", d.phone);
  setText(form, "topmostSubform[0].BG-Back[0].DealerEmail[0]", d.email);
  setText(form, "topmostSubform[0].BG-Back[0].ComplaintContact[0]", [d.principal || d.name, d.phone].filter(Boolean).join(", "));
  // Keep only the correct front + the back. Pages: 0 As-Is, 1 Implied, 2 back.
  pdf.removePage(implied ? 0 : 1);
  form.flatten();
  return await pdf.save();
}

// The official Spanish Buyers Guide (16 CFR 455 App. B) is a FLAT PDF — no
// AcroForm — so it is filled by overlaying text onto the exact government
// artwork at measured coordinates (validated against the rendered form). Only
// the blanks are drawn; the form itself is never altered. Pages: 0 As-Is front,
// 1 Implied front, 2 back. Coordinates are PDF points, origin bottom-left.
async function fillFtcEs(box: string, pct: number, days: number, miles: number, v: Vehicle, d: Dealer): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await loadTemplate("ftc-buyers-guide-es.pdf"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const implied = box === "implied";
  const pages = pdf.getPages();
  const front = pages[implied ? 1 : 0];
  const back = pages[2];
  // deno-lint-ignore no-explicit-any
  const draw = (pg: any, s: string, x: number, y: number, size = 10, f = font) => {
    if (s) pg.drawText(String(s), { x, y, size, font: f, color: black });
  };
  // Header — value sits on the blank line above each label.
  draw(front, v.make, 84, 643);
  draw(front, v.model, 206, 643);
  draw(front, v.year, 296, 643);
  draw(front, v.vin, 386, 643);
  if (box === "warranty") {
    // Dealer warranty (statutory states, Spanish sale): mark GARANTÍA DEL
    // CONCESIONARIO + GARANTÍA LIMITADA, the labor/parts % inline blanks, the
    // covered systems, and the term.
    draw(front, "X", 93, 491, 15, bold);
    draw(front, "X", 97, 456, 10, bold);
    draw(front, String(pct || 100), 315, 458);
    draw(front, String(pct || 100), 449, 458);
    const term = days ? `${days} días${miles ? ` o ${miles.toLocaleString("en-US")} millas` : ""}, lo que ocurra primero` : "";
    draw(front, term, 315, 384, 8);
    ["Motor", "Transmisión", "Dirección", "Frenos", "Sistema eléctrico"].forEach((sys, i) => draw(front, sys, 83, 384 - i * 11, 8));
  } else {
    // As-Is ("COMO ESTÁ") or Implied ("SOLO GARANTÍAS IMPLÍCITAS") top box.
    draw(front, "X", 93, 577, 15, bold);
  }
  // Back — dealer identity + complaint contact, on the blanks above each label.
  draw(back, d.name, 86, 218);
  draw(back, [d.address, [d.city, d.state, d.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · "), 86, 193);
  draw(back, d.phone, 86, 168);
  draw(back, d.email, 312, 168);
  draw(back, [d.principal || d.name, d.phone].filter(Boolean).join(", "), 86, 143);
  // Keep only the correct front + the back.
  pdf.removePage(implied ? 0 : 1);
  return await pdf.save();
}

async function fillK208(v: Vehicle, d: Dealer): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await loadTemplate("k208-inspection.pdf"));
  const form = pdf.getForm();
  setText(form, "FillText1", v.year);
  setText(form, "FillText6", v.make);
  setText(form, "FillText29", v.model);
  setText(form, "FillText2", v.body);
  setText(form, "FillText4", v.mileage);
  const vin = (v.vin || "").toUpperCase().slice(0, 17);
  for (let i = 0; i < K208_VIN_FIELDS.length; i++) setText(form, K208_VIN_FIELDS[i], vin[i] || "");
  setText(form, "Text1", d.name);
  setText(form, "Text2", d.phone);
  setText(form, "Text3", d.address);
  setText(form, "Text4", d.city);
  setText(form, "Text5", d.state);
  setText(form, "Text6", d.zip);
  setText(form, "Text9", d.principal);
  setText(form, "Text10", d.license);
  form.flatten();
  return await pdf.save();
}

// deno-lint-ignore no-explicit-any
async function fileForm(admin: any, tenantId: string, vin: string, vehicleId: string | null, docType: string, bytes: Uint8Array, year: string): Promise<string> {
  const hash = await sha256Hex(bytes);
  const path = `${tenantId}/${docType}/${year || "na"}/${vin}-${hash.slice(0, 12)}.pdf`;
  await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  const url = signed?.signedUrl || "";
  try {
    await admin.from("signed_document_archive").insert({
      tenant_id: tenantId, doc_type: docType, entity_id: vehicleId || vin, vin,
      storage_path: path, storage_bucket: BUCKET, content_hash: hash, byte_size: bytes.length,
    });
  } catch { /* archive best-effort */ }
  // Upsert the generated_documents row so the form shows in the deal record +
  // signing packet with a viewable URL.
  if (vehicleId) {
    const { data: existing } = await admin.from("generated_documents")
      .select("id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("document_type", docType)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const snap = { source: "generate-vehicle-forms", storage_path: path, storage_bucket: BUCKET };
    if (existing?.id) {
      await admin.from("generated_documents").update({ online_url: url, pdf_url: url, data_snapshot: snap, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await admin.from("generated_documents").insert({
        tenant_id: tenantId, vehicle_id: vehicleId, template_id: docType === "k208" ? "ct-k208" : "ftc-buyers-guide",
        document_type: docType, document_status: "draft", version: 1, online_url: url, pdf_url: url, data_snapshot: snap,
      });
    }
  }
  return url;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; kinds?: string[]; box?: string; lang?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });
  const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds : ["buyers_guide", "k208"];
  // Optional box override (as-is | implied | warranty) so a manual selection in
  // the Buyers Guide UI fills the matching official form variant.
  const boxOverride = ["as-is", "implied", "warranty"].includes(String(body.box)) ? String(body.box) : null;
  // Language of the Buyers Guide — English AcroForm or the Spanish overlay.
  // 16 CFR 455.5 requires the Spanish Guide when the sale is conducted in Spanish.
  const lang = String(body.lang) === "es" ? "es" : "en";

  const admin = adminClient();
  if (!isServiceOrCron(req) && !(await isManagerMember(admin, req, tenantId))) {
    return json(401, { error: "unauthorized" });
  }

  const { data: listing } = await admin.from("vehicle_listings")
    .select("id, ymm, condition, mileage").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!listing?.id) return json(404, { error: "vehicle not found" });
  const { data: vf } = await admin.from("vehicle_files").select("year, make, model").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  const ymmParts = String(listing.ymm || "").trim().split(/\s+/);
  const vehicle: Vehicle = {
    year: String(vf?.year || ymmParts[0] || ""),
    make: vf?.make || ymmParts[1] || "",
    model: vf?.model || ymmParts.slice(2).join(" ") || "",
    body: "",
    vin,
    mileage: listing.mileage != null ? Number(listing.mileage).toLocaleString("en-US") : "",
  };

  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const s = (prof?.settings || {}) as Record<string, string>;
  const { data: ten } = await admin.from("tenants").select("primary_email, name").eq("id", tenantId).maybeSingle();
  const dealer: Dealer = {
    name: s.dealer_name || (ten?.name as string) || "", address: s.dealer_address || "", city: s.dealer_city || "",
    state: s.dealer_state || "", zip: s.dealer_zip || "", phone: s.dealer_phone || "",
    email: (ten?.primary_email as string) || "", principal: s.dealer_principal || "", license: s.dealer_license_number || "",
  };

  const out: Record<string, string> = {};
  try {
    if (kinds.includes("buyers_guide")) {
      const { data: bg } = await admin.from("generated_documents").select("data_snapshot")
        .eq("tenant_id", tenantId).eq("vehicle_id", listing.id).eq("document_type", "buyers_guide")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const snap = (bg?.data_snapshot || {}) as { box?: string; min_pct?: number; min_duration_days?: number; min_miles?: number };
      const effBox = boxOverride || snap.box || "as-is";
      const pct = Number(snap.min_pct) || 0, dd = Number(snap.min_duration_days) || 0, mi = Number(snap.min_miles) || 0;
      const bytes = lang === "es"
        ? await fillFtcEs(effBox, pct, dd, mi, vehicle, dealer)
        : await fillFtc(effBox, pct, dd, mi, vehicle, dealer);
      out.buyers_guide = await fileForm(admin, tenantId, vin, listing.id as string, "buyers_guide", bytes, vehicle.year);
    }
    if (kinds.includes("k208") && ["used", "cpo", "certified"].includes(String(listing.condition || "used").toLowerCase())) {
      const bytes = await fillK208(vehicle, dealer);
      out.k208 = await fileForm(admin, tenantId, vin, listing.id as string, "k208", bytes, vehicle.year);
    }
  } catch (e) {
    return json(500, { ok: false, error: String((e as Error)?.message || e) });
  }

  return json(200, { ok: true, forms: out });
});
