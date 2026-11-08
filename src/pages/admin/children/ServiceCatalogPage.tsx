import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { crumbsFor, locateTab } from "@/lib/admin/categories";
import { adminTabHref } from "@/lib/admin/sections";
import ServiceCatalogView from "@/pages/admin/views/documents/catalog/ServiceCatalogView";

export default function ServiceCatalogPage() {
  const parent = crumbsFor(locateTab("service-policy"), "Service policy").map((c, i, all) => (i === all.length - 1 ? { ...c, href: adminTabHref("service-policy") } : c));
  return (
    <ChildPageFrame crumbs={[...parent, { label: "Service catalog" }]} title="Service catalog" subtitle="Internal services a Get-Ready can route to a team or vendor.">
      <ServiceCatalogView />
    </ChildPageFrame>
  );
}
