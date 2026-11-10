const { createHash } = require('node:crypto');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');

const MIGRATION_DIRECTORY = path.resolve(__dirname, '../migrations');
const ADVISORY_LOCK_NAMESPACE = 0x41475249;
const ADVISORY_LOCK_KEY = 1;
const LEDGER_BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by TEXT NOT NULL DEFAULT current_user
  )
`;

class MigrationRunnerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'MigrationRunnerError';
  }
}

class MigrationChecksumError extends MigrationRunnerError {
  constructor(version) {
    super(`Migration ${version} was already applied with a different checksum.`);
    this.name = 'MigrationChecksumError';
    this.version = version;
  }
}

function checksumOf(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function parseMigrationFilename(filename) {
  const match = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/.exec(filename);
  if (!match) {
    throw new MigrationRunnerError(`Invalid migration filename: ${filename}`);
  }
  const numericVersion = Number(match[1]);
  if (!Number.isSafeInteger(numericVersion) || numericVersion < 1
    || match[1] !== String(numericVersion).padStart(3, '0')) {
    throw new MigrationRunnerError(`Migration version must be a canonical positive integer: ${filename}`);
  }
  return { version: match[1], name: match[2] };
}

function assertRunnerControlledSql(sql, filename) {
  if (/(^|;)\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)(?:\s+(?:TRANSACTION|WORK))?\s*;/im.test(sql)) {
    throw new MigrationRunnerError(
      `${filename} contains transaction control; the runner owns migration transactions.`,
    );
  }
}

async function validateLedger(client) {
  const columnsResult = await client.query(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
  );
  const columns = new Map(columnsResult.rows.map((row) => [row.column_name, row]));
  const expectedColumns = [
    ['version', 'text', null],
    ['name', 'text', null],
    ['checksum_sha256', 'character', 64],
    ['applied_at', 'timestamp with time zone', null],
    ['applied_by', 'text', null],
  ];
  const validColumns = expectedColumns.every(([name, dataType, length]) => {
    const column = columns.get(name);
    return column
      && column.data_type === dataType
      && (length === null || Number(column.character_maximum_length) === length)
      && column.is_nullable === 'NO';
  }) && columns.size === expectedColumns.length;
  if (!validColumns) {
    throw new MigrationRunnerError('schema_migrations has an unexpected column definition.');
  }

  const primaryKeyResult = await client.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_catalog = tc.constraint_catalog
       AND kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
       AND kcu.table_name = tc.table_name
     WHERE tc.table_schema = current_schema()
       AND tc.table_name = 'schema_migrations'
       AND tc.constraint_type = 'PRIMARY KEY'`,
  );
  if (primaryKeyResult.rows.length !== 1 || primaryKeyResult.rows[0].column_name !== 'version') {
    throw new MigrationRunnerError('schema_migrations must have a primary key on version only.');
  }
}

async function validateMigrationHistory(client, migrations) {
  const result = await client.query(
    `SELECT version, name, checksum_sha256
     FROM schema_migrations
     ORDER BY version::BIGINT`,
  );
  const localMigrations = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const applied of result.rows) {
    const local = localMigrations.get(applied.version);
    if (!local) {
      throw new MigrationRunnerError(
        `Migration ${applied.version} (${applied.name}) is recorded in the ledger but its SQL file is missing.`,
      );
    }
    if (local.name !== applied.name || local.checksum !== applied.checksum_sha256) {
      throw new MigrationChecksumError(applied.version);
    }
  }
}

async function loadMigrations(migrationDirectory = MIGRATION_DIRECTORY) {
  let filenames;
  try {
    filenames = await readdir(migrationDirectory);
  } catch (error) {
    throw new MigrationRunnerError('Could not read the migration directory.', { cause: error });
  }

  const sqlFiles = filenames.filter((filename) => filename.endsWith('.sql'));
  sqlFiles.sort((left, right) => (
    Number(parseMigrationFilename(left).version) - Number(parseMigrationFilename(right).version)
  ));
  const migrations = [];
  const versions = new Set();

  for (const filename of sqlFiles) {
    const { version, name } = parseMigrationFilename(filename);
    const numericVersion = Number(version);
    if (versions.has(numericVersion)) {
      throw new MigrationRunnerError(`Duplicate migration version ${version}.`);
    }
    versions.add(numericVersion);

    let sql;
    try {
      sql = await readFile(path.join(migrationDirectory, filename), 'utf8');
    } catch (error) {
      throw new MigrationRunnerError(`Could not read migration ${filename}.`, { cause: error });
    }
    assertRunnerControlledSql(sql, filename);
    migrations.push({ version, name, filename, sql, checksum: checksumOf(sql) });
  }
  return migrations;
}

async function runOneMigration(pool, migration, migrations, { actor = null } = {}) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new MigrationRunnerError(
      `Could not connect to the migration database for ${migration.version}.`,
      { cause: error },
    );
  }
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY],
    );
    await client.query(LEDGER_BOOTSTRAP_SQL);
    await validateLedger(client);
    await validateMigrationHistory(client, migrations);

    const appliedResult = await client.query(
      `SELECT version, name, checksum_sha256, applied_at, applied_by
       FROM schema_migrations
       WHERE version = $1`,
      [migration.version],
    );
    const applied = appliedResult.rows[0];
    if (applied) {
      if (applied.name !== migration.name || applied.checksum_sha256 !== migration.checksum) {
        throw new MigrationChecksumError(migration.version);
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return { version: migration.version, name: migration.name, status: 'already_applied' };
    }
    const laterMigration = await client.query(
      'SELECT version FROM schema_migrations WHERE version::BIGINT > $1::BIGINT LIMIT 1',
      [migration.version],
    );
    if (laterMigration.rows[0]) {
      throw new MigrationRunnerError(
        `Cannot apply migration ${migration.version} after later migration ${laterMigration.rows[0].version} is already recorded.`,
      );
    }

    const actorResult = await client.query('SELECT current_user AS actor');
    const executedBy = actor?.trim() || actorResult.rows[0]?.actor;
    if (!executedBy) {
      throw new MigrationRunnerError('Could not determine the migration execution actor.');
    }

    await client.query(migration.sql);
    await client.query(
      `INSERT INTO schema_migrations (version, name, checksum_sha256, applied_by)
       VALUES ($1, $2, $3, $4)`,
      [migration.version, migration.name, migration.checksum, executedBy],
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return { version: migration.version, name: migration.name, status: 'applied' };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new MigrationRunnerError(
          `Migration ${migration.version} failed and transaction rollback also failed.`,
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }
    if (error instanceof MigrationRunnerError) throw error;
    throw new MigrationRunnerError(`Migration ${migration.version} failed.`, { cause: error });
  } finally {
    client.release();
  }
}

async function validateEmptyMigrationDirectory(pool, migrations) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new MigrationRunnerError('Could not connect to inspect the migration ledger.', { cause: error });
  }
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY],
    );
    await client.query(LEDGER_BOOTSTRAP_SQL);
    await validateLedger(client);
    await validateMigrationHistory(client, migrations);
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    if (error instanceof MigrationRunnerError) throw error;
    throw new MigrationRunnerError('Could not validate the empty migration directory against the ledger.', {
      cause: error,
    });
  } finally {
    client.release();
  }
}

async function runMigrations({
  pool = null,
  migrationDirectory = MIGRATION_DIRECTORY,
  dryRun = false,
  actor = null,
} = {}) {
  const migrations = await loadMigrations(migrationDirectory);
  if (dryRun) {
    return migrations.map(({ version, name, filename, checksum }) => ({
      version,
      name,
      filename,
      checksum,
      status: 'planned',
    }));
  }
  if (!pool || typeof pool.connect !== 'function') {
    throw new MigrationRunnerError('A migration database pool is required unless using dry-run mode.');
  }
  if (migrations.length === 0) {
    await validateEmptyMigrationDirectory(pool, migrations);
    return [];
  }

  const results = [];
  for (const migration of migrations) {
    results.push(await runOneMigration(pool, migration, migrations, { actor }));
  }
  return results;
}

module.exports = {
  MigrationChecksumError,
  MigrationRunnerError,
  checksumOf,
  loadMigrations,
  runMigrations,
  validateLedger,
  validateMigrationHistory,
};
