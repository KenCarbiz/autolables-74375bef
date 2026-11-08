-- Rollback for 20261109000000_description_store_settings.sql. Every store
-- returns to the dealership description_settings row.
DROP FUNCTION IF EXISTS public.apply_description_store_settings(uuid, uuid, integer, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.description_store_settings_errors(jsonb);
DROP TABLE IF EXISTS public.description_store_settings_versions;
DROP TABLE IF EXISTS public.description_store_settings;
