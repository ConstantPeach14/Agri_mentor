const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createDatabasePoolOptions } = require('../src/database-pool-options');
const { loadConfig } = require('../src/config');
const { createPostgresProgrammeRepository } = require('../src/postgres-programme-repository');

function optionsFrom(argv) {
  const [command, ...args] = argv;
  const options = { command };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith('--') || index + 1 >= args.length || options[key.slice(2)] !== undefined) {
      throw new Error('Use command options as unique --name value pairs.');
    }
    options[key.slice(2)] = args[index + 1];
  }
  return options;
}

function required(options, key) {
  const value = options[key]?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function validEmail(value) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid invitation email.');
  }
  return email;
}

function validHours(value) {
  const hours = value === undefined ? 72 : Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error('Invitation expiry must be from 1 to 168 hours.');
  }
  return hours;
}

function verifyDatabaseTarget(databaseUrl, confirmedTarget, confirmedDatabase) {
  const database = new URL(databaseUrl);
  if (database.hostname !== confirmedTarget || database.pathname.slice(1) !== confirmedDatabase) {
    throw new Error('The confirmed host and database do not match DATABASE_URL.');
  }
}

function newInvitation() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

async function main() {
  require('dotenv').config();
  const options = optionsFrom(process.argv.slice(2));
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL must be configured for operator provisioning.');
  const confirmedTarget = required(options, 'confirm-target');
  const confirmedDatabase = required(options, 'confirm-database');
  verifyDatabaseTarget(config.databaseUrl, confirmedTarget, confirmedDatabase);
  const repositoryPool = new Pool(createDatabasePoolOptions(config.databaseUrl, {
    max: 1,
    connectionTimeoutMillis: 5000,
  }));
  const repository = createPostgresProgrammeRepository(repositoryPool);
  try {
    if (options.command === 'create-programme') {
      const name = required(options, 'name');
      const description = options.description ?? '';
      if (name.length > 160 || !name.trim() || description.length > 2000) {
        throw new Error('Programme name or description is outside its allowed length.');
      }
      const email = validEmail(required(options, 'email'));
      const hours = validHours(options['expires-hours']);
      const invite = newInvitation();
      const programmeId = randomUUID();
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      await repository.createProgrammeAndInvitation(
        { id: programmeId, name: name.trim(), description: description.trim() },
        email,
        invite.tokenHash,
        expiresAt,
      );
      console.log(JSON.stringify({
        programmeId,
        invitationEmail: email,
        expiresAt: expiresAt.toISOString(),
        invitationToken: invite.token,
        note: 'Deliver the token securely; it is shown only once.',
      }, null, 2));
      return;
    }
    if (options.command === 'invite-staff') {
      const programmeId = required(options, 'programme-id');
      const email = validEmail(required(options, 'email'));
      const hours = validHours(options['expires-hours']);
      const invite = newInvitation();
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      await repository.provisionProgrammeInvitation(
        programmeId,
        email,
        invite.tokenHash,
        expiresAt,
      );
      console.log(JSON.stringify({
        programmeId,
        invitationEmail: email,
        expiresAt: expiresAt.toISOString(),
        invitationToken: invite.token,
        note: 'Deliver the token securely; it is shown only once.',
      }, null, 2));
      return;
    }
    if (options.command === 'assign-participant') {
      const programmeId = required(options, 'programme-id');
      const email = validEmail(required(options, 'email'));
      const role = required(options, 'role');
      if (!['mentee', 'mentor'].includes(role)) {
        throw new Error('Participant role must be mentee or mentor.');
      }
      await repository.provisionParticipantMembership(programmeId, email, role);
      console.log(`Assigned ${role} membership to the selected programme.`);
      return;
    }
    throw new Error('Use create-programme, invite-staff, or assign-participant.');
  } finally {
    await repositoryPool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { optionsFrom, verifyDatabaseTarget };
