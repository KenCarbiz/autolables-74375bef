import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface DirectoryMember {
  userId: string;
  name: string;
  role: string;
}

export const useTenantMemberDirectory = () => {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const query = useQuery({
    queryKey: ["tenant_member_directory", tenantId],
    enabled: !!tenantId,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<DirectoryMember[]> => {
      const { data, error } = await supabase.rpc("list_tenant_members", { p_tenant_id: tenantId as string });
      if (error) return [];
      return (data ?? [])
        .filter((m) => !!m.user_id && !!m.accepted_at)
        .map((m) => ({ userId: m.user_id, name: m.email || m.invited_email || "", role: m.role }));
    },
  });
  const members = query.data ?? [];
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name || null;
  return { members, nameOf, isLoading: query.isLoading };
};
