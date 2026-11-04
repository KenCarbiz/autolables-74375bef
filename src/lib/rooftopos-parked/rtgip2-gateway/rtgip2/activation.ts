import { EXTERNAL_DELIVERY_ENABLED } from "../config";
import type { EnvelopeV2 } from "./core";

export interface ActivationState {
  global_kill: boolean;
  application_enabled: Readonly<Record<string, boolean>>;
  tenant_enabled: Readonly<Record<string, boolean>>;
  rooftop_enabled: Readonly<Record<string, boolean>>;
  connection_enabled: Readonly<Record<string, boolean>>;
  routes: readonly string[];
  security_accepted: boolean;
  staging_accepted: boolean;
  deployment_approval_ref: string | null;
}

/** Preparation only: no state or environment variable can override the compiled DEV prohibition. */
export function liveActivationDenial(
  e: EnvelopeV2,
  connection: string,
  state: ActivationState,
): string | null {
  if (!EXTERNAL_DELIVERY_ENABLED) return "external_delivery_hardcoded_off";
  if (state.global_kill) return "global_kill";
  if (!state.security_accepted || !state.staging_accepted || !state.deployment_approval_ref)
    return "acceptance_or_approval_missing";
  if (!state.routes.includes(e.route)) return "route_denied";
  if (!state.application_enabled[e.source_app] || !state.application_enabled[e.target_app])
    return "application_disabled";
  if (
    !state.tenant_enabled[e.tenant_id] ||
    !state.rooftop_enabled[e.rooftop_id] ||
    !state.connection_enabled[connection]
  )
    return "scope_disabled";
  return null;
}
