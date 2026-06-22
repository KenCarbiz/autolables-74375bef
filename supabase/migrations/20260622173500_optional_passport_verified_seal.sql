-- Optional dealer-controlled Passport Verified seal.
-- Dealers can choose whether the customer Passport displays the premium verified seal.

alter table public.passport_delivery_settings
  add column if not exists show_passport_verified_seal boolean not null default false;

comment on column public.passport_delivery_settings.show_passport_verified_seal is 'Dealer opt-in for displaying the AutoLabels Passport Verified seal on customer Passport pages.';
