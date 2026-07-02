// Client-side entry for the Customer Passport contact routing logic. The
// implementation lives with the edge functions (they resolve routing at
// request time with the service role) and is pure TS, so the client reuses
// it for the admin live preview without duplicating the rules.
export * from "../../supabase/functions/_shared/passport-routing";
