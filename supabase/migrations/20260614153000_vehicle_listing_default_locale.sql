-- Default display language for a published listing's public scan page.
--
-- When a sale is negotiated in Spanish, the dealer can publish the QR so
-- the buyer's window-sticker scan (/v/:slug) opens in Spanish by default
-- (FTC 16 CFR Part 455 bilingual Buyers Guide; CA Civil Code §1632 / SB
-- 766 language-of-negotiation disclosures). The buyer can still flip the
-- toggle either way; this only seeds the initial language.
--
-- 'en' default preserves today's behavior for every existing listing.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'en';
