const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { after, before, test } = require('node:test');

const { createApp } = require('../src/app');
const { HttpError } = require('../src/http-error');
const { createMentorshipService } = require('../src/mentorship-service');
const { createProgrammeService } = require('../src/programme-service');

const staffId = '51000000-0000-4000-8000-000000000001';
const otherStaffId = '51000000-0000-4000-8000-000000000002';
const programmeId = '52000000-0000-4000-8000-000000000001';
const unrelatedProgrammeId = '52000000-0000-4000-8000-000000000002';
const participantId = '53000000-0000-4000-8000-000000000001';
const menteeId = '54000000-0000-4000-8000-000000000001';
const mentorId = '54000000-0000-4000-8000-000000000002';
const validInvitationToken = 'valid-invitation-token-012345678901234567890';
const validInvitationHash = createHash('sha256').update(validInvitationToken).digest('hex');

const identities = {
  'staff-token': { id: staffId, role: 'programme_staff' },
  'other-staff-token': { id: otherStaffId, role: 'programme_staff' },
  'mentee-token': { id: '54000000-0000-4000-8000-000000000001', role: 'mentee' },
  'mentor-token': { id: '54000000-0000-4000-8000-000000000002', role: 'mentor' },
};

const assignedProgrammeIds = new Map([
  [staffId, new Set([programmeId])],
  [otherStaffId, new Set([unrelatedProgrammeId])],
]);
const createdProgrammes = [];
const participantMembershipChanges = [];
const matchProposals = new Map();
const repository = {
  async createProgrammeForStaff(userId, input) {
    const programme = { id: `created-${createdProgrammes.length + 1}`, ...input };
    createdProgrammes.push({ userId, programme });
    return programme;
  },
  async listStaffProgrammes(userId) {
    return [...(assignedProgrammeIds.get(userId) ?? [])].map((id) => ({ id, name: 'Assigned programme' }));
  },
  async assignProgrammeParticipant(userId, targetProgrammeId, email, role) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)) {
      throw new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
    }
    participantMembershipChanges.push({ userId, targetProgrammeId, email, role });
    return { id: participantId, role, status: 'active' };
  },
  async updateProgrammeParticipantMembership(userId, targetProgrammeId, id, status) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId) || id !== participantId) return null;
    participantMembershipChanges.push({ userId, targetProgrammeId, id, status });
    return { id, role: 'mentee', status };
  },
  async listProgrammeMatchProposals(userId, targetProgrammeId) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)) {
      throw new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
    }
    return [...matchProposals.values()].filter((proposal) => proposal.programmeId === targetProgrammeId);
  },
  async createProgrammeMatchProposal(userId, targetProgrammeId, input) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)) {
      throw new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
    }
    const proposal = {
      id: '55000000-0000-4000-8000-000000000001',
      programmeId: targetProgrammeId,
      proposedByStaffUserId: userId,
      ...input,
      status: 'proposed',
      menteeResponse: 'pending',
      mentorResponse: 'pending',
      relationshipId: null,
    };
    matchProposals.set(proposal.id, proposal);
    return proposal;
  },
  async withdrawProgrammeMatchProposal(userId, targetProgrammeId, proposalId) {
    const proposal = matchProposals.get(proposalId);
    if (!proposal || proposal.programmeId !== targetProgrammeId
      || !(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)
      || !['proposed', 'awaiting_mentor', 'awaiting_mentee'].includes(proposal.status)) return null;
    proposal.status = 'withdrawn';
    return proposal;
  },
  async listParticipantMatchProposals(userId, role) {
    return [...matchProposals.values()].filter((proposal) => proposal[`${role}Id`] === userId);
  },
  async respondToProgrammeMatchProposal(userId, role, proposalId, response) {
    const proposal = matchProposals.get(proposalId);
    if (!proposal || proposal[`${role}Id`] !== userId) return null;
    const responseKey = `${role}Response`;
    if (proposal[responseKey] !== 'pending') {
      throw Object.assign(new Error('This match proposal has already been answered.'), { code: 'MATCH_PROPOSAL_FINAL' });
    }
    proposal[responseKey] = response;
    if (response === 'declined') proposal.status = 'declined';
    else if (proposal.menteeResponse === 'accepted' && proposal.mentorResponse === 'accepted') {
      proposal.status = 'accepted';
      proposal.relationshipId = '56000000-0000-4000-8000-000000000001';
    } else proposal.status = role === 'mentee' ? 'awaiting_mentor' : 'awaiting_mentee';
    return proposal;
  },
  async getStaffDashboard(userId) {
    const programmes = await this.listStaffProgrammes(userId);
    return { summary: { programmeCount: programmes.length }, programmes, recentActivity: [] };
  },
  async listProgrammeParticipants(userId, targetProgrammeId, filters) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)) {
      throw new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
    }
    return { items: [], page: filters.page, pageSize: filters.pageSize, total: 0 };
  },
  async getProgrammeParticipant(userId, id) {
    if (userId !== staffId || id !== participantId) return null;
    return { id, role: 'mentee', programmes: [{ id: programmeId }] };
  },
  async getProgrammeOversight(userId, targetProgrammeId) {
    if (!(assignedProgrammeIds.get(userId) ?? new Set()).has(targetProgrammeId)) {
      throw new HttpError(404, 'PROGRAMME_NOT_FOUND', 'Programme not found.');
    }
    return { programme: { id: targetProgrammeId }, requests: [], relationships: [], sessions: [], goals: [] };
  },
  async acceptProgrammeInvitation(userId, token) {
    if (userId !== staffId || token !== validInvitationHash) {
      const error = new Error('invalid invitation');
      error.code = 'INVITATION_INVALID';
      throw error;
    }
    return { id: programmeId, name: 'Assigned programme' };
  },
};

const authService = {
  async authenticate(token) {
    const user = identities[token];
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return { user };
  },
  async consumeStaffInvitation() {
    throw new HttpError(400, 'INVITATION_INVALID', 'This invitation is invalid, expired, or already used.');
  },
};
const mentorshipService = createMentorshipService({});
const programmeService = createProgrammeService(repository);
const app = createApp({ corsOrigins: [], nodeEnv: 'test' }, { authService, mentorshipService, programmeService });
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, token, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

test('direct API blocks Mentees and Mentors from all Staff endpoints', async () => {
  const paths = [
    { path: '/api/staff/dashboard' },
    { path: '/api/staff/programmes' },
    { path: '/api/staff/programmes', options: { method: 'POST', body: JSON.stringify({ name: 'New programme' }) } },
    { path: `/api/staff/programmes/${programmeId}/participants`, options: { method: 'POST', body: JSON.stringify({ email: 'grower@example.test', role: 'mentee' }) } },
    { path: `/api/staff/programmes/${programmeId}/participants/${participantId}`, options: { method: 'PATCH', body: JSON.stringify({ status: 'removed' }) } },
    { path: `/api/staff/programmes/${programmeId}/match-proposals` },
    { path: `/api/staff/programmes/${programmeId}/match-proposals`, options: { method: 'POST', body: JSON.stringify({ menteeId, mentorId }) } },
    { path: `/api/staff/programmes/${programmeId}/participants` },
    { path: `/api/staff/participants/${participantId}` },
    { path: `/api/staff/programmes/${programmeId}/oversight` },
    {
      path: '/api/staff/invitations/accept',
      options: { method: 'POST', body: JSON.stringify({ token: validInvitationToken }) },
    },
  ];
  for (const token of ['mentee-token', 'mentor-token']) {
    for (const { path, options } of paths) {
      const response = await request(path, token, options);
      assert.equal(response.status, 403, `${token} ${path}`);
      assert.equal((await response.json()).error.code, 'ROLE_RESTRICTED');
    }
  }
});

test('Programme Staff can create a programme assigned only to their authenticated identity', async () => {
  const response = await request('/api/staff/programmes', 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ name: '  Soil Health Cohort  ', description: '  Field mentorship  ' }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).data, {
    id: 'created-1',
    name: 'Soil Health Cohort',
    description: 'Field mentorship',
  });
  assert.equal(createdProgrammes[0].userId, staffId);

  const invalid = await request('/api/staff/programmes', 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ name: '   ', role: 'admin' }),
  });
  assert.equal(invalid.status, 400);
});

test('Programme Staff can explicitly assign and remove participants only within assigned programmes', async () => {
  const assigned = await request(`/api/staff/programmes/${programmeId}/participants`, 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ email: '  GROWER@example.test ', role: 'mentee' }),
  });
  assert.equal(assigned.status, 201);
  assert.deepEqual((await assigned.json()).data, { id: participantId, role: 'mentee', status: 'active' });
  assert.equal(participantMembershipChanges.at(-1).email, 'grower@example.test');
  assert.equal(participantMembershipChanges.at(-1).userId, staffId);

  const removed = await request(`/api/staff/programmes/${programmeId}/participants/${participantId}`, 'staff-token', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'removed' }),
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).data.status, 'removed');

  const unrelated = await request(`/api/staff/programmes/${unrelatedProgrammeId}/participants`, 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ email: 'grower@example.test', role: 'mentee' }),
  });
  assert.equal(unrelated.status, 404);

  const invalidRole = await request(`/api/staff/programmes/${programmeId}/participants`, 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ email: 'grower@example.test', role: 'programme_staff' }),
  });
  assert.equal(invalidRole.status, 400);
});

test('Staff coordinates a proposal and only both named participants can activate the mentorship', async () => {
  const proposalPath = `/api/staff/programmes/${programmeId}/match-proposals`;
  const created = await request(proposalPath, 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ menteeId, mentorId }),
  });
  assert.equal(created.status, 201);
  const proposal = (await created.json()).data;
  assert.equal(proposal.proposedByStaffUserId, staffId);
  assert.equal(proposal.status, 'proposed');

  const staffResponse = await request(`/api/mentorship/match-proposals/${proposal.id}`, 'staff-token', {
    method: 'PATCH',
    body: JSON.stringify({ response: 'accepted' }),
  });
  assert.equal(staffResponse.status, 403);

  const menteeResponse = await request(`/api/mentorship/match-proposals/${proposal.id}`, 'mentee-token', {
    method: 'PATCH',
    body: JSON.stringify({ response: 'accepted' }),
  });
  assert.equal((await menteeResponse.json()).data.status, 'awaiting_mentor');

  const mentorResponse = await request(`/api/mentorship/match-proposals/${proposal.id}`, 'mentor-token', {
    method: 'PATCH',
    body: JSON.stringify({ response: 'accepted' }),
  });
  const accepted = (await mentorResponse.json()).data;
  assert.equal(accepted.status, 'accepted');
  assert.ok(accepted.relationshipId);

  const mismatchedParticipant = await request(`/api/mentorship/match-proposals/${proposal.id}`, 'other-staff-token', {
    method: 'PATCH',
    body: JSON.stringify({ response: 'accepted' }),
  });
  assert.equal(mismatchedParticipant.status, 403);
});

test('Staff dashboard and programme list use the authenticated staff identity', async () => {
  const dashboard = await request('/api/staff/dashboard', 'staff-token');
  assert.equal(dashboard.status, 200);
  assert.deepEqual((await dashboard.json()).data.summary, { programmeCount: 1 });
  const programmes = await request('/api/staff/programmes', 'staff-token');
  assert.deepEqual((await programmes.json()).data.map((item) => item.id), [programmeId]);
});

test('direct API hides unassigned programme data and unrelated participant records', async () => {
  const participants = await request(`/api/staff/programmes/${unrelatedProgrammeId}/participants`, 'staff-token');
  assert.equal(participants.status, 404);
  assert.equal((await participants.json()).error.code, 'PROGRAMME_NOT_FOUND');
  const oversight = await request(`/api/staff/programmes/${unrelatedProgrammeId}/oversight`, 'staff-token');
  assert.equal(oversight.status, 404);
  const participant = await request('/api/staff/participants/53000000-0000-4000-8000-000000000099', 'staff-token');
  assert.equal(participant.status, 404);
});

test('Staff assigned to multiple programmes receive only their own programme scope', async () => {
  assignedProgrammeIds.set(staffId, new Set([programmeId, unrelatedProgrammeId]));
  try {
    const response = await request('/api/staff/programmes', 'staff-token');
    assert.deepEqual((await response.json()).data.map((item) => item.id), [programmeId, unrelatedProgrammeId]);
  } finally {
    assignedProgrammeIds.set(staffId, new Set([programmeId]));
  }
});

test('Staff list pagination and filters are validated through the direct API', async () => {
  const valid = await request(`/api/staff/programmes/${programmeId}/participants?page=2&pageSize=10&role=mentee`, 'staff-token');
  assert.equal(valid.status, 200);
  assert.deepEqual((await valid.json()).data, { items: [], page: 2, pageSize: 10, total: 0 });
  const invalid = await request(`/api/staff/programmes/${programmeId}/participants?page=0`, 'staff-token');
  assert.equal(invalid.status, 400);
});

test('new Staff invitation consumption is handled only by the authentication endpoint', async () => {
  const response = await request('/api/auth/staff-invitations/consume', null, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVITATION_INVALID');
  const oldRoute = await request('/api/staff/invitations/consume', null, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(oldRoute.status, 404);
});

test('only missing programme scope tables are reported as an unapplied programme migration', async () => {
  for (const error of [
    Object.assign(new Error('relation "programme_staff_assignments" does not exist'), { code: '42P01' }),
  ]) {
    const service = createProgrammeService({
      async listStaffProgrammes() { throw error; },
    });
    await assert.rejects(service.listProgrammes({ id: staffId, role: 'programme_staff' }), (cause) => {
      assert.equal(cause.status, 503);
      assert.equal(cause.code, 'PROGRAMME_NOT_CONFIGURED');
      return true;
    });
  }

  for (const error of [
    Object.assign(new Error('relation "users" does not exist'), { code: '42P01' }),
    Object.assign(new Error('column "status" does not exist'), { code: '42703', column: 'status' }),
    Object.assign(new Error('database connection failed'), { code: 'ECONNREFUSED' }),
  ]) {
    const service = createProgrammeService({
      async listStaffProgrammes() { throw error; },
    });
    await assert.rejects(service.listProgrammes({ id: staffId, role: 'programme_staff' }), (cause) => {
      assert.equal(cause, error);
      assert.notEqual(cause.code, 'PROGRAMME_NOT_CONFIGURED');
      return true;
    });
  }
});

test('Staff invitation acceptance hashes tokens and rejects malformed, expired or reused invitations', async () => {
  const malformed = await request('/api/staff/invitations/accept', 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ token: 'bad' }),
  });
  assert.equal(malformed.status, 400);
  const accepted = await request('/api/staff/invitations/accept', 'staff-token', {
    method: 'POST',
    body: JSON.stringify({ token: validInvitationToken }),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).data.id, programmeId);
  const invalid = await request('/api/staff/invitations/accept', 'other-staff-token', {
    method: 'POST',
    body: JSON.stringify({ token: validInvitationToken }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVITATION_INVALID');
});

test('Staff oversight endpoints are read-only and cannot accept participant requests', async () => {
  const response = await request('/api/mentorship/requests/55000000-0000-4000-8000-000000000001', 'staff-token', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ROLE_RESTRICTED');
});
