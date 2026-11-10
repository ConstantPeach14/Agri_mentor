require('dotenv').config();

const { Pool } = require('pg');
const { runMigrations } = require('../src/migration-runner');
const { createDatabasePoolOptions } = require('../src/database-pool-options');

function errorMessages(error) {
  const messages = [];
  function collect(current) {
    if (!current) return;
    if (typeof current.message === 'string') messages.push(current.message);
    if (current instanceof AggregateError) {
      current.errors.forEach(collect);
    } else {
      collect(current.cause);
    }
  }
  collect(error);
  return messages;
}

async function main(args = process.argv.slice(2), env = process.env) {
  const allowedArgs = new Set(['--dry-run', '--apply', '--help']);
  const unknown = args.filter((arg) => !allowedArgs.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown migration option: ${unknown.join(', ')}`);
  }
  if (args.includes('--help')) {
    console.log('Usage: npm run migrate -- [--dry-run | --apply]');
    console.log('--dry-run (default) inspects migration files without connecting.');
    console.log('--apply explicitly runs pending migrations using MIGRATION_DATABASE_URL.');
    return;
  }
  if (args.includes('--dry-run') && args.includes('--apply')) {
    throw new Error('Choose either --dry-run or --apply, not both.');
  }

  if (!args.includes('--apply')) {
    const plan = await runMigrations({ dryRun: true });
    for (const migration of plan) {
      console.log(`${migration.status}: ${migration.version} ${migration.name} ${migration.checksum}`);
    }
    return;
  }

  const connectionString = env.MIGRATION_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL must be set to explicitly apply migrations.');
  }

  const pool = new Pool(createDatabasePoolOptions(connectionString, {
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  }));
  try {
    const results = await runMigrations({ pool, actor: env.MIGRATION_ACTOR });
    for (const result of results) {
      console.log(`${result.status}: ${result.version} ${result.name}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Migration command failed: ${errorMessages(error).join(' Caused by: ')}`);
    process.exitCode = 1;
  });
}

module.exports = { errorMessages, main };
