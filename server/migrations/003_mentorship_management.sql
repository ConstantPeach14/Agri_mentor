-- Persistent mentorship sessions, goals, milestones, and goal activity history.
-- Requires migrations 001 and 002. Apply only after separate explicit approval.

CREATE TABLE mentorship_sessions (
  id UUID PRIMARY KEY,
  relationship_id UUID NOT NULL
    REFERENCES mentorship_relationships(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  scheduled_at TIMESTAMPTZ NOT NULL,
  preparation_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(preparation_notes) <= 2000),
  outcome_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(outcome_notes) <= 4000),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (
    (status = 'scheduled' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX mentorship_sessions_relationship_schedule_idx
  ON mentorship_sessions (relationship_id, scheduled_at DESC);
CREATE INDEX mentorship_sessions_status_schedule_idx
  ON mentorship_sessions (status, scheduled_at);

CREATE TABLE mentorship_goals (
  id UUID PRIMARY KEY,
  relationship_id UUID NOT NULL
    REFERENCES mentorship_relationships(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  measurable_outcome TEXT NOT NULL CHECK (char_length(btrim(measurable_outcome)) BETWEEN 1 AND 2000),
  target_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX mentorship_goals_relationship_status_target_idx
  ON mentorship_goals (relationship_id, status, target_date);
CREATE INDEX mentorship_goals_status_target_idx
  ON mentorship_goals (status, target_date);

CREATE TABLE mentorship_goal_milestones (
  id UUID PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES mentorship_goals(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status = 'pending' AND completed_at IS NULL)
  )
);
CREATE INDEX mentorship_goal_milestones_goal_status_idx
  ON mentorship_goal_milestones (goal_id, status, created_at);

CREATE TABLE mentorship_goal_events (
  id UUID PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES mentorship_goals(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'revised', 'completed', 'reopened', 'archived',
    'milestone_added', 'milestone_completed', 'milestone_reopened'
  )),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mentorship_goal_events_goal_created_idx
  ON mentorship_goal_events (goal_id, created_at DESC);

CREATE FUNCTION enforce_session_creator_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM mentorship_relationships relationship
     WHERE relationship.id = NEW.relationship_id
       AND NEW.created_by IN (relationship.mentee_user_id, relationship.mentor_user_id)
  ) THEN
    RAISE EXCEPTION 'Session creator must belong to the mentorship relationship'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_creator_is_participant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_sessions_creator_participant
BEFORE INSERT OR UPDATE OF relationship_id, created_by ON mentorship_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_session_creator_participant();

CREATE FUNCTION enforce_session_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.relationship_id IS DISTINCT FROM OLD.relationship_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Session identity cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_identity_immutable';
  END IF;
  IF OLD.status <> 'scheduled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A completed or cancelled session cannot be reopened'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_status_final';
  END IF;
  IF OLD.status <> 'scheduled' AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR NEW.preparation_notes IS DISTINCT FROM OLD.preparation_notes
    OR NEW.outcome_notes IS DISTINCT FROM OLD.outcome_notes
  ) THEN
    RAISE EXCEPTION 'A completed or cancelled session cannot be edited'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_session_details_final';
  END IF;
  NEW.updated_at := now();
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.completed_at := now();
    NEW.cancelled_at := NULL;
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.cancelled_at := now();
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_sessions_transition
BEFORE UPDATE ON mentorship_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_session_transition();

CREATE FUNCTION enforce_goal_creator_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM mentorship_relationships relationship
     WHERE relationship.id = NEW.relationship_id
       AND NEW.created_by IN (relationship.mentee_user_id, relationship.mentor_user_id)
  ) THEN
    RAISE EXCEPTION 'Goal creator must belong to the mentorship relationship'
      USING ERRCODE = '23514', CONSTRAINT = 'mentorship_goal_creator_is_participant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_goals_creator_participant
BEFORE INSERT OR UPDATE OF relationship_id, created_by ON mentorship_goals
FOR EACH ROW EXECUTE FUNCTION enforce_goal_creator_participant();

CREATE FUNCTION record_mentorship_goal_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_actor UUID;
  event_name TEXT;
  event_details JSONB := '{}'::JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_actor := NEW.created_by;
    event_name := 'created';
    event_details := jsonb_build_object(
      'title', NEW.title,
      'measurableOutcome', NEW.measurable_outcome,
      'targetDate', NEW.target_date
    );
  ELSIF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.measurable_outcome IS DISTINCT FROM OLD.measurable_outcome
    OR NEW.target_date IS DISTINCT FROM OLD.target_date THEN
    event_name := 'revised';
    event_details := jsonb_build_object(
      'title', NEW.title,
      'measurableOutcome', NEW.measurable_outcome,
      'targetDate', NEW.target_date
    );
  ELSIF OLD.status <> NEW.status THEN
    event_name := CASE NEW.status
      WHEN 'completed' THEN 'completed'
      WHEN 'active' THEN 'reopened'
      ELSE 'archived'
    END;
  ELSE
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    event_actor := nullif(current_setting('agri_mentor.actor_user_id', true), '')::UUID;
    IF event_actor IS NULL OR NOT EXISTS (
      SELECT 1
        FROM mentorship_relationships relationship
       WHERE relationship.id = NEW.relationship_id
         AND event_actor IN (relationship.mentee_user_id, relationship.mentor_user_id)
    ) THEN
      RAISE EXCEPTION 'Goal changes require an authenticated participant'
        USING ERRCODE = '23514', CONSTRAINT = 'mentorship_goal_event_actor_required';
    END IF;
  END IF;
  INSERT INTO mentorship_goal_events (id, goal_id, actor_user_id, event_type, details)
  VALUES (gen_random_uuid(), NEW.id, event_actor, event_name, event_details);
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_goals_record_history
AFTER INSERT OR UPDATE ON mentorship_goals
FOR EACH ROW EXECUTE FUNCTION record_mentorship_goal_event();

CREATE FUNCTION touch_mentorship_goal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_goals_touch
BEFORE UPDATE ON mentorship_goals
FOR EACH ROW EXECUTE FUNCTION touch_mentorship_goal();

CREATE FUNCTION record_mentorship_milestone_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_actor UUID;
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_actor := NEW.created_by;
    event_name := 'milestone_added';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_actor := NEW.updated_by;
    event_name := CASE NEW.status
      WHEN 'completed' THEN 'milestone_completed'
      ELSE 'milestone_reopened'
    END;
    NEW.updated_at := now();
    NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN now() ELSE NULL END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO mentorship_goal_events (id, goal_id, actor_user_id, event_type, details)
  VALUES (
    gen_random_uuid(),
    NEW.goal_id,
    event_actor,
    event_name,
    jsonb_build_object('milestoneId', NEW.id, 'title', NEW.title)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER mentorship_milestones_record_history
BEFORE INSERT OR UPDATE ON mentorship_goal_milestones
FOR EACH ROW EXECUTE FUNCTION record_mentorship_milestone_event();
