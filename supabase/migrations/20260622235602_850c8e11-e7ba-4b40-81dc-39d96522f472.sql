
alter table public.passport_delivery_settings
  add column if not exists enable_used_car_service_inspection boolean not null default false,
  add column if not exists enable_reconditioning_workflow boolean not null default false,
  add column if not exists require_manager_approval_for_passport_proof boolean not null default true,
  add column if not exists allow_customer_visible_service_photos boolean not null default false,
  add column if not exists allow_customer_visible_reconditioning_notes boolean not null default false;

comment on column public.passport_delivery_settings.enable_used_car_service_inspection is 'Dealer opt-in for service QR used-car inspection intake.';
comment on column public.passport_delivery_settings.enable_reconditioning_workflow is 'Dealer opt-in for reconditioning workflow and completed-work capture.';
comment on column public.passport_delivery_settings.require_manager_approval_for_passport_proof is 'Requires manager approval before service/recon proof appears on customer Passport.';
comment on column public.passport_delivery_settings.allow_customer_visible_service_photos is 'Dealer opt-in for customer-visible service/recon photos after approval.';
comment on column public.passport_delivery_settings.allow_customer_visible_reconditioning_notes is 'Dealer opt-in for customer-visible reconditioning notes after approval and guardrail review.';
