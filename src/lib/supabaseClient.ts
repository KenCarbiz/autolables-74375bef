import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resilientAuthStorage } from "@/lib/auth/resilientAuthStorage";

const backendUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(backendUrl, publishableKey, {
  auth: {
    storage: resilientAuthStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});