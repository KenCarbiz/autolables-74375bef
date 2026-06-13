alter table public.products
  add column if not exists benefit_justification text not null default '';

comment on column public.products.benefit_justification is
  'FTC §5 + SB 766 §11713.21: factual basis for why this product offers genuine consumer benefit (prevents no-benefit item flagging).';