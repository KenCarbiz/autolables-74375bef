-- Rollback for the PROPOSED 20261101000000_price_component_evidence.sql.
-- Drops the evidence table and everything it added. Export the table first
-- if any rows must be kept: the evidence is deleted with it.
DROP TABLE IF EXISTS public.price_component_evidence;
DROP FUNCTION IF EXISTS public.price_component_evidence_immutable();
