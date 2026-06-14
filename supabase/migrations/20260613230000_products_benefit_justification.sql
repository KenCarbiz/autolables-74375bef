-- ──────────────────────────────────────────────────────────────
-- Wave 16 — per-line benefit justification on products.
--
-- FTC §5 and CA SB 766 §11713.21 both require dealers to justify
-- WHY each add-on benefits the buyer for the specific transaction.
-- Today the products catalog carries name + disclosure + price
-- but no separate "benefit" field; dealers cram it into the
-- disclosure string. That makes downstream surfaces (sticker,
-- addendum, /v/:slug receipt, Audit-Defense Packet) unable to
-- show benefit text distinctly from the legal disclosure.
--
-- This migration adds an OPTIONAL benefit_justification column
-- on products. The per-addendum products_snapshot JSONB seeds
-- from this value at addendum-build time; dealers can override
-- per-vehicle for transaction-specific context (the shape SB 766
-- expects). Both layers persist so the Audit-Defense Packet can
-- prove the dealer didn't change the catalog after the fact.
--
-- Safe to apply to a populated catalog — column defaults to '',
-- no existing rows break.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS benefit_justification TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.products.benefit_justification IS
  'Per-product benefit justification text. Used as the SEED for the per-addendum line; dealers can override per-vehicle in the addendum builder. Required on installed (badge_type=installed) products before the compliance red-team will release a signing link. References: FTC Act §5, CA SB 766 §11713.21 (eff. Oct 1 2026).';
