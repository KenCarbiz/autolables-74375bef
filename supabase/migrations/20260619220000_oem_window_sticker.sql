-- OEM window sticker (Monroney) — the rendered factory sticker pulled by VIN
-- from a provider (VinAudit / MonroneyLabels / VehicleDatabases) and cached on
-- the listing so the customer packet can show it. The binary is stored in a
-- public bucket; only the resulting URL + a checked-at timestamp live here.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS oem_sticker_url text,
  ADD COLUMN IF NOT EXISTS oem_sticker_checked_at timestamptz;

-- Public, read-only bucket for the rendered stickers. Service-role writes
-- (from the edge function) bypass RLS; public read is implied by public=true.
INSERT INTO storage.buckets (id, name, public)
VALUES ('oem-stickers', 'oem-stickers', true)
ON CONFLICT (id) DO NOTHING;
