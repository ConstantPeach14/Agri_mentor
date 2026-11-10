-- Programme-scoped, read-only staff oversight and one-time staff invitations.
-- Existing users are not assigned automatically. Apply only after explicit
-- approval and through the migration runner on an authorised target.

CREATE TABLE programmes (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX programmes_status_created_idx ON programmes (status, created_at DESC);

CREATE TABLE programme_staff_invitations (
  id UUID PRIMARY KEY,
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT current_user,
  CHECK (expires_at > created_at),
  CHECK ((used_at IS NULL) = (used_by_user_id IS NULL)),
  CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX programme_staff_invitations_email_expiry_idx
  ON programme_staff_invitations (email, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX programme_staff_invitations_pending_email_programme_idx
  ON programme_staff_invitations (programme_id, email)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE programme_staff_assignments (
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (programme_id, staff_user_id)
);
CREATE INDEX programme_staff_assignments_staff_status_idx
  ON programme_staff_assignments (staff_user_id, status, programme_id);

CREATE TABLE programme_participants (
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('mentee', 'mentor')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (programme_id, participant_user_id),
  UNIQUE (programme_id, participant_user_id, participant_role)
);
CREATE INDEX programme_participants_scope_role_status_idx
  ON programme_participants (programme_id, participant_role, status, assigned_at DESC);
CREATE INDEX programme_participants_user_status_idx
  ON programme_participants (participant_user_id, status, programme_id);

CREATE TABLE programme_relationships (
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  relationship_id UUID NOT NULL REFERENCES mentorship_relationships(id) ON DELETE RESTRICT,
  mentee_user_id UUID NOT NULL,
  mentor_user_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (programme_id, relationship_id),
  FOREIGN KEY (programme_id, mentee_user_id)
    REFERENCES programme_participants (programme_id, participant_user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (programme_id, mentor_user_id)
    REFERENCES programme_participants (programme_id, participant_user_id)
    ON DELETE RESTRICT
);
CREATE INDEX programme_relationships_relationship_idx
  ON programme_relationships (relationship_id, programme_id);

CREATE TABLE programme_requests (
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES mentorship_requests(id) ON DELETE RESTRICT,
  mentee_user_id UUID NOT NULL,
  mentor_user_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (programme_id, request_id),
  FOREIGN KEY (programme_id, mentee_user_id)
    REFERENCES programme_participants (programme_id, participant_user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (programme_id, mentor_user_id)
    REFERENCES programme_participants (programme_id, participant_user_id)
    ON DELETE RESTRICT
);
CREATE INDEX programme_requests_request_idx ON programme_requests (request_id, programme_id);

CREATE FUNCTION enforce_programme_assignment_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  member_role TEXT;
BEGIN
  IF TG_TABLE_NAME = 'programme_staff_assignments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users
       WHERE id = NEW.staff_user_id AND role = 'programme_staff' AND account_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Programme assignment requires an active Programme Staff account'
        USING ERRCODE = '23514', CONSTRAINT = 'programme_staff_assignment_role';
    END IF;
    RETURN NEW;
  END IF;

  SELECT role INTO member_role FROM users
   WHERE id = NEW.participant_user_id AND account_status = 'active';
  IF member_role IS DISTINCT FROM NEW.participant_role
    OR member_role NOT IN ('mentee', 'mentor') THEN
    RAISE EXCEPTION 'Programme participant role must match the active account role'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_participant_role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER programme_staff_assignments_role
BEFORE INSERT OR UPDATE OF staff_user_id ON programme_staff_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_programme_assignment_roles();
CREATE TRIGGER programme_participants_role
BEFORE INSERT OR UPDATE OF participant_user_id, participant_role ON programme_participants
FOR EACH ROW EXECUTE FUNCTION enforce_programme_assignment_roles();

CREATE FUNCTION enforce_programme_relationship_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM mentorship_relationships relationship
      JOIN programme_participants mentee_membership
        ON mentee_membership.programme_id = NEW.programme_id
       AND mentee_membership.participant_user_id = relationship.mentee_user_id
       AND mentee_membership.participant_role = 'mentee'
       AND mentee_membership.status = 'active'
      JOIN programme_participants mentor_membership
        ON mentor_membership.programme_id = NEW.programme_id
       AND mentor_membership.participant_user_id = relationship.mentor_user_id
       AND mentor_membership.participant_role = 'mentor'
       AND mentor_membership.status = 'active'
     WHERE relationship.id = NEW.relationship_id
       AND relationship.mentee_user_id = NEW.mentee_user_id
       AND relationship.mentor_user_id = NEW.mentor_user_id
  ) THEN
    RAISE EXCEPTION 'Programme relationship requires both actively assigned participants'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_relationship_participants';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER programme_relationships_scope
BEFORE INSERT OR UPDATE OF programme_id, relationship_id, mentee_user_id, mentor_user_id
ON programme_relationships
FOR EACH ROW EXECUTE FUNCTION enforce_programme_relationship_scope();

CREATE FUNCTION enforce_programme_request_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM mentorship_requests request
      JOIN programme_participants mentee_membership
        ON mentee_membership.programme_id = NEW.programme_id
       AND mentee_membership.participant_user_id = request.mentee_user_id
       AND mentee_membership.participant_role = 'mentee'
       AND mentee_membership.status = 'active'
      JOIN programme_participants mentor_membership
        ON mentor_membership.programme_id = NEW.programme_id
       AND mentor_membership.participant_user_id = request.mentor_user_id
       AND mentor_membership.participant_role = 'mentor'
       AND mentor_membership.status = 'active'
     WHERE request.id = NEW.request_id
       AND request.mentee_user_id = NEW.mentee_user_id
       AND request.mentor_user_id = NEW.mentor_user_id
  ) THEN
    RAISE EXCEPTION 'Programme request requires both actively assigned participants'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_request_participants';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_requests_scope
BEFORE INSERT OR UPDATE OF programme_id, request_id, mentee_user_id, mentor_user_id
ON programme_requests
FOR EACH ROW EXECUTE FUNCTION enforce_programme_request_scope();

CREATE FUNCTION link_request_to_shared_programmes()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Programme scope linking requires READ COMMITTED isolation'
      USING ERRCODE = '0A000';
  END IF;
  -- The separate INSERT statement gets a fresh READ COMMITTED snapshot after this lock.
  PERFORM pg_advisory_xact_lock(734205, 5);
  INSERT INTO programme_requests (programme_id, request_id, mentee_user_id, mentor_user_id)
  SELECT mentee_membership.programme_id, NEW.id, NEW.mentee_user_id, NEW.mentor_user_id
    FROM programme_participants mentee_membership
    JOIN programme_participants mentor_membership
      ON mentor_membership.programme_id = mentee_membership.programme_id
     AND mentor_membership.participant_user_id = NEW.mentor_user_id
     AND mentor_membership.participant_role = 'mentor'
     AND mentor_membership.status = 'active'
   WHERE mentee_membership.participant_user_id = NEW.mentee_user_id
     AND mentee_membership.participant_role = 'mentee'
     AND mentee_membership.status = 'active'
  ON CONFLICT (programme_id, request_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_requests_programme_scope
AFTER INSERT ON mentorship_requests
FOR EACH ROW EXECUTE FUNCTION link_request_to_shared_programmes();

CREATE FUNCTION link_relationship_to_shared_programmes()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Programme scope linking requires READ COMMITTED isolation'
      USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(734205, 5);
  INSERT INTO programme_relationships (
    programme_id, relationship_id, mentee_user_id, mentor_user_id
  )
  SELECT mentee_membership.programme_id, NEW.id, NEW.mentee_user_id, NEW.mentor_user_id
    FROM programme_participants mentee_membership
    JOIN programme_participants mentor_membership
      ON mentor_membership.programme_id = mentee_membership.programme_id
     AND mentor_membership.participant_user_id = NEW.mentor_user_id
     AND mentor_membership.participant_role = 'mentor'
     AND mentor_membership.status = 'active'
   WHERE mentee_membership.participant_user_id = NEW.mentee_user_id
     AND mentee_membership.participant_role = 'mentee'
     AND mentee_membership.status = 'active'
  ON CONFLICT (programme_id, relationship_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_relationships_programme_scope
AFTER INSERT ON mentorship_relationships
FOR EACH ROW EXECUTE FUNCTION link_relationship_to_shared_programmes();

CREATE FUNCTION link_participant_relationships_to_programme()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Programme scope linking requires READ COMMITTED isolation'
      USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(734205, 5);
  IF NEW.participant_role = 'mentee' THEN
    INSERT INTO programme_requests (programme_id, request_id, mentee_user_id, mentor_user_id)
    SELECT NEW.programme_id, request.id, request.mentee_user_id, request.mentor_user_id
      FROM mentorship_requests request
      JOIN programme_participants mentor_membership
        ON mentor_membership.programme_id = NEW.programme_id
       AND mentor_membership.participant_user_id = request.mentor_user_id
       AND mentor_membership.participant_role = 'mentor'
       AND mentor_membership.status = 'active'
     WHERE request.mentee_user_id = NEW.participant_user_id
    ON CONFLICT (programme_id, request_id) DO NOTHING;
    INSERT INTO programme_relationships (
      programme_id, relationship_id, mentee_user_id, mentor_user_id
    )
    SELECT NEW.programme_id, relationship.id, relationship.mentee_user_id, relationship.mentor_user_id
      FROM mentorship_relationships relationship
      JOIN programme_participants mentor_membership
        ON mentor_membership.programme_id = NEW.programme_id
       AND mentor_membership.participant_user_id = relationship.mentor_user_id
       AND mentor_membership.participant_role = 'mentor'
       AND mentor_membership.status = 'active'
     WHERE relationship.mentee_user_id = NEW.participant_user_id
    ON CONFLICT (programme_id, relationship_id) DO NOTHING;
  ELSE
    INSERT INTO programme_requests (programme_id, request_id, mentee_user_id, mentor_user_id)
    SELECT NEW.programme_id, request.id, request.mentee_user_id, request.mentor_user_id
      FROM mentorship_requests request
      JOIN programme_participants mentee_membership
        ON mentee_membership.programme_id = NEW.programme_id
       AND mentee_membership.participant_user_id = request.mentee_user_id
       AND mentee_membership.participant_role = 'mentee'
       AND mentee_membership.status = 'active'
     WHERE request.mentor_user_id = NEW.participant_user_id
    ON CONFLICT (programme_id, request_id) DO NOTHING;
    INSERT INTO programme_relationships (
      programme_id, relationship_id, mentee_user_id, mentor_user_id
    )
    SELECT NEW.programme_id, relationship.id, relationship.mentee_user_id, relationship.mentor_user_id
      FROM mentorship_relationships relationship
      JOIN programme_participants mentee_membership
        ON mentee_membership.programme_id = NEW.programme_id
       AND mentee_membership.participant_user_id = relationship.mentee_user_id
       AND mentee_membership.participant_role = 'mentee'
       AND mentee_membership.status = 'active'
     WHERE relationship.mentor_user_id = NEW.participant_user_id
    ON CONFLICT (programme_id, relationship_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_participants_relationship_scope
AFTER INSERT OR UPDATE OF status ON programme_participants
FOR EACH ROW EXECUTE FUNCTION link_participant_relationships_to_programme();

CREATE FUNCTION prevent_programme_scope_identity_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.programme_id IS DISTINCT FROM OLD.programme_id THEN
    RAISE EXCEPTION 'Programme scope identity cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_scope_identity_immutable';
  END IF;
  IF TG_TABLE_NAME = 'programme_participants' AND (
    NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id
    OR NEW.participant_role IS DISTINCT FROM OLD.participant_role
  ) THEN
    RAISE EXCEPTION 'Programme scope identity cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_scope_identity_immutable';
  ELSIF TG_TABLE_NAME = 'programme_staff_assignments'
    AND NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id THEN
    RAISE EXCEPTION 'Programme scope identity cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_scope_identity_immutable';
  ELSIF TG_TABLE_NAME = 'programme_relationships' AND (
    NEW.relationship_id IS DISTINCT FROM OLD.relationship_id
    OR NEW.mentee_user_id IS DISTINCT FROM OLD.mentee_user_id
    OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id
  ) THEN
    RAISE EXCEPTION 'Programme scope identity cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_scope_identity_immutable';
  ELSIF TG_TABLE_NAME = 'programme_requests' AND (
    NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.mentee_user_id IS DISTINCT FROM OLD.mentee_user_id
    OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id
  ) THEN
    RAISE EXCEPTION 'Programme scope identity cannot be reassigned'
      USING ERRCODE = '23514', CONSTRAINT = 'programme_scope_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_staff_assignments_identity
BEFORE UPDATE ON programme_staff_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_programme_scope_identity_reassignment();
CREATE TRIGGER programme_participants_identity
BEFORE UPDATE ON programme_participants
FOR EACH ROW EXECUTE FUNCTION prevent_programme_scope_identity_reassignment();
CREATE TRIGGER programme_relationships_identity
BEFORE UPDATE ON programme_relationships
FOR EACH ROW EXECUTE FUNCTION prevent_programme_scope_identity_reassignment();
CREATE TRIGGER programme_requests_identity
BEFORE UPDATE ON programme_requests
FOR EACH ROW EXECUTE FUNCTION prevent_programme_scope_identity_reassignment();

CREATE FUNCTION touch_programme_membership_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER programme_staff_assignments_updated_at
BEFORE UPDATE ON programme_staff_assignments
FOR EACH ROW EXECUTE FUNCTION touch_programme_membership_updated_at();
CREATE TRIGGER programme_participants_updated_at
BEFORE UPDATE ON programme_participants
FOR EACH ROW EXECUTE FUNCTION touch_programme_membership_updated_at();
CREATE TRIGGER programmes_updated_at
BEFORE UPDATE ON programmes
FOR EACH ROW EXECUTE FUNCTION touch_programme_membership_updated_at();
