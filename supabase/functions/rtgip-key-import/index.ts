import {
  RTGIP2_KEY_IMPORT_ENABLED,
  createEntryKeyImport,
} from "../_shared/rtgip2-key-import.bundle.js";

const keyImport = createEntryKeyImport({ compiledEnabled: RTGIP2_KEY_IMPORT_ENABLED });

Deno.serve((req: Request) => keyImport.handle(req));
