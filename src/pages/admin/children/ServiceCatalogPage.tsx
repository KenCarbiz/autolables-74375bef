import { Crumbs } from "@/components/detail/parts";
import { PageBody, PageHeader } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import ServiceCatalogView from "@/pages/admin/views/documents/catalog/ServiceCatalogView";

export default function ServiceCatalogPage() {
  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Administration", to: "/admin" }, { label: "Documents & Service", to: adminTabHref("templates") }, { label: "Service policy", to: adminTabHref("service-policy") }, { label: "Service catalog" }]} />
      <PageHeader title="Service catalog" description="Internal services a Get-Ready can route to a team or vendor." />
      <ServiceCatalogView />
    </PageBody>
  );
}
