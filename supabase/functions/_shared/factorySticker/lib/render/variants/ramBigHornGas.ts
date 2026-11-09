// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/ramBigHornGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Ram 2500 (gasoline), built from the
// verified Stellantis label for a 2026 Ram 2500 Big Horn Crew Cab 4X4 (6.4L V8
// HEMI HD), VIN 3C6UR5DJ7TG302125, SHA-256
// faac3bd17acf838ce68a15a7515f3df6092b7fe3cbe8c71a78cfd1e85876bd4d, retrieved
// from the manufacturer's window-sticker service (gas-hd-references/provenance.json).
//
// The gasoline label is the same FCA heavy-duty form as the diesel Ram: no EPA
// fuel-economy label (GVWR over 8,500 lb), the California Air Resources Board
// panel with the per-VIN grades printed as Not Available (no VIN-to-test-group
// source), the government safety panel and the FlexCare advertisement slot,
// which carries the Vehicle Passport QR. The fuel tag, engine, equipment, prices
// and warranty all come from the record; none of the reference's values is a
// default. The FlexCare artwork, "FCA US LLC", the L4-VON / S.L. / SHIP TO
// fields and the federal-law statements are not reproduced.

import { buildRam2500HdLayout } from "./ramLimitedDiesel.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const RAM_2500_GAS_ID = "ram_2026_2500_gas";

export const buildRam2500GasLayout: VariantLayoutBuilder = buildRam2500HdLayout;
