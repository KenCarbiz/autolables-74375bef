/**
 * Server-layer safety configuration for the DEV gateway.
 * EXTERNAL_DELIVERY_ENABLED is a compile-time literal `false`. There is no env var,
 * DB column (DB has CHECK external_delivery_enabled = false) or UI control that can flip it.
 */
export const GATEWAY_ENVIRONMENT = "DEV" as const;
export const EXTERNAL_DELIVERY_ENABLED = false as const;
export const DEV_BANNER = "DEV / SYNTHETIC / NO PRODUCTION CONNECTORS";

export function assertLocalOnly(target: string): void {
  // Any adapter must call this before attempting delivery. In phase 1 it always refuses network delivery.
  if (EXTERNAL_DELIVERY_ENABLED !== false) {
    throw new Error("unreachable: external delivery is hardcoded off in DEV");
  }
  if (/^https?:\/\//i.test(target)) {
    throw new Error(`External delivery to ${target} refused: DEV gateway is local-only`);
  }
}
