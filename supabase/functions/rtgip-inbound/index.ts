import { RTGIP2_APP_RUNTIME_ENABLED, createEntryRuntime } from "../_shared/rtgip2-runtime.bundle.js";

const runtime = createEntryRuntime({ compiledEnabled: RTGIP2_APP_RUNTIME_ENABLED });

Deno.serve((req: Request) => runtime.inbound(req));
