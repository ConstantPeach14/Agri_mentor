-- Adds participant and optional reason metadata to the existing ended lifecycle.
-- Do not apply without separate approval and an explicitly authorised target.

ALTER TABLE mentorship_relationships
  ADD COLUMN ended_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN end_reason TEXT
    CHECK (end_reason IS NULL OR char_length(btrim(end_reason)) <= 1000);

CREATE FUNCTION enforce_mentorship_relationship_termination()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ended' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
    OR NEW.ended_by_user_id IS DISTINCT FROM OLD.ended_by_user_id
    OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
  ) THEN
    RAISE EXCEPTION 'An ended mentorship relationship is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_relationship_termination_final';
  END IF;

  IF NEW.status = 'active' AND (
    NEW.ended_at IS NOT NULL
    OR NEW.ended_by_user_id IS NOT NULL
    OR NEW.end_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Active mentorship relationships cannot have termination metadata'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_relationship_active_without_termination';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'ended' AND (
    NEW.ended_at IS NULL
    OR NEW.ended_by_user_id IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM mentorship_relationships relationship
       WHERE relationship.id = NEW.id
         AND NEW.ended_by_user_id IN (relationship.mentee_user_id, relationship.mentor_user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Ending a mentorship requires an authorised participant and timestamp'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_relationship_termination_actor_required';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_relationships_termination_audit
BEFORE UPDATE ON mentorship_relationships
FOR EACH ROW EXECUTE FUNCTION enforce_mentorship_relationship_termination();
