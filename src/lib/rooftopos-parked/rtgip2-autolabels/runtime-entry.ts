// The bundle entry for the AutoLabels edge functions (scripts/rtgip2/build-runtime.mjs). The
// functions pass only the compiled literal; every other input is fixed here or read from the
// platform environment by the runtime's gate.
import postgres from "postgres";
import { RTGIP3, createAppRuntime } from "../rtgip2-runtime/runtime.ts";
import { labelsStagingAdapter } from "./staging-adapter.ts";
import { PUBLISH_KINDS, PUBLISH_REF_KEYS, labelsPublishAuthorizer } from "./publish-authorizer.ts";
import { RTGIP2_APP_RUNTIME_ENABLED, STAGING_GATEWAY_ORIGINS, STAGING_PROJECT_REF } from "./runtime-config.ts";

export { RTGIP2_APP_RUNTIME_ENABLED, RTGIP3, STAGING_GATEWAY_ORIGINS, STAGING_PROJECT_REF, createAppRuntime };

export const APP_BINDINGS = {
  app: "autolabels",
  adapter: labelsStagingAdapter,
  publish: { kinds: PUBLISH_KINDS, refKeys: PUBLISH_REF_KEYS, authorize: labelsPublishAuthorizer },
} as const;

const env = (name: string): string | undefined => (globalThis as unknown as { Deno: { env: { get(n: string): string | undefined } } }).Deno.env.get(name);

export function createEntryRuntime(opts: { compiledEnabled: boolean }) {
  return createAppRuntime({
    ...APP_BINDINGS,
    compiledEnabled: opts.compiledEnabled,
    stagingRef: STAGING_PROJECT_REF,
    gatewayOrigins: STAGING_GATEWAY_ORIGINS,
    env,
    sql: () => postgres(env("SUPABASE_DB_URL") ?? "", { prepare: false, max: 3, idle_timeout: 5, onnotice: () => {} }),
  });
}
