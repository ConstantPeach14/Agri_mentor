const { randomUUID } = require('node:crypto');
const { HttpError } = require('./http-error');

function programmeNotFound() {
  return new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
}

function invalidInvitation() {
  const error = new Error('Programme invitation is invalid, expired, or already used.');
  error.code = 'INVITATION_INVALID';
  return error;
}

function createPostgresProgrammeRepository(pool) {
  async function requireProgrammeAccess(staffUserId, programmeId) {
    const result = await pool.query(
      `SELECT programme.id, programme.name, programme.description, programme.status
         FROM programmes programme
         JOIN programme_staff_assignments assignment
           ON assignment.programme_id = programme.id
          AND assignment.staff_user_id = $1
          AND assignment.status = 'active'
        WHERE programme.id = $2 AND programme.status = 'active'`,
      [staffUserId, programmeId],
    );
    if (!result.rows[0]) throw programmeNotFound();
    return result.rows[0];
  }

  async function consumeInvitation(client, tokenHash, email) {
    const result = await client.query(
      `SELECT invitation.id, invitation.programme_id, invitation.email,
              invitation.expires_at, invitation.expires_at <= now() AS expired,
              invitation.used_at, invitation.revoked_at,
              programme.status AS programme_status
         FROM programme_staff_invitations invitation
         JOIN programmes programme ON programme.id = invitation.programme_id
        WHERE invitation.token_hash = $1
        FOR UPDATE OF invitation`,
      [tokenHash],
    );
    const invitation = result.rows[0];
    if (!invitation || (email !== null && invitation.email !== email) || invitation.used_at
      || invitation.revoked_at
      || invitation.expired || invitation.programme_status !== 'active') {
      throw invalidInvitation();
    }
    return invitation;
  }

  async function readMatchProposals(executor, whereSql, values) {
    const result = await executor.query(
      `SELECT proposal.id, proposal.programme_id AS "programmeId",
              proposal.mentee_user_id AS "menteeId", mentee.full_name AS "menteeName",
              mentee_profile.location AS "menteeLocation",
              mentee_profile.needs AS "menteeNeeds",
              mentee_profile.experience_level AS "menteeExperience",
              ARRAY(SELECT expertise.name FROM mentee_interests interest
                    JOIN expertise ON expertise.id = interest.expertise_id
                   WHERE interest.mentee_user_id = mentee.id ORDER BY lower(expertise.name)) AS "menteeInterests",
              proposal.mentor_user_id AS "mentorId", mentor.full_name AS "mentorName",
              mentor_profile.location AS "mentorLocation",
              mentor_profile.specialisation AS "mentorSpecialisation",
              mentor_profile.max_active_mentees AS "mentorCapacity",
              mentor_profile.availability_note AS "mentorAvailability",
              (SELECT count(*)::INTEGER FROM mentorship_relationships active_relationship
                WHERE active_relationship.mentor_user_id = mentor.id
                  AND active_relationship.status = 'active') AS "mentorActiveMentees",
              ARRAY(SELECT expertise.name FROM mentor_expertise link
                    JOIN expertise ON expertise.id = link.expertise_id
                   WHERE link.mentor_user_id = mentor.id ORDER BY lower(expertise.name)) AS "mentorExpertise",
              proposal.proposed_by_staff_user_id AS "proposedByStaffUserId",
              proposal.status, proposal.mentee_response AS "menteeResponse",
              proposal.mentee_responded_at AS "menteeRespondedAt",
              proposal.mentor_response AS "mentorResponse",
              proposal.mentor_responded_at AS "mentorRespondedAt",
              proposal.request_id AS "requestId", proposal.relationship_id AS "relationshipId",
              proposal.created_at AS "createdAt", proposal.updated_at AS "updatedAt"
         FROM programme_match_proposals proposal
         JOIN users mentee ON mentee.id = proposal.mentee_user_id
          AND mentee.account_status = 'active'
         JOIN mentee_profiles mentee_profile ON mentee_profile.user_id = mentee.id
         JOIN users mentor ON mentor.id = proposal.mentor_user_id
          AND mentor.account_status = 'active'
         JOIN mentor_profiles mentor_profile ON mentor_profile.user_id = mentor.id
        WHERE ${whereSql}
        ORDER BY proposal.created_at DESC, proposal.id`,
      values,
    );
    return result.rows;
  }

  return {
    async createProgrammeForStaff(staffUserId, programme) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const created = await client.query(
          `INSERT INTO programmes (id, name, description)
           VALUES ($1, $2, $3)
           RETURNING id, name, description, created_at AS "createdAt"`,
          [randomUUID(), programme.name, programme.description],
        );
        await client.query(
          `INSERT INTO programme_staff_assignments (programme_id, staff_user_id, status)
           VALUES ($1, $2, 'active')`,
          [created.rows[0].id, staffUserId],
        );
        await client.query('COMMIT');
        return created.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listStaffProgrammes(staffUserId) {
      const result = await pool.query(
        `SELECT programme.id, programme.name, programme.description,
                programme.created_at AS "createdAt",
                assignment.assigned_at AS "assignedAt",
                (SELECT count(*)::INTEGER FROM programme_participants participant
                  JOIN users account
                    ON account.id = participant.participant_user_id
                   AND account.account_status = 'active'
                  WHERE participant.programme_id = programme.id
                    AND participant.participant_role = 'mentee'
                    AND participant.status = 'active') AS "menteeCount",
                (SELECT count(*)::INTEGER FROM programme_participants participant
                  JOIN users account
                    ON account.id = participant.participant_user_id
                   AND account.account_status = 'active'
                  WHERE participant.programme_id = programme.id
                    AND participant.participant_role = 'mentor'
                    AND participant.status = 'active') AS "mentorCount"
           FROM programmes programme
           JOIN programme_staff_assignments assignment
             ON assignment.programme_id = programme.id
            AND assignment.staff_user_id = $1
            AND assignment.status = 'active'
          WHERE programme.status = 'active'
          ORDER BY programme.name, programme.id`,
        [staffUserId],
      );
      return result.rows;
    },

    async getStaffDashboard(staffUserId) {
      const summary = await pool.query(
        `WITH accessible AS (
           SELECT programme.id
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
            WHERE programme.status = 'active'
         )
         SELECT
           (SELECT count(*)::INTEGER FROM accessible) AS "programmeCount",
           (SELECT count(*)::INTEGER FROM programme_participants participant
             JOIN accessible ON accessible.id = participant.programme_id
             JOIN users account ON account.id = participant.participant_user_id
               AND account.account_status = 'active'
            WHERE participant.participant_role = 'mentee' AND participant.status = 'active') AS "menteeCount",
           (SELECT count(*)::INTEGER FROM programme_participants participant
             JOIN accessible ON accessible.id = participant.programme_id
             JOIN users account ON account.id = participant.participant_user_id
               AND account.account_status = 'active'
            WHERE participant.participant_role = 'mentor' AND participant.status = 'active') AS "mentorCount",
           (SELECT count(DISTINCT relationship.id)::INTEGER
              FROM programme_relationships scope
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id
                AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id
                AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE relationship.status = 'active') AS "activeRelationshipCount",
           (SELECT count(DISTINCT request.id)::INTEGER
              FROM programme_requests scope
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_requests request ON request.id = scope.request_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = request.mentee_user_id
                AND mentee.participant_role = 'mentee' AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = request.mentor_user_id
                AND mentor.participant_role = 'mentor' AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = request.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = request.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE request.status = 'pending') AS "pendingRequestCount",
           (SELECT count(DISTINCT session.id)::INTEGER
              FROM mentorship_sessions session
              JOIN programme_relationships scope ON scope.relationship_id = session.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE relationship.status = 'active'
               AND session.status = 'scheduled' AND session.scheduled_at >= now()) AS "upcomingSessionCount",
           (SELECT count(DISTINCT session.id)::INTEGER
              FROM mentorship_sessions session
              JOIN programme_relationships scope ON scope.relationship_id = session.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE relationship.status = 'active' AND session.status = 'completed') AS "completedSessionCount",
           (SELECT count(DISTINCT session.id)::INTEGER
              FROM mentorship_sessions session
              JOIN programme_relationships scope ON scope.relationship_id = session.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE relationship.status = 'active' AND session.status = 'cancelled') AS "cancelledSessionCount",
           (SELECT count(DISTINCT session.id)::INTEGER
              FROM mentorship_sessions session
              JOIN programme_relationships scope ON scope.relationship_id = session.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE relationship.status = 'active' AND session.status = 'scheduled'
               AND session.scheduled_at < now()) AS "overdueSessionCount",
           (SELECT count(DISTINCT participant.participant_user_id)::INTEGER
              FROM programme_participants participant
              JOIN accessible ON accessible.id = participant.programme_id
              JOIN users account ON account.id = participant.participant_user_id
                AND account.account_status = 'active'
             WHERE participant.participant_role = 'mentee' AND participant.status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM programme_relationships scope
                 JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
                 JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                   AND mentor.participant_user_id = relationship.mentor_user_id
                   AND mentor.participant_role = 'mentor' AND mentor.status = 'active'
                 JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                   AND mentor_account.account_status = 'active'
                 WHERE scope.programme_id = participant.programme_id
                   AND relationship.mentee_user_id = participant.participant_user_id
                   AND relationship.status = 'active'
               )) AS "unmatchedMenteeCount",
           (SELECT count(DISTINCT participant.participant_user_id)::INTEGER
              FROM programme_participants participant
              JOIN accessible ON accessible.id = participant.programme_id
              JOIN users account ON account.id = participant.participant_user_id
                AND account.account_status = 'active'
             WHERE participant.participant_role = 'mentor' AND participant.status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM programme_relationships scope
                 JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
                 JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                   AND mentee.participant_user_id = relationship.mentee_user_id
                   AND mentee.participant_role = 'mentee' AND mentee.status = 'active'
                 JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                   AND mentee_account.account_status = 'active'
                 WHERE scope.programme_id = participant.programme_id
                   AND relationship.mentor_user_id = participant.participant_user_id
                   AND relationship.status = 'active'
               )) AS "unmatchedMentorCount",
           (SELECT count(DISTINCT goal.id)::INTEGER
              FROM mentorship_goals goal
              JOIN programme_relationships scope ON scope.relationship_id = goal.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE goal.status = 'active') AS "activeGoalCount",
           (SELECT count(DISTINCT milestone.id)::INTEGER
              FROM mentorship_goal_milestones milestone
              JOIN mentorship_goals goal ON goal.id = milestone.goal_id AND goal.status = 'active'
              JOIN programme_relationships scope ON scope.relationship_id = goal.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE milestone.status = 'pending') AS "activeMilestoneCount",
           (SELECT count(DISTINCT goal.id)::INTEGER
              FROM mentorship_goals goal
              JOIN programme_relationships scope ON scope.relationship_id = goal.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE goal.status = 'completed') AS "completedGoalCount",
           (SELECT count(DISTINCT milestone.id)::INTEGER
              FROM mentorship_goal_milestones milestone
              JOIN mentorship_goals goal ON goal.id = milestone.goal_id
              JOIN programme_relationships scope ON scope.relationship_id = goal.relationship_id
              JOIN accessible ON accessible.id = scope.programme_id
              JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
              JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
                AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
              JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
                AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
              JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
                AND mentee_account.account_status = 'active'
              JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
                AND mentor_account.account_status = 'active'
             WHERE milestone.status = 'completed') AS "completedMilestoneCount"`,
        [staffUserId],
      );
      const programmes = await this.listStaffProgrammes(staffUserId);
      const recentActivity = await pool.query(
        `WITH accessible AS (
           SELECT programme.id
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
            WHERE programme.status = 'active'
         ), activity AS (
           SELECT 'session'::TEXT AS type, session.id, session.title AS label,
                  session.created_at AS "occurredAt", relationship.id AS "relationshipId"
             FROM mentorship_sessions session
             JOIN programme_relationships scope ON scope.relationship_id = session.relationship_id
             JOIN accessible ON accessible.id = scope.programme_id
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
               AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
             JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
               AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
             JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
               AND mentee_account.account_status = 'active'
             JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
               AND mentor_account.account_status = 'active'
           UNION ALL
           SELECT 'goal'::TEXT, event.id, goal.title, event.created_at, goal.relationship_id
             FROM mentorship_goal_events event
             JOIN mentorship_goals goal ON goal.id = event.goal_id
             JOIN programme_relationships scope ON scope.relationship_id = goal.relationship_id
             JOIN accessible ON accessible.id = scope.programme_id
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN programme_participants mentee ON mentee.programme_id = scope.programme_id
               AND mentee.participant_user_id = relationship.mentee_user_id AND mentee.status = 'active'
             JOIN programme_participants mentor ON mentor.programme_id = scope.programme_id
               AND mentor.participant_user_id = relationship.mentor_user_id AND mentor.status = 'active'
             JOIN users mentee_account ON mentee_account.id = relationship.mentee_user_id
               AND mentee_account.account_status = 'active'
             JOIN users mentor_account ON mentor_account.id = relationship.mentor_user_id
               AND mentor_account.account_status = 'active'
           UNION ALL
           SELECT 'request'::TEXT, request.id, 'Mentorship request', request.created_at, NULL::UUID
             FROM mentorship_requests request
             JOIN programme_requests request_scope ON request_scope.request_id = request.id
             JOIN programme_participants mentee ON mentee.participant_user_id = request.mentee_user_id
               AND mentee.participant_role = 'mentee' AND mentee.status = 'active'
             JOIN accessible ON accessible.id = request_scope.programme_id
               AND accessible.id = mentee.programme_id
             JOIN programme_participants mentor ON mentor.programme_id = accessible.id
               AND mentor.participant_user_id = request.mentor_user_id
               AND mentor.participant_role = 'mentor' AND mentor.status = 'active'
             JOIN users mentee_account ON mentee_account.id = request.mentee_user_id
               AND mentee_account.account_status = 'active'
             JOIN users mentor_account ON mentor_account.id = request.mentor_user_id
               AND mentor_account.account_status = 'active'
         )
         SELECT type, id, label, "occurredAt", "relationshipId"
           FROM activity ORDER BY "occurredAt" DESC LIMIT 10`,
        [staffUserId],
      );
      return {
        summary: summary.rows[0],
        programmes,
        recentActivity: recentActivity.rows,
      };
    },

    async listProgrammeParticipants(staffUserId, programmeId, filters) {
      await requireProgrammeAccess(staffUserId, programmeId);
      const offset = (filters.page - 1) * filters.pageSize;
      const count = await pool.query(
        `SELECT count(*)::INTEGER AS total
           FROM programme_participants participant
           JOIN users account ON account.id = participant.participant_user_id
           LEFT JOIN mentee_profiles mentee ON mentee.user_id = account.id
           LEFT JOIN mentor_profiles mentor ON mentor.user_id = account.id
          WHERE participant.programme_id = $1
            AND ($2::TEXT IS NULL OR participant.participant_role = $2)
            AND ($3::TEXT = 'all' OR participant.status = $3)
            AND ($4::TEXT = '' OR concat_ws(' ', account.full_name, account.role,
                  COALESCE(mentee.location, mentor.location, ''),
                  COALESCE(mentee.biography, mentor.biography, '')) ILIKE '%' || $4 || '%')
            AND account.account_status = 'active'`,
        [programmeId, filters.role ?? null, filters.status, filters.q],
      );
      const result = await pool.query(
        `SELECT account.id, account.full_name AS name, participant.participant_role AS role,
                participant.status AS "membershipStatus",
                participant.assigned_at AS "assignedAt",
                participant.programme_id AS "programmeId",
                programme.name AS "programmeName",
                COALESCE(mentee.location, mentor.location, '') AS location,
                COALESCE(mentee.biography, mentor.biography, '') AS bio,
                COALESCE(mentee.image_url, mentor.image_url) AS "imageUrl",
                CASE WHEN participant.participant_role = 'mentee'
                  THEN mentee.experience_level ELSE
                    CASE WHEN mentor.experience_years IS NULL THEN '' ELSE mentor.experience_years || ' years' END
                END AS experience,
                COALESCE((
                  SELECT array_agg(expertise.name ORDER BY lower(expertise.name))
                    FROM mentee_interests interest
                    JOIN expertise ON expertise.id = interest.expertise_id
                   WHERE interest.mentee_user_id = account.id
                ), ARRAY[]::TEXT[]) AS interests,
                COALESCE((
                  SELECT array_agg(expertise.name ORDER BY lower(expertise.name))
                    FROM mentor_expertise link
                    JOIN expertise ON expertise.id = link.expertise_id
                   WHERE link.mentor_user_id = account.id
                ), ARRAY[]::TEXT[]) AS expertise,
                mentor.specialisation,
                mentor.max_active_mentees AS "maxActiveMentees",
                (SELECT count(*)::INTEGER FROM mentorship_relationships relationship
                  WHERE relationship.mentor_user_id = account.id AND relationship.status = 'active') AS "activeMentees",
                COALESCE(to_jsonb(mentor)->>'availability_note', '') AS "availabilityNote"
           FROM programme_participants participant
           JOIN programmes programme ON programme.id = participant.programme_id
           JOIN users account ON account.id = participant.participant_user_id
           LEFT JOIN mentee_profiles mentee ON mentee.user_id = account.id
           LEFT JOIN mentor_profiles mentor ON mentor.user_id = account.id
          WHERE participant.programme_id = $1
            AND ($2::TEXT IS NULL OR participant.participant_role = $2)
            AND ($3::TEXT = 'all' OR participant.status = $3)
            AND ($4::TEXT = '' OR concat_ws(' ', account.full_name, account.role,
                  COALESCE(mentee.location, mentor.location, ''),
                  COALESCE(mentee.biography, mentor.biography, '')) ILIKE '%' || $4 || '%')
            AND account.account_status = 'active'
          ORDER BY account.full_name, account.id
          LIMIT $5 OFFSET $6`,
        [programmeId, filters.role ?? null, filters.status, filters.q, filters.pageSize, offset],
      );
      return { items: result.rows, page: filters.page, pageSize: filters.pageSize, total: count.rows[0].total };
    },

    async getProgrammeParticipant(staffUserId, participantId) {
      const result = await pool.query(
        `SELECT account.id, account.full_name AS name, account.role,
                COALESCE(mentee.location, mentor.location, '') AS location,
                COALESCE(mentee.biography, mentor.biography, '') AS bio,
                COALESCE(mentee.image_url, mentor.image_url) AS "imageUrl",
                mentee.experience_level AS "experienceLevel",
                mentor.experience_years AS "experienceYears",
                mentor.specialisation,
                COALESCE((
                  SELECT array_agg(expertise.name ORDER BY lower(expertise.name))
                    FROM mentee_interests interest
                    JOIN expertise ON expertise.id = interest.expertise_id
                   WHERE interest.mentee_user_id = account.id
                ), ARRAY[]::TEXT[]) AS interests,
                COALESCE((
                  SELECT array_agg(expertise.name ORDER BY lower(expertise.name))
                    FROM mentor_expertise link
                    JOIN expertise ON expertise.id = link.expertise_id
                   WHERE link.mentor_user_id = account.id
                ), ARRAY[]::TEXT[]) AS expertise,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', programme.id,
                    'name', programme.name,
                    'membershipStatus', participant.status,
                    'assignedAt', participant.assigned_at
                  ) ORDER BY programme.name)
                    FROM programme_participants participant
                    JOIN programmes programme ON programme.id = participant.programme_id
                    JOIN programme_staff_assignments assignment
                      ON assignment.programme_id = programme.id
                     AND assignment.staff_user_id = $1 AND assignment.status = 'active'
                   WHERE participant.participant_user_id = account.id
                     AND programme.status = 'active'
                ), '[]'::JSONB) AS programmes
           FROM users account
           LEFT JOIN mentee_profiles mentee ON mentee.user_id = account.id
           LEFT JOIN mentor_profiles mentor ON mentor.user_id = account.id
          WHERE account.id = $2 AND account.role IN ('mentee', 'mentor')
            AND account.account_status = 'active'
            AND EXISTS (
              SELECT 1
                FROM programme_participants participant
                JOIN programmes programme ON programme.id = participant.programme_id
                JOIN programme_staff_assignments assignment
                  ON assignment.programme_id = programme.id
                 AND assignment.staff_user_id = $1 AND assignment.status = 'active'
               WHERE participant.participant_user_id = account.id
                 AND participant.status = 'active' AND programme.status = 'active'
            )`,
        [staffUserId, participantId],
      );
      return result.rows[0] ?? null;
    },

    async getProgrammeOversight(staffUserId, programmeId) {
      const programme = await requireProgrammeAccess(staffUserId, programmeId);
      const [requests, relationships, sessions, goals, matchProposals] = await Promise.all([
        pool.query(
          `SELECT request.id, request.status, request.created_at AS "createdAt",
                  mentee.id AS "menteeId", mentee.full_name AS "menteeName",
                  mentor.id AS "mentorId", mentor.full_name AS "mentorName",
                  request.responded_at AS "respondedAt"
             FROM programme_requests request_scope
             JOIN mentorship_requests request ON request.id = request_scope.request_id
             JOIN programme_participants mentee_membership
               ON mentee_membership.programme_id = request_scope.programme_id
              AND mentee_membership.participant_user_id = request.mentee_user_id
              AND mentee_membership.participant_role = 'mentee' AND mentee_membership.status = 'active'
             JOIN programme_participants mentor_membership
               ON mentor_membership.programme_id = request_scope.programme_id
              AND mentor_membership.participant_user_id = request.mentor_user_id
              AND mentor_membership.participant_role = 'mentor' AND mentor_membership.status = 'active'
             JOIN users mentee ON mentee.id = request.mentee_user_id
              AND mentee.account_status = 'active'
             JOIN users mentor ON mentor.id = request.mentor_user_id
              AND mentor.account_status = 'active'
            WHERE request_scope.programme_id = $1
            ORDER BY request.created_at DESC LIMIT 50`,
          [programmeId],
        ),
        pool.query(
          `SELECT relationship.id, relationship.status, relationship.created_at AS "startedAt",
                  relationship.ended_at AS "endedAt",
                  mentee.id AS "menteeId", mentee.full_name AS "menteeName",
                  mentor.id AS "mentorId", mentor.full_name AS "mentorName"
             FROM programme_relationships scope
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN programme_participants mentee_membership
               ON mentee_membership.programme_id = scope.programme_id
              AND mentee_membership.participant_user_id = relationship.mentee_user_id
              AND mentee_membership.participant_role = 'mentee' AND mentee_membership.status = 'active'
             JOIN programme_participants mentor_membership
               ON mentor_membership.programme_id = scope.programme_id
              AND mentor_membership.participant_user_id = relationship.mentor_user_id
              AND mentor_membership.participant_role = 'mentor' AND mentor_membership.status = 'active'
             JOIN users mentee ON mentee.id = relationship.mentee_user_id
              AND mentee.account_status = 'active'
             JOIN users mentor ON mentor.id = relationship.mentor_user_id
              AND mentor.account_status = 'active'
            WHERE scope.programme_id = $1
            ORDER BY relationship.created_at DESC LIMIT 50`,
          [programmeId],
        ),
        pool.query(
          `SELECT session.id, session.title, session.scheduled_at AS "scheduledAt",
                  session.status, session.completed_at AS "completedAt",
                  session.coordinated_by_staff_user_id AS "coordinatedByStaffUserId",
                  (SELECT response FROM programme_session_participation attendance
                    WHERE attendance.session_id = session.id
                      AND attendance.participant_user_id = relationship.mentee_user_id) AS "menteeResponse",
                  (SELECT response FROM programme_session_participation attendance
                    WHERE attendance.session_id = session.id
                      AND attendance.participant_user_id = relationship.mentor_user_id) AS "mentorResponse",
                  relationship.id AS "relationshipId",
                  mentee.full_name AS "menteeName", mentor.full_name AS "mentorName"
             FROM programme_relationships scope
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN mentorship_sessions session ON session.relationship_id = relationship.id
             JOIN programme_participants mentee_membership
               ON mentee_membership.programme_id = scope.programme_id
              AND mentee_membership.participant_user_id = relationship.mentee_user_id
              AND mentee_membership.status = 'active'
             JOIN programme_participants mentor_membership
               ON mentor_membership.programme_id = scope.programme_id
              AND mentor_membership.participant_user_id = relationship.mentor_user_id
              AND mentor_membership.status = 'active'
             JOIN users mentee ON mentee.id = relationship.mentee_user_id
              AND mentee.account_status = 'active'
             JOIN users mentor ON mentor.id = relationship.mentor_user_id
              AND mentor.account_status = 'active'
            WHERE scope.programme_id = $1
            ORDER BY session.scheduled_at DESC LIMIT 50`,
          [programmeId],
        ),
        pool.query(
          `SELECT goal.id, goal.title, goal.measurable_outcome AS "measurableOutcome",
                  goal.target_date AS "targetDate", goal.status,
                  goal.completed_at AS "completedAt", relationship.id AS "relationshipId",
                  mentee.full_name AS "menteeName", mentor.full_name AS "mentorName",
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id', milestone.id,
                      'title', milestone.title,
                      'status', milestone.status,
                      'completedAt', milestone.completed_at
                    ) ORDER BY milestone.created_at)
                      FROM mentorship_goal_milestones milestone
                     WHERE milestone.goal_id = goal.id
                  ), '[]'::JSONB) AS milestones
             FROM programme_relationships scope
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN mentorship_goals goal ON goal.relationship_id = relationship.id
             JOIN programme_participants mentee_membership
               ON mentee_membership.programme_id = scope.programme_id
              AND mentee_membership.participant_user_id = relationship.mentee_user_id
              AND mentee_membership.status = 'active'
             JOIN programme_participants mentor_membership
               ON mentor_membership.programme_id = scope.programme_id
              AND mentor_membership.participant_user_id = relationship.mentor_user_id
              AND mentor_membership.status = 'active'
             JOIN users mentee ON mentee.id = relationship.mentee_user_id
              AND mentee.account_status = 'active'
             JOIN users mentor ON mentor.id = relationship.mentor_user_id
              AND mentor.account_status = 'active'
            WHERE scope.programme_id = $1
            ORDER BY goal.updated_at DESC LIMIT 50`,
          [programmeId],
        ),
        readMatchProposals(pool, 'proposal.programme_id = $1', [programmeId]),
      ]);
      return {
        programme,
        requests: requests.rows,
        relationships: relationships.rows,
        sessions: sessions.rows,
        goals: goals.rows,
        matchProposals,
      };
    },

    async listProgrammeMatchProposals(staffUserId, programmeId) {
      await requireProgrammeAccess(staffUserId, programmeId);
      return readMatchProposals(pool, 'proposal.programme_id = $1', [programmeId]);
    },

    async createProgrammeSession(staffUserId, programmeId, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const relationship = await client.query(
          `SELECT relationship.id
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
             JOIN programme_relationships scope ON scope.programme_id = programme.id
             JOIN mentorship_relationships relationship ON relationship.id = scope.relationship_id
             JOIN programme_participants mentee ON mentee.programme_id = programme.id
              AND mentee.participant_user_id = relationship.mentee_user_id
              AND mentee.participant_role = 'mentee' AND mentee.status = 'active'
             JOIN users mentee_account ON mentee_account.id = mentee.participant_user_id
              AND mentee_account.account_status = 'active'
             JOIN programme_participants mentor ON mentor.programme_id = programme.id
              AND mentor.participant_user_id = relationship.mentor_user_id
              AND mentor.participant_role = 'mentor' AND mentor.status = 'active'
             JOIN users mentor_account ON mentor_account.id = mentor.participant_user_id
              AND mentor_account.account_status = 'active'
            WHERE programme.id = $2 AND programme.status = 'active'
              AND relationship.id = $3 AND relationship.status = 'active'
            FOR UPDATE OF relationship`,
          [staffUserId, programmeId, input.relationshipId],
        );
        if (!relationship.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const result = await client.query(
          `INSERT INTO mentorship_sessions
             (id, relationship_id, title, scheduled_at, preparation_notes, created_by,
              coordinated_programme_id, coordinated_by_staff_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
           RETURNING id, relationship_id AS "relationshipId", title,
                     scheduled_at AS "scheduledAt", preparation_notes AS "preparationNotes",
                     status, created_by AS "createdBy", created_at AS "createdAt",
                     completed_at AS "completedAt", coordinated_by_staff_user_id AS "coordinatedByStaffUserId"`,
          [randomUUID(), input.relationshipId, input.title, input.scheduledAt,
            input.preparationNotes, staffUserId, programmeId],
        );
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async respondToProgrammeSession(userId, sessionId, response) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE programme_session_participation attendance
              SET response = $3, responded_at = now(), updated_at = now()
             FROM mentorship_sessions session
             JOIN mentorship_relationships relationship ON relationship.id = session.relationship_id
             JOIN users account ON account.id = $2 AND account.account_status = 'active'
            WHERE attendance.session_id = $1 AND attendance.participant_user_id = $2
              AND attendance.session_id = session.id
              AND session.status = 'scheduled'
              AND $2 IN (relationship.mentee_user_id, relationship.mentor_user_id)
              AND attendance.response = 'pending'
           RETURNING attendance.session_id AS "sessionId", attendance.participant_user_id AS "participantId",
                     attendance.response, attendance.responded_at AS "respondedAt"`,
          [sessionId, userId, response],
        );
        if (!updated.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const confirmations = await client.query(
          `SELECT count(*)::INTEGER AS total,
                  count(*) FILTER (WHERE response = 'attended')::INTEGER AS attended
             FROM programme_session_participation
            WHERE session_id = $1`,
          [sessionId],
        );
        if (confirmations.rows[0].total === 2 && confirmations.rows[0].attended === 2) {
          await client.query(
            `UPDATE mentorship_sessions SET status = 'completed' WHERE id = $1 AND status = 'scheduled'`,
            [sessionId],
          );
        }
        const attendance = await client.query(
          `SELECT session.id AS "sessionId", session.status,
                  (SELECT response FROM programme_session_participation
                    WHERE session_id = session.id AND participant_user_id = relationship.mentee_user_id) AS "menteeResponse",
                  (SELECT response FROM programme_session_participation
                    WHERE session_id = session.id AND participant_user_id = relationship.mentor_user_id) AS "mentorResponse"
             FROM mentorship_sessions session
             JOIN mentorship_relationships relationship ON relationship.id = session.relationship_id
            WHERE session.id = $1`,
          [sessionId],
        );
        await client.query('COMMIT');
        return { ...updated.rows[0], ...attendance.rows[0] };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async createProgrammeMatchProposal(staffUserId, programmeId, { menteeId, mentorId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const access = await client.query(
          `SELECT programme.id
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
            WHERE programme.id = $2 AND programme.status = 'active'
            FOR UPDATE OF programme`,
          [staffUserId, programmeId],
        );
        if (!access.rows[0]) throw programmeNotFound();
        const proposalId = randomUUID();
        await client.query(
          `INSERT INTO programme_match_proposals
             (id, programme_id, mentee_user_id, mentor_user_id, proposed_by_staff_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [proposalId, programmeId, menteeId, mentorId, staffUserId],
        );
        const [proposal] = await readMatchProposals(client, 'proposal.id = $1', [proposalId]);
        await client.query('COMMIT');
        return proposal;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async withdrawProgrammeMatchProposal(staffUserId, programmeId, proposalId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE programme_match_proposals proposal
              SET status = 'withdrawn', withdrawn_by_staff_user_id = $1
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
            WHERE proposal.id = $3 AND proposal.programme_id = $2
              AND programme.id = proposal.programme_id AND programme.status = 'active'
              AND proposal.status IN ('proposed', 'awaiting_mentor', 'awaiting_mentee')
           RETURNING proposal.id`,
          [staffUserId, programmeId, proposalId],
        );
        if (!updated.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const [proposal] = await readMatchProposals(client, 'proposal.id = $1', [proposalId]);
        await client.query('COMMIT');
        return proposal;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listParticipantMatchProposals(userId, role) {
      if (role === 'mentee') {
        return readMatchProposals(pool, 'proposal.mentee_user_id = $1', [userId]);
      }
      return readMatchProposals(pool, 'proposal.mentor_user_id = $1', [userId]);
    },

    async respondToProgrammeMatchProposal(userId, role, proposalId, response) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const selected = await client.query(
          `SELECT * FROM programme_match_proposals
            WHERE id = $1 AND $2 = CASE WHEN mentee_user_id = $3 THEN 'mentee' ELSE 'mentor' END
              AND $3 IN (mentee_user_id, mentor_user_id)
            FOR UPDATE`,
          [proposalId, role, userId],
        );
        const proposal = selected.rows[0];
        if (!proposal) {
          await client.query('ROLLBACK');
          return null;
        }
        const ownResponse = role === 'mentee' ? proposal.mentee_response : proposal.mentor_response;
        if (ownResponse !== 'pending' || !['proposed', 'awaiting_mentor', 'awaiting_mentee'].includes(proposal.status)) {
          throw Object.assign(new Error('This match proposal has already been answered.'), { code: 'MATCH_PROPOSAL_FINAL' });
        }

        let nextStatus = 'declined';
        let requestId = null;
        let relationshipId = null;
        const otherResponse = role === 'mentee' ? proposal.mentor_response : proposal.mentee_response;
        if (response === 'accepted' && otherResponse === 'accepted') {
          const capacityResult = await client.query(
            `SELECT profile.max_active_mentees,
                    (SELECT count(*)::INTEGER FROM mentorship_relationships relationship
                      WHERE relationship.mentor_user_id = profile.user_id
                        AND relationship.status = 'active') AS active_count
               FROM mentor_profiles profile WHERE profile.user_id = $1 FOR UPDATE`,
            [proposal.mentor_user_id],
          );
          if (!capacityResult.rows[0]) throw programmeNotFound();
          const capacity = capacityResult.rows[0].max_active_mentees;
          if (capacity !== null && Number(capacityResult.rows[0].active_count) >= Number(capacity)) {
            throw Object.assign(new Error('Mentor capacity changed while this proposal was awaiting responses.'), {
              code: 'MENTOR_AT_CAPACITY',
            });
          }
          nextStatus = 'accepted';
          requestId = randomUUID();
          relationshipId = randomUUID();
        } else if (response === 'accepted') {
          nextStatus = role === 'mentee' ? 'awaiting_mentor' : 'awaiting_mentee';
        }

        if (role === 'mentee') {
          await client.query(
            `UPDATE programme_match_proposals
                SET mentee_response = $2, mentee_responded_at = now(),
                    mentee_responded_by_user_id = $3, status = $4,
                    request_id = $5, relationship_id = $6
              WHERE id = $1`,
            [proposalId, response, userId, nextStatus, requestId, relationshipId],
          );
        } else {
          await client.query(
            `UPDATE programme_match_proposals
                SET mentor_response = $2, mentor_responded_at = now(),
                    mentor_responded_by_user_id = $3, status = $4,
                    request_id = $5, relationship_id = $6
              WHERE id = $1`,
            [proposalId, response, userId, nextStatus, requestId, relationshipId],
          );
        }

        if (nextStatus === 'accepted') {
          await client.query(
            `INSERT INTO mentorship_requests
               (id, mentee_user_id, mentor_user_id, message, status, responded_at)
             VALUES ($1, $2, $3, 'Programme match accepted by both participants.', 'accepted', now())`,
            [requestId, proposal.mentee_user_id, proposal.mentor_user_id],
          );
          await client.query(
            `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
             VALUES ($1, $2, $3, $4)`,
            [relationshipId, requestId, proposal.mentee_user_id, proposal.mentor_user_id],
          );
        }

        const [updated] = await readMatchProposals(client, 'proposal.id = $1', [proposalId]);
        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async assignProgrammeParticipant(staffUserId, programmeId, participantEmail, role) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const access = await client.query(
          `SELECT programme.id
             FROM programmes programme
             JOIN programme_staff_assignments assignment
               ON assignment.programme_id = programme.id
              AND assignment.staff_user_id = $1 AND assignment.status = 'active'
            WHERE programme.id = $2 AND programme.status = 'active'
            FOR UPDATE OF programme`,
          [staffUserId, programmeId],
        );
        if (!access.rows[0]) throw programmeNotFound();
        const result = await client.query(
          `INSERT INTO programme_participants
             (programme_id, participant_user_id, participant_role, status, assigned_by_user_id)
           SELECT $1, account.id, account.role, 'active', $4
             FROM users account
            WHERE lower(account.email) = $2 AND account.role = $3
              AND account.account_status = 'active'
           ON CONFLICT (programme_id, participant_user_id)
           DO UPDATE SET status = 'active', assigned_by_user_id = $4, updated_at = now()
           RETURNING participant_user_id AS id, participant_role AS role, status`,
          [programmeId, participantEmail, role, staffUserId],
        );
        if (!result.rows[0]) {
          throw new HttpError(404, 'PARTICIPANT_NOT_FOUND', 'No active participant account matches that email and role.');
        }
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateProgrammeParticipantMembership(staffUserId, programmeId, participantId, status) {
      const result = await pool.query(
        `UPDATE programme_participants participant
            SET status = $4, assigned_by_user_id = $1, updated_at = now()
           FROM programmes programme
           JOIN programme_staff_assignments assignment
             ON assignment.programme_id = programme.id
            AND assignment.staff_user_id = $1 AND assignment.status = 'active'
          WHERE participant.programme_id = $2 AND participant.participant_user_id = $3
            AND participant.programme_id = programme.id AND programme.status = 'active'
            AND EXISTS (
              SELECT 1 FROM users account
               WHERE account.id = participant.participant_user_id
                 AND account.account_status = 'active'
            )
          RETURNING participant.participant_user_id AS id,
                    participant.participant_role AS role, participant.status`,
        [staffUserId, programmeId, participantId, status],
      );
      return result.rows[0] ?? null;
    },

    async consumeStaffInvitation({ tokenHash, email, user, session }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const invitation = await consumeInvitation(client, tokenHash, email);
        const existing = await client.query(
          'SELECT id FROM users WHERE lower(email) = $1 FOR UPDATE',
          [email],
        );
        if (existing.rows[0]) throw invalidInvitation();
        const inserted = await client.query(
          `INSERT INTO users (id, full_name, email, password_hash, role, account_status, phone)
           VALUES ($1, $2, $3, $4, 'programme_staff', 'active', $5)
           RETURNING id, full_name, email, phone, role, account_status, updated_at`,
          [user.id, user.fullName, email, user.passwordHash, user.phone],
        );
        await client.query('INSERT INTO programme_staff_profiles (user_id) VALUES ($1)', [user.id]);
        await client.query(
          `INSERT INTO programme_staff_assignments (programme_id, staff_user_id, status)
           VALUES ($1, $2, 'active')`,
          [invitation.programme_id, user.id],
        );
        await client.query(
          `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [session.id, session.userId, session.tokenHash, session.expiresAt],
        );
        await client.query(
          `UPDATE programme_staff_invitations
              SET used_at = now(), used_by_user_id = $2
            WHERE id = $1`,
          [invitation.id, user.id],
        );
        await client.query('COMMIT');
        return inserted.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async acceptProgrammeInvitation(staffUserId, tokenHash) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const invitation = await consumeInvitation(client, tokenHash, null);
        const staff = await client.query(
          `SELECT email FROM users
            WHERE id = $1 AND role = 'programme_staff' AND account_status = 'active'
            FOR UPDATE`,
          [staffUserId],
        );
        if (!staff.rows[0] || staff.rows[0].email.toLowerCase() !== invitation.email) throw invalidInvitation();
        await client.query(
          `INSERT INTO programme_staff_assignments (programme_id, staff_user_id, status)
           VALUES ($1, $2, 'active')
           ON CONFLICT (programme_id, staff_user_id)
           DO UPDATE SET status = 'active', updated_at = now()`,
          [invitation.programme_id, staffUserId],
        );
        await client.query(
          `UPDATE programme_staff_invitations
              SET used_at = now(), used_by_user_id = $2
            WHERE id = $1`,
          [invitation.id, staffUserId],
        );
        const result = await client.query(
          `SELECT id, name, description
             FROM programmes WHERE id = $1`,
          [invitation.programme_id],
        );
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async provisionProgrammeInvitation(programmeId, email, tokenHash, expiresAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE programme_staff_invitations
              SET revoked_at = now()
            WHERE programme_id = $1 AND email = $2
              AND used_at IS NULL AND revoked_at IS NULL
              AND expires_at <= now()`,
          [programmeId, email],
        );
        const result = await client.query(
          `INSERT INTO programme_staff_invitations
             (id, programme_id, email, token_hash, expires_at)
           SELECT $5, programme.id, $2, $3, $4
             FROM programmes programme
            WHERE programme.id = $1 AND programme.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM users account
                 WHERE lower(account.email) = $2
                   AND (account.role <> 'programme_staff' OR account.account_status <> 'active')
              )
           RETURNING id`,
          [programmeId, email, tokenHash, expiresAt, randomUUID()],
        );
        if (!result.rows[0]) throw programmeNotFound();
        await client.query('COMMIT');
        return result.rows[0].id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async createProgrammeAndInvitation(programme, email, tokenHash, expiresAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT id FROM users
            WHERE lower(email) = $1
              AND (role <> 'programme_staff' OR account_status <> 'active')
            FOR UPDATE`,
          [email],
        );
        if (existing.rows[0]) {
          const error = new Error('An invitation cannot be issued to an existing non-staff account.');
          error.code = 'INVITATION_EMAIL_INELIGIBLE';
          throw error;
        }
        const created = await client.query(
          `INSERT INTO programmes (id, name, description)
           VALUES ($1, $2, $3) RETURNING id`,
          [programme.id, programme.name, programme.description],
        );
        await client.query(
          `INSERT INTO programme_staff_invitations (id, programme_id, email, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), created.rows[0].id, email, tokenHash, expiresAt],
        );
        await client.query('COMMIT');
        return created.rows[0].id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async provisionParticipantMembership(programmeId, participantEmail, role) {
      const result = await pool.query(
        `INSERT INTO programme_participants (programme_id, participant_user_id, participant_role, status)
         SELECT programme.id, account.id, account.role, 'active'
           FROM programmes programme
           JOIN users account ON lower(account.email) = $2
          WHERE programme.id = $1 AND programme.status = 'active'
            AND account.role = $3 AND account.account_status = 'active'
         ON CONFLICT (programme_id, participant_user_id)
         DO UPDATE SET status = 'active', updated_at = now()
         RETURNING participant_user_id`,
        [programmeId, participantEmail, role],
      );
      if (!result.rows[0]) {
        throw new HttpError(404, 'PROGRAMME_OR_PARTICIPANT_NOT_FOUND', 'Programme or eligible participant not found.');
      }
      return result.rows[0].participant_user_id;
    },
  };
}

module.exports = { createPostgresProgrammeRepository };
