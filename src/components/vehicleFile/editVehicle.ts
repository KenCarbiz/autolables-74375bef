import type { VehicleRow } from "./types";

export interface EditVehicleForm {
  ymm: string;
  trim: string;
  mileage: string;
  condition: string;
}

export const CONDITIONS = ["new", "used", "cpo"] as const;

type Editable = Pick<VehicleRow, "ymm" | "trim" | "mileage" | "condition">;

export const editFormFromVehicle = (v: Editable): EditVehicleForm => ({
  ymm: v.ymm ?? "",
  trim: v.trim ?? "",
  mileage: v.mileage != null ? String(v.mileage) : "",
  condition: v.condition ?? "",
});

export interface EditVehiclePatch {
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: string | null;
}

export type EditVehicleResult = { ok: true; patch: Partial<EditVehiclePatch> } | { ok: false; error: string };

/** Returns only the fields that changed; price is deliberately not editable here because price review owns it. */
export const buildEditPatch = (before: Editable, form: EditVehicleForm): EditVehicleResult => {
  const patch: Partial<EditVehiclePatch> = {};
  const ymm = form.ymm.trim();
  const trim = form.trim.trim();
  if (ymm !== (before.ymm ?? "")) patch.ymm = ymm || null;
  if (trim !== (before.trim ?? "")) patch.trim = trim || null;
  const rawMiles = form.mileage.replace(/[,\s]/g, "");
  if (rawMiles !== "") {
    const miles = Number(rawMiles);
    if (!Number.isInteger(miles) || miles < 0 || miles > 999999) {
      return { ok: false, error: "Mileage must be a whole number from 0 to 999,999." };
    }
    if (miles !== before.mileage) patch.mileage = miles;
  } else if (before.mileage != null) {
    patch.mileage = null;
  }
  const cond = form.condition.trim().toLowerCase();
  if (cond && !(CONDITIONS as readonly string[]).includes(cond)) return { ok: false, error: "Condition must be new, used or cpo." };
  if (cond !== (before.condition ?? "")) patch.condition = cond || null;
  return { ok: true, patch };
};
