const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createPostgresProgrammeRepository } = require('../src/postgres-programme-repository');

const staffId = '51000000-0000-4000-8000-000000000001';
const programmeId = '52000000-0000-4000-8000-000000000001';
const tokenHash = 'a'.repeat(64);

test('programme repository scopes programme lists and dashboard queries to the session staff id', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT programme\.id, programme\.name, programme\.description/.test(sql)) {
        return { rows: [{ id: programmeId, name: 'Assigned' }] };
      }
      if (/WITH accessible AS/.test(sql) && /programmeCount/.test(sql)) {
        return { rows: [{ programmeCount: 1, menteeCount: 0, mentorCount: 0 }] };
      }
      return { rows: [] };
    },
  };
  const repository = createPostgresProgrammeRepository(pool);
  const result = await repository.getStaffDashboard(staffId);
  assert.equal(result.programmes[0].id, programmeId);
  const staffScopedQueries = queries.filter(({ sql }) => /programme_staff_assignments/.test(sql));
  assert.ok(staffScopedQueries.length >= 3);
  for (const query of staffScopedQueries) {
    assert.ok(query.values.includes(staffId));
    assert.match(query.sql, /assignment\.staff_user_id = \$1/);
    assert.match(query.sql, /assignment\.status = 'active'/);
  }
});

test('participant repository checks staff assignment, paginates, and selects no authentication data', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT programme\.id, programme\.name/.test(sql)) {
        return { rows: [{ id: programmeId, name: 'Assigned', status: 'active' }] };
      }
      if (/count\(\*\)::INTEGER AS total/.test(sql)) return { rows: [{ total: 25 }] };
      if (/membershipStatus/.test(sql)) return { rows: [{ id: 'participant-id', name: 'Grower' }] };
      return { rows: [] };
    },
  };
  const repository = createPostgresProgrammeRepository(pool);
  const result = await repository.listProgrammeParticipants(staffId, programmeId, {
    q: 'grower', role: 'mentee', status: 'active', page: 2, pageSize: 10,
  });
  assert.equal(result.total, 25);
  assert.equal(result.items[0].name, 'Grower');
  const pageQuery = queries.find(({ sql }) => /membershipStatus/.test(sql));
  assert.deepEqual(pageQuery.values, [programmeId, 'mentee', 'active', 'grower', 10, 10]);
  assert.doesNotMatch(pageQuery.sql, /password_hash|auth_sessions|account\.email|account\.phone/i);
});

test('programme membership assignment and status changes remain scoped to the signed-in staff member', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT programme\.id/.test(sql)) return { rows: [{ id: programmeId }] };
      if (/INSERT INTO programme_participants/.test(sql)) {
        return { rows: [{ id: 'participant-id', role: 'mentee', status: 'active' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [{ id: 'participant-id', role: 'mentee', status: 'removed' }] };
    },
  };
  const repository = createPostgresProgrammeRepository(pool);
  const assigned = await repository.assignProgrammeParticipant(
    staffId,
    programmeId,
    'grower@example.test',
    'mentee',
  );
  assert.equal(assigned.status, 'active');
  assert.deepEqual(queries[0], { sql: 'BEGIN', values: undefined });
  assert.deepEqual(queries[1].values, [staffId, programmeId]);
  assert.deepEqual(queries[2].values, [programmeId, 'grower@example.test', 'mentee', staffId]);
  assert.match(queries[2].sql, /account\.account_status = 'active'/);
  assert.match(queries[2].sql, /ON CONFLICT \(programme_id, participant_user_id\)/);
  assert.equal(queries[3].sql, 'COMMIT');

  const updated = await repository.updateProgrammeParticipantMembership(
    staffId,
    programmeId,
    'participant-id',
    'removed',
  );
  assert.equal(updated.status, 'removed');
  const updateQuery = queries.at(-1);
  assert.deepEqual(updateQuery.values, [staffId, programmeId, 'participant-id', 'removed']);
  assert.match(updateQuery.sql, /assignment\.staff_user_id = \$1/);
  assert.match(updateQuery.sql, /account\.account_status = 'active'/);
});

test('invitation acceptance locks and consumes one matching programme invitation transactionally', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT invitation\.id/.test(sql)) {
        return {
          rows: [{
            id: 'invitation-id',
            programme_id: programmeId,
            email: 'staff@example.test',
            expires_at: new Date(Date.now() + 60_000),
            used_at: null,
            revoked_at: null,
            programme_status: 'active',
          }],
        };
      }
      if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'staff@example.test' }] };
      if (/SELECT id, name, description/.test(sql)) return { rows: [{ id: programmeId, name: 'Assigned' }] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresProgrammeRepository({
    async connect() { return client; },
  });
  const result = await repository.acceptProgrammeInvitation('staff-id', tokenHash);
  assert.equal(result.id, programmeId);
  const invitationLock = queries.find(({ sql }) => /SELECT invitation\.id/.test(sql));
  assert.match(invitationLock.sql, /FOR UPDATE OF invitation/);
  const assignment = queries.find(({ sql }) => /INSERT INTO programme_staff_assignments/.test(sql));
  assert.deepEqual(assignment.values, [programmeId, 'staff-id']);
  assert.ok(queries.some(({ sql }) => /SET used_at = now\(\), used_by_user_id = \$2/.test(sql)));
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(invitationLock.values[0], tokenHash);
  assert.match(invitationLock.sql, /invitation\.revoked_at/);
});

test('expired invitations are revoked transactionally before replacement issuance', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/INSERT INTO programme_staff_invitations/.test(sql)) {
        return { rows: [{ id: 'replacement-invitation' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresProgrammeRepository({
    async connect() { return client; },
  });

  const invitationId = await repository.provisionProgrammeInvitation(
    programmeId,
    'staff@example.test',
    tokenHash,
    new Date(Date.now() + 60_000),
  );

  assert.equal(invitationId, 'replacement-invitation');
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /SET revoked_at = now\(\)/);
  assert.match(queries[1].sql, /expires_at <= now\(\)/);
  assert.deepEqual(queries[1].values, [programmeId, 'staff@example.test']);
  assert.match(queries[2].sql, /INSERT INTO programme_staff_invitations/);
  assert.equal(queries[3].sql, 'COMMIT');
});

test('dashboard aggregates and recent activity exclude inactive participant accounts', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/programmeCount/.test(sql)) {
        return { rows: [{
          programmeCount: 1,
          menteeCount: 0,
          mentorCount: 0,
          activeRelationshipCount: 0,
          pendingRequestCount: 0,
          upcomingSessionCount: 0,
          completedGoalCount: 0,
          completedMilestoneCount: 0,
        }] };
      }
      return { rows: [] };
    },
  };
  const repository = createPostgresProgrammeRepository(pool);
  await repository.getStaffDashboard(staffId);

  const programmeCounts = queries.find(({ sql }) => /SELECT programme\.id, programme\.name, programme\.description/.test(sql));
  const summary = queries.find(({ sql }) => /programmeCount/.test(sql));
  const activity = queries.find(({ sql }) => /"relationshipId"/.test(sql));
  assert.equal((programmeCounts.sql.match(/account\.account_status = 'active'/g) ?? []).length, 2);
  assert.ok((summary.sql.match(/account_status = 'active'/g) ?? []).length >= 12);
  assert.ok((activity.sql.match(/account_status = 'active'/g) ?? []).length >= 6);
});

test('every Staff oversight query excludes inactive accounts for both participants', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT programme\.id, programme\.name, programme\.description, programme\.status/.test(sql)) {
        return { rows: [{ id: programmeId, name: 'Assigned', description: '', status: 'active' }] };
      }
      return { rows: [] };
    },
  };
  const repository = createPostgresProgrammeRepository(pool);
  await repository.getProgrammeOversight(staffId, programmeId);

  const oversightQueries = queries.slice(1);
  assert.equal(oversightQueries.length, 5);
  for (const { sql } of oversightQueries) {
    assert.match(sql, /mentee\.account_status = 'active'/);
    assert.match(sql, /mentor\.account_status = 'active'/);
  }
});
