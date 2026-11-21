-- Both tables are platform configuration, read in the app only by the
-- platform-administrator Inventory network console (provider_field_definitions)
-- or only inside SECURITY DEFINER functions (vehicle_history_setting_keys:
-- vehicle_history_effective_setting, vehicle_history_set_setting), which bypass RLS.
-- Writes already go only through SECURITY DEFINER RPCs.

DROP POLICY IF EXISTS "vehicle_history_setting_keys_read" ON public.vehicle_history_setting_keys;
DROP POLICY IF EXISTS "Platform admins read history setting keys" ON public.vehicle_history_setting_keys;
CREATE POLICY "Platform admins read history setting keys"
  ON public.vehicle_history_setting_keys FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in users read field definitions" ON public.provider_field_definitions;
DROP POLICY IF EXISTS "Platform admins read field definitions" ON public.provider_field_definitions;
CREATE POLICY "Platform admins read field definitions"
  ON public.provider_field_definitions FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.vehicle_history_setting_keys FROM anon;
REVOKE ALL ON public.provider_field_definitions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicle_history_setting_keys FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.provider_field_definitions FROM authenticated;
GRANT SELECT ON public.vehicle_history_setting_keys, public.provider_field_definitions TO authenticated;

NOTIFY pgrst, 'reload schema';