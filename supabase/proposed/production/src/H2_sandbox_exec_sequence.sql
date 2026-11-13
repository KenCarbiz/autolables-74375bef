-- H2. Staging-only (AutoLabels Staging uakiwvigsmrlyfpsalai). Remove sequence advancement from sandbox_exec on the
-- one package sequence it can use. Revokes only; SELECT on the sequence and every other grant are kept.
REVOKE USAGE, UPDATE ON SEQUENCE public.vehicle_custody_milestones_seq_seq FROM sandbox_exec;
