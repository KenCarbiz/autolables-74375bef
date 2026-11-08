import { afterAll, beforeAll } from "vitest";
import { TEMPLATE_CATALOG } from "../../oem/templateCatalog";

type Mutable = { approval: string; layoutStatus: string };

// Tests that exercise the pending-approval gate pin the entries they cover back
// to pending inside their own describe block, so the gate stays covered after
// the owner approves a template.
export function pinCatalogPending(ids?: readonly string[]): void {
  const saved = new Map<string, { approval: string; layoutStatus: string }>();
  beforeAll(() => {
    for (const t of TEMPLATE_CATALOG) {
      if (ids && !ids.includes(t.id)) continue;
      const m = t as unknown as Mutable;
      if (m.approval !== "approved") continue;
      saved.set(t.id, { approval: m.approval, layoutStatus: m.layoutStatus });
      Object.assign(m, { approval: "pending_owner_approval", layoutStatus: "sample_ready" });
    }
  });
  afterAll(() => {
    for (const t of TEMPLATE_CATALOG) {
      const s = saved.get(t.id);
      if (s) Object.assign(t as unknown as Mutable, s);
    }
    saved.clear();
  });
}
