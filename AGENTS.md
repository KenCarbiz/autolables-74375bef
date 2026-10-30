# Agent rules

- Files.com inventory intake lives in `supabase/functions/files-inventory-notify` (signed webhook receiver) and `files-inventory-admin` (platform-admin console), with pure rules in `supabase/functions/_shared/filescom/`. Why: the tenant is derived only from an admin-approved exact-path binding, never from a request header or filename.
- Files.com connector phase 1 writes only `inventory_feed_*` tables (enforced by `assertConnectorWrite`). Why: inventory upserts, sold/retire and sharing need separate owner approval.
