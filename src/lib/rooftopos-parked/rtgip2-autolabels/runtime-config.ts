// Compiled switches for the deployable runtime. Nothing at run time can change these: the literal
// and the origin list are values in the generated bundle, and the staging ref is the only backend
// the runtime will answer on.
export const RTGIP2_APP_RUNTIME_ENABLED = true as const;
export const STAGING_PROJECT_REF = "uakiwvigsmrlyfpsalai";
// Placeholder until Ken chooses the published Gateway Staging subdomain (decision D-2, C-S6 F2).
export const GATEWAY_STAGING_ORIGIN = "https://rooftopos-gateway-staging.lovable.app";
export const STAGING_GATEWAY_ORIGINS: readonly string[] = [GATEWAY_STAGING_ORIGIN];
