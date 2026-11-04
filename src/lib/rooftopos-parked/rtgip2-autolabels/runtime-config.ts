// Compiled switches for the deployable runtime. Nothing at run time can change these: the literal
// and the origin list are values in the generated bundle, and the staging ref is the only backend
// the runtime will answer on.
export const RTGIP2_APP_RUNTIME_ENABLED = true as const;
export const STAGING_PROJECT_REF = "uakiwvigsmrlyfpsalai";
const PENDING_GATEWAY_STAGING_ORIGIN: readonly string[] = [];
export const STAGING_GATEWAY_ORIGINS: readonly string[] = PENDING_GATEWAY_STAGING_ORIGIN;
