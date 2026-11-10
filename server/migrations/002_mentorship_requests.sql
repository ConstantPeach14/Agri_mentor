-- Mentor discovery, mentorship requests, and active mentorship relationships.
-- Apply only after explicit approval and through the migration runner.

ALTER TABLE mentor_profiles
  ADD COLUMN max_active_mentees SMALLINT,
  ADD CONSTRAINT mentor_profiles_capacity_check
    CHECK (max_active_mentees IS NULL OR max_active_mentees >= 1);

CREATE TABLE mentorship_requests (
  id UUID PRIMARY KEY,
  mentee_user_id UUID NOT NULL REFERENCES mentee_profiles(user_id) ON DELETE RESTRICT,
  mentor_user_id UUID NOT NULL REFERENCES mentor_profiles(user_id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  needs TEXT NOT NULL DEFAULT '' CHECK (char_length(needs) <= 1000),
  interests TEXT NOT NULL DEFAULT '' CHECK (char_length(interests) <= 1000),
  goals TEXT NOT NULL DEFAULT '' CHECK (char_length(goals) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK (
    (status = 'pending' AND responded_at IS NULL)
    OR (status <> 'pending' AND responded_at IS NOT NULL)
  ),
  UNIQUE (id, mentee_user_id, mentor_user_id)
);

-- An accepted pair remains ineligible for another request even after its relationship ends.
CREATE UNIQUE INDEX mentorship_requests_pair_active_unique
  ON mentorship_requests (mentee_user_id, mentor_user_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX mentorship_requests_mentor_status_created_idx
  ON mentorship_requests (mentor_user_id, status, created_at DESC);
CREATE INDEX mentorship_requests_mentee_status_created_idx
  ON mentorship_requests (mentee_user_id, status, created_at DESC);

CREATE TABLE mentorship_relationships (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  mentee_user_id UUID NOT NULL,
  mentor_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  ),
  FOREIGN KEY (request_id, mentee_user_id, mentor_user_id)
    REFERENCES mentorship_requests (id, mentee_user_id, mentor_user_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX mentorship_relationships_active_pair_unique
  ON mentorship_relationships (mentee_user_id, mentor_user_id)
  WHERE status = 'active';
CREATE INDEX mentorship_relationships_mentee_status_idx
  ON mentorship_relationships (mentee_user_id, status, created_at DESC);
CREATE INDEX mentorship_relationships_mentor_status_idx
  ON mentorship_relationships (mentor_user_id, status, created_at DESC);

CREATE FUNCTION enforce_mentorship_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  mentor_capacity SMALLINT;
  active_count INTEGER;
BEGIN
  IF NEW.status = 'active' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
      RETURN NEW;
    END IF;

    SELECT max_active_mentees
      INTO mentor_capacity
      FROM mentor_profiles
     WHERE user_id = NEW.mentor_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mentor profile does not exist'
        USING ERRCODE = '23503', CONSTRAINT = 'mentorship_relationships_mentor_fkey';
    END IF;

    SELECT count(*)::INTEGER
      INTO active_count
      FROM mentorship_relationships
     WHERE mentor_user_id = NEW.mentor_user_id AND status = 'active';

    IF mentor_capacity IS NOT NULL AND active_count >= mentor_capacity THEN
      RAISE EXCEPTION 'Mentor has reached the active mentee capacity'
        USING ERRCODE = '23514', CONSTRAINT = 'mentorship_capacity_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_relationships_enforce_capacity
BEFORE INSERT OR UPDATE OF status ON mentorship_relationships
FOR EACH ROW
EXECUTE FUNCTION enforce_mentorship_capacity();

CREATE FUNCTION prevent_capacity_below_active_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NEW.max_active_mentees IS NULL THEN
    RETURN NEW;
  END IF;

  -- The UPDATE locks this mentor row; relationship activation takes the same lock.
  SELECT count(*)::INTEGER
    INTO active_count
    FROM mentorship_relationships
   WHERE mentor_user_id = OLD.user_id AND status = 'active';

  IF active_count > NEW.max_active_mentees THEN
    RAISE EXCEPTION 'Mentor capacity cannot be lower than the active relationship count'
      USING ERRCODE = '23514', CONSTRAINT = 'mentor_capacity_not_below_active_count';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentor_profiles_enforce_capacity
BEFORE UPDATE OF max_active_mentees ON mentor_profiles
FOR EACH ROW
WHEN (OLD.max_active_mentees IS DISTINCT FROM NEW.max_active_mentees)
EXECUTE FUNCTION prevent_capacity_below_active_relationships();

CREATE FUNCTION prevent_mentorship_relationship_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.mentee_user_id IS DISTINCT FROM OLD.mentee_user_id
    OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id THEN
    RAISE EXCEPTION 'A mentorship relationship cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_relationship_identity_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_relationships_identity_immutable
BEFORE UPDATE ON mentorship_relationships
FOR EACH ROW
EXECUTE FUNCTION prevent_mentorship_relationship_reassignment();

CREATE FUNCTION enforce_mentorship_request_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A responded mentorship request cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_request_status_is_final';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_requests_status_transition
BEFORE UPDATE OF status ON mentorship_requests
FOR EACH ROW
EXECUTE FUNCTION enforce_mentorship_request_transition();

CREATE FUNCTION prevent_mentorship_request_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.mentee_user_id IS DISTINCT FROM OLD.mentee_user_id
    OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id THEN
    RAISE EXCEPTION 'A mentorship request cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_request_identity_is_immutable';
  END IF;

  IF (OLD.status <> 'pending' OR NEW.status <> 'pending')
    AND (
      NEW.message IS DISTINCT FROM OLD.message
      OR NEW.needs IS DISTINCT FROM OLD.needs
      OR NEW.interests IS DISTINCT FROM OLD.interests
      OR NEW.goals IS DISTINCT FROM OLD.goals
    ) THEN
    RAISE EXCEPTION 'A mentorship request cannot be edited when it is being responded to or has been responded to'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_request_content_is_immutable_after_response';
  END IF;

  IF OLD.status <> 'pending' AND NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN
    RAISE EXCEPTION 'A responded mentorship request timestamp cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_request_response_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_requests_identity_and_content_immutable
BEFORE UPDATE ON mentorship_requests
FOR EACH ROW
EXECUTE FUNCTION prevent_mentorship_request_mutation();

CREATE FUNCTION enforce_accepted_request_relationship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_request_id UUID;
  request_status TEXT;
  request_mentee_user_id UUID;
  request_mentor_user_id UUID;
  relationship_count INTEGER;
  matching_relationship_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'mentorship_requests' THEN
    affected_request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_OP = 'DELETE' THEN
    affected_request_id := OLD.request_id;
  ELSE
    affected_request_id := NEW.request_id;
  END IF;

  SELECT status, mentee_user_id, mentor_user_id
    INTO request_status, request_mentee_user_id, request_mentor_user_id
    FROM mentorship_requests
   WHERE id = affected_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::INTEGER,
         count(*) FILTER (
           WHERE mentee_user_id = request_mentee_user_id
             AND mentor_user_id = request_mentor_user_id
         )::INTEGER
    INTO relationship_count, matching_relationship_count
    FROM mentorship_relationships
   WHERE request_id = affected_request_id;

  IF request_status = 'accepted' AND relationship_count <> 1 THEN
    RAISE EXCEPTION 'An accepted request must have exactly one mentorship relationship'
      USING ERRCODE = '23514', CONSTRAINT = 'accepted_request_requires_relationship';
  END IF;

  IF relationship_count > 0
    AND (request_status <> 'accepted' OR matching_relationship_count <> relationship_count) THEN
    RAISE EXCEPTION 'A mentorship relationship must match an accepted request'
      USING ERRCODE = '23514', CONSTRAINT = 'relationship_requires_matching_accepted_request';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER mentorship_requests_require_relationship
AFTER INSERT OR UPDATE OR DELETE ON mentorship_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_accepted_request_relationship();

CREATE CONSTRAINT TRIGGER mentorship_relationships_require_accepted_request
AFTER INSERT OR UPDATE OR DELETE ON mentorship_relationships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_accepted_request_relationship();
