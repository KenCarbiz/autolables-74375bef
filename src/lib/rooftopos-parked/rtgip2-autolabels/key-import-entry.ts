// The bundle entry for the AutoLabels rtgip-key-import Edge Function (C-S4 Alternative S1, staging
// only, removed after provisioning). The function passes only the compiled literal below; the staging
// ref is the runtime's compiled one and everything else is read from the platform environment.
import postgres from "postgres";
import { createKeyImport, keySecretName, KEY_IMPORT_IDS } from "../rtgip2-key-import/key-import.ts";
import { STAGING_PROJECT_REF } from "./runtime-config.ts";

export const RTGIP2_KEY_IMPORT_ENABLED = false as const;

export { STAGING_PROJECT_REF, createKeyImport, keySecretName, KEY_IMPORT_IDS };

const env = (name: string): string | undefined =>
  (globalThis as unknown as { Deno: { env: { get(n: string): string | undefined } } }).Deno.env.get(
    name,
  );

export function createEntryKeyImport(opts: { compiledEnabled: boolean }) {
  return createKeyImport({
    compiledEnabled: opts.compiledEnabled,
    stagingRef: STAGING_PROJECT_REF,
    env,
    sql: () =>
      postgres(env("SUPABASE_DB_URL") ?? "", {
        prepare: false,
        max: 1,
        idle_timeout: 2,
        connect_timeout: 5,
        onnotice: () => {},
      }),
  });
}
