require('dotenv').config();

const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createAuthService } = require('./auth-service');
const { createMentorshipService } = require('./mentorship-service');
const { createProgrammeService } = require('./programme-service');
const { createCloudinaryImageService } = require('./cloudinary-image-service');
const { createPostgresAuthRepository } = require('./postgres-auth-repository');
const { createPostgresProgrammeRepository } = require('./postgres-programme-repository');
const { createDatabasePoolOptions } = require('./database-pool-options');
const { Pool } = require('pg');

const config = loadConfig();
const imageService = createCloudinaryImageService();
let pool = null;
let authService = null;
let mentorshipService = null;
let programmeService = null;
if (config.databaseUrl) {
  pool = new Pool(createDatabasePoolOptions(config.databaseUrl, {
    max: 10,
    connectionTimeoutMillis: 5000,
  }));
  const repository = createPostgresAuthRepository(pool);
  const programmeRepository = createPostgresProgrammeRepository(pool);
  authService = createAuthService(Object.assign(repository, {
    consumeStaffInvitation: programmeRepository.consumeStaffInvitation,
  }), {
    sessionTtlHours: config.sessionTtlHours,
    imageService,
  });
  mentorshipService = createMentorshipService(repository);
  programmeService = createProgrammeService(programmeRepository);
} else {
  console.warn('DATABASE_URL is not configured; authentication endpoints will return 503.');
}
const app = createApp(config, {
  authService,
  imageService,
  mentorshipService,
  programmeService,
  checkDatabase: pool ? () => pool.query('SELECT 1') : null,
});
const server = app.listen(config.port, config.host, () => {
  console.log(`agriMentor API listening on http://${config.host}:${config.port}`);
});

server.on('error', (error) => {
  console.error('Unable to start agriMentor API:', error.message);
  process.exitCode = 1;
});

async function close() {
  await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
}

process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
