const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('server environment example contains placeholders instead of usable credentials', () => {
  const contents = readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
  const values = Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    assert.match(values[key], /<[^>]+>/, `${key} should use obvious placeholders`);
    assert.doesNotMatch(values[key], /\.neon\.tech|neondb/i, `${key} should not name a real database target`);
  }
  for (const key of ['MIGRATION_ACTOR', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    assert.match(values[key], /^<[A-Z0-9_]+>$/, `${key} should contain only a placeholder`);
  }
});
