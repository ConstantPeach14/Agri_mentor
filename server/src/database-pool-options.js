function createDatabasePoolOptions(connectionString, options = {}) {
  let url;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new Error('Database connection URL is invalid.', { cause: error });
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Database connection URL must use PostgreSQL.');
  }

  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const sslMode = url.searchParams.get('sslmode');
  if (!localHost && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('Remote PostgreSQL connections must require TLS using sslmode.');
  }

  return {
    connectionString,
    ...options,
    ssl: localHost ? undefined : { rejectUnauthorized: true },
  };
}

module.exports = { createDatabasePoolOptions };
