// Compiled switches for the deployable PRODUCTION runtime. Nothing at run time can change these: the
// literal, the mode, the project ref and the origin list are values in the generated bundle. The
// production backend is the only one the runtime will answer on, and only with RTGIP2_RUNTIME_MODE
// set to "production"; on any staging backend it refuses before reading a body, secret or row.
export const RTGIP2_APP_RUNTIME_ENABLED = true as const;
export const RTGIP2_RUNTIME_MODE = "production" as const;
export const PROJECT_REF = "onnbmmdbrsgytfozfozn";

// The production Gateway origin is a P2 input that is not known yet. scripts/rtgip2/build-runtime.mjs
// substitutes RTGIP_PRODUCTION_GATEWAY_ORIGIN at build time; without it the bundle carries the
// placeholder below (reserved .invalid domain) and an empty allowlist, so every dispatch is refused
// with gateway_origin_not_allowed until the bundle is rebuilt with the real origin.
declare const __RTGIP_PRODUCTION_GATEWAY_ORIGIN__: string | undefined;
export const GATEWAY_ORIGIN_PLACEHOLDER = "https://production-gateway-origin-unset.invalid";
export const GATEWAY_PRODUCTION_ORIGIN: string =
  typeof __RTGIP_PRODUCTION_GATEWAY_ORIGIN__ === "string" ? __RTGIP_PRODUCTION_GATEWAY_ORIGIN__ : GATEWAY_ORIGIN_PLACEHOLDER;
export const GATEWAY_ORIGINS: readonly string[] =
  GATEWAY_PRODUCTION_ORIGIN === GATEWAY_ORIGIN_PLACEHOLDER ? [] : [GATEWAY_PRODUCTION_ORIGIN];
