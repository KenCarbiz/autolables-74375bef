import type { StickerData } from "./templates";
import type { SnapshotProduct } from "./addendumMapping";

// ──────────────────────────────────────────────────────────────────────
// Document-to-packet consistency layer. Compares a generated sticker's data
// against the addendum signing packet (products_snapshot) + vehicle data so a
// printed/published addendum can never silently diverge from what the customer
// signs. This is NOT a legal engine — it sits alongside stateCompliance /
// complianceRedTeam and protects sticker_match_ack. Pure + unit-testable.
// ──────────────────────────────────────────────────────────────────────

export type Severity = "info" | "warning" | "fail";

export interface MatchFinding {
  severity: Severity;
  field: string;
  message: string;
  stickerValue?: string;
  packetValue?: string;
  fix?: string;
}

export interface MatchResult {
  status: "pass" | "warn" | "blocked";
  findings: MatchFinding[];
}

export interface PacketContext {
  vin?: string;
  stock?: string;
  vehicleTitle?: string; // "2027 INFINITI QX60 LUXE"
  price?: number;
  msrp?: number;
  products?: SnapshotProduct[];
  hasDisclaimer?: boolean;
  qrRequired?: boolean;
  hasQr?: boolean;
  documentStatus?: string;     // generated_documents.document_status
  signed?: boolean;            // customer already signed the packet
  signedAfterGenerated?: boolean; // sticker changed after the signature
}

const norm = (s?: string) => (s || "").trim().toLowerCase();
const num = (v?: string | number) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
const nameKey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

export function validateStickerPacketMatch(sticker: StickerData, ctx: PacketContext): MatchResult {
  const f: MatchFinding[] = [];
  const add = (severity: Severity, field: string, message: string, extra?: Partial<MatchFinding>) =>
    f.push({ severity, field, message, ...extra });

  // ── Vehicle identity ──────────────────────────────────────────────
  if (ctx.vin && sticker.vin && norm(ctx.vin) !== norm(sticker.vin))
    add("fail", "vin", "VIN on the sticker does not match the packet.", { stickerValue: sticker.vin, packetValue: ctx.vin, fix: "Regenerate the sticker from this vehicle." });
  if (ctx.stock && sticker.stock && norm(ctx.stock) !== norm(sticker.stock))
    add("warning", "stock", "Stock number mismatch.", { stickerValue: sticker.stock, packetValue: ctx.stock });
  if (ctx.vehicleTitle && sticker.vehicleTitle && nameKey(ctx.vehicleTitle) !== nameKey(sticker.vehicleTitle))
    add("warning", "vehicle", "Year/make/model wording differs from the packet.", { stickerValue: sticker.vehicleTitle, packetValue: ctx.vehicleTitle });

  // ── Pricing ───────────────────────────────────────────────────────
  if (ctx.price && sticker.price && num(sticker.price) !== ctx.price)
    add("warning", "price", "Vehicle price differs from the packet.", { stickerValue: sticker.price, packetValue: String(ctx.price) });
  if (ctx.msrp && sticker.msrp && num(sticker.msrp) !== ctx.msrp)
    add("warning", "msrp", "MSRP differs from the packet.", { stickerValue: sticker.msrp, packetValue: String(ctx.msrp) });

  // ── Item-level reconciliation ─────────────────────────────────────
  const products = Array.isArray(ctx.products) ? ctx.products.filter((p) => (p?.name || "").trim()) : [];
  const installedNames = new Set(sticker.installed.filter((i) => i.name.trim()).map((i) => nameKey(i.name)));
  const upgradeNames = new Set(sticker.upgrades.filter((i) => i.name.trim()).map((i) => nameKey(i.name)));
  const stickerNames = new Set([...installedNames, ...upgradeNames, ...sticker.benefits.map((b) => nameKey(b.name))]);

  for (const p of products) {
    const key = nameKey(p.name);
    const onSticker = stickerNames.has(key);
    const isOptional = p.badge_type === "optional";
    const isInstalled = p.badge_type === "installed";
    if (!onSticker) {
      add("warning", "item", `Packet item not shown on the sticker: ${p.name}.`, { packetValue: p.name, fix: "Add the item or regenerate from the addendum." });
      continue;
    }
    if (isOptional && installedNames.has(key))
      add("fail", "item_type", `"${p.name}" is optional in the packet but shown as installed on the sticker.`, { fix: "Move it to Available Upgrades." });
    if (isInstalled && upgradeNames.has(key))
      add("fail", "item_type", `"${p.name}" is installed in the packet but shown as an upgrade on the sticker.`, { fix: "Move it to Installed Equipment." });
    // Added-above-advertised installed item must be disclosed (priced) on the sticker.
    if (isInstalled && p.price_in_advertised === false) {
      const line = sticker.installed.find((i) => nameKey(i.name) === key);
      if (line && !num(line.price))
        add("warning", "disclosure", `"${p.name}" is added above the advertised price but isn't priced on the sticker.`, { fix: "Show its price so it is disclosed as additive." });
    }
    // Optional item incorrectly priced into a Total MSRP roll-up.
    if (isOptional && installedNames.has(key))
      add("fail", "total", `Optional item "${p.name}" must not be added to Total MSRP.`);
  }
  // Sticker line not present in the packet.
  for (const i of sticker.installed.concat(sticker.upgrades)) {
    if (!i.name.trim()) continue;
    if (products.length && !products.some((p) => nameKey(p.name) === nameKey(i.name)))
      add("warning", "item", `Sticker item not in the signing packet: ${i.name}.`, { stickerValue: i.name });
  }

  // ── Disclaimer / QR ───────────────────────────────────────────────
  if (ctx.hasDisclaimer === false)
    add("warning", "disclaimer", "No disclaimer text on the sticker.", { fix: "Add the standard disclosure." });
  if (ctx.qrRequired && ctx.hasQr === false)
    add("fail", "qr", "QR code is required for this template but missing.", { fix: "Enable the QR / publish a passport URL." });

  // ── Document lifecycle gates ──────────────────────────────────────
  if (ctx.documentStatus === "superseded")
    add("fail", "version", "This document version has been superseded.", { fix: "Use the current version." });
  if (ctx.documentStatus && !["approved", "printed", "published"].includes(ctx.documentStatus) && ctx.documentStatus !== "draft" && ctx.documentStatus !== "pending_approval")
    add("warning", "status", `Document status is ${ctx.documentStatus}.`);
  if (ctx.signed && ctx.signedAfterGenerated)
    add("fail", "signed", "The packet was signed but the sticker changed afterward.", { fix: "Create a new version; the customer may need to re-review." });

  const hasFail = f.some((x) => x.severity === "fail");
  const hasWarn = f.some((x) => x.severity === "warning");
  return { status: hasFail ? "blocked" : hasWarn ? "warn" : "pass", findings: f };
}
