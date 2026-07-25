// TenantContext seeds a "house" sentinel tenant so anonymous/public pages have
// branding before (or without) a sign-in. Its id is the literal string "house",
// which is not a uuid — any tenant-scoped query fired with it comes back as a
// raw Postgres `invalid input syntax for type uuid` error. Every gate on the
// current tenant must therefore ask for a REAL tenant id, not just a truthy one.

export const HOUSE_TENANT_ID = "house";

export function realTenantId(tenant: { id?: string | null } | null | undefined): string | null {
  const id = tenant?.id;
  return id && id !== HOUSE_TENANT_ID ? id : null;
}
