import { ExternalLink } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { AdminCard, AdminLinkButton, AdminTable, Td, Th } from "@/components/admin/v2/primitives";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
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
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
      <AdminCard
        flush
        inset="sm"
        title="Customer previews"
        action={<AdminLinkButton to={ADMIN_CHILD_ROUTES.customerPreview} variant="primary">Open dealer preview</AdminLinkButton>}
      >
        <AdminTable caption="Customer previews" minWidth={560}>
          <thead>
            <tr>
              <Th>Scenario</Th>
              <Th>What it shows</Th>
              <Th align="right">Preview</Th>
            </tr>
          </thead>
          <tbody>
            {PASSPORT_PREVIEWS.map((p) => (
              <tr key={p.key}>
                <Td className="whitespace-nowrap font-medium">{p.title}</Td>
                <Td className="max-w-[420px] truncate text-adm-muted">{p.detail}</Td>
                <Td align="right">
                  <a href={p.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-adm-primary hover:underline">
                    Open preview
                    <ExternalLink className="w-5 h-5" aria-hidden="true" />
                  </a>
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminCard>
      <div className="space-y-3">
        <RoutingPreview routing={settings.passport_contact_routing} agents={settings.passport_agents ?? []} now={now} />
        <AdminLinkButton to={adminTabHref("routing")} variant="secondary" className="w-full">Edit routing</AdminLinkButton>
      </div>
    </div>
  );
}
