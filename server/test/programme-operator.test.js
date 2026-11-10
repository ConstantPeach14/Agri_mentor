const assert = require('node:assert/strict');
const { test } = require('node:test');

const { optionsFrom, verifyDatabaseTarget } = require('../scripts/programme-operator');

test('operator CLI parses unique option/value pairs', () => {
  assert.deepEqual(optionsFrom([
    'invite-staff',
    '--programme-id',
    'programme-uuid',
    '--email',
    'staff@example.test',
  ]), {
    command: 'invite-staff',
    'programme-id': 'programme-uuid',
    email: 'staff@example.test',
  });
  assert.throws(() => optionsFrom(['assign-participant', '--email']), /unique --name value pairs/);
  assert.throws(() => optionsFrom(['assign-participant', '--email', 'one', '--email', 'two']), /unique --name value pairs/);
});

test('operator CLI requires both the configured host and database to be confirmed', () => {
  const databaseUrl = 'postgresql://operator@db.example.test/isolated_test?sslmode=require';
  assert.doesNotThrow(() => verifyDatabaseTarget(
    databaseUrl,
    'db.example.test',
    'isolated_test',
  ));
  assert.throws(() => verifyDatabaseTarget(databaseUrl, 'production.example.test', 'isolated_test'), /do not match/);
  assert.throws(() => verifyDatabaseTarget(databaseUrl, 'db.example.test', 'production'), /do not match/);
});
