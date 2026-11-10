const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createDatabasePoolOptions } = require('../src/database-pool-options');

test('remote PostgreSQL pool requires TLS and validates certificates', () => {
  assert.throws(
    () => createDatabasePoolOptions('postgresql://user:pass@db.example.test/app'),
    /must require TLS/,
  );
  const options = createDatabasePoolOptions(
    'postgresql://user:pass@db.example.test/app?sslmode=require',
    { max: 2 },
  );
  assert.equal(options.max, 2);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
});

test('local PostgreSQL remains usable without TLS for isolated development tests', () => {
  const options = createDatabasePoolOptions('postgresql://user:pass@localhost/app');
  assert.equal(options.ssl, undefined);
});

test('connection URLs must be valid PostgreSQL URLs', () => {
  assert.throws(() => createDatabasePoolOptions('not-a-url'), /URL is invalid/);
  assert.throws(() => createDatabasePoolOptions('https://db.example.test/app'), /must use PostgreSQL/);
});
