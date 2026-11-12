// The bundle entry for the AutoLabels edge functions (scripts/rtgip2/build-runtime.mjs). The
// functions pass only the compiled literal; every other input is fixed here or read from the
// platform environment by the runtime's gate.
import postgres from "postgres";
import { RTGIP3, createAppRuntime } from "../rtgip2-runtime/runtime.ts";
import { labelsStagingAdapter } from "./staging-adapter.ts";
import { PUBLISH_KINDS, PUBLISH_REF_KEYS, labelsPublishAuthorizer } from "./publish-authorizer.ts";
import {
  GATEWAY_ORIGINS,
  PROJECT_REF,
  RTGIP2_APP_RUNTIME_ENABLED,
  RTGIP2_RUNTIME_MODE,
} from "./runtime-config.ts";

export { GATEWAY_ORIGINS, PROJECT_REF, RTGIP2_APP_RUNTIME_ENABLED, RTGIP2_RUNTIME_MODE, RTGIP3, createAppRuntime };

export const APP_BINDINGS = {
  app: "autolabels",
  runtimeMode: RTGIP2_RUNTIME_MODE,
  adapter: labelsStagingAdapter,
  publish: { kinds: PUBLISH_KINDS, refKeys: PUBLISH_REF_KEYS, authorize: labelsPublishAuthorizer },
} as const;

const env = (name: string): string | undefined => (globalThis as unknown as { Deno: { env: { get(n: string): string | undefined } } }).Deno.env.get(name);

export function createEntryRuntime(opts: { compiledEnabled: boolean }) {
  return createAppRuntime({
    ...APP_BINDINGS,
    compiledEnabled: opts.compiledEnabled,
    stagingRef: PROJECT_REF,
    gatewayOrigins: GATEWAY_ORIGINS,
    env,
    // The dedicated login rtgip_edge (function secret RTGIP_EDGE_DB_URL), never the postgres owner.
    sql: () => postgres(env("RTGIP_EDGE_DB_URL") ?? "", { prepare: false, max: 3, idle_timeout: 5, onnotice: () => {} }),
  });
}
