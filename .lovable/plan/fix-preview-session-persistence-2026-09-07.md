# Fix preview session persistence

## Changes
- Add an application-owned auth storage adapter that keeps the existing editor broker as the preferred shared-session path, while immediately mirroring writes/removals to browser storage and falling back to browser storage when broker reads time out or return no value.
- Route application imports to an application-owned backend client through the build alias, leaving the generated client and generated preview storage files untouched so regeneration cannot erase the fix.
- Remove the XMLHttpRequest and hidden-frame login relay paths so sign-in uses the standard password flow only.
- Remove the now-unneeded `auth-login-relay` function and its public function configuration. Do not alter backend data, migrations, cron jobs, secrets, or publication state.

## Verification
- Add focused storage tests that simulate a silent editor broker and prove a session write is immediately present in browser storage, readable after a fresh adapter/client initialization, and removable on sign-out.
- Run the focused tests and production build, then inspect the latest build diagnostics.
- Exercise the preview sign-in/reload flow when an authenticated test session is available; report persistence evidence separately from token issuance.

## Technical details
- The durable customization will live outside `src/integrations/supabase/client.ts` and `previewAuthStorage.ts`, which remain generated and unchanged.
- The broker remains preferred for reads and receives best-effort writes, but its two-second timeout will no longer delay or fail local persistence.
