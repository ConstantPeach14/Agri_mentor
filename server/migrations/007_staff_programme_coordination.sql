-- Staff-coordinated match proposals and session scheduling.
-- Requires migrations 001-006, including programme oversight tables from 005.
-- Proposal only: do not apply without separate review and explicit approval.

CREATE TABLE programme_match_proposals (
  id UUID PRIMARY KEY,
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  mentee_user_id UUID NOT NULL,
  mentee_role TEXT NOT NULL DEFAULT 'mentee' CHECK (mentee_role = 'mentee'),
  mentor_user_id UUID NOT NULL,
  mentor_role TEXT NOT NULL DEFAULT 'mentor' CHECK (mentor_role = 'mentor'),
  proposed_by_staff_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'awaiting_mentor', 'awaiting_mentee', 'accepted', 'declined', 'withdrawn')),
  mentee_response TEXT NOT NULL DEFAULT 'pending' CHECK (mentee_response IN ('pending', 'accepted', 'declined')),
  mentee_responded_at TIMESTAMPTZ,
  mentee_responded_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  mentor_response TEXT NOT NULL DEFAULT 'pending' CHECK (mentor_response IN ('pending', 'accepted', 'declined')),
  mentor_responded_at TIMESTAMPTZ,
  mentor_responded_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_by_staff_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  request_id UUID UNIQUE REFERENCES mentorship_requests(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  relationship_id UUID UNIQUE REFERENCES mentorship_relationships(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (programme_id, mentee_user_id, mentee_role)
    REFERENCES programme_participants (programme_id, participant_user_id, participant_role)
    ON DELETE RESTRICT,
  FOREIGN KEY (programme_id, mentor_user_id, mentor_role)
    REFERENCES programme_participants (programme_id, participant_user_id, participant_role)
    ON DELETE RESTRICT,
  FOREIGN KEY (programme_id, proposed_by_staff_user_id)
    REFERENCES programme_staff_assignments (programme_id, staff_user_id)
    ON DELETE RESTRICT,
  CHECK (mentee_user_id <> mentor_user_id),
  CHECK ((mentee_response = 'pending') = (mentee_responded_at IS NULL)),
  CHECK ((mentee_response = 'pending') = (mentee_responded_by_user_id IS NULL)),
  CHECK ((mentor_response = 'pending') = (mentor_responded_at IS NULL)),
  CHECK ((mentor_response = 'pending') = (mentor_responded_by_user_id IS NULL)),
  CHECK (mentee_responded_by_user_id IS NULL OR mentee_responded_by_user_id = mentee_user_id),
  CHECK (mentor_responded_by_user_id IS NULL OR mentor_responded_by_user_id = mentor_user_id),
  CHECK ((request_id IS NULL) = (relationship_id IS NULL)),
  CHECK (
    (status = 'proposed' AND mentee_response = 'pending' AND mentor_response = 'pending')
    OR (status = 'awaiting_mentor' AND mentee_response = 'accepted' AND mentor_response = 'pending')
    OR (status = 'awaiting_mentee' AND mentee_response = 'pending' AND mentor_response = 'accepted')
    OR (status = 'declined' AND (mentee_response = 'declined' OR mentor_response = 'declined'))
    OR (status = 'withdrawn' AND withdrawn_by_staff_user_id IS NOT NULL)
    OR (status = 'accepted' AND mentee_response = 'accepted' AND mentor_response = 'accepted')
  ),
  CHECK ((status = 'accepted') = (request_id IS NOT NULL AND relationship_id IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR (request_id IS NULL AND relationship_id IS NULL))
);
CREATE INDEX programme_match_proposals_programme_status_created_idx
  ON programme_match_proposals (programme_id, status, created_at DESC);
CREATE INDEX programme_match_proposals_mentee_status_idx
  ON programme_match_proposals (mentee_user_id, status, created_at DESC);
CREATE INDEX programme_match_proposals_mentor_status_idx
  ON programme_match_proposals (mentor_user_id, status, created_at DESC);
CREATE UNIQUE INDEX programme_match_proposals_pending_pair_unique
  ON programme_match_proposals (programme_id, mentee_user_id, mentor_user_id)
  WHERE status IN ('proposed', 'awaiting_mentor', 'awaiting_mentee');

CREATE TABLE programme_match_proposal_events (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES programme_match_proposals(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'proposed', 'mentee_accepted', 'mentee_declined',
    'mentor_accepted', 'mentor_declined', 'awaiting_mentor',
    'awaiting_mentee', 'accepted', 'declined', 'withdrawn'
  )),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX programme_match_proposal_events_proposal_created_idx
  ON programme_match_proposal_events (proposal_id, created_at, id);

CREATE FUNCTION prevent_match_proposal_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Programme match proposal events are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_events_append_only';
END;
$$;
CREATE TRIGGER programme_match_proposal_events_append_only
BEFORE UPDATE OR DELETE ON programme_match_proposal_events
FOR EACH ROW EXECUTE FUNCTION prevent_match_proposal_event_mutation();

CREATE FUNCTION validate_programme_match_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  mentor_capacity SMALLINT;
  active_relationship_count INTEGER;
  pending_proposal_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM programmes programme
        JOIN programme_staff_assignments assignment
          ON assignment.programme_id = programme.id
         AND assignment.staff_user_id = NEW.proposed_by_staff_user_id
         AND assignment.status = 'active'
        JOIN users staff_account
          ON staff_account.id = assignment.staff_user_id
         AND staff_account.role = 'programme_staff'
         AND staff_account.account_status = 'active'
        JOIN programme_participants mentee_membership
          ON mentee_membership.programme_id = programme.id
         AND mentee_membership.participant_user_id = NEW.mentee_user_id
         AND mentee_membership.participant_role = 'mentee'
         AND mentee_membership.status = 'active'
        JOIN users mentee_account
          ON mentee_account.id = NEW.mentee_user_id
         AND mentee_account.role = 'mentee'
         AND mentee_account.account_status = 'active'
        JOIN programme_participants mentor_membership
          ON mentor_membership.programme_id = programme.id
         AND mentor_membership.participant_user_id = NEW.mentor_user_id
         AND mentor_membership.participant_role = 'mentor'
         AND mentor_membership.status = 'active'
        JOIN users mentor_account
          ON mentor_account.id = NEW.mentor_user_id
         AND mentor_account.role = 'mentor'
         AND mentor_account.account_status = 'active'
       WHERE programme.id = NEW.programme_id
         AND programme.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Match proposal requires an active staff assignment and active programme participants'
        USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_scope';
    END IF;

    SELECT max_active_mentees INTO mentor_capacity
      FROM mentor_profiles WHERE user_id = NEW.mentor_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Match proposal mentor profile does not exist'
        USING ERRCODE = '23503', CONSTRAINT = 'programme_match_proposal_mentor_profile';
    END IF;

    IF EXISTS (
      SELECT 1 FROM mentorship_relationships relationship
       WHERE relationship.mentee_user_id = NEW.mentee_user_id
         AND relationship.mentor_user_id = NEW.mentor_user_id
         AND relationship.status = 'active'
    ) OR EXISTS (
      SELECT 1 FROM mentorship_requests request
       WHERE request.mentee_user_id = NEW.mentee_user_id
         AND request.mentor_user_id = NEW.mentor_user_id
         AND request.status IN ('pending', 'accepted')
    ) THEN
      RAISE EXCEPTION 'A pending request or active mentorship already exists for this pair'
        USING ERRCODE = '23505', CONSTRAINT = 'programme_match_proposal_pair_available';
    END IF;

    SELECT count(*)::INTEGER INTO active_relationship_count
      FROM mentorship_relationships relationship
     WHERE relationship.mentor_user_id = NEW.mentor_user_id
       AND relationship.status = 'active';
    SELECT count(*)::INTEGER INTO pending_proposal_count
      FROM programme_match_proposals proposal
     WHERE proposal.mentor_user_id = NEW.mentor_user_id
       AND proposal.status IN ('proposed', 'awaiting_mentor', 'awaiting_mentee');
    IF mentor_capacity IS NOT NULL
      AND active_relationship_count + pending_proposal_count >= mentor_capacity THEN
      RAISE EXCEPTION 'Mentor has no available capacity for another proposal'
        USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_capacity';
    END IF;
  ELSIF NEW.programme_id IS DISTINCT FROM OLD.programme_id
    OR NEW.mentee_user_id IS DISTINCT FROM OLD.mentee_user_id
    OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id
    OR NEW.proposed_by_staff_user_id IS DISTINCT FROM OLD.proposed_by_staff_user_id THEN
    RAISE EXCEPTION 'Programme match proposal identity cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_identity_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.mentee_response <> 'pending' AND NEW.mentee_response IS DISTINCT FROM OLD.mentee_response)
    OR (OLD.mentor_response <> 'pending' AND NEW.mentor_response IS DISTINCT FROM OLD.mentor_response)
    OR (OLD.mentee_response = 'pending' AND NEW.mentee_response NOT IN ('pending', 'accepted', 'declined'))
    OR (OLD.mentor_response = 'pending' AND NEW.mentor_response NOT IN ('pending', 'accepted', 'declined'))
  ) THEN
    RAISE EXCEPTION 'Participant match responses are final once recorded'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_response_final';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_match_proposals_validate
BEFORE INSERT OR UPDATE ON programme_match_proposals
FOR EACH ROW EXECUTE FUNCTION validate_programme_match_proposal();

CREATE FUNCTION verify_programme_match_result()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'accepted' AND NOT EXISTS (
    SELECT 1
      FROM mentorship_requests request
      JOIN mentorship_relationships relationship
        ON relationship.request_id = request.id
       AND relationship.mentee_user_id = request.mentee_user_id
       AND relationship.mentor_user_id = request.mentor_user_id
     WHERE request.id = NEW.request_id
       AND request.status = 'accepted'
       AND request.mentee_user_id = NEW.mentee_user_id
       AND request.mentor_user_id = NEW.mentor_user_id
       AND relationship.id = NEW.relationship_id
  ) THEN
    RAISE EXCEPTION 'An accepted proposal must reference a matching accepted request and relationship'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_match_proposal_result_required';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER programme_match_proposal_result
AFTER INSERT OR UPDATE ON programme_match_proposals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_programme_match_result();

CREATE FUNCTION record_programme_match_proposal_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_actor UUID;
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_actor := NEW.proposed_by_staff_user_id;
    event_name := 'proposed';
  ELSIF NEW.mentee_response IS DISTINCT FROM OLD.mentee_response THEN
    event_actor := NEW.mentee_responded_by_user_id;
    event_name := 'mentee_' || NEW.mentee_response;
  ELSIF NEW.mentor_response IS DISTINCT FROM OLD.mentor_response THEN
    event_actor := NEW.mentor_responded_by_user_id;
    event_name := 'mentor_' || NEW.mentor_response;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_actor := COALESCE(NEW.withdrawn_by_staff_user_id, NEW.proposed_by_staff_user_id);
    event_name := NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO programme_match_proposal_events (id, proposal_id, actor_user_id, event_type, details)
  VALUES (
    gen_random_uuid(), NEW.id, event_actor, event_name,
    jsonb_build_object('status', NEW.status, 'requestId', NEW.request_id, 'relationshipId', NEW.relationship_id)
  );
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO programme_match_proposal_events (id, proposal_id, actor_user_id, event_type, details)
    VALUES (
      gen_random_uuid(), NEW.id,
      COALESCE(NEW.withdrawn_by_staff_user_id, event_actor, NEW.proposed_by_staff_user_id),
      NEW.status,
      jsonb_build_object('previousStatus', OLD.status, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_match_proposals_audit
AFTER INSERT OR UPDATE ON programme_match_proposals
FOR EACH ROW EXECUTE FUNCTION record_programme_match_proposal_event();

-- Capacity is checked when a proposal is created and again when the second
-- participant accepts; Migrations 002/003 remain the final enforcement layer.

-- Staff-created sessions retain the Staff actor separately; participants keep
-- their own attendance responses in programme_session_participation.
ALTER TABLE mentorship_sessions
  ADD COLUMN coordinated_programme_id UUID,
  ADD COLUMN coordinated_by_staff_user_id UUID,
  ADD CONSTRAINT mentorship_sessions_coordination_pair_check
    CHECK ((coordinated_programme_id IS NULL) = (coordinated_by_staff_user_id IS NULL)),
  ADD CONSTRAINT mentorship_sessions_coordination_staff_fk
    FOREIGN KEY (coordinated_programme_id, coordinated_by_staff_user_id)
    REFERENCES programme_staff_assignments (programme_id, staff_user_id)
    ON DELETE RESTRICT;

CREATE TABLE programme_session_participation (
  session_id UUID NOT NULL REFERENCES mentorship_sessions(id) ON DELETE RESTRICT,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'attended', 'missed')),
  responded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, participant_user_id),
  CHECK ((response = 'pending') = (responded_at IS NULL))
);
CREATE INDEX programme_session_participation_participant_response_idx
  ON programme_session_participation (participant_user_id, response, session_id);

CREATE FUNCTION validate_session_participation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id
  ) THEN
    RAISE EXCEPTION 'Session participation identity cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_session_participation_identity_immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM mentorship_sessions session
      JOIN mentorship_relationships relationship ON relationship.id = session.relationship_id
     WHERE session.id = NEW.session_id
      AND (session.status <> 'cancelled' OR NEW.response = 'pending')
       AND NEW.participant_user_id IN (relationship.mentee_user_id, relationship.mentor_user_id)
  ) THEN
    RAISE EXCEPTION 'Session response must belong to a session participant'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_session_participation_actor';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_session_participation_validate
BEFORE INSERT OR UPDATE ON programme_session_participation
FOR EACH ROW EXECUTE FUNCTION validate_session_participation();

CREATE FUNCTION create_session_participation_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO programme_session_participation (session_id, participant_user_id)
  SELECT NEW.id, relationship.mentee_user_id FROM mentorship_relationships relationship
   WHERE relationship.id = NEW.relationship_id
  UNION ALL
  SELECT NEW.id, relationship.mentor_user_id FROM mentorship_relationships relationship
   WHERE relationship.id = NEW.relationship_id
  ON CONFLICT (session_id, participant_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_sessions_participation_rows
AFTER INSERT ON mentorship_sessions
FOR EACH ROW EXECUTE FUNCTION create_session_participation_rows();

-- Preserve known historical completion by the recorded creator. Do not infer
-- the other participant's attendance from a completed session status.
INSERT INTO programme_session_participation (session_id, participant_user_id, response, responded_at)
SELECT session.id, session.created_by,
       CASE WHEN session.status = 'completed' THEN 'attended' ELSE 'pending' END,
       CASE WHEN session.status = 'completed' THEN session.completed_at ELSE NULL END
  FROM mentorship_sessions session
ON CONFLICT (session_id, participant_user_id) DO NOTHING;
INSERT INTO programme_session_participation (session_id, participant_user_id)
SELECT session.id, relationship.mentee_user_id
  FROM mentorship_sessions session
  JOIN mentorship_relationships relationship ON relationship.id = session.relationship_id
 WHERE relationship.mentee_user_id <> session.created_by
UNION ALL
SELECT session.id, relationship.mentor_user_id
  FROM mentorship_sessions session
  JOIN mentorship_relationships relationship ON relationship.id = session.relationship_id
 WHERE relationship.mentor_user_id <> session.created_by
ON CONFLICT (session_id, participant_user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_session_creator_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.coordinated_by_staff_user_id IS NOT NULL THEN
    IF NEW.created_by IS DISTINCT FROM NEW.coordinated_by_staff_user_id
      OR NOT EXISTS (
        SELECT 1
          FROM programme_staff_assignments assignment
          JOIN programmes programme ON programme.id = assignment.programme_id
           AND programme.status = 'active'
          JOIN programme_relationships scope
            ON scope.programme_id = assignment.programme_id
           AND scope.relationship_id = NEW.relationship_id
          JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
          JOIN programme_participants mentee
            ON mentee.programme_id = scope.programme_id
           AND mentee.participant_user_id = relationship.mentee_user_id
           AND mentee.participant_role = 'mentee' AND mentee.status = 'active'
          JOIN programme_participants mentor
            ON mentor.programme_id = scope.programme_id
           AND mentor.participant_user_id = relationship.mentor_user_id
           AND mentor.participant_role = 'mentor' AND mentor.status = 'active'
            JOIN users mentee_account
              ON mentee_account.id = relationship.mentee_user_id
             AND mentee_account.account_status = 'active'
            JOIN users mentor_account
              ON mentor_account.id = relationship.mentor_user_id
             AND mentor_account.account_status = 'active'
          JOIN users staff ON staff.id = assignment.staff_user_id
           AND staff.role = 'programme_staff' AND staff.account_status = 'active'
         WHERE assignment.programme_id = NEW.coordinated_programme_id
           AND assignment.staff_user_id = NEW.coordinated_by_staff_user_id
           AND assignment.status = 'active'
           AND relationship.status = 'active'
      ) THEN
      RAISE EXCEPTION 'Staff session scheduling requires an active assigned programme relationship'
        USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_creator_is_authorized';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM mentorship_relationships relationship
     WHERE relationship.id = NEW.relationship_id
       AND NEW.created_by IN (relationship.mentee_user_id, relationship.mentor_user_id)
  ) THEN
    RAISE EXCEPTION 'Session creator must belong to the mentorship relationship'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_creator_is_participant';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER mentorship_sessions_creator_participant ON mentorship_sessions;
CREATE TRIGGER mentorship_sessions_creator_participant
BEFORE INSERT OR UPDATE OF relationship_id, created_by, coordinated_programme_id, coordinated_by_staff_user_id
ON mentorship_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_session_creator_participant();

CREATE FUNCTION prevent_session_coordination_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.coordinated_programme_id IS DISTINCT FROM OLD.coordinated_programme_id
    OR NEW.coordinated_by_staff_user_id IS DISTINCT FROM OLD.coordinated_by_staff_user_id THEN
    RAISE EXCEPTION 'Session coordination authorship cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_coordination_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_sessions_coordination_identity
BEFORE UPDATE ON mentorship_sessions
FOR EACH ROW EXECUTE FUNCTION prevent_session_coordination_reassignment();
