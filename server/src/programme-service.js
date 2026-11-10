const { createHash } = require('node:crypto');
const { HttpError } = require('./http-error');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pageSizeMaximum = 50;
const programmeTables = new Set([
  'programmes',
  'programme_staff_invitations',
  'programme_staff_assignments',
  'programme_participants',
  'programme_relationships',
  'programme_requests',
  'programme_match_proposals',
  'programme_match_proposal_events',
  'programme_session_participation',
]);

function isProgrammeSchemaUnavailable(error) {
  if (error?.code === '42P01') {
    const relation = /relation "([a-z_]+)" does not exist/i.exec(error.message ?? '');
    return !!relation && programmeTables.has(relation[1]);
  }
  return false;
}

async function callProgrammeRepository(operation) {
  try {
    return await operation();
  } catch (error) {
    if (isProgrammeSchemaUnavailable(error)) {
      throw new HttpError(
        503,
        'PROGRAMME_NOT_CONFIGURED',
        'Programme oversight is unavailable until its approved database migration is applied.',
      );
    }
    throw error;
  }
}

function requireStaff(user) {
  if (user?.role !== 'programme_staff') {
    throw new HttpError(403, 'ROLE_RESTRICTED', 'Programme oversight is not available for your account role.');
  }
}

function validateUuid(value, label) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'INVALID_INPUT', `Enter a valid ${label}.`);
  }
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
    throw new HttpError(400, 'INVALID_INPUT', 'Pagination values are invalid.');
  }
  return Number(value);
}

function validateParticipantQuery(input) {
  const allowed = new Set(['q', 'role', 'status', 'page', 'pageSize']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'The participant search contains unsupported filters.');
  }
  if (input.q !== undefined && (typeof input.q !== 'string' || input.q.trim().length > 120)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Search text must be 120 characters or fewer.');
  }
  const q = input.q?.trim() ?? '';
  const role = input.role;
  if (role !== undefined && !['mentee', 'mentor'].includes(role)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Choose a valid participant role.');
  }
  const status = input.status ?? 'active';
  if (!['active', 'removed', 'all'].includes(status)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Choose a valid programme membership status.');
  }
  return {
    q,
    role,
    status,
    page: positiveInteger(input.page, 1, 1000000),
    pageSize: positiveInteger(input.pageSize, 20, pageSizeMaximum),
  };
}

function validateProgrammeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['name', 'description'].includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter a programme name and optional description.');
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = input.description === undefined ? '' : input.description;
  if (name.length < 1 || name.length > 160
    || typeof description !== 'string' || description.length > 2000) {
    throw new HttpError(400, 'INVALID_INPUT', 'Programme name must be 1 to 160 characters and description no more than 2000 characters.');
  }
  return { name, description: description.trim() };
}

function validateParticipantMembershipInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['email', 'role'].includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter a participant email and role.');
  }
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !['mentee', 'mentor'].includes(input.role)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid participant email and choose Mentee or Mentor.');
  }
  return { email, role: input.role };
}

function validateMatchProposalInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['menteeId', 'mentorId'].includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Choose one Mentee and one Mentor from this programme.');
  }
  validateUuid(input.menteeId, 'Mentee ID');
  validateUuid(input.mentorId, 'Mentor ID');
  if (input.menteeId === input.mentorId) {
    throw new HttpError(400, 'INVALID_INPUT', 'Choose two different participants.');
  }
  return { menteeId: input.menteeId, mentorId: input.mentorId };
}

function createProgrammeService(repository) {
  return {
    async createProgramme(user, input) {
      requireStaff(user);
      return callProgrammeRepository(() => (
        repository.createProgrammeForStaff(user.id, validateProgrammeInput(input))
      ));
    },

    async assignParticipant(user, programmeId, input) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      const membership = validateParticipantMembershipInput(input);
      return callProgrammeRepository(() => (
        repository.assignProgrammeParticipant(user.id, programmeId, membership.email, membership.role)
      ));
    },

    async updateParticipantMembership(user, programmeId, participantId, input) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      validateUuid(participantId, 'participant ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => key !== 'status')
        || !['active', 'removed'].includes(input.status)) {
        throw new HttpError(400, 'INVALID_INPUT', 'Choose active or removed for programme membership.');
      }
      const membership = await callProgrammeRepository(() => (
        repository.updateProgrammeParticipantMembership(user.id, programmeId, participantId, input.status)
      ));
      if (!membership) throw new HttpError(404, 'PARTICIPANT_NOT_FOUND', 'Programme participant not found.');
      return membership;
    },

    async listMatchProposals(user, programmeId) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      return callProgrammeRepository(() => repository.listProgrammeMatchProposals(user.id, programmeId));
    },

    async proposeMatch(user, programmeId, input) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      const proposal = validateMatchProposalInput(input);
      try {
        return await callProgrammeRepository(() => (
          repository.createProgrammeMatchProposal(user.id, programmeId, proposal)
        ));
      } catch (error) {
        if (error.code === '23505' || error.constraint === 'programme_match_proposal_pair_available') {
          throw new HttpError(409, 'MATCH_ALREADY_EXISTS', 'This pair already has a request, active mentorship, or open proposal.');
        }
        if (error.constraint === 'programme_match_proposal_capacity') {
          throw new HttpError(409, 'MENTOR_AT_CAPACITY', 'This Mentor has no available capacity for another proposal.');
        }
        if (error.constraint === 'programme_match_proposal_scope') {
          throw new HttpError(404, 'PARTICIPANT_NOT_FOUND', 'Both participants must have active membership in this programme.');
        }
        throw error;
      }
    },

    async withdrawMatchProposal(user, programmeId, proposalId) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      validateUuid(proposalId, 'proposal ID');
      const proposal = await callProgrammeRepository(() => (
        repository.withdrawProgrammeMatchProposal(user.id, programmeId, proposalId)
      ));
      if (!proposal) throw new HttpError(404, 'MATCH_PROPOSAL_NOT_FOUND', 'Open match proposal not found.');
      return proposal;
    },

    async respondToMatchProposal(user, proposalId, input) {
      if (!['mentee', 'mentor'].includes(user?.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Only the proposed Mentee or Mentor can respond to a match.');
      }
      validateUuid(proposalId, 'proposal ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => key !== 'response')
        || !['accepted', 'declined'].includes(input.response)) {
        throw new HttpError(400, 'INVALID_INPUT', 'Choose accepted or declined.');
      }
      try {
        const proposal = await callProgrammeRepository(() => (
          repository.respondToProgrammeMatchProposal(user.id, user.role, proposalId, input.response)
        ));
        if (!proposal) throw new HttpError(404, 'MATCH_PROPOSAL_NOT_FOUND', 'Match proposal not found.');
        return proposal;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error.code === 'MENTOR_AT_CAPACITY') {
          throw new HttpError(409, 'MENTOR_AT_CAPACITY', 'Mentor capacity changed before both participants accepted. Contact Programme Staff to review the proposal.');
        }
        if (error.code === 'MATCH_PROPOSAL_FINAL') {
          throw new HttpError(409, 'MATCH_PROPOSAL_FINAL', error.message);
        }
        if (error.code === '23505') {
          throw new HttpError(409, 'MATCH_CONFLICT', 'A request or active mentorship now exists for this pair.');
        }
        throw error;
      }
    },

    async createCoordinatedSession(user, programmeId, input) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !['relationshipId', 'title', 'scheduledAt', 'preparationNotes'].includes(key))) {
        throw new HttpError(400, 'INVALID_INPUT', 'Enter valid session scheduling details.');
      }
      validateUuid(input.relationshipId, 'relationship ID');
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const preparationNotes = input.preparationNotes === undefined ? '' : input.preparationNotes;
      const scheduledAt = typeof input.scheduledAt === 'string' ? new Date(input.scheduledAt) : null;
      if (!title || title.length > 160
        || !(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()
        || typeof preparationNotes !== 'string' || preparationNotes.length > 2000) {
        throw new HttpError(400, 'INVALID_INPUT', 'Enter a title, future session time, and notes no longer than 2000 characters.');
      }
      const session = await callProgrammeRepository(() => repository.createProgrammeSession(
        user.id,
        programmeId,
        {
          relationshipId: input.relationshipId,
          title,
          scheduledAt: scheduledAt.toISOString(),
          preparationNotes: preparationNotes.trim(),
        },
      ));
      if (!session) throw new HttpError(404, 'RELATIONSHIP_NOT_FOUND', 'An active relationship in this programme was not found.');
      return session;
    },

    async recordSessionParticipation(user, sessionId, input) {
      if (!['mentee', 'mentor'].includes(user?.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Only session participants can record their attendance.');
      }
      validateUuid(sessionId, 'session ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => key !== 'response')
        || !['attended', 'missed'].includes(input.response)) {
        throw new HttpError(400, 'INVALID_INPUT', 'Choose attended or missed.');
      }
      const participation = await callProgrammeRepository(() => (
        repository.respondToProgrammeSession(user.id, sessionId, input.response)
      ));
      if (!participation) throw new HttpError(404, 'SESSION_NOT_FOUND', 'A scheduled session for your mentorship was not found.');
      return participation;
    },

    async listParticipantMatchProposals(user) {
      if (!['mentee', 'mentor'].includes(user?.role)) {
        throw new HttpError(403, 'ROLE_RESTRICTED', 'Match proposals are only available to Mentors and Mentees.');
      }
      return callProgrammeRepository(() => repository.listParticipantMatchProposals(user.id, user.role));
    },

    async listProgrammes(user) {
      requireStaff(user);
      return callProgrammeRepository(() => repository.listStaffProgrammes(user.id));
    },

    async getDashboard(user) {
      requireStaff(user);
      return callProgrammeRepository(() => repository.getStaffDashboard(user.id));
    },

    async listParticipants(user, programmeId, input) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      return callProgrammeRepository(() => (
        repository.listProgrammeParticipants(user.id, programmeId, validateParticipantQuery(input))
      ));
    },

    async getParticipant(user, participantId) {
      requireStaff(user);
      validateUuid(participantId, 'participant ID');
      const participant = await callProgrammeRepository(() => repository.getProgrammeParticipant(user.id, participantId));
      if (!participant) throw new HttpError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found.');
      return participant;
    },

    async getOversight(user, programmeId) {
      requireStaff(user);
      validateUuid(programmeId, 'programme ID');
      return callProgrammeRepository(() => repository.getProgrammeOversight(user.id, programmeId));
    },

    async acceptInvitation(user, input) {
      requireStaff(user);
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => key !== 'token')
        || typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(input.token)) {
        throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid programme invitation.');
      }
      try {
        const tokenHash = createHash('sha256').update(input.token).digest('hex');
        return await callProgrammeRepository(() => repository.acceptProgrammeInvitation(user.id, tokenHash));
      } catch (error) {
        if (error.code === 'INVITATION_INVALID') {
          throw new HttpError(400, 'INVITATION_INVALID', 'This invitation is invalid, expired, or already used.');
        }
        throw error;
      }
    },
  };
}

module.exports = { createProgrammeService };
