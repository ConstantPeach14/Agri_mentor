const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  assertIsolatedTestDatabase,
  resolveApplicationDatabaseUrl,
} = require('../src/postgres-test-target');

const target = {
  connectionString: 'postgresql://test_role:test_password@test-ep.neon.tech/agri_mentor_test?sslmode=require',
  projectId: 'agri-mentor-project-id',
  branchId: 'agri-mentor-test-branch-id',
  projectName: 'agriMentor isolated tests',
  branchName: 'test',
  expectedHost: 'test-ep.neon.tech',
  targetConfirmation: 'agri-mentor-project-id|agri-mentor-test-branch-id|agri_mentor_test|test-ep.neon.tech',
};

test('PostgreSQL test target requires an explicitly confirmed isolated Neon target', () => {
  assert.deepEqual(assertIsolatedTestDatabase(target), {
    databaseName: 'agri_mentor_test',
    host: 'test-ep.neon.tech',
    projectId: 'agri-mentor-project-id',
    branchId: 'agri-mentor-test-branch-id',
    projectName: 'agriMentor isolated tests',
    branchName: 'test',
  });
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    targetConfirmation: '',
  }), /TARGET_CONFIRMATION/);
});

test('PostgreSQL test target rejects application URL, wrong host, database, and non-TLS URLs', () => {
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    applicationConnectionString: target.connectionString,
  }), /must not be the application database/);
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    connectionString: 'postgresql://test_role:other_password@test-ep.neon.tech/agri_mentor_test?sslmode=require',
    applicationConnectionString: 'postgresql://app_role:app_password@test-ep-pooler.neon.tech/agri_mentor_test?sslmode=require',
  }), /must not be the application database/);
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    expectedHost: 'other-ep.neon.tech',
    targetConfirmation: 'agri-mentor-project-id|agri-mentor-test-branch-id|agri_mentor_test|other-ep.neon.tech',
  }), /does not match/);
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    connectionString: target.connectionString.replace('agri_mentor_test', 'neondb'),
  }), /agri_mentor_test/);
  assert.throws(() => assertIsolatedTestDatabase({
    ...target,
    connectionString: target.connectionString.replace('?sslmode=require', ''),
  }), /require TLS/);
});

test('a blank process URL resolves the backend .env URL without loading it into process state', () => {
  const url = 'postgresql://app:secret@app-ep.neon.tech/neondb?sslmode=require';
  assert.equal(resolveApplicationDatabaseUrl({
    environmentUrl: '',
    envFileContents: `DATABASE_URL=${url}`,
  }), url);
  assert.equal(resolveApplicationDatabaseUrl({
    environmentUrl: ` ${url} `,
    envFileContents: 'DATABASE_URL=postgresql://unused',
  }), url);
});
