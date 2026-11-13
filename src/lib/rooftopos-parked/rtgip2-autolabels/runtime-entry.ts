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

/**
 * The function secret RTGIP_EDGE_DB_URL, accepted only for the dedicated login rtgip_edge (rtgip_edge.<ref> through
 * the pooler). Any other user, the postgres owner included, or no URL throws before a connection is opened.
 */
export function edgeDbUrl(value: string | undefined): string {
  let user = "";
  let scheme = "";
  try {
    const u = new URL(value ?? "");
    scheme = u.protocol;
    user = decodeURIComponent(u.username);
  } catch {
    throw new Error("rtgip_edge_db_url_invalid");
  }
  if ((scheme !== "postgres:" && scheme !== "postgresql:") || !/^rtgip_edge(\.[a-z0-9]{20})?$/.test(user)) throw new Error("rtgip_edge_db_url_invalid");
  return value as string;
}

export function createEntryRuntime(opts: { compiledEnabled: boolean }) {
  return createAppRuntime({
    ...APP_BINDINGS,
    compiledEnabled: opts.compiledEnabled,
    stagingRef: PROJECT_REF,
    gatewayOrigins: GATEWAY_ORIGINS,
    env,
    // The dedicated login rtgip_edge (function secret RTGIP_EDGE_DB_URL), never the postgres owner.
    sql: () => postgres(edgeDbUrl(env("RTGIP_EDGE_DB_URL")), { prepare: false, max: 3, idle_timeout: 5, onnotice: () => {} }),
  });
}
