const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const PARAMETERS = { N: 32768, r: 8, p: 1, keyLength: 64 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, PARAMETERS.keyLength, {
    N: PARAMETERS.N,
    r: PARAMETERS.r,
    p: PARAMETERS.p,
    maxmem: 128 * 1024 * 1024,
  });

  return [
    'scrypt',
    PARAMETERS.N,
    PARAMETERS.r,
    PARAMETERS.p,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, n, r, p, saltValue, keyValue, extra] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !saltValue || !keyValue || extra !== undefined) {
    return false;
  }

  const parameters = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isSafeInteger(parameters.N) || !Number.isSafeInteger(parameters.r)
    || !Number.isSafeInteger(parameters.p) || parameters.N < 2 || parameters.N > 262144
    || (parameters.N & (parameters.N - 1)) !== 0
    || parameters.r < 1 || parameters.r > 16 || parameters.p < 1 || parameters.p > 4) {
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltValue, 'base64url');
    expected = Buffer.from(keyValue, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== PARAMETERS.keyLength) return false;

  const actual = await scrypt(password, salt, expected.length, {
    ...parameters,
    maxmem: 128 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
