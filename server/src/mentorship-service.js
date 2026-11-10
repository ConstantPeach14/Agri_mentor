const { HttpError } = require('./http-error');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestStatuses = new Set(['accepted', 'declined', 'cancelled']);
const mentorshipMigrationColumns = new Set([
  'max_active_mentees',
  'ended_by_user_id',
  'end_reason',
]);
const mentorshipTables = new Set([
  'mentorship_requests',
  'mentorship_relationships',
  'mentorship_sessions',
  'mentorship_goals',
  'mentorship_goal_milestones',
  'mentorship_goal_events',
]);

function isMentorshipMigrationUnavailable(error) {
  if (error?.code === '42703') {
    return mentorshipMigrationColumns.has(error.column)
      || [...mentorshipMigrationColumns].some((column) => error.message?.includes(`column "${column}"`));
  }
  if (error?.code !== '42P01') return false;
  const missingRelation = /relation "([a-z_]+)" does not exist/i.exec(error.message ?? '');
  return !!missingRelation && mentorshipTables.has(missingRelation[1]);
}

async function callMentorshipRepository(operation) {
  try {
    return await operation();
  } catch (error) {
    if (isMentorshipMigrationUnavailable(error)) {
      throw new HttpError(
        503,
        'MENTORSHIP_NOT_CONFIGURED',
        'This mentorship feature is awaiting its required database migration.',
      );
    }
    throw error;
  }
}

function requireRole(user, role) {
  if (user.role !== role) {
    throw new HttpError(403, 'ROLE_RESTRICTED', 'This action is not available for your account role.');
  }
}

function validateUuid(value, label) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'INVALID_INPUT', `Enter a valid ${label}.`);
  }
}

function validateSearch(input) {
  const supportedFields = new Set(['q', 'expertise', 'location', 'minExperience']);
  if (Object.keys(input).some((field) => !supportedFields.has(field))) {
    throw new HttpError(400, 'INVALID_INPUT', 'The mentor search contains an unsupported filter.');
  }
  const search = {};
  for (const field of ['q', 'expertise', 'location']) {
    const value = input[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.trim().length > 120) {
        throw new HttpError(400, 'INVALID_INPUT', `The ${field} filter must be 120 characters or fewer.`);
      }
      if (value.trim()) search[field] = value.trim();
    }
  }
  if (input.minExperience !== undefined) {
    const value = Number(input.minExperience);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new HttpError(400, 'INVALID_INPUT', 'Minimum experience must be a whole number from 0 to 100.');
    }
    search.minExperience = value;
  }
  return search;
}

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter valid mentorship request details.');
  }
  const supportedFields = new Set(['mentorId', 'message', 'needs', 'interests', 'goals']);
  if (Object.keys(input).some((field) => !supportedFields.has(field))) {
    throw new HttpError(400, 'INVALID_INPUT', 'The mentorship request contains unsupported fields.');
  }
  validateUuid(input.mentorId, 'mentor ID');
  const fields = {};
  for (const field of ['message', 'needs', 'interests', 'goals']) {
    const value = input[field] ?? '';
    const maximum = field === 'message' ? 2000 : 1000;
    if (typeof value !== 'string' || value.trim().length > maximum) {
      throw new HttpError(400, 'INVALID_INPUT', `The ${field} field must be ${maximum} characters or fewer.`);
    }
    fields[field] = value.trim();
  }
  if (!fields.message) {
    throw new HttpError(400, 'INVALID_INPUT', 'Add a message for the mentor.');
  }
  return { mentorId: input.mentorId, ...fields };
}

function validateManagementInput(input, supportedFields, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((field) => !supportedFields.has(field))) {
    throw new HttpError(400, 'INVALID_INPUT', `Enter valid ${label} details.`);
  }
}

function validateText(value, field, maximum, { required = false } = {}) {
  if (typeof value !== 'string' || value.trim().length > maximum
    || (required && !value.trim())) {
    throw new HttpError(400, 'INVALID_INPUT', `The ${field} field must be ${required ? 'non-empty and ' : ''}${maximum} characters or fewer.`);
  }
  return value.trim();
}

function validateDateTime(value, field) {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
    : null;
  if (!match) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid future ISO date and time.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
    || parsed.getTime() <= Date.now()) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid future ISO date and time.`);
  }
  return parsed.toISOString();
}

function validateDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function requireMentorshipParticipant(user) {
  if (!['mentee', 'mentor'].includes(user.role)) {
    throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentorship management is not available for your account role.');
  }
}

function createMentorshipService(repository) {
  return {
    async listMentors(user, input) {
      requireRole(user, 'mentee');
      const filters = validateSearch(input);
      return callMentorshipRepository(() => repository.listMentors(filters));
    },

    async getMentor(user, mentorId) {
      requireRole(user, 'mentee');
      validateUuid(mentorId, 'mentor ID');
      const mentor = await callMentorshipRepository(() => repository.getMentor(mentorId));
      if (!mentor) throw new HttpError(404, 'MENTOR_NOT_FOUND', 'Mentor profile not found.');
      return mentor;
    },

    async listRequests(user) {
      if (!['mentee', 'mentor'].includes(user.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentorship requests are not available for your account role.');
      }
      return callMentorshipRepository(() => repository.listMentorshipRequests(user.id, user.role));
    },

    async createRequest(user, input) {
      requireRole(user, 'mentee');
      const request = validateRequest(input);
      try {
        return await callMentorshipRepository(() => repository.createMentorshipRequest(user.id, request));
      } catch (error) {
        if (error.code === 'MENTOR_AT_CAPACITY') {
          throw new HttpError(409, 'MENTOR_AT_CAPACITY', 'This mentor has reached their active mentee capacity.');
        }
        if (error.code === '23505' || error.code === 'REQUEST_EXISTS') {
          throw new HttpError(409, 'REQUEST_EXISTS', 'A pending request or active mentorship already exists with this mentor.');
        }
        if (error.code === '23503' || error.code === 'MENTOR_NOT_FOUND') {
          throw new HttpError(404, 'MENTOR_NOT_FOUND', 'Mentor profile not found.');
        }
        throw error;
      }
    },

    async updateRequest(user, requestId, input) {
      validateUuid(requestId, 'request ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((field) => field !== 'status')) {
        throw new HttpError(400, 'INVALID_INPUT', 'Provide only a request status.');
      }
      const { status } = input;
      if (!requestStatuses.has(status)) {
        throw new HttpError(400, 'INVALID_INPUT', 'Choose a supported request status.');
      }
      if (user.role === 'mentee' && status !== 'cancelled') {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentees can only cancel their pending requests.');
      }
      if (user.role === 'mentor' && !['accepted', 'declined'].includes(status)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentors can only accept or decline their incoming requests.');
      }
      if (!['mentee', 'mentor'].includes(user.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentorship requests are not available for your account role.');
      }
      try {
        const request = await callMentorshipRepository(
          () => repository.updateMentorshipRequest(user.id, user.role, requestId, status),
        );
        if (!request) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Mentorship request not found.');
        return request;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error.code === 'MENTOR_AT_CAPACITY' || error.constraint === 'mentorship_capacity_check') {
          throw new HttpError(409, 'MENTOR_AT_CAPACITY', 'This mentor has reached their active mentee capacity.');
        }
        if (error.code === 'REQUEST_NOT_PENDING' || error.code === '23505') {
          throw new HttpError(409, 'REQUEST_NOT_PENDING', 'This request has already been answered or a relationship already exists.');
        }
        throw error;
      }
    },

    async listRelationships(user) {
      if (!['mentee', 'mentor'].includes(user.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Mentorship relationships are not available for your account role.');
      }
      return callMentorshipRepository(() => repository.listMentorshipRelationships(user.id, user.role));
    },

    async endRelationship(user, relationshipId, input) {
      requireMentorshipParticipant(user);
      validateUuid(relationshipId, 'relationship ID');
      validateManagementInput(input, new Set(['reason']), 'relationship end');
      const reason = input.reason === undefined
        ? ''
        : validateText(input.reason, 'reason', 1000);
      const relationship = await callMentorshipRepository(
        () => repository.endMentorshipRelationship(user.id, relationshipId, reason),
      );
      if (!relationship) {
        throw new HttpError(404, 'RELATIONSHIP_NOT_FOUND', 'Active mentorship relationship not found.');
      }
      return relationship;
    },

    async listSessions(user) {
      requireMentorshipParticipant(user);
      return callMentorshipRepository(() => repository.listMentorshipSessions(user.id));
    },

    async createSession(user, input) {
      requireMentorshipParticipant(user);
      validateManagementInput(
        input,
        new Set(['relationshipId', 'title', 'scheduledAt', 'preparationNotes']),
        'session',
      );
      validateUuid(input.relationshipId, 'relationship ID');
      const session = await callMentorshipRepository(() => repository.createMentorshipSession(user.id, {
        relationshipId: input.relationshipId,
        title: validateText(input.title, 'title', 160, { required: true }),
        scheduledAt: validateDateTime(input.scheduledAt, 'Session date and time'),
        preparationNotes: validateText(input.preparationNotes ?? '', 'preparation notes', 2000),
      }));
      if (!session) throw new HttpError(404, 'RELATIONSHIP_NOT_FOUND', 'An active mentorship relationship was not found.');
      return session;
    },

    async updateSession(user, sessionId, input) {
      requireMentorshipParticipant(user);
      validateUuid(sessionId, 'session ID');
      validateManagementInput(
        input,
        new Set(['title', 'scheduledAt', 'preparationNotes', 'outcomeNotes', 'status']),
        'session update',
      );
      const changes = {};
      if (input.title !== undefined) changes.title = validateText(input.title, 'title', 160, { required: true });
      if (input.scheduledAt !== undefined) changes.scheduledAt = validateDateTime(input.scheduledAt, 'Session date and time');
      if (input.preparationNotes !== undefined) changes.preparationNotes = validateText(input.preparationNotes, 'preparation notes', 2000);
      if (input.outcomeNotes !== undefined) changes.outcomeNotes = validateText(input.outcomeNotes, 'outcome notes', 4000);
      if (input.status !== undefined) {
        if (!['completed', 'cancelled'].includes(input.status)) {
          throw new HttpError(400, 'INVALID_INPUT', 'Choose completed or cancelled for a scheduled session.');
        }
        changes.status = input.status;
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'INVALID_INPUT', 'Provide at least one session change.');
      const session = await callMentorshipRepository(
        () => repository.updateMentorshipSession(user.id, sessionId, changes),
      );
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found or no longer editable.');
      return session;
    },

    async listGoals(user) {
      requireMentorshipParticipant(user);
      return callMentorshipRepository(() => repository.listMentorshipGoals(user.id));
    },

    async createGoal(user, input) {
      requireMentorshipParticipant(user);
      validateManagementInput(
        input,
        new Set(['relationshipId', 'title', 'measurableOutcome', 'targetDate']),
        'goal',
      );
      validateUuid(input.relationshipId, 'relationship ID');
      const goal = await callMentorshipRepository(() => repository.createMentorshipGoal(user.id, {
        relationshipId: input.relationshipId,
        title: validateText(input.title, 'title', 160, { required: true }),
        measurableOutcome: validateText(input.measurableOutcome, 'measurable outcome', 2000, { required: true }),
        targetDate: validateDate(input.targetDate, 'Target date'),
      }));
      if (!goal) throw new HttpError(404, 'RELATIONSHIP_NOT_FOUND', 'An active mentorship relationship was not found.');
      return goal;
    },

    async updateGoal(user, goalId, input) {
      requireMentorshipParticipant(user);
      validateUuid(goalId, 'goal ID');
      validateManagementInput(
        input,
        new Set(['title', 'measurableOutcome', 'targetDate', 'status']),
        'goal update',
      );
      const changes = {};
      if (input.title !== undefined) changes.title = validateText(input.title, 'title', 160, { required: true });
      if (input.measurableOutcome !== undefined) {
        changes.measurableOutcome = validateText(input.measurableOutcome, 'measurable outcome', 2000, { required: true });
      }
      if (input.targetDate !== undefined) changes.targetDate = validateDate(input.targetDate, 'Target date');
      if (input.status !== undefined) {
        if (!['active', 'completed', 'archived'].includes(input.status)) {
          throw new HttpError(400, 'INVALID_INPUT', 'Choose active, completed, or archived for a goal.');
        }
        changes.status = input.status;
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'INVALID_INPUT', 'Provide at least one goal change.');
      const goal = await callMentorshipRepository(() => repository.updateMentorshipGoal(user.id, goalId, changes));
      if (!goal) throw new HttpError(404, 'GOAL_NOT_FOUND', 'Goal not found or its relationship is no longer active.');
      return goal;
    },

    async createMilestone(user, goalId, input) {
      requireMentorshipParticipant(user);
      validateUuid(goalId, 'goal ID');
      validateManagementInput(input, new Set(['title']), 'milestone');
      const created = await callMentorshipRepository(() => repository.createGoalMilestone(
        user.id,
        goalId,
        validateText(input.title, 'milestone title', 240, { required: true }),
      ));
      if (!created) throw new HttpError(404, 'GOAL_NOT_FOUND', 'Goal not found or its relationship is no longer active.');
      return { created: true };
    },

    async updateMilestone(user, milestoneId, input) {
      requireMentorshipParticipant(user);
      validateUuid(milestoneId, 'milestone ID');
      validateManagementInput(input, new Set(['title', 'status']), 'milestone update');
      const changes = {};
      if (input.title !== undefined) changes.title = validateText(input.title, 'milestone title', 240, { required: true });
      if (input.status !== undefined) {
        if (!['pending', 'completed'].includes(input.status)) {
          throw new HttpError(400, 'INVALID_INPUT', 'Choose pending or completed for a milestone.');
        }
        changes.status = input.status;
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'INVALID_INPUT', 'Provide a milestone title or status.');
      const updated = await callMentorshipRepository(
        () => repository.updateGoalMilestone(user.id, milestoneId, changes),
      );
      if (!updated) throw new HttpError(404, 'MILESTONE_NOT_FOUND', 'Milestone not found or its relationship is no longer active.');
      return { updated: true };
    },
  };
}

module.exports = {
  createMentorshipService,
  isMentorshipMigrationUnavailable,
  validateRequest,
  validateSearch,
};
