const { randomUUID } = require('node:crypto');
const { HttpError } = require('./http-error');

function profileFromRows(user, roleProfile, topics = []) {
  const common = {
    userId: user.id,
    name: user.fullName,
    email: user.email,
    phone: user.phone ?? '',
    role: user.role,
    location: roleProfile?.location ?? '',
    bio: roleProfile?.bio ?? '',
    organization: '',
    jobTitle: '',
    maxActiveMentees: roleProfile?.maxActiveMentees ?? null,
    activeMentees: roleProfile?.activeMentees ?? 0,
    availabilityNote: roleProfile?.availabilityNote ?? '',
    imageUrl: roleProfile?.imageUrl ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: (roleProfile?.updatedAt ?? user.updatedAt).toISOString(),
  };

  if (user.role === 'mentee') {
    return {
      ...common,
      interests: topics,
      expertise: [],
      experience: roleProfile?.experienceLevel ?? '',
      specialisation: '',
      needs: roleProfile?.needs ?? '',
      qualifications: '',
    };
  }
  if (user.role === 'mentor') {
    return {
      ...common,
      interests: [],
      expertise: topics,
      experience: roleProfile?.experienceYears == null ? '' : `${roleProfile.experienceYears} years`,
      specialisation: roleProfile?.specialisation ?? '',
      needs: '',
      qualifications: roleProfile?.qualificationsSummary ?? '',
    };
  }
  return {
    ...common,
    interests: [],
    expertise: [],
    experience: '',
    specialisation: '',
    needs: '',
    qualifications: '',
    organization: roleProfile?.organization ?? '',
    jobTitle: roleProfile?.jobTitle ?? '',
  };
}

function userFromRow(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    passwordHash: row.password_hash,
    accountStatus: row.account_status,
    updatedAt: row.updated_at,
  };
}

function isoDate(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mentorFromRow(row) {
  const maxActiveMentees = row.max_active_mentees == null ? null : Number(row.max_active_mentees);
  const activeMentees = Number(row.active_mentees ?? 0);
  return {
    id: row.user_id,
    name: row.full_name,
    location: row.location,
    bio: row.biography,
    experienceYears: row.experience_years,
    specialisation: row.specialisation,
    qualifications: row.qualifications_summary,
    imageUrl: row.image_url,
    expertise: row.expertise ?? [],
    activeMentees,
    maxActiveMentees,
    availableSlots: maxActiveMentees === null ? null : Math.max(0, maxActiveMentees - activeMentees),
    availabilityNote: row.availability_note ?? '',
    updatedAt: isoDate(row.updated_at),
  };
}

function mentorshipRequestFromRow(row) {
  return {
    id: row.id,
    menteeId: row.mentee_user_id,
    mentorId: row.mentor_user_id,
    message: row.message,
    needs: row.needs,
    interests: row.interests,
    goals: row.goals,
    status: row.status,
    createdAt: isoDate(row.created_at),
    respondedAt: row.responded_at ? isoDate(row.responded_at) : null,
    mentee: {
      id: row.mentee_user_id,
      name: row.mentee_name,
      location: row.mentee_location,
      imageUrl: row.mentee_image_url,
      experience: row.mentee_experience_level,
      interests: row.mentee_interests ?? [],
    },
    mentor: {
      id: row.mentor_user_id,
      name: row.mentor_name,
      location: row.mentor_location,
      imageUrl: row.mentor_image_url,
      specialisation: row.mentor_specialisation,
    },
  };
}

function mentorshipRelationshipFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    menteeId: row.mentee_user_id,
    mentorId: row.mentor_user_id,
    status: row.status,
    startedAt: isoDate(row.created_at),
    endedAt: row.ended_at ? isoDate(row.ended_at) : null,
    endedByUserId: row.ended_by_user_id ?? null,
    endReason: row.end_reason ?? '',
    mentee: {
      id: row.mentee_user_id,
      name: row.mentee_name,
      location: row.mentee_location,
      imageUrl: row.mentee_image_url,
    },
    mentor: {
      id: row.mentor_user_id,
      name: row.mentor_name,
      location: row.mentor_location,
      imageUrl: row.mentor_image_url,
      specialisation: row.mentor_specialisation,
    },
  };
}

function mentorshipSessionFromRow(row) {
  return {
    id: row.id,
    relationshipId: row.relationship_id,
    title: row.title,
    scheduledAt: isoDate(row.scheduled_at),
    preparationNotes: row.preparation_notes,
    outcomeNotes: row.outcome_notes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    completedAt: row.completed_at ? isoDate(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? isoDate(row.cancelled_at) : null,
    coordinatedByStaffUserId: row.coordinated_by_staff_user_id ?? null,
    coordinatedByStaffName: row.coordinated_by_staff_name ?? null,
    menteeResponse: row.mentee_response ?? null,
    mentorResponse: row.mentor_response ?? null,
  };
}

function mentorshipGoalFromRow(row) {
  return {
    id: row.id,
    relationshipId: row.relationship_id,
    title: row.title,
    measurableOutcome: row.measurable_outcome,
    targetDate: typeof row.target_date === 'string'
      ? row.target_date
      : row.target_date.toISOString().slice(0, 10),
    status: row.status,
    createdBy: row.created_by,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    completedAt: row.completed_at ? isoDate(row.completed_at) : null,
    milestones: row.milestones ?? [],
    history: row.history ?? [],
  };
}

function createPostgresAuthRepository(pool) {
  async function findTopics(client, userId, role) {
    const table = role === 'mentor' ? 'mentor_expertise' : 'mentee_interests';
    const ownerColumn = role === 'mentor' ? 'mentor_user_id' : 'mentee_user_id';
    const result = await client.query(
      `SELECT e.name FROM ${table} relation
       JOIN expertise e ON e.id = relation.expertise_id
       WHERE relation.${ownerColumn} = $1 ORDER BY lower(e.name)`,
      [userId],
    );
    return result.rows.map((row) => row.name);
  }

  async function getProfileWithClient(client, userId, expectedRole) {
    const result = await client.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role,
        u.created_at AS user_created_at, u.updated_at AS user_updated_at,
        mp.location AS mentor_location, mp.biography AS mentor_bio,
        mp.experience_years, mp.specialisation, mp.qualifications_summary,
        mp.max_active_mentees,
        COALESCE(to_jsonb(mp)->>'availability_note', '') AS mentor_availability_note,
        (SELECT count(*)::INTEGER FROM mentorship_relationships active_relationship
         WHERE active_relationship.mentor_user_id = mp.user_id
           AND active_relationship.status = 'active') AS mentor_active_mentees,
        mp.updated_at AS mentor_updated_at,
        np.location AS mentee_location, np.biography AS mentee_bio,
        np.experience_level, np.needs, np.cloudinary_public_id AS mentee_cloudinary_public_id,
        np.image_url AS mentee_image_url, np.updated_at AS mentee_updated_at,
        mp.cloudinary_public_id AS mentor_cloudinary_public_id, mp.image_url AS mentor_image_url,
        sp.organization AS staff_organization, sp.job_title AS staff_job_title,
        sp.cloudinary_public_id AS staff_cloudinary_public_id, sp.image_url AS staff_image_url,
        sp.updated_at AS staff_updated_at
       FROM users u
       LEFT JOIN mentor_profiles mp ON mp.user_id = u.id
       LEFT JOIN mentee_profiles np ON np.user_id = u.id
       LEFT JOIN programme_staff_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1 AND u.role = $2 AND u.account_status = 'active'`,
      [userId, expectedRole],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const user = {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
    };
    const roleProfile = user.role === 'mentor'
      ? {
          location: row.mentor_location,
          bio: row.mentor_bio,
          experienceYears: row.experience_years,
          specialisation: row.specialisation,
          qualificationsSummary: row.qualifications_summary,
          maxActiveMentees: row.max_active_mentees == null ? null : Number(row.max_active_mentees),
          activeMentees: Number(row.mentor_active_mentees ?? 0),
          availabilityNote: row.mentor_availability_note ?? '',
          cloudinaryPublicId: row.mentor_cloudinary_public_id,
          imageUrl: row.mentor_image_url,
          updatedAt: row.mentor_updated_at,
        }
      : user.role === 'mentee'
        ? {
            location: row.mentee_location,
            bio: row.mentee_bio,
            experienceLevel: row.experience_level,
            needs: row.needs,
            cloudinaryPublicId: row.mentee_cloudinary_public_id,
            imageUrl: row.mentee_image_url,
            updatedAt: row.mentee_updated_at,
          }
        : {
            organization: row.staff_organization,
            jobTitle: row.staff_job_title,
            cloudinaryPublicId: row.staff_cloudinary_public_id,
            imageUrl: row.staff_image_url,
            updatedAt: row.staff_updated_at,
          };
    if (!roleProfile?.updatedAt) return null;
    const topics = user.role === 'programme_staff'
      ? []
      : await findTopics(client, userId, user.role);
    return profileFromRows(user, roleProfile, topics);
  }

  async function getMentorshipRequest(client, requestId, userId, role) {
    const result = await client.query(
      `SELECT mr.id, mr.mentee_user_id, mr.mentor_user_id, mr.message,
        mr.needs, mr.interests, mr.goals, mr.status, mr.created_at, mr.responded_at,
        mentee.full_name AS mentee_name, mentee_profile.location AS mentee_location,
        mentee_profile.image_url AS mentee_image_url,
        mentee_profile.experience_level AS mentee_experience_level,
        ARRAY(
          SELECT e.name FROM mentee_interests mi
          JOIN expertise e ON e.id = mi.expertise_id
          WHERE mi.mentee_user_id = mr.mentee_user_id ORDER BY lower(e.name)
        ) AS mentee_interests,
        mentor.full_name AS mentor_name, mentor_profile.location AS mentor_location,
        mentor_profile.image_url AS mentor_image_url,
        mentor_profile.specialisation AS mentor_specialisation
       FROM mentorship_requests mr
       JOIN users mentee ON mentee.id = mr.mentee_user_id AND mentee.account_status = 'active'
       JOIN mentee_profiles mentee_profile ON mentee_profile.user_id = mr.mentee_user_id
       JOIN users mentor ON mentor.id = mr.mentor_user_id AND mentor.account_status = 'active'
       JOIN mentor_profiles mentor_profile ON mentor_profile.user_id = mr.mentor_user_id
       WHERE mr.id = $1
         AND (($2 = 'mentee' AND mr.mentee_user_id = $3)
           OR ($2 = 'mentor' AND mr.mentor_user_id = $3))`,
      [requestId, role, userId],
    );
    return result.rows[0] ? mentorshipRequestFromRow(result.rows[0]) : null;
  }

  const mentorQuery = `
    SELECT u.id AS user_id, u.full_name, mp.location, mp.biography,
      mp.experience_years, mp.specialisation, mp.qualifications_summary,
      mp.image_url, mp.max_active_mentees, mp.updated_at,
      COALESCE(to_jsonb(mp)->>'availability_note', '') AS availability_note,
      count(DISTINCT r.id)::INTEGER AS active_mentees,
      COALESCE(array_agg(DISTINCT e.name) FILTER (WHERE e.name IS NOT NULL), ARRAY[]::TEXT[]) AS expertise
    FROM mentor_profiles mp
    JOIN users u ON u.id = mp.user_id AND u.role = 'mentor' AND u.account_status = 'active'
    LEFT JOIN mentorship_relationships r
      ON r.mentor_user_id = mp.user_id AND r.status = 'active'
    LEFT JOIN mentor_expertise me ON me.mentor_user_id = mp.user_id
    LEFT JOIN expertise e ON e.id = me.expertise_id AND e.is_active
    WHERE ($1::TEXT IS NULL
      OR concat_ws(' ', u.full_name, mp.location, mp.biography, mp.specialisation,
        mp.qualifications_summary) ILIKE $1
      OR EXISTS (
        SELECT 1 FROM mentor_expertise search_link
        JOIN expertise search_expertise ON search_expertise.id = search_link.expertise_id
        WHERE search_link.mentor_user_id = mp.user_id
          AND search_expertise.is_active AND search_expertise.name ILIKE $1
      ))
      AND ($2::TEXT IS NULL OR EXISTS (
        SELECT 1 FROM mentor_expertise expertise_link
        JOIN expertise selected_expertise ON selected_expertise.id = expertise_link.expertise_id
        WHERE expertise_link.mentor_user_id = mp.user_id
          AND selected_expertise.is_active AND lower(selected_expertise.name) = lower($2)
      ))
      AND ($3::TEXT IS NULL OR mp.location ILIKE $3)
      AND ($4::INTEGER IS NULL OR COALESCE(mp.experience_years, 0) >= $4)
    GROUP BY u.id, mp.user_id, mp.location, mp.biography, mp.experience_years,
      mp.specialisation, mp.qualifications_summary, mp.image_url,
      mp.max_active_mentees, mp.updated_at,
      COALESCE(to_jsonb(mp)->>'availability_note', '')
    HAVING mp.max_active_mentees IS NULL
      OR count(DISTINCT r.id) < mp.max_active_mentees
    ORDER BY mp.experience_years DESC NULLS LAST, lower(u.full_name)
  `;

  return {
    async checkConnection() {
      await pool.query('SELECT 1');
      return true;
    },

    async createUser(user, session) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO users (id, full_name, email, password_hash, role, account_status, phone)
           VALUES ($1, $2, $3, $4, $5, 'active', $6)
           RETURNING id, full_name, email, password_hash, role, account_status, phone, updated_at`,
          [user.id, user.fullName, user.email, user.passwordHash, user.role, user.phone],
        );
        if (user.role === 'mentee') {
          await client.query('INSERT INTO mentee_profiles (user_id) VALUES ($1)', [user.id]);
        } else if (user.role === 'mentor') {
          await client.query('INSERT INTO mentor_profiles (user_id) VALUES ($1)', [user.id]);
        } else if (user.role === 'programme_staff') {
          await client.query('INSERT INTO programme_staff_profiles (user_id) VALUES ($1)', [user.id]);
        } else {
          throw new HttpError(400, 'INVALID_ROLE', 'The account role is not supported.');
        }
        await client.query(
          `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [session.id, session.userId, session.tokenHash, session.expiresAt],
        );
        await client.query('COMMIT');
        return userFromRow(inserted.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        `SELECT id, full_name, email, password_hash, role, account_status, phone, updated_at
         FROM users WHERE lower(email) = $1`,
        [email],
      );
      return result.rows[0] ? userFromRow(result.rows[0]) : null;
    },

    async createSession(session) {
      await pool.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [session.id, session.userId, session.tokenHash, session.expiresAt],
      );
    },

    async findSession(tokenHash) {
      const result = await pool.query(
        `SELECT s.id AS session_id, u.id, u.full_name, u.email, u.phone, u.role, u.account_status, u.updated_at
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [tokenHash],
      );
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return { ...userFromRow(row), sessionId: row.session_id };
    },

    async revokeSession(tokenHash) {
      await pool.query(
        `UPDATE auth_sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      );
    },

    getProfile(userId, role) {
      return getProfileWithClient(pool, userId, role);
    },

    async getProfileImageMetadata(userId, role) {
      const profileTable = {
        mentee: 'mentee_profiles',
        mentor: 'mentor_profiles',
        programme_staff: 'programme_staff_profiles',
      }[role];
      if (!profileTable) throw new HttpError(403, 'ROLE_RESTRICTED', 'This account cannot access this profile.');
      const result = await pool.query(
        `SELECT profile.cloudinary_public_id
         FROM ${profileTable} profile
         JOIN users u ON u.id = profile.user_id
         WHERE profile.user_id = $1 AND u.role = $2 AND u.account_status = 'active'`,
        [userId, role],
      );
      return result.rows[0] ? { publicId: result.rows[0].cloudinary_public_id } : null;
    },

    async updateProfileImage(userId, role, image) {
      const profileTable = {
        mentee: 'mentee_profiles',
        mentor: 'mentor_profiles',
        programme_staff: 'programme_staff_profiles',
      }[role];
      if (!profileTable) throw new HttpError(403, 'ROLE_RESTRICTED', 'This account cannot update this profile.');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const account = await client.query(
          `SELECT id FROM users WHERE id = $1 AND role = $2 AND account_status = 'active' FOR UPDATE`,
          [userId, role],
        );
        if (!account.rows[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
        await client.query(
          `UPDATE ${profileTable}
           SET cloudinary_public_id = $2, image_url = $3, updated_at = now()
           WHERE user_id = $1`,
          [userId, image.publicId, image.secureUrl],
        );
        const profile = await getProfileWithClient(client, userId, role);
        if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
        await client.query('COMMIT');
        return profile;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async createAgriculturalImage(userId, image) {
      const result = await pool.query(
        `INSERT INTO agricultural_images
           (id, owner_user_id, cloudinary_public_id, image_url, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, owner_user_id, cloudinary_public_id, image_url, content_type, size_bytes, created_at`,
        [randomUUID(), userId, image.publicId, image.secureUrl, image.contentType, image.sizeBytes],
      );
      return agriculturalImageFromRow(result.rows[0]);
    },

    async listAgriculturalImages(userId) {
      const result = await pool.query(
        `SELECT id, owner_user_id, cloudinary_public_id, image_url, content_type, size_bytes, created_at
         FROM agricultural_images WHERE owner_user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows.map(agriculturalImageFromRow);
    },

    async getAgriculturalImage(userId, imageId) {
      const result = await pool.query(
        `SELECT id, owner_user_id, cloudinary_public_id, image_url, content_type, size_bytes, created_at
         FROM agricultural_images WHERE id = $1 AND owner_user_id = $2`,
        [imageId, userId],
      );
      return result.rows[0] ? agriculturalImageFromRow(result.rows[0]) : null;
    },

    async deleteAgriculturalImage(userId, imageId) {
      const result = await pool.query(
        `DELETE FROM agricultural_images
         WHERE id = $1 AND owner_user_id = $2
         RETURNING id`,
        [imageId, userId],
      );
      return result.rowCount === 1;
    },

    async listMentors(filters) {
      const result = await pool.query(mentorQuery, [
        filters.q ? `%${filters.q}%` : null,
        filters.expertise ?? null,
        filters.location ? `%${filters.location}%` : null,
        filters.minExperience ?? null,
      ]);
      return result.rows.map(mentorFromRow);
    },

    async getMentor(mentorId) {
      const result = await pool.query(
        `${mentorQuery.replace(
          'WHERE ($1::TEXT IS NULL',
          'WHERE u.id = $5 AND ($1::TEXT IS NULL',
        )}`,
        [null, null, null, null, mentorId],
      );
      return result.rows[0] ? mentorFromRow(result.rows[0]) : null;
    },

    async createMentorshipRequest(menteeId, request) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mentor = await client.query(
          `SELECT user_id FROM mentor_profiles
           WHERE user_id = $1 FOR SHARE`,
          [request.mentorId],
        );
        if (!mentor.rows[0]) {
          const error = new Error('Mentor profile not found.');
          error.code = 'MENTOR_NOT_FOUND';
          throw error;
        }
        const availability = await client.query(
          `SELECT mp.max_active_mentees,
            (SELECT count(*)::INTEGER FROM mentorship_relationships r
             WHERE r.mentor_user_id = mp.user_id AND r.status = 'active') AS active_mentees
           FROM mentor_profiles mp WHERE mp.user_id = $1`,
          [request.mentorId],
        );
        if (availability.rows[0].max_active_mentees !== null
          && Number(availability.rows[0].active_mentees) >= Number(availability.rows[0].max_active_mentees)) {
          const error = new Error('Mentor has reached the active mentee capacity.');
          error.code = 'MENTOR_AT_CAPACITY';
          throw error;
        }
        const inserted = await client.query(
          `INSERT INTO mentorship_requests
             (id, mentee_user_id, mentor_user_id, message, needs, interests, goals)
           SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = $3 AND role = 'mentor' AND account_status = 'active'
           )
           RETURNING id`,
          [randomUUID(), menteeId, request.mentorId, request.message, request.needs, request.interests, request.goals],
        );
        if (!inserted.rows[0]) {
          const error = new Error('Mentor profile not found.');
          error.code = 'MENTOR_NOT_FOUND';
          throw error;
        }
        const result = await getMentorshipRequest(client, inserted.rows[0].id, menteeId, 'mentee');
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMentorshipRequests(userId, role) {
      const result = await pool.query(
        `SELECT mr.id, mr.mentee_user_id, mr.mentor_user_id, mr.message,
          mr.needs, mr.interests, mr.goals, mr.status, mr.created_at, mr.responded_at,
          mentee.full_name AS mentee_name, mentee_profile.location AS mentee_location,
          mentee_profile.image_url AS mentee_image_url,
          mentee_profile.experience_level AS mentee_experience_level,
          ARRAY(
            SELECT e.name FROM mentee_interests mi
            JOIN expertise e ON e.id = mi.expertise_id
            WHERE mi.mentee_user_id = mr.mentee_user_id ORDER BY lower(e.name)
          ) AS mentee_interests,
          mentor.full_name AS mentor_name, mentor_profile.location AS mentor_location,
          mentor_profile.image_url AS mentor_image_url,
          mentor_profile.specialisation AS mentor_specialisation
         FROM mentorship_requests mr
         JOIN users mentee ON mentee.id = mr.mentee_user_id AND mentee.account_status = 'active'
         JOIN mentee_profiles mentee_profile ON mentee_profile.user_id = mr.mentee_user_id
         JOIN users mentor ON mentor.id = mr.mentor_user_id AND mentor.account_status = 'active'
         JOIN mentor_profiles mentor_profile ON mentor_profile.user_id = mr.mentor_user_id
         WHERE ($2 = 'mentee' AND mr.mentee_user_id = $1)
            OR ($2 = 'mentor' AND mr.mentor_user_id = $1)
         ORDER BY mr.created_at DESC`,
        [userId, role],
      );
      return result.rows.map(mentorshipRequestFromRow);
    },

    async updateMentorshipRequest(userId, role, requestId, status) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const requestOwner = await client.query(
          `SELECT mentee_user_id, mentor_user_id
           FROM mentorship_requests WHERE id = $1`,
          [requestId],
        );
        if (!requestOwner.rows[0]
          || (role === 'mentee' && requestOwner.rows[0].mentee_user_id !== userId)
          || (role === 'mentor' && requestOwner.rows[0].mentor_user_id !== userId)) {
          await client.query('ROLLBACK');
          return null;
        }

        if (role === 'mentor') {
          const mentor = await client.query(
            'SELECT max_active_mentees FROM mentor_profiles WHERE user_id = $1 FOR UPDATE',
            [userId],
          );
          if (!mentor.rows[0]) {
            await client.query('ROLLBACK');
            return null;
          }
        }

        const locked = await client.query(
          `SELECT id, mentee_user_id, mentor_user_id, status
           FROM mentorship_requests WHERE id = $1 FOR UPDATE`,
          [requestId],
        );
        if (!locked.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        if (locked.rows[0].status !== 'pending') {
          const error = new Error('Mentorship request is no longer pending.');
          error.code = 'REQUEST_NOT_PENDING';
          throw error;
        }

        if (status === 'accepted') {
          const capacity = await client.query(
            `SELECT mp.max_active_mentees,
              (SELECT count(*)::INTEGER FROM mentorship_relationships r
               WHERE r.mentor_user_id = mp.user_id AND r.status = 'active') AS active_mentees
             FROM mentor_profiles mp WHERE mp.user_id = $1`,
            [userId],
          );
          if (!capacity.rows[0]
            || (capacity.rows[0].max_active_mentees !== null
              && Number(capacity.rows[0].active_mentees) >= Number(capacity.rows[0].max_active_mentees))) {
            const error = new Error('Mentor has reached the active mentee capacity.');
            error.code = 'MENTOR_AT_CAPACITY';
            throw error;
          }
        }

        await client.query(
          `UPDATE mentorship_requests SET status = $2, responded_at = now()
           WHERE id = $1`,
          [requestId, status],
        );
        if (status === 'accepted') {
          await client.query(
            `INSERT INTO mentorship_relationships
               (id, request_id, mentee_user_id, mentor_user_id, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [randomUUID(), requestId, locked.rows[0].mentee_user_id, locked.rows[0].mentor_user_id],
          );
        }
        const result = await getMentorshipRequest(client, requestId, userId, role);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMentorshipRelationships(userId, role) {
      const result = await pool.query(
        `SELECT relationship.id, relationship.request_id, relationship.mentee_user_id,
          relationship.mentor_user_id, relationship.status, relationship.created_at,
          relationship.ended_at,
          (to_jsonb(relationship)->>'ended_by_user_id')::UUID AS ended_by_user_id,
          COALESCE(to_jsonb(relationship)->>'end_reason', '') AS end_reason,
          mentee.full_name AS mentee_name,
          mentee_profile.location AS mentee_location, mentee_profile.image_url AS mentee_image_url,
          mentor.full_name AS mentor_name, mentor_profile.location AS mentor_location,
          mentor_profile.image_url AS mentor_image_url,
          mentor_profile.specialisation AS mentor_specialisation
         FROM mentorship_relationships relationship
         JOIN users mentee ON mentee.id = relationship.mentee_user_id
         JOIN mentee_profiles mentee_profile ON mentee_profile.user_id = relationship.mentee_user_id
         JOIN users mentor ON mentor.id = relationship.mentor_user_id
         JOIN mentor_profiles mentor_profile ON mentor_profile.user_id = relationship.mentor_user_id
         WHERE (($2 = 'mentee' AND relationship.mentee_user_id = $1)
             OR ($2 = 'mentor' AND relationship.mentor_user_id = $1))
         ORDER BY relationship.created_at DESC`,
        [userId, role],
      );
      return result.rows.map(mentorshipRelationshipFromRow);
    },

    async endMentorshipRelationship(userId, relationshipId, reason) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ended = await client.query(
          `UPDATE mentorship_relationships
           SET status = 'ended',
               ended_at = now(),
               ended_by_user_id = $2,
               end_reason = NULLIF($3, '')
           WHERE id = $1 AND status = 'active'
             AND $2 IN (mentee_user_id, mentor_user_id)
           RETURNING id`,
          [relationshipId, userId, reason],
        );
        if (!ended.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const result = await client.query(
          `SELECT relationship.id, relationship.request_id, relationship.mentee_user_id,
            relationship.mentor_user_id, relationship.status, relationship.created_at,
            relationship.ended_at,
            (to_jsonb(relationship)->>'ended_by_user_id')::UUID AS ended_by_user_id,
            COALESCE(to_jsonb(relationship)->>'end_reason', '') AS end_reason,
            mentee.full_name AS mentee_name,
            mentee_profile.location AS mentee_location, mentee_profile.image_url AS mentee_image_url,
            mentor.full_name AS mentor_name, mentor_profile.location AS mentor_location,
            mentor_profile.image_url AS mentor_image_url,
            mentor_profile.specialisation AS mentor_specialisation
           FROM mentorship_relationships relationship
           JOIN users mentee ON mentee.id = relationship.mentee_user_id
           JOIN mentee_profiles mentee_profile ON mentee_profile.user_id = relationship.mentee_user_id
           JOIN users mentor ON mentor.id = relationship.mentor_user_id
           JOIN mentor_profiles mentor_profile ON mentor_profile.user_id = relationship.mentor_user_id
           WHERE relationship.id = $1`,
          [relationshipId],
        );
        await client.query('COMMIT');
        return mentorshipRelationshipFromRow(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMentorshipSessions(userId) {
      const result = await pool.query(
        `SELECT s.*,
                staff.full_name AS coordinated_by_staff_name,
                (SELECT response FROM programme_session_participation attendance
                  WHERE attendance.session_id = s.id
                    AND attendance.participant_user_id = relationship.mentee_user_id) AS mentee_response,
                (SELECT response FROM programme_session_participation attendance
                  WHERE attendance.session_id = s.id
                    AND attendance.participant_user_id = relationship.mentor_user_id) AS mentor_response
         FROM mentorship_sessions s
         JOIN mentorship_relationships relationship ON relationship.id = s.relationship_id
         LEFT JOIN users staff ON staff.id = s.coordinated_by_staff_user_id
         WHERE $1 IN (relationship.mentee_user_id, relationship.mentor_user_id)
         ORDER BY s.scheduled_at DESC`,
        [userId],
      );
      return result.rows.map(mentorshipSessionFromRow);
    },

    async createMentorshipSession(userId, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const relationship = await client.query(
          `SELECT id FROM mentorship_relationships
           WHERE id = $1 AND status = 'active'
             AND $2 IN (mentee_user_id, mentor_user_id)
           FOR UPDATE`,
          [input.relationshipId, userId],
        );
        if (!relationship.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const inserted = await client.query(
          `INSERT INTO mentorship_sessions
             (id, relationship_id, title, scheduled_at, preparation_notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [randomUUID(), input.relationshipId, input.title, input.scheduledAt, input.preparationNotes, userId],
        );
        await client.query('COMMIT');
        return mentorshipSessionFromRow(inserted.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateMentorshipSession(userId, sessionId, changes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE mentorship_sessions AS s
           SET title = COALESCE($3, s.title),
               scheduled_at = COALESCE($4, s.scheduled_at),
               preparation_notes = COALESCE($5, s.preparation_notes),
               outcome_notes = COALESCE($6, s.outcome_notes),
               status = COALESCE($7, s.status)
           FROM mentorship_relationships relationship
           WHERE s.id = $1
             AND relationship.id = s.relationship_id
             AND $2 IN (relationship.mentee_user_id, relationship.mentor_user_id)
             AND s.status = 'scheduled'
           RETURNING s.*`,
          [
            sessionId,
            userId,
            changes.title ?? null,
            changes.scheduledAt ?? null,
            changes.preparationNotes ?? null,
            changes.outcomeNotes ?? null,
            changes.status ?? null,
          ],
        );
        if (!updated.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query('COMMIT');
        return mentorshipSessionFromRow(updated.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMentorshipGoals(userId) {
      const result = await pool.query(
        `SELECT goal.*,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', milestone.id,
              'title', milestone.title,
              'status', milestone.status,
              'completed', milestone.status = 'completed',
              'createdAt', milestone.created_at,
              'completedAt', milestone.completed_at
            ) ORDER BY milestone.created_at, milestone.id)
            FROM mentorship_goal_milestones milestone
            WHERE milestone.goal_id = goal.id
          ), '[]'::JSONB) AS milestones,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', event.id,
              'actorUserId', event.actor_user_id,
              'type', event.event_type,
              'details', event.details,
              'createdAt', event.created_at
            ) ORDER BY event.created_at DESC, event.id)
            FROM mentorship_goal_events event
            WHERE event.goal_id = goal.id
          ), '[]'::JSONB) AS history
         FROM mentorship_goals goal
         JOIN mentorship_relationships relationship ON relationship.id = goal.relationship_id
         WHERE $1 IN (relationship.mentee_user_id, relationship.mentor_user_id)
         ORDER BY goal.created_at DESC`,
        [userId],
      );
      return result.rows.map(mentorshipGoalFromRow);
    },

    async createMentorshipGoal(userId, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const relationship = await client.query(
          `SELECT id FROM mentorship_relationships
           WHERE id = $1 AND status = 'active'
             AND $2 IN (mentee_user_id, mentor_user_id)
           FOR UPDATE`,
          [input.relationshipId, userId],
        );
        if (!relationship.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const inserted = await client.query(
          `INSERT INTO mentorship_goals
             (id, relationship_id, title, measurable_outcome, target_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [randomUUID(), input.relationshipId, input.title, input.measurableOutcome, input.targetDate, userId],
        );
        const result = await client.query(
          `SELECT goal.*,
            '[]'::JSONB AS milestones,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', event.id, 'actorUserId', event.actor_user_id, 'type', event.event_type,
                'details', event.details, 'createdAt', event.created_at
              ) ORDER BY event.created_at DESC, event.id)
              FROM mentorship_goal_events event WHERE event.goal_id = goal.id
            ), '[]'::JSONB) AS history
           FROM mentorship_goals goal WHERE goal.id = $1`,
          [inserted.rows[0].id],
        );
        await client.query('COMMIT');
        return mentorshipGoalFromRow(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateMentorshipGoal(userId, goalId, changes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owned = await client.query(
          `SELECT goal.id FROM mentorship_goals goal
           JOIN mentorship_relationships relationship ON relationship.id = goal.relationship_id
           WHERE goal.id = $1 AND relationship.status = 'active'
               AND goal.status IN ('active', 'completed')
             AND $2 IN (relationship.mentee_user_id, relationship.mentor_user_id)
           FOR UPDATE OF goal`,
          [goalId, userId],
        );
        if (!owned.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          "SELECT set_config('agri_mentor.actor_user_id', $1, true)",
          [userId],
        );
        const updated = await client.query(
          `UPDATE mentorship_goals
           SET title = COALESCE($2, title),
               measurable_outcome = COALESCE($3, measurable_outcome),
               target_date = COALESCE($4, target_date),
               status = COALESCE($5, status)
           WHERE id = $1
           RETURNING id`,
          [
            goalId,
            changes.title ?? null,
            changes.measurableOutcome ?? null,
            changes.targetDate ?? null,
            changes.status ?? null,
          ],
        );
        const result = await client.query(
          `SELECT goal.*,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', milestone.id, 'title', milestone.title, 'status', milestone.status,
                'completed', milestone.status = 'completed', 'createdAt', milestone.created_at,
                'completedAt', milestone.completed_at
              ) ORDER BY milestone.created_at, milestone.id)
              FROM mentorship_goal_milestones milestone WHERE milestone.goal_id = goal.id
            ), '[]'::JSONB) AS milestones,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', event.id, 'actorUserId', event.actor_user_id, 'type', event.event_type,
                'details', event.details, 'createdAt', event.created_at
              ) ORDER BY event.created_at DESC, event.id)
              FROM mentorship_goal_events event WHERE event.goal_id = goal.id
            ), '[]'::JSONB) AS history
           FROM mentorship_goals goal WHERE goal.id = $1`,
          [updated.rows[0].id],
        );
        await client.query('COMMIT');
        return mentorshipGoalFromRow(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async createGoalMilestone(userId, goalId, title) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const goal = await client.query(
          `SELECT goal.id FROM mentorship_goals goal
           JOIN mentorship_relationships relationship ON relationship.id = goal.relationship_id
           WHERE goal.id = $1 AND relationship.status = 'active'
             AND $2 IN (relationship.mentee_user_id, relationship.mentor_user_id)
           FOR UPDATE OF goal`,
          [goalId, userId],
        );
        if (!goal.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          `INSERT INTO mentorship_goal_milestones (id, goal_id, title, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4)`,
          [randomUUID(), goalId, title, userId],
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateGoalMilestone(userId, milestoneId, changes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE mentorship_goal_milestones milestone
           SET title = COALESCE($3, milestone.title),
               status = COALESCE($4, milestone.status),
               updated_by = $2
           FROM mentorship_goals goal
           JOIN mentorship_relationships relationship ON relationship.id = goal.relationship_id
           WHERE milestone.id = $1 AND goal.id = milestone.goal_id
             AND relationship.status = 'active'
             AND goal.status = 'active'
             AND $2 IN (relationship.mentee_user_id, relationship.mentor_user_id)
           RETURNING milestone.id`,
          [milestoneId, userId, changes.title ?? null, changes.status ?? null],
        );
        if (!updated.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateProfile(userId, role, changes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const account = await client.query(
          `SELECT id FROM users
           WHERE id = $1 AND role = $2 AND account_status = 'active'
           FOR UPDATE`,
          [userId, role],
        );
        if (!account.rows[0]) {
          throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
        }
        if (changes.fullName !== undefined || changes.phone !== undefined) {
          await client.query(
            `UPDATE users SET
               full_name = COALESCE($2, full_name),
               phone = COALESCE($3, phone),
               updated_at = now()
             WHERE id = $1`,
            [userId, changes.fullName ?? null, changes.phone ?? null],
          );
        }
        if (role === 'mentee') {
          await client.query(
            `UPDATE mentee_profiles SET
               location = COALESCE($2, location),
               biography = COALESCE($3, biography),
               needs = COALESCE($4, needs),
               experience_level = COALESCE($5, experience_level),
               updated_at = now()
             WHERE user_id = $1`,
            [userId, changes.location ?? null, changes.bio ?? null, changes.needs ?? null, changes.experience ?? null],
          );
          if (changes.interests !== undefined) {
            await client.query('DELETE FROM mentee_interests WHERE mentee_user_id = $1', [userId]);
            for (const name of changes.interests) {
              await client.query(
                `INSERT INTO expertise (id, name)
                 VALUES ($1, $2)
                 ON CONFLICT ((lower(name))) DO NOTHING`,
                [randomUUID(), name],
              );
              await client.query(
                `INSERT INTO mentee_interests (mentee_user_id, expertise_id)
                 SELECT $1, id FROM expertise WHERE lower(name) = lower($2)
                 ON CONFLICT DO NOTHING`,
                [userId, name],
              );
            }
          }
        } else if (role === 'mentor') {
          const yearsText = changes.experience;
          const years = yearsText === undefined || !yearsText.trim()
            ? null
            : Number.parseInt(yearsText.trim(), 10);
          if (yearsText !== undefined && yearsText.trim()
            && (!/^\d{1,3}(?:\s+years?)?$/i.test(yearsText.trim()) || !Number.isInteger(years) || years < 0 || years > 100)) {
            throw new HttpError(400, 'INVALID_INPUT', 'Enter mentor experience as a number of years.');
          }
          if (changes.maxActiveMentees !== undefined) {
            const capacity = await client.query(
              `SELECT max_active_mentees,
                (SELECT count(*)::INTEGER FROM mentorship_relationships
                 WHERE mentor_user_id = $1 AND status = 'active') AS active_mentees
               FROM mentor_profiles WHERE user_id = $1 FOR UPDATE`,
              [userId],
            );
            if (!capacity.rows[0]) {
              await client.query('ROLLBACK');
              return null;
            }
            if (changes.maxActiveMentees !== null
              && Number(capacity.rows[0].active_mentees) > changes.maxActiveMentees) {
              throw new HttpError(
                409,
                'MENTOR_CAPACITY_BELOW_ACTIVE_COUNT',
                'Maximum mentees cannot be lower than your current active mentorship count.',
              );
            }
          }
          await client.query(
            `UPDATE mentor_profiles SET
               location = COALESCE($2, location),
               biography = COALESCE($3, biography),
               experience_years = CASE WHEN $4 THEN $5 ELSE experience_years END,
               specialisation = COALESCE($6, specialisation),
               qualifications_summary = COALESCE($7, qualifications_summary),
               max_active_mentees = CASE WHEN $8 THEN $9 ELSE max_active_mentees END,
               updated_at = now()
             WHERE user_id = $1`,
            [
              userId,
              changes.location ?? null,
              changes.bio ?? null,
              yearsText !== undefined,
              years,
              changes.specialisation ?? null,
              changes.qualifications ?? null,
              changes.maxActiveMentees !== undefined,
              changes.maxActiveMentees ?? null,
            ],
          );
          if (changes.expertise !== undefined) {
            await client.query('DELETE FROM mentor_expertise WHERE mentor_user_id = $1', [userId]);
            for (const name of changes.expertise) {
              await client.query(
                `INSERT INTO expertise (id, name)
                 VALUES ($1, $2)
                 ON CONFLICT ((lower(name))) DO NOTHING`,
                [randomUUID(), name],
              );
              await client.query(
                `INSERT INTO mentor_expertise (mentor_user_id, expertise_id)
                 SELECT $1, id FROM expertise WHERE lower(name) = lower($2)
                 ON CONFLICT DO NOTHING`,
                [userId, name],
              );
            }
          }
          if (changes.availabilityNote !== undefined) {
            await client.query(
              'UPDATE mentor_profiles SET availability_note = $2, updated_at = now() WHERE user_id = $1',
              [userId, changes.availabilityNote],
            );
          }
        }
        if (role === 'programme_staff') {
          await client.query(
            `UPDATE programme_staff_profiles SET
               organization = COALESCE($2, organization),
               job_title = COALESCE($3, job_title),
               updated_at = now()
             WHERE user_id = $1`,
            [userId, changes.organization ?? null, changes.jobTitle ?? null],
          );
        }
        const profile = await getProfileWithClient(client, userId, role);
        await client.query('COMMIT');
        return profile;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function agriculturalImageFromRow(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    publicId: row.cloudinary_public_id,
    secureUrl: row.image_url,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at.toISOString(),
  };
}

module.exports = { createPostgresAuthRepository };
