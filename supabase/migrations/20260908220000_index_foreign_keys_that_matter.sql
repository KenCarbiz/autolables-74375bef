-- Foreign-key indexes, scoped deliberately.
--
-- The security linter reports 97 unindexed foreign keys. It is not correct to
-- add 97 indexes. An unindexed FK costs a sequential scan of the CHILD table
-- whenever the parent row is deleted or its key updated, so the cost is
-- proportional to the child's size -- and 48 of the 97 sit on tables with
-- fewer than 100 rows, where that scan is free. Indexing those would buy
-- nothing, add write amplification on every insert, and trip the linter's
-- other rule, unused_index. Trading one warning for another is not a fix.
--
-- So this covers the 49 on tables at or above 100 rows: 13 at 1,000+ and 36
-- between 100 and 999. The remaining 48 are left deliberately, and the query
-- that produced this split is in the commit message so the decision can be
-- re-run as the tables grow.
--
-- Additive only: every statement is CREATE INDEX IF NOT EXISTS. No policy, no
-- grant, no data. Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_fk_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_dept_signoff_tokens_vehicle_listing_id ON public.dept_signoff_tokens (vehicle_listing_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_cases_current_master_version_id ON public.description_cases (current_master_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_cases_master_locked_by ON public.description_cases (master_locked_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_cases_published_master_version_id ON public.description_cases (published_master_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_channel_versions_locked_by ON public.description_channel_versions (locked_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_channel_versions_tenant_id ON public.description_channel_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_deliveries_channel_version_id ON public.description_deliveries (channel_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_deliveries_tenant_id ON public.description_deliveries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_deliveries_version_id ON public.description_deliveries (version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_exceptions_assigned_to ON public.description_exceptions (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_description_exceptions_resolved_by ON public.description_exceptions (resolved_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_fact_snapshots_tenant_id ON public.description_fact_snapshots (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_feature_selections_selection_user_id ON public.description_feature_selections (selection_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_model_executions_requested_by ON public.description_model_executions (requested_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_model_executions_version_id ON public.description_model_executions (version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_preflight_results_requested_by ON public.description_preflight_results (requested_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_validation_results_channel_version_id ON public.description_validation_results (channel_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_validation_results_resolved_by ON public.description_validation_results (resolved_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_validation_results_tenant_id ON public.description_validation_results (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_versions_approved_by ON public.description_versions (approved_by);
CREATE INDEX IF NOT EXISTS idx_fk_description_versions_created_by_user_id ON public.description_versions (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_versions_fact_snapshot_id ON public.description_versions (fact_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_versions_model_execution_id ON public.description_versions (model_execution_id);
CREATE INDEX IF NOT EXISTS idx_fk_description_versions_parent_version_id ON public.description_versions (parent_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_document_assets_vehicle_id ON public.document_assets (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fk_factory_sticker_records_approved_by ON public.factory_sticker_records (approved_by);
CREATE INDEX IF NOT EXISTS idx_fk_factory_sticker_records_current_document_id ON public.factory_sticker_records (current_document_id);
CREATE INDEX IF NOT EXISTS idx_fk_factory_sticker_records_reviewed_by ON public.factory_sticker_records (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_fk_factory_sticker_records_vehicle_id ON public.factory_sticker_records (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fk_generated_documents_approved_by ON public.generated_documents (approved_by);
CREATE INDEX IF NOT EXISTS idx_fk_generated_documents_generated_by ON public.generated_documents (generated_by);
CREATE INDEX IF NOT EXISTS idx_fk_generated_documents_superseded_by ON public.generated_documents (superseded_by);
CREATE INDEX IF NOT EXISTS idx_fk_neovin_snapshots_vehicle_id ON public.neovin_snapshots (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fk_safety_inspections_assigned_to ON public.safety_inspections (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_safety_inspections_licensee_certified_by ON public.safety_inspections (licensee_certified_by);
CREATE INDEX IF NOT EXISTS idx_fk_safety_inspections_superseded_by ON public.safety_inspections (superseded_by);
CREATE INDEX IF NOT EXISTS idx_fk_signed_document_archive_created_by ON public.signed_document_archive (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_stale_document_flags_reviewed_by ON public.stale_document_flags (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_facts_overridden_by ON public.vehicle_facts (overridden_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_facts_source_record_id ON public.vehicle_facts (source_record_id);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_files_created_by ON public.vehicle_files (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_lifecycle_authorized_by ON public.vehicle_lifecycle (authorized_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_lifecycle_state_changed_by ON public.vehicle_lifecycle (state_changed_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_lifecycle_vehicle_id ON public.vehicle_lifecycle (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_listings_created_by ON public.vehicle_listings (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_listings_recall_override_by ON public.vehicle_listings (recall_override_by);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_snapshots_parent_snapshot_id ON public.vehicle_snapshots (parent_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fk_vehicle_snapshots_tenant_id ON public.vehicle_snapshots (tenant_id);
