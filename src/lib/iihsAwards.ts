// Client-side entry for IIHS award matching. The implementation lives with
// the edge functions (public-listing-view attaches the matched award to the
// anonymous payload) and is pure TS, so the client and admin reuse it.
export * from "../../supabase/functions/_shared/iihs-awards";
