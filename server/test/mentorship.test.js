const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

const { createApp } = require('../src/app');
const { createMentorshipService } = require('../src/mentorship-service');

const menteeId = 'a0a00000-0000-4000-8000-000000000001';
const secondMenteeId = 'a0a00000-0000-4000-8000-000000000002';
const mentorId = 'b0b00000-0000-4000-8000-000000000001';
const otherMentorId = 'b0b00000-0000-4000-8000-000000000002';

function createMemoryRepository() {
  const mentors = [
    {
      id: mentorId,
      name: 'Ama Kofi',
      location: 'Accra',
      bio: 'Soil and crop advisor.',
      experience: '12 years',
      expertise: ['Soil health', 'Horticulture'],
      availableSlots: 1,
      imageUrl: 'https://images.example.test/ama.jpg',
    },
    {
      id: otherMentorId,
      name: 'Kojo Mensah',
      location: 'Kumasi',
      bio: 'Irrigation mentor.',
      experience: '8 years',
      expertise: ['Irrigation'],
      availableSlots: 2,
      imageUrl: null,
    },
  ];
  const mentees = new Map([
    [menteeId, { id: menteeId, name: 'Mina Grower', location: 'Accra', imageUrl: null, experience: 'New grower', interests: ['Soil health'] }],
    [secondMenteeId, { id: secondMenteeId, name: 'Nii Farmer', location: 'Tema', imageUrl: null, experience: 'Early-stage', interests: [] }],
  ]);
  const requests = [];
  const relationships = [];
  const repository = {
    async listMentors(filters) {
      return mentors.filter((mentor) => {
        const terms = `${mentor.name} ${mentor.location} ${mentor.bio} ${mentor.expertise.join(' ')}`.toLowerCase();
        return (!filters.q || terms.includes(filters.q.toLowerCase()))
          && (!filters.expertise || mentor.expertise.some((item) => item.toLowerCase() === filters.expertise.toLowerCase()))
          && (!filters.location || mentor.location.toLowerCase().includes(filters.location.toLowerCase()));
      });
    },
    async getMentor(id) {
      return mentors.find((mentor) => mentor.id === id) ?? null;
    },
    async createMentorshipRequest(id, input) {
      const mentor = mentors.find((item) => item.id === input.mentorId);
      if (!mentor) {
        const error = new Error('Mentor not found');
        error.code = 'MENTOR_NOT_FOUND';
        throw error;
      }
      if (relationships.filter((item) => item.mentorId === mentor.id && item.status === 'active').length >= mentor.availableSlots) {
        const error = new Error('Capacity reached');
        error.code = 'MENTOR_AT_CAPACITY';
        throw error;
      }
      if (requests.some((item) => item.menteeId === id && item.mentorId === mentor.id && ['pending', 'accepted'].includes(item.status))) {
        const error = new Error('Duplicate request');
        error.code = '23505';
        throw error;
      }
      const mentee = mentees.get(id);
      const request = {
        id: randomUUID(),
        menteeId: id,
        mentorId: mentor.id,
        message: input.message,
        needs: input.needs,
        interests: input.interests,
        goals: input.goals,
        status: 'pending',
        createdAt: new Date().toISOString(),
        respondedAt: null,
        mentee,
        mentor: { id: mentor.id, name: mentor.name, location: mentor.location, imageUrl: mentor.imageUrl },
      };
      requests.push(request);
      return request;
    },
    async listMentorshipRequests(id, role) {
      return requests.filter((item) => role === 'mentee' ? item.menteeId === id : item.mentorId === id);
    },
    async updateMentorshipRequest(id, role, requestId, status) {
      const request = requests.find((item) => item.id === requestId
        && (role === 'mentee' ? item.menteeId === id : item.mentorId === id));
      if (!request) return null;
      if (request.status !== 'pending') {
        const error = new Error('Request is no longer pending');
        error.code = 'REQUEST_NOT_PENDING';
        throw error;
      }
      if (status === 'accepted') {
        const mentor = mentors.find((item) => item.id === request.mentorId);
        if (relationships.filter((item) => item.mentorId === id && item.status === 'active').length >= mentor.availableSlots) {
          const error = new Error('Capacity reached');
          error.code = 'MENTOR_AT_CAPACITY';
          throw error;
        }
        request.status = 'accepted';
        request.respondedAt = new Date().toISOString();
        relationships.push({
          id: randomUUID(),
          requestId,
          menteeId: request.menteeId,
          mentorId: request.mentorId,
          status: 'active',
          startedAt: request.respondedAt,
          endedAt: null,
          mentee: request.mentee,
          mentor: request.mentor,
        });
      } else {
        request.status = status;
        request.respondedAt = new Date().toISOString();
      }
      return request;
    },
    async listMentorshipRelationships(id, role) {
      return relationships.filter((item) => role === 'mentee'
        ? item.menteeId === id
        : item.mentorId === id);
    },
    async endMentorshipRelationship(id, relationshipId, reason) {
      const relationship = relationships.find((item) => item.id === relationshipId
        && item.status === 'active'
        && [item.menteeId, item.mentorId].includes(id));
      if (!relationship) return null;
      relationship.status = 'ended';
      relationship.endedAt = new Date().toISOString();
      relationship.endedByUserId = id;
      relationship.endReason = reason;
      return relationship;
    },
  };
  return { repository, requests, relationships };
}

const { repository, requests, relationships } = createMemoryRepository();
const users = new Map([
  ['mentee-token-000000000000000000000000000000000000000000', { id: menteeId, role: 'mentee' }],
  ['second-mentee-token-000000000000000000000000000000000000', { id: secondMenteeId, role: 'mentee' }],
  ['mentor-token-0000000000000000000000000000000000000000000', { id: mentorId, role: 'mentor' }],
  ['other-mentor-token-00000000000000000000000000000000000', { id: otherMentorId, role: 'mentor' }],
]);
const authService = {
  async authenticate(token) {
    const user = users.get(token);
    if (!user) {
      const error = new Error('Unauthenticated');
      error.status = 401;
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    return { user, sessionId: `session-${user.id}` };
  },
};
let server;
let baseUrl;

before(async () => {
  const app = createApp(
    { corsOrigins: [], nodeEnv: 'test' },
    { authService, mentorshipService: createMentorshipService(repository) },
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const menteeToken = 'mentee-token-000000000000000000000000000000000000000000';
const secondMenteeToken = 'second-mentee-token-000000000000000000000000000000000000';
const mentorToken = 'mentor-token-0000000000000000000000000000000000000000000';
const otherMentorToken = 'other-mentor-token-00000000000000000000000000000000000';
const firstRequest = {
  mentorId,
  message: 'I would value practical advice as I start growing vegetables.',
  needs: 'Help planning a small vegetable plot.',
  interests: 'Soil health, horticulture',
  goals: 'Build a seasonal growing plan.',
};

test('mentor discovery requires authentication and enforces the mentee role', async () => {
  const unauthorized = await request('/api/mentors');
  assert.equal(unauthorized.status, 401);

  const denied = await request('/api/mentors', { token: mentorToken });
  assert.equal(denied.status, 403);

  const response = await request('/api/mentors?q=soil&expertise=Soil%20health', { token: menteeToken });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'Ama Kofi');
  assert.equal(data[0].imageUrl, 'https://images.example.test/ama.jpg');
  assert.equal('email' in data[0], false);
});

test('mentees can read a mentor profile and invalid IDs receive a client error', async () => {
  const response = await request(`/api/mentors/${mentorId}`, { token: menteeToken });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.expertise.includes('Horticulture'), true);

  const invalid = await request('/api/mentors/not-a-uuid', { token: menteeToken });
  assert.equal(invalid.status, 400);
});

test('request submission validates fields, rejects duplicates, and exposes only owner lists', async () => {
  const invalid = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, message: '' },
  });
  assert.equal(invalid.status, 400);

  const whitespaceMessage = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, message: ' \t\n ' },
  });
  assert.equal(whitespaceMessage.status, 400);

  const oversizedMessage = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, message: 'x'.repeat(2001) },
  });
  assert.equal(oversizedMessage.status, 400);

  const unsupportedField = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, accountRole: 'mentor' },
  });
  assert.equal(unsupportedField.status, 400);

  const submitted = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, message: ` ${firstRequest.message} ` },
  });
  assert.equal(submitted.status, 201);
  const { data: created } = await submitted.json();
  assert.equal(created.status, 'pending');
  assert.equal(created.message, firstRequest.message);
  assert.equal(created.needs, firstRequest.needs);

  const duplicate = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: firstRequest,
  });
  assert.equal(duplicate.status, 409);

  const menteeList = await request('/api/mentorship/requests', { token: menteeToken });
  assert.deepEqual((await menteeList.json()).data.map((item) => item.id), [created.id]);
  const mentorList = await request('/api/mentorship/requests', { token: mentorToken });
  assert.deepEqual((await mentorList.json()).data.map((item) => item.id), [created.id]);

  const unauthorizedCancel = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: secondMenteeToken,
    body: { status: 'cancelled' },
  });
  assert.equal(unauthorizedCancel.status, 404);
  const wrongRole = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: mentorToken,
    body: { status: 'cancelled' },
  });
  assert.equal(wrongRole.status, 403);

  const unsupportedUpdate = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: mentorToken,
    body: { status: 'accepted', menteeId },
  });
  assert.equal(unsupportedUpdate.status, 400);
});

test('only the addressed mentor can accept, and acceptance creates a relationship visible to both users', async () => {
  const created = requests[0];
  const wrongMentor = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: otherMentorToken,
    body: { status: 'accepted' },
  });
  assert.equal(wrongMentor.status, 404);

  const accepted = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: mentorToken,
    body: { status: 'accepted' },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).data.status, 'accepted');
  assert.equal(relationships.length, 1);

  const menteeRelationships = await request('/api/mentorship/relationships', { token: menteeToken });
  const mentorRelationships = await request('/api/mentorship/relationships', { token: mentorToken });
  assert.equal((await menteeRelationships.json()).data[0].mentorId, mentorId);
  assert.equal((await mentorRelationships.json()).data[0].menteeId, menteeId);

  const repeatedResponse = await request(`/api/mentorship/requests/${created.id}`, {
    method: 'PATCH',
    token: mentorToken,
    body: { status: 'declined' },
  });
  assert.equal(repeatedResponse.status, 409);

  const atCapacity = await request('/api/mentorship/requests', {
    method: 'POST',
    token: secondMenteeToken,
    body: { ...firstRequest, mentorId },
  });
  assert.equal(atCapacity.status, 409);
  assert.equal((await atCapacity.json()).error.code, 'MENTOR_AT_CAPACITY');
});

test('either relationship participant can end it, and both participants retain its history', async () => {
  const relationship = relationships[0];
  const unauthorized = await request(`/api/mentorship/relationships/${relationship.id}`, {
    method: 'PATCH',
    token: secondMenteeToken,
    body: { reason: 'Wrong account' },
  });
  assert.equal(unauthorized.status, 404);

  const ended = await request(`/api/mentorship/relationships/${relationship.id}`, {
    method: 'PATCH',
    token: mentorToken,
    body: { reason: 'The growing season is complete.' },
  });
  assert.equal(ended.status, 200);
  const endedRelationship = (await ended.json()).data;
  assert.equal(endedRelationship.status, 'ended');
  assert.equal(endedRelationship.endedByUserId, mentorId);
  assert.equal(endedRelationship.endReason, 'The growing season is complete.');
  assert.ok(endedRelationship.endedAt);

  const menteeHistory = await request('/api/mentorship/relationships', { token: menteeToken });
  const mentorHistory = await request('/api/mentorship/relationships', { token: mentorToken });
  assert.equal((await menteeHistory.json()).data[0].status, 'ended');
  assert.equal((await mentorHistory.json()).data[0].status, 'ended');

  const repeated = await request(`/api/mentorship/relationships/${relationship.id}`, {
    method: 'PATCH',
    token: menteeToken,
    body: {},
  });
  assert.equal(repeated.status, 404);
});

test('mentee can cancel a pending request and mentor can decline another request', async () => {
  const cancellable = await request('/api/mentorship/requests', {
    method: 'POST',
    token: menteeToken,
    body: { ...firstRequest, mentorId: otherMentorId },
  });
  const cancelledId = (await cancellable.json()).data.id;
  const cancelled = await request(`/api/mentorship/requests/${cancelledId}`, {
    method: 'PATCH',
    token: menteeToken,
    body: { status: 'cancelled' },
  });
  assert.equal((await cancelled.json()).data.status, 'cancelled');

  const secondRequestResponse = await request('/api/mentorship/requests', {
    method: 'POST',
    token: secondMenteeToken,
    body: { ...firstRequest, mentorId: otherMentorId },
  });
  const declinedId = (await secondRequestResponse.json()).data.id;
  const declined = await request(`/api/mentorship/requests/${declinedId}`, {
    method: 'PATCH',
    token: otherMentorToken,
    body: { status: 'declined' },
  });
  assert.equal((await declined.json()).data.status, 'declined');
});
