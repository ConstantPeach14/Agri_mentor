const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    corsOrigins: [],
    nodeEnv: 'test',
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health endpoint returns application and environment status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    application: 'agriMentor',
    status: 'ok',
    api: 'available',
    database: 'not_configured',
    environment: 'test',
  });
});

test('configured local Expo web origins pass CORS while unrelated origins are not reflected', async () => {
  const corsApp = createApp({
    corsOrigins: ['http://localhost:8081', 'http://127.0.0.1:8081'],
    nodeEnv: 'test',
  });
  const corsServer = corsApp.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    corsServer.once('listening', resolve);
    corsServer.once('error', reject);
  });
  const corsUrl = `http://127.0.0.1:${corsServer.address().port}/api/auth/register`;

  try {
    for (const origin of ['http://localhost:8081', 'http://127.0.0.1:8081']) {
      const response = await fetch(corsUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }

    const unrelatedOrigin = await fetch(corsUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unrelated.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(unrelatedOrigin.status, 204);
    assert.equal(unrelatedOrigin.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve, reject) => {
      corsServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('unknown paths return a JSON 404 response', async () => {
  const response = await fetch(`${baseUrl}/unknown`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  });
});

test('account routes report unavailable when the database-backed service is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).error, {
    code: 'AUTH_UNAVAILABLE',
    message: 'Account services are not configured.',
  });
});

test('malformed JSON receives a safe client error response', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_REQUEST',
      message: 'The request could not be processed.',
    },
  });
});

test('environment configuration applies defaults and parses CORS origins', () => {
  assert.deepEqual(loadConfig({
    PORT: '4100',
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:8081, https://example.test ',
  }), {
    port: 4100,
    host: '127.0.0.1',
    nodeEnv: 'test',
    databaseUrl: null,
    sessionTtlHours: 24,
    corsOrigins: ['http://localhost:8081', 'https://example.test'],
  });

  assert.equal(loadConfig({}).port, 3000);
  assert.equal(loadConfig({ DATABASE_URL: 'postgresql://test/db', SESSION_TTL_HOURS: '48' }).sessionTtlHours, 48);
});

test('invalid ports are rejected during configuration', () => {
  assert.throws(() => loadConfig({ PORT: 'not-a-port' }), {
    message: 'PORT must be an integer between 1 and 65535.',
  });
});

test('invalid session duration is rejected during configuration', () => {
  assert.throws(() => loadConfig({ SESSION_TTL_HOURS: '0' }), {
    message: 'SESSION_TTL_HOURS must be an integer between 1 and 720.',
  });
});
