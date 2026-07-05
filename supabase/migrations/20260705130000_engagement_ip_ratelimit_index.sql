-- record-engagement rate-limits by counting recent events per client IP on
-- EVERY write (eq ip_address, created_at >= 5 min ago). Without an index on
-- (ip_address, created_at) that count degrades to a scan as the table grows,
-- slowing every event insert. This composite index keeps the rate check O(log n).
CREATE INDEX IF NOT EXISTS customer_engagement_events_ip_time_idx
  ON public.customer_engagement_events (ip_address, created_at DESC);
