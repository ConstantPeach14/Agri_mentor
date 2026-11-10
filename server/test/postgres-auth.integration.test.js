const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');

const { createApp } = require('../src/app');
const { createAuthService } = require('../src/auth-service');
const { createDatabasePoolOptions } = require('../src/database-pool-options');
const { createPostgresAuthRepository } = require('../src/postgres-auth-repository');
const {
  assertIsolatedTestDatabase,
  resolveApplicationDatabaseUrl,
} = require('../src/postgres-test-target');

const enabled = process.env.AGRI_MENTOR_ENABLE_DISPOSABLE_DB_TESTS === '1';
const connectionString = process.env.AGRI_MENTOR_POSTGRES_TEST_DATABASE_URL;
let pool;
let server;
let baseUrl;
let repository;
let authService;

if (enabled) {
  const envFilePath = path.resolve(__dirname, '../.env');
  const envFileContents = existsSync(envFilePath) ? readFileSync(envFilePath, 'utf8') : '';
  assertIsolatedTestDatabase({
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
}

before(async () => {
  if (!enabled) return;
  pool = new Pool(createDatabasePoolOptions(connectionString, {
    max: 4,
    connectionTimeoutMillis: 5000,
  }));
  repository = createPostgresAuthRepository(pool);
  authService = createAuthService(repository);

  const app = createApp({ corsOrigins: [], nodeEnv: 'test' }, { authService });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
});

async function post(route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('PostgreSQL auth and profile integration against an explicitly disposable database', {
  skip: !enabled && 'Set AGRI_MENTOR_ENABLE_DISPOSABLE_DB_TESTS=1 to opt in.',
}, async () => {
  const stamp = randomUUID();
  const accounts = [];

  for (const role of ['mentee', 'mentor', 'programme_staff']) {
    const email = `${role}-${stamp}@example.test`;
    const password = 'integration test passphrase 123';
    const registration = await post('/api/auth/register', {
      fullName: `Test ${role}`,
      email,
      password,
      role,
    });
    assert.equal(registration.status, 201);
    const registered = (await registration.json()).data;
    assert.equal(registered.user.role, role);
    assert.equal(registered.profile.role, role);
    accounts.push({ email, password, role, id: registered.user.id, token: registered.token });

    const login = await post('/api/auth/login', { email, password });
    assert.equal(login.status, 200);
    const loggedIn = (await login.json()).data;
    assert.equal(loggedIn.user.role, role);
    assert.equal(loggedIn.profile.userId, registered.user.id);

    const incorrectPassword = await post('/api/auth/login', {
      email,
      password: 'incorrect integration password',
    });
    assert.equal(incorrectPassword.status, 401);

    const duplicateEmail = await post('/api/auth/register', {
      fullName: `Duplicate ${role}`,
      email: email.toUpperCase(),
      password,
      role,
    });
    assert.equal(duplicateEmail.status, 409);

    const roleChange = await fetch(`${baseUrl}/api/profile`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${registered.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'mentor' }),
    });
    assert.equal(roleChange.status, 400);

    assert.equal(await repository.getProfile(registered.user.id, role === 'mentee' ? 'mentor' : 'mentee'), null);
  }

  const staff = accounts.find((account) => account.role === 'programme_staff');
  const staffUpdate = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${staff.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization: 'Test Organization', jobTitle: 'Coordinator' }),
  });
  assert.equal(staffUpdate.status, 200);
  const staffProfile = (await staffUpdate.json()).data;
  assert.equal(staffProfile.organization, 'Test Organization');
  assert.equal(staffProfile.jobTitle, 'Coordinator');

  const mentee = accounts.find((account) => account.role === 'mentee');
  const clientOneUpdate = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${mentee.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      location: 'Cross-device test location',
      bio: 'Integration profile biography',
      needs: 'Irrigation advice',
      experience: 'Two growing seasons',
      interests: ['Soil health'],
    }),
  });
  assert.equal(clientOneUpdate.status, 200);
  const savedMenteeProfile = (await clientOneUpdate.json()).data;
  assert.equal(savedMenteeProfile.location, 'Cross-device test location');
  assert.equal(savedMenteeProfile.bio, 'Integration profile biography');
  assert.equal(savedMenteeProfile.needs, 'Irrigation advice');
  assert.equal(savedMenteeProfile.experience, 'Two growing seasons');
  assert.deepEqual(savedMenteeProfile.interests, ['Soil health']);
  const clientTwo = await post('/api/auth/login', { email: mentee.email, password: mentee.password });
  const clientTwoToken = (await clientTwo.json()).data.token;
  const clientTwoProfile = await fetch(`${baseUrl}/api/profile`, {
    headers: { authorization: `Bearer ${clientTwoToken}` },
  });
  const reloadedMenteeProfile = (await clientTwoProfile.json()).data;
  assert.equal(reloadedMenteeProfile.location, 'Cross-device test location');
  assert.equal(reloadedMenteeProfile.bio, 'Integration profile biography');
  assert.equal(reloadedMenteeProfile.needs, 'Irrigation advice');
  assert.equal(reloadedMenteeProfile.experience, 'Two growing seasons');
  assert.deepEqual(reloadedMenteeProfile.interests, ['Soil health']);

  const clientTwoUpdate = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${clientTwoToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ location: 'Reverse cross-device update' }),
  });
  assert.equal(clientTwoUpdate.status, 200);
  const clientOneProfile = await fetch(`${baseUrl}/api/profile`, {
    headers: { authorization: `Bearer ${mentee.token}` },
  });
  assert.equal((await clientOneProfile.json()).data.location, 'Reverse cross-device update');

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${clientTwoToken}` },
  });
  assert.equal(logout.status, 200);
  const revokedSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${clientTwoToken}` },
  });
  assert.equal(revokedSession.status, 401);

  const menteeTokenHash = createHash('sha256').update(mentee.token).digest('hex');
  await pool.query(
    `UPDATE auth_sessions SET expires_at = now() - interval '1 minute'
     WHERE token_hash = $1`,
    [menteeTokenHash],
  );
  const expiredSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${mentee.token}` },
  });
  assert.equal(expiredSession.status, 401);

  const mismatchedProfileClient = await pool.connect();
  try {
    await mismatchedProfileClient.query('BEGIN');
    await assert.rejects(
      mismatchedProfileClient.query(
        "UPDATE users SET role = 'mentor' WHERE id = $1",
        [mentee.id],
      ),
      (error) => error.code === '23514',
    );
    await mismatchedProfileClient.query('ROLLBACK');
    await mismatchedProfileClient.query('BEGIN');
    await assert.rejects(
      mismatchedProfileClient.query(
        'INSERT INTO mentor_profiles (user_id) VALUES ($1)',
        [mentee.id],
      ),
      (error) => error.code === '23503',
    );
    await mismatchedProfileClient.query('ROLLBACK');
    await mismatchedProfileClient.query('BEGIN');
    await mismatchedProfileClient.query(
      'DELETE FROM mentee_profiles WHERE user_id = $1',
      [mentee.id],
    );
    await assert.rejects(
      mismatchedProfileClient.query('COMMIT'),
      (error) => error.code === '23514',
    );
    await mismatchedProfileClient.query('ROLLBACK');
  } finally {
    mismatchedProfileClient.release();
  }
});
