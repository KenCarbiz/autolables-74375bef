-- An evidence ledger behind every generated description.
--
-- description_versions already retains most of what an audit needs: the fact
-- snapshot, the source-data and configuration fingerprints, the voice-profile
-- version, quality and validation state, and — through model_execution_id —
-- the provider, model, token usage, latency and cost. What it cannot answer is
-- which specific facts the writer says it used, under which prompt profile and
-- knowledge revision, and against which Vehicle Truth snapshot.
--
-- One caution encoded in the column names below. A structured-output model
-- returning used_fact_ids is REPORTING ITS OWN REASONING. That is a claim, not
-- proof, and it must never become the validation: a model that invents a fact
-- can equally invent the id it cites. The columns are therefore named for what
-- they are — what the model CLAIMED — and evidence_audit_json holds the
-- cross-check against the fact snapshot we actually supplied. Copy is still
-- validated by reading the copy (validateContent), never by trusting the
-- writer's own account of it.

ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS truth_snapshot_id     uuid,
  ADD COLUMN IF NOT EXISTS prompt_profile        text,
  ADD COLUMN IF NOT EXISTS knowledge_revision    text,
  ADD COLUMN IF NOT EXISTS voice_profile_id      uuid,
  ADD COLUMN IF NOT EXISTS headline              text,
  -- Fact keys the model said it used. Claims, audited below.
  ADD COLUMN IF NOT EXISTS claimed_fact_ids      text[] NOT NULL DEFAULT '{}',
  -- Which claimed facts carried which narrative role: hero, warranty, history.
  ADD COLUMN IF NOT EXISTS fact_roles_json       jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- Result of checking those claims against the supplied snapshot: ids cited
  -- that were never supplied, ids cited that were not usable in copy, and
  -- supplied facts the writer ignored.
  ADD COLUMN IF NOT EXISTS evidence_audit_json   jsonb  NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.description_versions.claimed_fact_ids IS
  'Fact keys the generating model reported using. A self-report, not evidence. Never treat as validation; see evidence_audit_json for the cross-check against the supplied fact snapshot.';
COMMENT ON COLUMN public.description_versions.evidence_audit_json IS
  'Cross-check of claimed_fact_ids against the fact snapshot: {ok, fabricated_ids, unusable_ids, unclaimed_supplied}. fabricated_ids non-empty means the model cited a fact it was never given.';
COMMENT ON COLUMN public.description_versions.knowledge_revision IS
  'Revision of the knowledge library whose modules were loaded for this generation. Reference knowledge explains a verified feature; it never establishes that a VIN has one.';

-- Auditors ask two questions: everything written under a prompt profile, and
-- every version citing a given fact.
CREATE INDEX IF NOT EXISTS idx_description_versions_prompt_profile
  ON public.description_versions (tenant_id, prompt_profile, knowledge_revision);
CREATE INDEX IF NOT EXISTS idx_description_versions_claimed_facts
  ON public.description_versions USING gin (claimed_fact_ids);

-- A version whose model cited a fact it was never supplied is the signal that
-- matters most, and it should be cheap to find.
CREATE INDEX IF NOT EXISTS idx_description_versions_evidence_failed
  ON public.description_versions (tenant_id, created_at DESC)
  WHERE (evidence_audit_json->>'ok') = 'false';
