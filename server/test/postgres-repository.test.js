const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createPostgresAuthRepository } = require('../src/postgres-auth-repository');

function goalRow(status = 'completed') {
  const now = new Date('2026-11-09T12:00:00.000Z');
  return {
    id: 'f0f00000-0000-4000-8000-000000000002',
    relationship_id: 'd0d00000-0000-4000-8000-000000000001',
    title: 'Revised goal',
    measurable_outcome: 'Measure progress',
    target_date: '2027-01-31',
    status,
    created_by: 'a0a00000-0000-4000-8000-000000000001',
    created_at: now,
    updated_at: now,
    completed_at: status === 'completed' ? now : null,
    milestones: [],
    history: [],
  };
}

test('PostgreSQL goal repository locks active or completed participant goals before updates', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/SELECT goal\.id/.test(sql)) {
        return { rows: [{ id: 'f0f00000-0000-4000-8000-000000000002' }] };
      }
      if (/UPDATE mentorship_goals/.test(sql)) {
        return { rows: [{ id: 'f0f00000-0000-4000-8000-000000000002' }] };
      }
      if (/SELECT goal\.\*/.test(sql)) return { rows: [goalRow('active')] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresAuthRepository({
    async connect() {
      return client;
    },
  });

  const result = await repository.updateMentorshipGoal(
    'a0a00000-0000-4000-8000-000000000001',
    'f0f00000-0000-4000-8000-000000000002',
    { status: 'active' },
  );

  assert.equal(result.status, 'active');
  const ownershipQuery = queries.find((sql) => /SELECT goal\.id/.test(sql));
  assert.match(ownershipQuery, /goal\.status IN \('active', 'completed'\)/);
  assert.match(ownershipQuery, /\$2 IN \(relationship\.mentee_user_id, relationship\.mentor_user_id\)/);
  assert.ok(queries.includes('COMMIT'));
});

test('mentor availability updates target mentor_profiles inside the profile transaction', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT id FROM users/.test(sql)) return { rows: [{ id: 'mentor-id' }] };
      if (/SELECT u\.id, u\.full_name/.test(sql)) {
        return {
          rows: [{
            id: 'mentor-id',
            full_name: 'Mentor',
            email: 'mentor@example.test',
            phone: '',
            role: 'mentor',
            user_created_at: new Date('2026-01-01T00:00:00.000Z'),
            user_updated_at: new Date('2026-01-01T00:00:00.000Z'),
            mentor_updated_at: new Date('2026-01-01T00:00:00.000Z'),
            mentor_active_mentees: 0,
            mentor_availability_note: 'Weekday evenings',
          }],
        };
      }
      if (/SELECT e\.name/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresAuthRepository({
    async connect() {
      return client;
    },
  });

  const result = await repository.updateProfile('mentor-id', 'mentor', {
    availabilityNote: 'Weekday evenings',
  });

  const availabilityUpdate = queries.find(({ sql }) => /SET availability_note/.test(sql));
  assert.deepEqual(availabilityUpdate.values, ['mentor-id', 'Weekday evenings']);
  assert.equal(result.availabilityNote, 'Weekday evenings');
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
});
