-- Customer Passport contact routing — lead attribution + escalation fields.
--
-- Routing configuration (mode, agent roster, rotation memory, after-hours,
-- SLA) lives in dealer_profiles.settings (passport_contact_routing,
-- passport_agents, passport_rotation_state, vehicle_agent_assignments) and is
-- resolved server-side by public-listing-view / lead-alert. This migration
-- only adds the lead-side columns those functions write, plus an optional
-- per-listing agent assignment. Additive and idempotent.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sub_source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS routing jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS routed_agent_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;

-- Vehicle-level assignment for Assigned Agent mode. Text id referencing the
-- dealer's passport_agents roster entry (settings-managed, not a FK).
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS assigned_agent_id text;

-- The SLA sweep (passport-lead-escalation) scans for unanswered routed leads.
CREATE INDEX IF NOT EXISTS idx_leads_routing_sla
  ON public.leads (store_id, created_at)
  WHERE routing IS NOT NULL AND first_response_at IS NULL;
