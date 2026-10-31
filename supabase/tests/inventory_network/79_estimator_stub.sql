-- Test-only stand-ins the payment estimator migration (0009) references.
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.onboarding_profiles (tenant_id uuid PRIMARY KEY, stores jsonb DEFAULT '[]');
CREATE TABLE IF NOT EXISTS public.audit_log (id bigserial PRIMARY KEY, action text, entity_type text, entity_id text, store_id text, user_id uuid, details jsonb, created_at timestamptz DEFAULT now());
