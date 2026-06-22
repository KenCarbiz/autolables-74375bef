-- Dealer-controlled reconditioning and service-photo visibility fields.
-- These keep recon proof opt-in and manager-reviewed before customer Passport display.

alter table public.used_vehicle_inspections
  add column if not exists reconditioned boolean not null default false,
  add column if not exists reconditioning_work_performed text null,
  add column if not exists service_photos_allowed boolean not null default false,
  add column if not exists service_photo_visibility text not null default 'dealer_private';

comment on column public.used_vehicle_inspections.reconditioned is 'True when service/recon has completed reconditioning work on the vehicle.';
comment on column public.used_vehicle_inspections.reconditioning_work_performed is 'Plain-language list or summary of what reconditioning work was completed.';
comment on column public.used_vehicle_inspections.service_photos_allowed is 'Dealer opt-in for saving service/recon photos for this inspection.';
comment on column public.used_vehicle_inspections.service_photo_visibility is 'dealer_private, manager_review, or customer_visible_after_approval.';
