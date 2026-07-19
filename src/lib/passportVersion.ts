// Client-side re-export of the pure passport version resolver so the same
// logic backs the edge function (public-listing-view) and any client-side
// preview/admin surfaces. Zero imports beyond the shared file keeps this
// safe for both Deno and the Vite bundle.
export {
  resolvePassportVersion,
  type PassportVersion,
  type PassportVersionOverride,
  type PassportResolutionReason,
  type PassportVersionInput,
  type PassportVersionResult,
} from "../../supabase/functions/_shared/passport-version";
