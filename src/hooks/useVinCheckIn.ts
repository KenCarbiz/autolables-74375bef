import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";

export type CheckInMode = "staff" | "vendor";

export type CheckInReason =
  | "not_authenticated"
  | "invalid_vin"
  | "no_membership"
  | "vehicle_not_found"
  | "not_assigned"
  | "role_not_permitted"
  | "unavailable";

export interface CheckInAssignment {
  record_id: string;
  item_id: string;
  label: string;
  category: string;
  status: string;
  notes: string | null;
}

export interface CheckInVehicle {
  mode: CheckInMode;
  vin: string;
  ymm: string | null;
  stockNumber: string | null;
  tenantId: string;
  tenantName: string | null;
  role: string;
  vehicleListingId: string | null;
  readyToken: string | null;
  installToken: string | null;
  assignments: CheckInAssignment[];
}

export interface CheckInDenial {
  reason: CheckInReason;
  message: string;
  vin: string | null;
}

export type CheckInOutcome =
  | { ok: true; vehicle: CheckInVehicle }
  | ({ ok: false } & CheckInDenial);

interface RpcPayload {
  ok?: boolean;
  reason?: string;
  mode?: string;
  vin?: string;
  ymm?: string | null;
  stock_number?: string | null;
  tenant_id?: string;
  tenant_name?: string | null;
  role?: string;
  email?: string | null;
  vehicle_listing_id?: string | null;
  ready_token?: string | null;
  install_token?: string | null;
  assignments?: CheckInAssignment[];
}

const dealer = (p: RpcPayload) => p.tenant_name || "this dealership";

// Every denial names the thing the person can act on. A worker standing at a
// car with a phone cannot debug "something went wrong".
export const denialMessage = (p: RpcPayload): string => {
  switch (p.reason) {
    case "not_authenticated":
      return "Sign in first. A check-in records who did the work, so it needs your account, not just the vehicle.";
    case "invalid_vin":
      return "That is not a valid VIN. A VIN is 17 characters and never contains the letters I, O or Q.";
    case "no_membership":
      return "Your account is not linked to a dealership yet. Ask the store to add you to their team, then scan again.";
    case "vehicle_not_found":
      return `No vehicle with VIN ${p.vin || ""} is on ${dealer(p)}'s books. Check the VIN you scanned, or ask the shop to add the car before you check it in.`;
    case "not_assigned":
      return `${dealer(p)} has this vehicle, but no work on it is assigned to ${p.email || "your account"}. Ask the shop to dispatch the line to you, then scan again.`;
    case "role_not_permitted":
      return `Your role at ${dealer(p)} (${roleDisplayName(p.role)}) does not include vehicle check-in. Ask a manager for the service, detail or vendor role.`;
    default:
      return "We could not resolve that VIN. Try the scan again, and tell the shop if it keeps failing.";
  }
};

const KNOWN_REASONS: CheckInReason[] = [
  "not_authenticated",
  "invalid_vin",
  "no_membership",
  "vehicle_not_found",
  "not_assigned",
  "role_not_permitted",
];

const toReason = (raw: string | undefined): CheckInReason =>
  KNOWN_REASONS.find((r) => r === raw) ?? "unavailable";

export const useVinCheckIn = () => {
  const [resolving, setResolving] = useState(false);

  const resolve = useCallback(async (vin: string): Promise<CheckInOutcome> => {
    setResolving(true);
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any).rpc("resolve_vin_checkin", { p_vin: vin });
      const payload = (data || {}) as RpcPayload;
      if (error || !payload.ok) {
        const withVin: RpcPayload = { ...payload, vin: payload.vin || vin };
        return {
          ok: false,
          reason: error ? "unavailable" : toReason(payload.reason),
          message: error ? denialMessage({ reason: "unavailable" }) : denialMessage(withVin),
          vin: withVin.vin ?? null,
        };
      }
      return {
        ok: true,
        vehicle: {
          mode: payload.mode === "vendor" ? "vendor" : "staff",
          vin: String(payload.vin || vin).toUpperCase(),
          ymm: payload.ymm ?? null,
          stockNumber: payload.stock_number ?? null,
          tenantId: String(payload.tenant_id || ""),
          tenantName: payload.tenant_name ?? null,
          role: String(payload.role || ""),
          vehicleListingId: payload.vehicle_listing_id ?? null,
          readyToken: payload.ready_token ?? null,
          installToken: payload.install_token ?? null,
          assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
        },
      };
    } finally {
      setResolving(false);
    }
  }, []);

  return { resolve, resolving };
};

// Which Get-Ready stations the hub should show this person. GetReady already
// scopes itself from ?dept=, so the role decides the scope rather than a second
// station list living here. A manager gets the unscoped hub.
export const checkInDept = (role: string): string | null => {
  const normalized = role.trim().toLowerCase();
  if (normalized === "detail") return "detail";
  if (normalized === "technician") return "service";
  if (normalized === "service_advisor" || normalized === "service_manager") return "service";
  return null;
};

export const checkInHref = (vehicle: CheckInVehicle): string | null => {
  if (!vehicle.readyToken) return null;
  const dept = checkInDept(vehicle.role);
  return `/ready/${vehicle.readyToken}${dept ? `?dept=${dept}` : ""}`;
};
