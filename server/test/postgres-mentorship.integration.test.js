const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');

const { createDatabasePoolOptions } = require('../src/database-pool-options');
const { createPostgresProgrammeRepository } = require('../src/postgres-programme-repository');
const {
  assertIsolatedTestDatabase,
  resolveApplicationDatabaseUrl,
} = require('../src/postgres-test-target');

const enabled = process.env.AGRI_MENTOR_ENABLE_DISPOSABLE_DB_TESTS === '1';
const connectionString = process.env.AGRI_MENTOR_POSTGRES_TEST_DATABASE_URL;

async function createActors(pool, { menteeCount = 1, capacity = null } = {}) {
  const mentor = { id: randomUUID() };
  const mentees = Array.from({ length: menteeCount }, () => ({ id: randomUUID() }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, full_name, email, password_hash, role)
       VALUES ($1, 'Integration Mentor', $2, 'unused-test-hash', 'mentor')`,
      [mentor.id, `${mentor.id}@example.test`],
    );
    await client.query(
      'INSERT INTO mentor_profiles (user_id, max_active_mentees) VALUES ($1, $2)',
      [mentor.id, capacity],
    );
    for (const mentee of mentees) {
      await client.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, 'Integration Mentee', $2, 'unused-test-hash', 'mentee')`,
        [mentee.id, `${mentee.id}@example.test`],
      );
      await client.query('INSERT INTO mentee_profiles (user_id) VALUES ($1)', [mentee.id]);
    }
    await client.query('COMMIT');
    return { mentor, mentees };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createRequest(pool, menteeId, mentorId) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO mentorship_requests (id, mentee_user_id, mentor_user_id, message, needs, interests, goals)
     VALUES ($1, $2, $3, 'Request message', 'Needs', 'Interests', 'Goals')`,
    [id, menteeId, mentorId],
  );
  return id;
}

async function acceptWithRelationship(client, requestId, menteeId, mentorId, relationshipId = randomUUID()) {
  await client.query(
    `UPDATE mentorship_requests SET status = 'accepted', responded_at = now()
     WHERE id = $1`,
    [requestId],
  );
  await client.query(
    `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
     VALUES ($1, $2, $3, $4)`,
    [relationshipId, requestId, menteeId, mentorId],
  );
  return relationshipId;
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function waitForScopeLockWaiters(pool, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT count(*)::INTEGER AS waiting
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = 734205::OID AND objid = 5::OID
          AND objsubid = 2 AND granted = FALSE`,
    );
    if (result.rows[0].waiting >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} programme-scope lock waiters.`);
}

async function runConcurrentScopeWriters(pool, writers) {
  const blocker = await pool.connect();
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(734205, 5)');
    const operations = clients.map(async (client, index) => {
      try {
        await client.query('BEGIN');
        await writers[index](client);
        await client.query('COMMIT');
        return null;
      } catch (error) {
        await client.query('ROLLBACK');
        return error;
      }
    });
    try {
      await waitForScopeLockWaiters(pool, clients.length);
      await blocker.query('COMMIT');
      const errors = await Promise.all(operations);
      assert.deepEqual(errors, [null, null]);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await Promise.all(operations);
    }
  } finally {
    for (const client of clients) client.release();
    blocker.release();
  }
}

async function createProgramme(pool) {
  const programmeId = randomUUID();
  await pool.query('INSERT INTO programmes (id, name) VALUES ($1, $2)', [programmeId, `Test ${programmeId}`]);
  return programmeId;
}

async function enrolParticipant(pool, programmeId, userId, role) {
  await pool.query(
    `INSERT INTO programme_participants (programme_id, participant_user_id, participant_role)
     VALUES ($1, $2, $3)`,
    [programmeId, userId, role],
  );
}

test('PostgreSQL mentorship migration constraints in an isolated schema', {
  skip: !enabled && 'Set AGRI_MENTOR_ENABLE_DISPOSABLE_DB_TESTS=1 to opt in on a confirmed disposable database.',
}, async (t) => {
  const envFilePath = path.resolve(__dirname, '../.env');
  const envFileContents = existsSync(envFilePath) ? readFileSync(envFilePath, 'utf8') : '';
  const target = assertIsolatedTestDatabase({
    connectionString,
    applicationConnectionString: resolveApplicationDatabaseUrl({
      environmentUrl: process.env.DATABASE_URL,
      envFileContents,
    }),
    projectId: process.env.AGRI_MENTOR_POSTGRES_TEST_PROJECT_ID,
    branchId: process.env.AGRI_MENTOR_POSTGRES_TEST_BRANCH_ID,
    projectName: process.env.AGRI_MENTOR_POSTGRES_TEST_PROJECT_NAME,
    branchName: process.env.AGRI_MENTOR_POSTGRES_TEST_BRANCH_NAME,
    expectedHost: process.env.AGRI_MENTOR_POSTGRES_TEST_EXPECTED_HOST,
    targetConfirmation: process.env.AGRI_MENTOR_POSTGRES_TEST_TARGET_CONFIRMATION,
  });

  const schema = `mentorship_test_${randomUUID().replace(/-/g, '')}`;
  const adminPool = new Pool(createDatabasePoolOptions(connectionString, {
    max: 2,
    connectionTimeoutMillis: 5000,
  }));
  let pool;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool(createDatabasePoolOptions(connectionString, {
      max: 6,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema}`,
    }));

    for (const filename of [
      '001_auth_profiles.sql',
      '002_mentorship_requests.sql',
      '003_mentorship_management.sql',
      '005_programme_oversight.sql',
    ]) {
      const migration = readFileSync(path.resolve(__dirname, `../migrations/${filename}`), 'utf8');
      await withTransaction(pool, (client) => client.query(migration));
    }

    await t.test('creates a request and rejects a duplicate pending request', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2 });
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      const result = await pool.query(
        'SELECT status, message FROM mentorship_requests WHERE id = $1',
        [requestId],
      );
      assert.deepEqual(result.rows[0], { status: 'pending', message: 'Request message' });
      await assert.rejects(
        createRequest(pool, mentees[0].id, mentor.id),
        (error) => error.code === '23505',
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO mentorship_requests (id, mentee_user_id, mentor_user_id, message)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), mentees[1].id, mentor.id, ' \t\n '],
        ),
        (error) => error.code === '23514' && error.constraint === 'mentorship_requests_message_check',
      );
      await pool.query(
        `INSERT INTO mentorship_requests (id, mentee_user_id, mentor_user_id, message)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), mentees[1].id, mentor.id, 'x'.repeat(2000)],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO mentorship_requests (id, mentee_user_id, mentor_user_id, message)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), mentees[1].id, mentor.id, 'x'.repeat(2001)],
        ),
        (error) => error.code === '23514' && error.constraint === 'mentorship_requests_message_check',
      );
    });

    await t.test('accepts a request and creates its relationship in one transaction', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, requestId, mentees[0].id, mentor.id));
      const result = await pool.query(
        `SELECT r.status AS request_status, m.status AS relationship_status
         FROM mentorship_requests r
         JOIN mentorship_relationships m ON m.request_id = r.id
         WHERE r.id = $1`,
        [requestId],
      );
      assert.deepEqual(result.rows[0], { request_status: 'accepted', relationship_status: 'active' });
      await assert.rejects(
        pool.query(
          `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), requestId, mentees[0].id, mentor.id],
        ),
        (error) => error.code === '23505',
      );
    });

    await t.test('rejects acceptance without a relationship', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await assert.rejects(
        withTransaction(pool, (client) => client.query(
          `UPDATE mentorship_requests SET status = 'accepted', responded_at = now()
           WHERE id = $1`,
          [requestId],
        )),
        (error) => error.constraint === 'accepted_request_requires_relationship',
      );
      const result = await pool.query('SELECT status FROM mentorship_requests WHERE id = $1', [requestId]);
      assert.equal(result.rows[0].status, 'pending');
    });

    await t.test('rejects a relationship without an accepted request', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await assert.rejects(
        withTransaction(pool, (client) => client.query(
          `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), requestId, mentees[0].id, mentor.id],
        )),
        (error) => error.constraint === 'relationship_requires_matching_accepted_request',
      );
    });

    await t.test('rejects a relationship with incorrect participants', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2 });
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      for (const [incorrectMentee, incorrectMentor] of [
        [mentees[1].id, mentor.id],
        [mentees[0].id, randomUUID()],
      ]) {
        await assert.rejects(pool.query(
          `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), requestId, incorrectMentee, incorrectMentor],
        ), (error) => error.code === '23503');
      }
    });

    await t.test('enforces mentor capacity and treats NULL capacity as unlimited', async () => {
      const limited = await createActors(pool, { menteeCount: 2, capacity: 1 });
      const firstRequest = await createRequest(pool, limited.mentees[0].id, limited.mentor.id);
      const secondRequest = await createRequest(pool, limited.mentees[1].id, limited.mentor.id);
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, firstRequest, limited.mentees[0].id, limited.mentor.id));
      await assert.rejects(
        withTransaction(pool, (client) =>
          acceptWithRelationship(client, secondRequest, limited.mentees[1].id, limited.mentor.id)),
        (error) => error.constraint === 'mentorship_capacity_check',
      );

      const unlimited = await createActors(pool, { menteeCount: 2, capacity: null });
      for (const mentee of unlimited.mentees) {
        const requestId = await createRequest(pool, mentee.id, unlimited.mentor.id);
        await withTransaction(pool, (client) =>
          acceptWithRelationship(client, requestId, mentee.id, unlimited.mentor.id));
      }
      const result = await pool.query(
        'SELECT max_active_mentees FROM mentor_profiles WHERE user_id = $1',
        [unlimited.mentor.id],
      );
      assert.equal(result.rows[0].max_active_mentees, null);
    });

    await t.test('serializes concurrent acceptances at capacity', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2, capacity: 1 });
      const requests = await Promise.all(mentees.map((mentee) => createRequest(pool, mentee.id, mentor.id)));
      const clients = await Promise.all([pool.connect(), pool.connect()]);
      let arrivals = 0;
      let releaseBarrier;
      const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
      try {
        const outcomes = await Promise.all(clients.map(async (client, index) => {
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE mentorship_requests SET status = 'accepted', responded_at = now()
               WHERE id = $1`,
              [requests[index]],
            );
            arrivals += 1;
            if (arrivals === clients.length) releaseBarrier();
            await barrier;
            await client.query(
              `INSERT INTO mentorship_relationships (id, request_id, mentee_user_id, mentor_user_id)
               VALUES ($1, $2, $3, $4)`,
              [randomUUID(), requests[index], mentees[index].id, mentor.id],
            );
            await client.query('COMMIT');
            return { success: true };
          } catch (error) {
            await client.query('ROLLBACK');
            return { success: false, error };
          }
        }));
        assert.equal(outcomes.filter((outcome) => outcome.success).length, 1);
        const rejected = outcomes.find((outcome) => !outcome.success);
        assert.equal(rejected.error.constraint, 'mentorship_capacity_check');
      } finally {
        for (const client of clients) client.release();
      }
      const result = await pool.query(
        `SELECT count(*)::INTEGER AS active_count
         FROM mentorship_relationships WHERE mentor_user_id = $1 AND status = 'active'`,
        [mentor.id],
      );
      assert.equal(result.rows[0].active_count, 1);
    });

    await t.test('rejects reducing capacity below the active relationship count', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2, capacity: 3 });
      for (const mentee of mentees) {
        const requestId = await createRequest(pool, mentee.id, mentor.id);
        await withTransaction(pool, (client) =>
          acceptWithRelationship(client, requestId, mentee.id, mentor.id));
      }
      await assert.rejects(
        pool.query('UPDATE mentor_profiles SET max_active_mentees = 1 WHERE user_id = $1', [mentor.id]),
        (error) => error.constraint === 'mentor_capacity_not_below_active_count',
      );
    });

    await t.test('serializes capacity reduction with relationship creation', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2, capacity: 2 });
      const activeRequest = await createRequest(pool, mentees[0].id, mentor.id);
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, activeRequest, mentees[0].id, mentor.id));
      const pendingRequest = await createRequest(pool, mentees[1].id, mentor.id);

      const lowerCapacity = pool.query(
        'UPDATE mentor_profiles SET max_active_mentees = 1 WHERE user_id = $1',
        [mentor.id],
      );
      const accept = withTransaction(pool, (client) =>
        acceptWithRelationship(client, pendingRequest, mentees[1].id, mentor.id));
      const results = await Promise.allSettled([lowerCapacity, accept]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

      const state = await pool.query(
        `SELECT mp.max_active_mentees, count(m.id)::INTEGER AS active_count
         FROM mentor_profiles mp
         LEFT JOIN mentorship_relationships m
           ON m.mentor_user_id = mp.user_id AND m.status = 'active'
         WHERE mp.user_id = $1
         GROUP BY mp.max_active_mentees`,
        [mentor.id],
      );
      const { max_active_mentees: capacity, active_count: activeCount } = state.rows[0];
      assert.ok(capacity === null || capacity >= activeCount);
    });

    await t.test('allows legitimate relationship ending and blocks relationship deletion', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, requestId, mentees[0].id, mentor.id));
      await withTransaction(pool, (client) => client.query(
        `UPDATE mentorship_relationships
         SET status = 'ended', ended_at = now()
         WHERE request_id = $1`,
        [requestId],
      ));
      const ended = await pool.query(
        'SELECT status FROM mentorship_relationships WHERE request_id = $1',
        [requestId],
      );
      assert.equal(ended.rows[0].status, 'ended');
      await assert.rejects(
        withTransaction(pool, (client) =>
          client.query('DELETE FROM mentorship_relationships WHERE request_id = $1', [requestId])),
        (error) => error.constraint === 'accepted_request_requires_relationship',
      );
      await assert.rejects(
        pool.query('DELETE FROM mentorship_requests WHERE id = $1', [requestId]),
        (error) => error.code === '23503',
      );
    });

    await t.test('allows pending cancellation and a later new request', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await pool.query(
        `UPDATE mentorship_requests SET status = 'cancelled', responded_at = now()
         WHERE id = $1`,
        [requestId],
      );
      await assert.rejects(
        pool.query(
          `UPDATE mentorship_requests SET status = 'pending', responded_at = NULL
           WHERE id = $1`,
          [requestId],
        ),
        (error) => error.constraint === 'mentorship_request_status_is_final',
      );
      const newRequestId = await createRequest(pool, mentees[0].id, mentor.id);
      assert.notEqual(newRequestId, requestId);
    });

    await t.test('keeps request identity immutable and response content final', async () => {
      const { mentor, mentees } = await createActors(pool, { menteeCount: 2 });
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      const identityUpdates = [
        ['id', randomUUID()],
        ['mentee_user_id', mentees[1].id],
        ['mentor_user_id', randomUUID()],
      ];
      for (const [column, value] of identityUpdates) {
        await assert.rejects(
          pool.query(`UPDATE mentorship_requests SET ${column} = $1 WHERE id = $2`, [value, requestId]),
          (error) => error.constraint === 'mentorship_request_identity_is_immutable',
        );
      }

      await pool.query(
        `UPDATE mentorship_requests SET needs = 'Updated while pending' WHERE id = $1`,
        [requestId],
      );
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, requestId, mentees[0].id, mentor.id));
      for (const column of ['message', 'needs', 'interests', 'goals']) {
        await assert.rejects(
          pool.query(`UPDATE mentorship_requests SET ${column} = 'changed' WHERE id = $1`, [requestId]),
          (error) => error.constraint === 'mentorship_request_content_is_immutable_after_response',
        );
      }
      await assert.rejects(
        pool.query(
          `UPDATE mentorship_requests SET responded_at = now() + interval '1 minute'
           WHERE id = $1`,
          [requestId],
        ),
        (error) => error.constraint === 'mentorship_request_response_is_immutable',
      );
    });

    await t.test('persists participant-owned sessions, measurable goals, milestones, and history', async () => {
      const { mentor, mentees } = await createActors(pool);
      const requestId = await createRequest(pool, mentees[0].id, mentor.id);
      await withTransaction(pool, (client) =>
        acceptWithRelationship(client, requestId, mentees[0].id, mentor.id));
      const relationshipResult = await pool.query(
        'SELECT id FROM mentorship_relationships WHERE request_id = $1',
        [requestId],
      );
      const relationshipId = relationshipResult.rows[0].id;

      const sessionId = randomUUID();
      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await pool.query(
        `INSERT INTO mentorship_sessions
           (id, relationship_id, title, scheduled_at, preparation_notes, created_by)
         VALUES ($1, $2, 'Field review', $3, 'Bring soil sample', $4)`,
        [sessionId, relationshipId, scheduledAt, mentees[0].id],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO mentorship_sessions
             (id, relationship_id, title, scheduled_at, created_by)
           VALUES ($1, $2, 'Unauthorized session', $3, $4)`,
          [randomUUID(), relationshipId, scheduledAt, randomUUID()],
        ),
        (error) => error.constraint === 'mentorship_session_creator_is_participant',
      );
      const completedSession = await pool.query(
        `UPDATE mentorship_sessions SET status = 'completed', outcome_notes = 'Tested soil'
         WHERE id = $1 RETURNING status, completed_at`,
        [sessionId],
      );
      assert.equal(completedSession.rows[0].status, 'completed');
      assert.ok(completedSession.rows[0].completed_at);
      await assert.rejects(
        pool.query(
          `UPDATE mentorship_sessions SET outcome_notes = 'Changed after completion'
           WHERE id = $1`,
          [sessionId],
        ),
        (error) => error.constraint === 'mentorship_session_details_final',
      );

      const goalId = randomUUID();
      await pool.query(
        `INSERT INTO mentorship_goals
           (id, relationship_id, title, measurable_outcome, target_date, created_by)
         VALUES ($1, $2, 'Improve soil health', 'Increase organic matter by 5%', '2027-12-31', $3)`,
        [goalId, relationshipId, mentor.id],
      );
      await withTransaction(pool, async (client) => {
        await client.query("SELECT set_config('agri_mentor.actor_user_id', $1, true)", [mentees[0].id]);
        await client.query(
          `UPDATE mentorship_goals SET target_date = '2028-01-31' WHERE id = $1`,
          [goalId],
        );
        const milestoneId = randomUUID();
        await client.query(
          `INSERT INTO mentorship_goal_milestones
             (id, goal_id, title, created_by, updated_by)
           VALUES ($1, $2, 'Run soil test', $3, $3)`,
          [milestoneId, goalId, mentees[0].id],
        );
        await client.query(
          `UPDATE mentorship_goal_milestones SET status = 'completed', updated_by = $2
           WHERE id = $1`,
          [milestoneId, mentees[0].id],
        );
        await client.query(
          `UPDATE mentorship_goals SET status = 'completed' WHERE id = $1`,
          [goalId],
        );
      });

      const history = await pool.query(
        `SELECT event_type FROM mentorship_goal_events
         WHERE goal_id = $1 ORDER BY created_at, id`,
        [goalId],
      );
      assert.deepEqual(history.rows.map((row) => row.event_type), [
        'created',
        'revised',
        'milestone_added',
        'milestone_completed',
        'completed',
      ]);
    });

    await t.test('links requests when participant enrollment races request insertion', async () => {
      const { mentor, mentees } = await createActors(pool);
      const programmeId = await createProgramme(pool);
      const menteeId = mentees[0].id;
      const requestId = randomUUID();
      await enrolParticipant(pool, programmeId, menteeId, 'mentee');

      await runConcurrentScopeWriters(pool, [
        (client) => client.query(
          `INSERT INTO programme_participants (programme_id, participant_user_id, participant_role)
           VALUES ($1, $2, 'mentor')`,
          [programmeId, mentor.id],
        ),
        (client) => client.query(
          `INSERT INTO mentorship_requests (id, mentee_user_id, mentor_user_id, message)
           VALUES ($1, $2, $3, 'Concurrent scope test')`,
          [requestId, menteeId, mentor.id],
        ),
      ]);

      const result = await pool.query(
        `SELECT count(*)::INTEGER AS count FROM programme_requests
          WHERE programme_id = $1 AND request_id = $2`,
        [programmeId, requestId],
      );
      assert.equal(result.rows[0].count, 1);
    });

    await t.test('links relationships when participant enrollment races relationship creation', async () => {
      const { mentor, mentees } = await createActors(pool);
      const programmeId = await createProgramme(pool);
      const menteeId = mentees[0].id;
      const requestId = await createRequest(pool, menteeId, mentor.id);
      await enrolParticipant(pool, programmeId, menteeId, 'mentee');
      const relationshipId = randomUUID();

      await runConcurrentScopeWriters(pool, [
        (client) => client.query(
          `INSERT INTO programme_participants (programme_id, participant_user_id, participant_role)
           VALUES ($1, $2, 'mentor')`,
          [programmeId, mentor.id],
        ),
        (client) => acceptWithRelationship(client, requestId, menteeId, mentor.id, relationshipId),
      ]);

      const [requestScope, relationshipScope] = await Promise.all([
        pool.query(
          `SELECT count(*)::INTEGER AS count FROM programme_requests
            WHERE programme_id = $1 AND request_id = $2`,
          [programmeId, requestId],
        ),
        pool.query(
          `SELECT count(*)::INTEGER AS count FROM programme_relationships
            WHERE programme_id = $1 AND relationship_id = $2`,
          [programmeId, relationshipId],
        ),
      ]);
      assert.equal(requestScope.rows[0].count, 1);
      assert.equal(relationshipScope.rows[0].count, 1);
    });

    await t.test('rejects scope-linking writes outside READ COMMITTED isolation', async () => {
      const { mentees } = await createActors(pool);
      const programmeId = await createProgramme(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await assert.rejects(
          enrolParticipant(client, programmeId, mentees[0].id, 'mentee'),
          (error) => error.code === '0A000' && /READ COMMITTED/.test(error.message),
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });

    await t.test('excludes suspended and closed accounts from Staff views despite active memberships', async () => {
      const pairs = [];
      for (let index = 0; index < 3; index += 1) pairs.push(await createActors(pool));
      const programmeId = await createProgramme(pool);
      const staffId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, 'Integration Staff', $2, 'unused-test-hash', 'programme_staff')`,
        [staffId, `${staffId}@example.test`],
      );
      await pool.query('INSERT INTO programme_staff_profiles (user_id) VALUES ($1)', [staffId]);
      await pool.query(
        `INSERT INTO programme_staff_assignments (programme_id, staff_user_id)
         VALUES ($1, $2)`,
        [programmeId, staffId],
      );

      const pairData = [];
      for (const pair of pairs) {
        const menteeId = pair.mentees[0].id;
        await enrolParticipant(pool, programmeId, menteeId, 'mentee');
        await enrolParticipant(pool, programmeId, pair.mentor.id, 'mentor');
        const requestId = await createRequest(pool, menteeId, pair.mentor.id);
        const relationshipId = await withTransaction(pool, (client) =>
          acceptWithRelationship(client, requestId, menteeId, pair.mentor.id));
        pairData.push({ menteeId, mentorId: pair.mentor.id, requestId, relationshipId });
      }

      await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', ['suspended', pairData[1].menteeId]);
      await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', ['suspended', pairData[1].mentorId]);
      await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', ['closed', pairData[2].menteeId]);
      await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', ['closed', pairData[2].mentorId]);

      const activeMemberships = await pool.query(
        `SELECT count(*)::INTEGER AS count FROM programme_participants
          WHERE programme_id = $1 AND status = 'active'`,
        [programmeId],
      );
      assert.equal(activeMemberships.rows[0].count, 6);

      const repository = createPostgresProgrammeRepository(pool);
      const dashboard = await repository.getStaffDashboard(staffId);
      assert.equal(dashboard.summary.menteeCount, 1);
      assert.equal(dashboard.summary.mentorCount, 1);
      assert.equal(dashboard.summary.activeRelationshipCount, 1);
      assert.equal(dashboard.recentActivity.length, 1);

      for (const role of ['mentee', 'mentor']) {
        const page = await repository.listProgrammeParticipants(staffId, programmeId, {
          q: '', role, status: 'active', page: 1, pageSize: 20,
        });
        assert.deepEqual(page.items.map((item) => item.id), [
          role === 'mentee' ? pairData[0].menteeId : pairData[0].mentorId,
        ]);
      }
      assert.ok(await repository.getProgrammeParticipant(staffId, pairData[0].menteeId));
      for (const inactive of pairData.slice(1)) {
        assert.equal(await repository.getProgrammeParticipant(staffId, inactive.menteeId), null);
        assert.equal(await repository.getProgrammeParticipant(staffId, inactive.mentorId), null);
      }

      const oversight = await repository.getProgrammeOversight(staffId, programmeId);
      assert.deepEqual(oversight.requests.map((request) => request.id), [pairData[0].requestId]);
      assert.deepEqual(oversight.relationships.map((relationship) => relationship.id), [pairData[0].relationshipId]);
    });

    await t.test('creates a scoped programme, manages membership, and aggregates real programme activity', async () => {
      const { mentor, mentees } = await createActors(pool);
      const staffId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, 'Integration Staff', $2, 'unused-test-hash', 'programme_staff')`,
        [staffId, `${staffId}@example.test`],
      );
      await pool.query('INSERT INTO programme_staff_profiles (user_id) VALUES ($1)', [staffId]);
      const repository = createPostgresProgrammeRepository(pool);
      const programme = await repository.createProgrammeForStaff(staffId, {
        name: 'Field Mentorship Cohort',
        description: 'Integration programme',
      });
      const menteeId = mentees[0].id;
      const assignedMentee = await repository.assignProgrammeParticipant(
        staffId, programme.id, `${menteeId}@example.test`, 'mentee',
      );
      const assignedMentor = await repository.assignProgrammeParticipant(
        staffId, programme.id, `${mentor.id}@example.test`, 'mentor',
      );
      assert.equal(assignedMentee.status, 'active');
      assert.equal(assignedMentor.status, 'active');

      const requestId = await createRequest(pool, menteeId, mentor.id);
      const relationshipId = await withTransaction(pool, (client) =>
        acceptWithRelationship(client, requestId, menteeId, mentor.id));
      const [requestScope, relationshipScope] = await Promise.all([
        pool.query('SELECT programme_id FROM programme_requests WHERE request_id = $1', [requestId]),
        pool.query('SELECT programme_id FROM programme_relationships WHERE relationship_id = $1', [relationshipId]),
      ]);
      assert.deepEqual(requestScope.rows.map((row) => row.programme_id), [programme.id]);
      assert.deepEqual(relationshipScope.rows.map((row) => row.programme_id), [programme.id]);

      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const past = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      await pool.query(
        `INSERT INTO mentorship_sessions (id, relationship_id, title, scheduled_at, created_by)
         VALUES ($1, $2, 'Upcoming', $3, $4), ($5, $2, 'Overdue', $6, $4)`,
        [randomUUID(), relationshipId, future, menteeId, randomUUID(), past],
      );
      await pool.query(
        `INSERT INTO mentorship_sessions
           (id, relationship_id, title, scheduled_at, status, created_by, completed_at)
         VALUES ($1, $2, 'Completed', $3, 'completed', $4, now())`,
        [randomUUID(), relationshipId, past, menteeId],
      );
      await pool.query(
        `INSERT INTO mentorship_sessions
           (id, relationship_id, title, scheduled_at, status, created_by, cancelled_at)
         VALUES ($1, $2, 'Cancelled', $3, 'cancelled', $4, now())`,
        [randomUUID(), relationshipId, future, menteeId],
      );
      const activeGoalId = randomUUID();
      await pool.query(
        `INSERT INTO mentorship_goals
           (id, relationship_id, title, measurable_outcome, target_date, created_by)
         VALUES ($1, $2, 'Active goal', 'One measured outcome', CURRENT_DATE + 30, $3)`,
        [activeGoalId, relationshipId, mentor.id],
      );
      await pool.query(
        `INSERT INTO mentorship_goals
           (id, relationship_id, title, measurable_outcome, target_date, status, created_by, completed_at)
         VALUES ($1, $2, 'Completed goal', 'One measured outcome', CURRENT_DATE, 'completed', $3, now())`,
        [randomUUID(), relationshipId, mentor.id],
      );
      await pool.query(
        `INSERT INTO mentorship_goal_milestones
           (id, goal_id, title, created_by, updated_by)
         VALUES ($1, $2, 'Pending milestone', $3, $3)` ,
        [randomUUID(), activeGoalId, menteeId],
      );
      const dashboard = await repository.getStaffDashboard(staffId);
      assert.equal(dashboard.summary.programmeCount, 1);
      assert.equal(dashboard.summary.menteeCount, 1);
      assert.equal(dashboard.summary.mentorCount, 1);
      assert.equal(dashboard.summary.activeRelationshipCount, 1);
      assert.equal(dashboard.summary.upcomingSessionCount, 1);
      assert.equal(dashboard.summary.overdueSessionCount, 1);
      assert.equal(dashboard.summary.completedSessionCount, 1);
      assert.equal(dashboard.summary.cancelledSessionCount, 1);
      assert.equal(dashboard.summary.unmatchedMenteeCount, 0);
      assert.equal(dashboard.summary.unmatchedMentorCount, 0);
      assert.equal(dashboard.summary.activeGoalCount, 1);
      assert.equal(dashboard.summary.activeMilestoneCount, 1);
      assert.equal(dashboard.summary.completedGoalCount, 1);
    });
  } finally {
    if (pool) await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
});
