-- Superseded marker: the real sweep definition (token mint in its own
-- subtransaction, deterministic order, clearance recompute) lives in
-- 20260726150000_void_retract_and_sweep_clearance.sql, which redefines the
-- function created by 20260726040000. Kept so applied-migration history
-- matches file history; intentionally contains no SQL beyond this note.
SELECT 1;
