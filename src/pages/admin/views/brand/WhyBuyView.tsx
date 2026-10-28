import { AdminCard } from "@/components/admin/v2/primitives";
import DealershipTrustPanel from "@/components/admin/DealershipTrustPanel";
import { WHY_BUY_KEYS, validateWhyBuy } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { TextAreaField, TextField } from "./fields";

// Marketing copy the shopper reads on the Passport and stickers, then the
// existing trust panel (badges, reviews, amenities, advisor), which keeps its
// own instant save.

export default function WhyBuyView() {
  const form = useBrandForm(WHY_BUY_KEYS, validateWhyBuy);
  const { draft, set, source } = form;

  return (
    <div className="space-y-4">
      <AdminCard title="Why buy here" description="Shown to shoppers on the scanned vehicle packet and stickers. Only what you write appears.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="Tagline" value={draft.dealer_tagline} onChange={(v) => set("dealer_tagline", v)} hint="Shown under the dealership name on documents." className="md:col-span-2" />
          <TextAreaField label="Why buy here" value={draft.why_buy_here} onChange={(v) => set("why_buy_here", v)} rows={4} placeholder="Family owned, free lifetime car washes, 7-day exchange" />
          <TextAreaField label="Warranty programs" value={draft.warranty_programs} onChange={(v) => set("warranty_programs", v)} rows={4} placeholder="Powertrain warranty on every used vehicle, certified pre-owned coverage" hint="Free text. Structured programs live under Pricing & Products." />
        </div>
      </AdminCard>

      <BrandSaveBar form={form} />

      {source.isFixture ? (
        <AdminCard title="Credibility badges and reviews">
          <p className="text-[13px] text-adm-muted">The trust panel is live only; it is not part of the design fixture.</p>
        </AdminCard>
      ) : (
        <AdminCard>
          <DealershipTrustPanel />
        </AdminCard>
      )}
    </div>
  );
}
