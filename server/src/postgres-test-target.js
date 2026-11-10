function connectionIdentity(url) {
  return [
    url.protocol,
    url.hostname.toLowerCase().replace('-pooler.', '.'),
    url.port,
    decodeURIComponent(url.pathname.replace(/^\/+/, '')),
  ].join('|');
}

function resolveApplicationDatabaseUrl({ environmentUrl, envFileContents = '' }) {
  const configuredUrl = environmentUrl?.trim();
  if (configuredUrl) return configuredUrl;
  const dotenv = require('dotenv');
  return dotenv.parse(envFileContents).DATABASE_URL?.trim() || '';
}

function assertIsolatedTestDatabase({
  connectionString,
  applicationConnectionString = '',
  projectId,
  branchId,
  projectName,
  branchName,
  expectedHost,
  targetConfirmation,
}) {
  if (!connectionString) {
    throw new Error('AGRI_MENTOR_POSTGRES_TEST_DATABASE_URL must be set for PostgreSQL integration tests.');
  }
  if (!projectId || !branchId || !projectName || !branchName || !expectedHost) {
    throw new Error('Confirm the exact Neon test project, branch, database, and host before integration testing.');
  }
  if (targetConfirmation !== `${projectId}|${branchId}|agri_mentor_test|${expectedHost}`) {
    throw new Error('AGRI_MENTOR_POSTGRES_TEST_TARGET_CONFIRMATION does not match the confirmed disposable target.');
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('The PostgreSQL integration test URL is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The PostgreSQL integration test URL must use PostgreSQL.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (databaseName !== 'agri_mentor_test') {
    throw new Error('PostgreSQL integration tests require a disposable database named agri_mentor_test.');
  }
  if (parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error('The test database host does not match the confirmed Neon endpoint.');
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!localHost && !parsed.hostname.endsWith('.neon.tech')) {
    throw new Error('Use a local PostgreSQL test server or the confirmed isolated Neon test branch.');
  }
  if (!localHost && !['require', 'verify-ca', 'verify-full'].includes(parsed.searchParams.get('sslmode'))) {
    throw new Error('Neon PostgreSQL integration tests require TLS with certificate validation.');
  }
  if (applicationConnectionString) {
    let applicationUrl;
    try {
      applicationUrl = new URL(applicationConnectionString);
    } catch {
      throw new Error('The configured application PostgreSQL URL is invalid.');
    }
    if (connectionIdentity(parsed) === connectionIdentity(applicationUrl)) {
      throw new Error('The PostgreSQL integration test URL must not be the application database URL.');
    }
  }
  return { databaseName, host: parsed.hostname, projectId, branchId, projectName, branchName };
}

module.exports = { assertIsolatedTestDatabase, resolveApplicationDatabaseUrl };
