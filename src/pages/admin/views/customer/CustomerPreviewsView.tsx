import { ExternalLink } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { AdminCard, AdminLinkButton, InlineNote, SectionTitle } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { useAdminNow } from "@/lib/admin/dataSource";
import { RoutingPreview } from "./RoutingPreview";

const PASSPORT_PREVIEWS = [
  { key: "new2026", title: "New vehicle", detail: "A 2026 new vehicle with MSRP, discounts and the fee-inclusive price ladder.", href: "/v/demo?preview=1&scenario=new2026" },
  { key: "usedfee", title: "Used vehicle with doc fee", detail: "A used vehicle priced against market value with a configured doc fee.", href: "/v/demo?preview=1&scenario=usedfee" },
  { key: "sparse", title: "Sparse data", detail: "A used vehicle with little evidence, to see what the shopper gets when data is thin.", href: "/v/demo?preview=1&scenario=sparse" },
  { key: "review", title: "Verification report", detail: "The verification view a shopper reaches from the Verified card.", href: "/v/demo/verification?preview=1&scenario=review" },
];

export default function CustomerPreviewsView() {
  const { settings } = useDealerSettings();
  const now = useAdminNow();
  return (
    <div className="space-y-4">
      <SectionTitle title="Customer previews" description="See what shoppers see. Previews use synthetic vehicles and never touch inventory." />
      <InlineNote tone="info" title="The customer Passport design is locked.">These previews open the served page with example data. Changes to its layout need an explicit owner sign-off.</InlineNote>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PASSPORT_PREVIEWS.map((p) => (
            <AdminCard key={p.key} title={p.title} description={p.detail}>
              <a href={p.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 min-h-[36px] px-3.5 rounded-md border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                Open preview
                <ExternalLink className="w-4 h-4 text-adm-muted" aria-hidden="true" />
              </a>
            </AdminCard>
          ))}
        </div>
        <div className="space-y-3">
          <RoutingPreview routing={settings.passport_contact_routing} agents={settings.passport_agents ?? []} now={now} />
          <AdminLinkButton to={adminTabHref("routing")} variant="secondary" className="w-full">Edit routing</AdminLinkButton>
        </div>
      </div>
    </div>
  );
}
