const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  MigrationChecksumError,
  MigrationRunnerError,
  checksumOf,
  loadMigrations,
  runMigrations,
} = require('../src/migration-runner');

const temporaryDirectories = new Set();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

async function migrationFixture(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agrimentor-migrations-'));
  temporaryDirectories.add(directory);
  for (const [filename, sql] of Object.entries(files)) {
    await writeFile(path.join(directory, filename), sql, 'utf8');
  }
  return directory;
}

function createMockPool({ applied = new Map(), failMigration = false } = {}) {
  const database = {
    applied,
    migrationExecutions: 0,
    lockTail: Promise.resolve(),
    lockAcquisitions: 0,
    rollbacks: 0,
    connects: 0,
  };
  return {
    database,
    async connect() {
      database.connects += 1;
      const stagedRows = [];
      let stagedExecutions = 0;
      let releaseLock = null;
      return {
        async query(queryText, values = []) {
          const query = queryText.trim();
          if (query === 'BEGIN') return { rows: [] };
          if (query.startsWith('SET LOCAL')) return { rows: [] };
          if (query.startsWith('SELECT pg_advisory_xact_lock')) {
            const previousLock = database.lockTail;
            database.lockTail = new Promise((resolve) => { releaseLock = resolve; });
            await previousLock;
            database.lockAcquisitions += 1;
            return { rows: [] };
          }
          if (query.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
          if (query.startsWith('SELECT column_name, data_type')) {
            return { rows: [
              { column_name: 'version', data_type: 'text', character_maximum_length: null, is_nullable: 'NO' },
              { column_name: 'name', data_type: 'text', character_maximum_length: null, is_nullable: 'NO' },
              { column_name: 'checksum_sha256', data_type: 'character', character_maximum_length: 64, is_nullable: 'NO' },
              { column_name: 'applied_at', data_type: 'timestamp with time zone', character_maximum_length: null, is_nullable: 'NO' },
              { column_name: 'applied_by', data_type: 'text', character_maximum_length: null, is_nullable: 'NO' },
            ] };
          }
          if (query.startsWith('SELECT kcu.column_name')) return { rows: [{ column_name: 'version' }] };
          if (query.startsWith('SELECT version, name, checksum_sha256')) {
            if (query.includes('ORDER BY')) {
              return { rows: [...database.applied.values()] };
            }
            const row = database.applied.get(values[0]) ?? null;
            return { rows: row ? [row] : [] };
          }
          if (query.startsWith('SELECT version FROM schema_migrations')) return { rows: [] };
          if (query === 'SELECT current_user AS actor') {
            return { rows: [{ actor: 'migration_test_actor' }] };
          }
          if (query.startsWith('CREATE TABLE sample')) {
            if (failMigration) throw new Error('simulated migration SQL error');
            stagedExecutions += 1;
            return { rows: [] };
          }
          if (query.startsWith('INSERT INTO schema_migrations')) {
            stagedRows.push({
              version: values[0],
              name: values[1],
              checksum_sha256: values[2],
              applied_by: values[3],
            });
            return { rows: [] };
          }
          if (query === 'COMMIT') {
            for (const row of stagedRows) database.applied.set(row.version, row);
            database.migrationExecutions += stagedExecutions;
            releaseLock?.();
            return { rows: [] };
          }
          if (query === 'ROLLBACK') {
            database.rollbacks += 1;
            releaseLock?.();
            return { rows: [] };
          }
          throw new Error(`Unexpected mock query: ${query}`);
        },
        release() {},
      };
    },
  };
}

test('dry-run lists checksums without connecting to a database', async () => {
  const directory = await migrationFixture({
    '001_initial_schema.sql': 'CREATE TABLE sample (id integer);',
  });
  const pool = createMockPool();
  const plan = await runMigrations({ migrationDirectory: directory, pool, dryRun: true });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].version, '001');
  assert.equal(plan[0].checksum, checksumOf('CREATE TABLE sample (id integer);'));
  assert.equal(plan[0].status, 'planned');
  assert.equal(pool.database.connects, 0);
});

test('an unapplied migration is recorded with its checksum and actor', async () => {
  const directory = await migrationFixture({
    '001_initial_schema.sql': 'CREATE TABLE sample (id integer);',
  });
  const pool = createMockPool();
  const result = await runMigrations({ migrationDirectory: directory, pool, actor: 'release-operator' });

  assert.deepEqual(result.map((item) => item.status), ['applied']);
  const ledger = pool.database.applied.get('001');
  assert.equal(ledger.checksum_sha256, checksumOf('CREATE TABLE sample (id integer);'));
  assert.equal(ledger.applied_by, 'release-operator');
  assert.equal(pool.database.migrationExecutions, 1);
  assert.equal(pool.database.lockAcquisitions, 1);
});

test('matching applied migration is skipped and checksum drift is rejected', async () => {
  const sql = 'CREATE TABLE sample (id integer);';
  const directory = await migrationFixture({ '001_initial_schema.sql': sql });
  const pool = createMockPool({
    applied: new Map([['001', {
      version: '001',
      name: 'initial_schema',
      checksum_sha256: checksumOf(sql),
    }]]),
  });
  const result = await runMigrations({ migrationDirectory: directory, pool });
  assert.equal(result[0].status, 'already_applied');
  assert.equal(pool.database.migrationExecutions, 0);

  const driftedDirectory = await migrationFixture({
    '001_initial_schema.sql': 'CREATE TABLE sample (id bigint);',
  });
  await assert.rejects(
    runMigrations({ migrationDirectory: driftedDirectory, pool }),
    MigrationChecksumError,
  );
  assert.equal(pool.database.migrationExecutions, 0);
});

test('applied ledger versions without local migration files are rejected', async () => {
  const directory = await migrationFixture({
    '002_second_schema.sql': 'CREATE TABLE sample (id integer);',
  });
  const pool = createMockPool({
    applied: new Map([['001', {
      version: '001',
      name: 'first_schema',
      checksum_sha256: checksumOf('CREATE TABLE first_schema (id integer);'),
    }]]),
  });

  await assert.rejects(
    runMigrations({ migrationDirectory: directory, pool }),
    /Migration 001 .*SQL file is missing/,
  );
  assert.equal(pool.database.migrationExecutions, 0);
});

test('an empty migration directory still checks for orphaned ledger entries', async () => {
  const directory = await migrationFixture({});
  const pool = createMockPool({
    applied: new Map([['001', {
      version: '001',
      name: 'first_schema',
      checksum_sha256: checksumOf('CREATE TABLE first_schema (id integer);'),
    }]]),
  });

  await assert.rejects(
    runMigrations({ migrationDirectory: directory, pool }),
    /Migration 001 .*SQL file is missing/,
  );
  assert.equal(pool.database.lockAcquisitions, 1);
});

test('concurrent migration runs serialize on the advisory lock and apply once', async () => {
  const directory = await migrationFixture({
    '001_initial_schema.sql': 'CREATE TABLE sample (id integer);',
  });
  const pool = createMockPool();
  const runs = await Promise.all([
    runMigrations({ migrationDirectory: directory, pool }),
    runMigrations({ migrationDirectory: directory, pool }),
  ]);
  assert.equal(pool.database.migrationExecutions, 1);
  assert.equal(pool.database.lockAcquisitions, 2);
  assert.deepEqual(runs.flat().map((result) => result.status).sort(), ['already_applied', 'applied']);
});

test('migration errors roll back and leave the ledger unchanged', async () => {
  const directory = await migrationFixture({
    '001_initial_schema.sql': 'CREATE TABLE sample (id integer);',
  });
  const pool = createMockPool({ failMigration: true });

  await assert.rejects(
    runMigrations({ migrationDirectory: directory, pool }),
    (error) => error instanceof MigrationRunnerError && /Migration 001 failed/.test(error.message),
  );
  assert.equal(pool.database.rollbacks, 1);
  assert.equal(pool.database.applied.size, 0);
  assert.equal(pool.database.migrationExecutions, 0);
});

test('invalid and duplicate migration filenames are rejected', async () => {
  const invalidDirectory = await migrationFixture({ 'initial_schema.sql': 'SELECT 1;' });
  await assert.rejects(loadMigrations(invalidDirectory), /Invalid migration filename/);

  const duplicateDirectory = await migrationFixture({
    '001_initial_schema.sql': 'SELECT 1;',
    '001_second_schema.sql': 'SELECT 2;',
  });
  await assert.rejects(loadMigrations(duplicateDirectory), /Duplicate migration version/);
});

test('migration files cannot take transaction control away from the runner', async () => {
  const directory = await migrationFixture({
    '001_initial_schema.sql': 'BEGIN; CREATE TABLE sample (id integer); COMMIT;',
  });
  await assert.rejects(loadMigrations(directory), /contains transaction control/);
});
