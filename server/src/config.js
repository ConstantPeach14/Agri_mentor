function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  const sessionTtlHours = Number(env.SESSION_TTL_HOURS ?? 24);
  if (!Number.isInteger(sessionTtlHours) || sessionTtlHours < 1 || sessionTtlHours > 720) {
    throw new Error('SESSION_TTL_HOURS must be an integer between 1 and 720.');
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    sessionTtlHours,
    corsOrigins: (env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

module.exports = { loadConfig };
