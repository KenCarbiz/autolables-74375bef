-- ─────────────────────────────────────────────────────────────────────────
-- Harden the safety_inspections UPDATE policy.
--
-- The original policy let ANY accepted tenant member update an inspection row —
-- including a 'viewer', 'sales', or 'detail' login — which means a signed CT
-- K-208 (a compliance record that can gate deal finalization) could be flipped
-- to 'signed' or rewritten by a low-privilege user. Restrict UPDATE to the
-- roles that actually own the inspection lifecycle (plus platform admins).
-- INSERT/SELECT policies are unchanged.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members update safety inspections" ON public.safety_inspections;
DROP POLICY IF EXISTS "Privileged members update safety inspections" ON public.safety_inspections;

CREATE POLICY "Privileged members update safety inspections"
  ON public.safety_inspections FOR UPDATE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
        AND role IN ('owner','admin','manager','service')
    )
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
        AND role IN ('owner','admin','manager','service')
    )
  );
