const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createMentorshipService, isMentorshipMigrationUnavailable } = require('../src/mentorship-service');

const mentee = { id: 'a0a00000-0000-4000-8000-000000000001', role: 'mentee' };
const mentor = { id: 'b0b00000-0000-4000-8000-000000000001', role: 'mentor' };
const staff = { id: 'c0c00000-0000-4000-8000-000000000001', role: 'programme_staff' };
const relationshipId = 'd0d00000-0000-4000-8000-000000000001';

function serviceWith(overrides = {}) {
  const calls = [];
  const repository = {
    async createMentorshipSession(userId, input) {
      calls.push({ operation: 'createSession', userId, input });
      return { id: 'session-id', ...input };
    },
    async updateMentorshipSession(userId, sessionId, changes) {
      calls.push({ operation: 'updateSession', userId, sessionId, changes });
      return { id: sessionId, ...changes };
    },
    async createMentorshipGoal(userId, input) {
      calls.push({ operation: 'createGoal', userId, input });
      return { id: 'goal-id', ...input };
    },
    async updateMentorshipGoal(userId, goalId, changes) {
      calls.push({ operation: 'updateGoal', userId, goalId, changes });
      return { id: goalId, ...changes };
    },
    async createGoalMilestone(userId, goalId, title) {
      calls.push({ operation: 'createMilestone', userId, goalId, title });
      return true;
    },
    async updateGoalMilestone(userId, milestoneId, changes) {
      calls.push({ operation: 'updateMilestone', userId, milestoneId, changes });
      return true;
    },
    ...overrides,
  };
  return { service: createMentorshipService(repository), calls };
}

test('session creation validates ISO time and trims the title and preparation notes', async () => {
  const { service, calls } = serviceWith();
  const result = await service.createSession(mentee, {
    relationshipId,
    title: '  Soil review  ',
    scheduledAt: '2027-01-10T12:00:00.000Z',
    preparationNotes: '  Bring field readings  ',
  });
  assert.equal(result.title, 'Soil review');
  assert.equal(calls[0].input.preparationNotes, 'Bring field readings');
  await assert.rejects(
    service.createSession(mentee, {
      relationshipId,
      title: '   ',
      scheduledAt: 'not-a-date',
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('session datetime validation strictly rejects impossible dates and times', async () => {
  const { service } = serviceWith();
  for (const scheduledAt of [
    '2027-02-29T12:00:00Z',
    '2027-02-31T12:00:00Z',
    '2027-13-01T12:00:00Z',
    '2027-01-01T24:00:00Z',
    '2027-01-01T12:60:00Z',
    '2027-01-01T12:00:60Z',
    '2027-01-01 12:00:00Z',
  ]) {
    await assert.rejects(
      service.createSession(mentee, {
        relationshipId,
        title: 'Field visit',
        scheduledAt,
      }),
      (error) => error.code === 'INVALID_INPUT',
      scheduledAt,
    );
  }
  const validLeapDay = await service.createSession(mentee, {
    relationshipId,
    title: 'Leap day field visit',
    scheduledAt: '2028-02-29T12:00:00Z',
  });
  assert.equal(validLeapDay.scheduledAt, '2028-02-29T12:00:00.000Z');
});

test('session updates allow only supported status values and validate outcome notes', async () => {
  const { service, calls } = serviceWith();
  await service.updateSession(mentor, 'e0e00000-0000-4000-8000-000000000001', {
    status: 'completed',
    outcomeNotes: '  Agreed to test the plan  ',
  });
  assert.equal(calls[0].changes.outcomeNotes, 'Agreed to test the plan');
  await assert.rejects(
    service.updateSession(mentor, 'e0e00000-0000-4000-8000-000000000001', { status: 'scheduled' }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('goal and milestone validation requires measurable outcomes and valid dates', async () => {
  const { service, calls } = serviceWith();
  await service.createGoal(mentee, {
    relationshipId,
    title: '  Improve harvest  ',
    measurableOutcome: '  Record yield increase by 10 percent  ',
    targetDate: '2027-01-31',
  });
  assert.equal(calls[0].input.title, 'Improve harvest');
  assert.equal(calls[0].input.measurableOutcome, 'Record yield increase by 10 percent');
  await assert.rejects(
    service.createGoal(mentee, {
      relationshipId,
      title: 'Goal',
      measurableOutcome: 'Result',
      targetDate: '2027-02-31',
    }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await service.createMilestone(mentor, 'f0f00000-0000-4000-8000-000000000001', { title: '  Soil test  ' });
  assert.equal(calls[1].title, 'Soil test');
});

test('completed goals can be reopened and revised while archived goals remain unavailable', async () => {
  const calls = [];
  let state = 'completed';
  const { service } = serviceWith({
    async updateMentorshipGoal(userId, goalId, changes) {
      calls.push({ userId, goalId, changes });
      if (state === 'archived') return null;
      state = changes.status ?? state;
      return { id: goalId, status: state, ...changes };
    },
  });
  const goalId = 'f0f00000-0000-4000-8000-000000000002';
  const reopened = await service.updateGoal(mentee, goalId, { status: 'active' });
  assert.equal(reopened.status, 'active');
  assert.equal(calls[0].changes.status, 'active');

  const revised = await service.updateGoal(mentor, goalId, {
    title: 'Revised goal',
    measurableOutcome: 'Track results after reopening',
  });
  assert.equal(revised.title, 'Revised goal');
  assert.equal(calls[1].changes.measurableOutcome, 'Track results after reopening');

  state = 'archived';
  await assert.rejects(
    service.updateGoal(mentee, goalId, { status: 'active' }),
    (error) => error.code === 'GOAL_NOT_FOUND',
  );
});

test('relationship termination requires a participant and validates optional reason', async () => {
  const relationship = {
    id: 'd0d00000-0000-4000-8000-000000000002',
    status: 'ended',
    endedByUserId: mentee.id,
    endReason: 'Season completed',
  };
  const { service, calls } = serviceWith({
    async endMentorshipRelationship(userId, relationshipId, reason) {
      calls.push({ userId, relationshipId, reason });
      return relationship;
    },
  });
  const result = await service.endRelationship(mentee, relationship.id, { reason: ' Season completed ' });
  assert.equal(result.status, 'ended');
  assert.equal(calls[0].reason, 'Season completed');
  await assert.rejects(
    service.endRelationship(staff, relationship.id, {}),
    (error) => error.status === 403,
  );
  await assert.rejects(
    service.endRelationship(mentor, relationship.id, { reason: 'x'.repeat(1001) }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    service.endRelationship(mentee, relationship.id, { status: 'ended' }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('Programme Staff cannot use private mentorship management endpoints', async () => {
  const { service } = serviceWith();
  await assert.rejects(service.listSessions(staff), (error) => error.status === 403);
  await assert.rejects(service.listGoals(staff), (error) => error.status === 403);
  await assert.rejects(service.createSession(staff, {}), (error) => error.status === 403);
});

test('only known missing mentorship schema objects report pending migration', async () => {
  assert.equal(isMentorshipMigrationUnavailable({
    code: '42P01',
    message: 'relation "mentorship_sessions" does not exist',
  }), true);
  assert.equal(isMentorshipMigrationUnavailable({
    code: '42703',
    column: 'max_active_mentees',
    message: 'column "max_active_mentees" does not exist',
  }), true);
  assert.equal(isMentorshipMigrationUnavailable({
    code: '42P01',
    message: 'relation "users" does not exist',
  }), false);
  assert.equal(isMentorshipMigrationUnavailable({
    code: '42703',
    column: 'unrelated_field',
    message: 'column "unrelated_field" does not exist',
  }), false);

  const service = createMentorshipService({
    async listMentorshipSessions() {
      throw Object.assign(new Error('relation "users" does not exist'), { code: '42P01' });
    },
  });
  await assert.rejects(service.listSessions(mentee), (error) => {
    assert.equal(error.status, undefined);
    assert.equal(error.code, '42P01');
    return true;
  });
});
