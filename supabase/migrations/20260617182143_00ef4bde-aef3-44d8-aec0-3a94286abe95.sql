-- Ensure pgcrypto is installed in the extensions schema (Supabase default)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- The audit-chain hash function calls digest() but pins search_path to
-- 'public', 'pg_temp' — which does not include the extensions schema where
-- pgcrypto lives. Schema-qualify the call so it resolves regardless of
-- search_path. This is what was breaking admin_create_tenant: the function
-- writes to audit_log, whose BEFORE INSERT trigger calls _audit_chain_payload,
-- which called bare digest() → "function digest(text, unknown) does not exist".
CREATE OR REPLACE FUNCTION public._audit_chain_payload(
  _prev_hash text,
  _action text,
  _entity_type text,
  _entity_id text,
  _store_id text,
  _user_email text,
  _details jsonb,
  _created_at timestamp with time zone
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT encode(
    extensions.digest(
      coalesce(_prev_hash, 'GENESIS') || '|'
        || coalesce(_action, '') || '|'
        || coalesce(_entity_type, '') || '|'
        || coalesce(_entity_id, '') || '|'
        || coalesce(_store_id, '') || '|'
        || coalesce(_user_email, '') || '|'
        || coalesce(_details::text, '{}') || '|'
        || to_char(_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sha256'
    ),
    'hex'
  );
$function$;