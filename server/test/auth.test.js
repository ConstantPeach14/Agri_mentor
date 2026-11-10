const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

const { createApp } = require('../src/app');
const { createAuthService } = require('../src/auth-service');
const { verifyPassword } = require('../src/passwords');

function createMemoryRepository() {
  const users = new Map();
  const profiles = new Map();
  const sessions = new Map();
  const profileImageIds = new Map();
  const agriculturalImages = new Map();
  const repository = {
    async createUser(user, session) {
      if ([...users.values()].some((item) => item.email.toLowerCase() === user.email.toLowerCase())) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      const stored = { ...user, accountStatus: 'active' };
      users.set(user.id, stored);
      profiles.set(user.id, {
        userId: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        location: '',
        bio: '',
        interests: [],
        expertise: [],
        experience: '',
        specialisation: '',
        needs: '',
        qualifications: '',
        organization: '',
        jobTitle: '',
        maxActiveMentees: null,
        imageUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      sessions.set(session.tokenHash, { ...session, revokedAt: null });
      return stored;
    },
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async createSession(session) {
      sessions.set(session.tokenHash, { ...session, revokedAt: null });
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
      const user = users.get(session.userId);
      return user ? { ...user, sessionId: session.id } : null;
    },
    async revokeSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (session) session.revokedAt = new Date();
    },
    async getProfile(userId, role) {
      const profile = profiles.get(userId);
      return profile?.role === role ? profile : null;
    },
    async updateProfile(userId, role, changes) {
      const profile = profiles.get(userId);
      if (!profile || profile.role !== role) return null;
      Object.assign(profile, changes, { updatedAt: new Date().toISOString() });
      const user = users.get(userId);
      if (changes.fullName) {
        user.fullName = changes.fullName;
        profile.name = changes.fullName;
      }
      if (changes.phone !== undefined) profile.phone = changes.phone;
      return profile;
    },
    async updateProfileImage(userId, role, image) {
      const profile = profiles.get(userId);
      if (!profile || profile.role !== role) return null;
      Object.assign(profile, {
        imageUrl: image.secureUrl,
        updatedAt: new Date().toISOString(),
      });
      profileImageIds.set(userId, image.publicId);
      return profile;
    },
    async getProfileImageMetadata(userId, role) {
      const profile = profiles.get(userId);
      if (!profile || profile.role !== role) return null;
      return { publicId: profileImageIds.get(userId) ?? null };
    },
    async createAgriculturalImage(userId, image) {
      const record = {
        id: randomUUID(),
        ownerUserId: userId,
        ...image,
        createdAt: new Date().toISOString(),
      };
      agriculturalImages.set(record.id, record);
      return record;
    },
    async listAgriculturalImages(userId) {
      return [...agriculturalImages.values()].filter((image) => image.ownerUserId === userId);
    },
    async getAgriculturalImage(userId, imageId) {
      const image = agriculturalImages.get(imageId);
      return image?.ownerUserId === userId ? image : null;
    },
    async deleteAgriculturalImage(userId, imageId) {
      const image = agriculturalImages.get(imageId);
      if (image?.ownerUserId !== userId) return false;
      return agriculturalImages.delete(imageId);
    },
  };
  return { repository, users, profiles, sessions, agriculturalImages };
}

const { repository, users, profiles, sessions, agriculturalImages } = createMemoryRepository();

async function provisionStaffAccount(fullName, email) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await repository.createUser({
    id,
    fullName,
    email,
    passwordHash: 'test-only-password-hash',
    role: 'programme_staff',
    phone: '',
  }, {
    id: randomUUID(),
    userId: id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { id, token };
}

let nextImageId = 0;
const imageService = {
  async upload(_buffer, { userId, category }) {
    nextImageId += 1;
    return {
      publicId: `agrimentor/${category}/${userId}/${nextImageId}`,
      secureUrl: `https://images.example.test/${category}/${nextImageId}.jpg`,
    };
  },
  async destroy() {},
};
const authService = createAuthService(repository, { sessionTtlHours: 24, imageService });
let server;
let baseUrl;

before(async () => {
  const app = createApp({ corsOrigins: [], nodeEnv: 'test' }, { authService, imageService });
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

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('registration validates input, hashes passwords, returns no hash, and creates a session', async () => {
  const response = await post('/api/auth/register', {
    fullName: 'Test Grower',
    email: '  Test.Grower@example.test ',
    password: 'A long passphrase 123!',
    phone: '+27 72 000 0000',
    role: 'mentee',
  });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.user.email, 'test.grower@example.test');
  assert.equal(data.user.role, 'mentee');
  assert.equal('passwordHash' in data.user, false);
  assert.equal('password' in data.user, false);
  assert.equal(typeof data.token, 'string');
  assert.equal(data.profile.userId, data.user.id);

  const stored = await repository.findUserByEmail(data.user.email);
  assert.match(stored.passwordHash, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(stored.passwordHash, 'a long passphrase 123');
  assert.equal(await verifyPassword('A long passphrase 123!', stored.passwordHash), true);
  assert.equal(await verifyPassword('incorrect passphrase', stored.passwordHash), false);
});

test('registration rejects invalid fields and duplicate email without exposing account state', async () => {
  const shortPassword = await post('/api/auth/register', {
    fullName: 'Short Password',
    email: 'short-password@example.test',
    password: 'Ab1!',
    role: 'mentee',
  });
  assert.equal(shortPassword.status, 400);
  assert.deepEqual((await shortPassword.json()).error, {
    code: 'INVALID_INPUT',
    message: 'Password must be at least 6 characters and include letters, numbers, and a special character.',
  });

  const minimumPassword = await post('/api/auth/register', {
    fullName: 'Minimum Password',
    email: 'minimum-password@example.test',
    password: 'Pass1!',
    role: 'mentee',
  });
  assert.equal(minimumPassword.status, 201);

  const longerPassword = await post('/api/auth/register', {
    fullName: 'Longer Password',
    email: 'longer-password@example.test',
    password: 'Pass2!word',
    role: 'mentee',
  });
  assert.equal(longerPassword.status, 201);

  const invalid = await post('/api/auth/register', {
    fullName: 'X',
    email: 'not-an-email',
    password: 'short',
    role: 'admin',
  });

  test('login maps database outages to a safe temporary-unavailable response', async () => {
    const unavailableAuthService = createAuthService({
      async findUserByEmail() {
        throw Object.assign(new Error('database connection metadata'), { code: '08006' });
      },
    });
    const app = createApp({ corsOrigins: [], nodeEnv: 'test' }, { authService: unavailableAuthService });
    const unavailableServer = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      unavailableServer.once('listening', resolve);
      unavailableServer.once('error', reject);
    });
    try {
      const response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'grower@example.test', password: 'A long passphrase 123!' }),
      });
      assert.equal(response.status, 503);
      assert.deepEqual((await response.json()).error, {
        code: 'AUTH_UNAVAILABLE',
        message: 'Sign-in is temporarily unavailable. Please try again shortly.',
      });
    } finally {
      await new Promise((resolve, reject) => {
        unavailableServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');

  const duplicate = await post('/api/auth/register', {
    fullName: 'Another Grower',
    email: 'TEST.GROWER@example.test',
    password: 'Another strong phrase 123!',
    role: 'mentee',
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'ACCOUNT_EXISTS');
});

test('login errors are generic, profile is protected, profile updates persist, and logout revokes the token', async () => {
  const badLogin = await post('/api/auth/login', {
    email: 'missing@example.test',
    password: 'A long passphrase 123!',
  });
  assert.equal(badLogin.status, 401);
  assert.deepEqual((await badLogin.json()).error, {
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect.',
  });

  const login = await post('/api/auth/login', {
    email: 'test.grower@example.test',
    password: 'A long passphrase 123!',
  });
  assert.equal(login.status, 200);
  const { data } = await login.json();
  const token = data.token;
  assert.equal(typeof token, 'string');

  const unauthorized = await fetch(`${baseUrl}/api/profile`);
  assert.equal(unauthorized.status, 401);

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).data.email, 'test.grower@example.test');
  const sessionUser = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal((await sessionUser.json()).data.user.id, data.user.id);

  const update = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      location: 'Mbombela',
      bio: 'Smallholder grower',
      interests: ['Soil health'],
      needs: 'Irrigation advice',
      experience: 'Two seasons',
    }),
  });
  assert.equal(update.status, 200);
  const updatedProfile = (await update.json()).data;
  assert.equal(updatedProfile.location, 'Mbombela');
  assert.equal(updatedProfile.bio, 'Smallholder grower');
  assert.deepEqual(updatedProfile.interests, ['Soil health']);
  assert.equal(updatedProfile.needs, 'Irrigation advice');
  assert.equal(updatedProfile.experience, 'Two seasons');

  const secondClientLogin = await post('/api/auth/login', {
    email: 'test.grower@example.test',
    password: 'A long passphrase 123!',
  });
  const secondToken = (await secondClientLogin.json()).data.token;
  const sharedProfile = await fetch(`${baseUrl}/api/profile`, {
    headers: { authorization: `Bearer ${secondToken}` },
  });
  const reloadedProfile = (await sharedProfile.json()).data;
  assert.equal(reloadedProfile.location, 'Mbombela');
  assert.equal(reloadedProfile.bio, 'Smallholder grower');
  assert.deepEqual(reloadedProfile.interests, ['Soil health']);
  assert.equal(reloadedProfile.needs, 'Irrigation advice');
  assert.equal(reloadedProfile.experience, 'Two seasons');

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(afterLogout.status, 401);
});

test('public Programme Staff registration creates an active account with role-limited profile access', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Programme Coordinator',
    email: 'coordinator@example.test',
    password: 'A different long passphrase 123!',
    role: 'programme_staff',
  });

  assert.equal(registration.status, 201);
  const { data } = await registration.json();
  assert.equal(data.user.role, 'programme_staff');
  assert.equal(data.profile.role, 'programme_staff');
  assert.equal(users.get(data.user.id).accountStatus, 'active');

  const login = await post('/api/auth/login', {
    email: 'coordinator@example.test',
    password: 'A different long passphrase 123!',
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).data.user.role, 'programme_staff');

  const update = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${data.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ interests: ['Soil health'] }),
  });
  assert.equal(update.status, 403);
  assert.equal((await update.json()).error.code, 'ROLE_RESTRICTED');
});

test('mentors can configure a validated capacity and non-mentors cannot edit it', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Capacity Mentor',
    email: 'capacity-mentor@example.test',
    password: 'SecurePass!23',
    role: 'mentor',
  });
  assert.equal(registration.status, 201);
  const account = (await registration.json()).data;
  const headers = {
    authorization: `Bearer ${account.token}`,
    'content-type': 'application/json',
  };
  const saved = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ maxActiveMentees: 4 }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.maxActiveMentees, 4);

  const invalid = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ maxActiveMentees: 0 }),
  });
  assert.equal(invalid.status, 400);

  const unlimited = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ maxActiveMentees: null }),
  });
  assert.equal(unlimited.status, 200);
  assert.equal((await unlimited.json()).data.maxActiveMentees, null);

  const menteeToken = (await post('/api/auth/login', {
    email: 'test.grower@example.test',
    password: 'A long passphrase 123!',
  }).then((response) => response.json())).data.token;
  const denied = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${menteeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ maxActiveMentees: 2 }),
  });
  assert.equal(denied.status, 403);
  assert.notEqual(account.user.id, (await repository.findUserByEmail('test.grower@example.test')).id);
});

test('mentor availability notes validate length, persist, and report an unapplied migration accurately', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Availability Mentor',
    email: 'availability-mentor@example.test',
    password: 'SecurePass!23',
    role: 'mentor',
  });
  assert.equal(registration.status, 201);
  const account = (await registration.json()).data;
  const headers = {
    authorization: `Bearer ${account.token}`,
    'content-type': 'application/json',
  };
  const note = 'Available for weekday evening calls.'.padEnd(500, 'x');
  const saved = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ availabilityNote: note }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.availabilityNote, note);

  const tooLong = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ availabilityNote: `${note}x` }),
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error.message, 'Availability notes must be 500 characters or fewer.');

  const unavailableService = createAuthService({
    async updateProfile() {
      throw Object.assign(new Error('column "availability_note" does not exist'), {
        code: '42703',
        column: 'availability_note',
      });
    },
  });
  await assert.rejects(
    unavailableService.updateProfile({ id: account.user.id, role: 'mentor' }, { availabilityNote: 'Weekday evenings' }),
    (error) => error.status === 503
      && error.code === 'MENTOR_AVAILABILITY_NOT_CONFIGURED',
  );
});

test('mentor registration and login return the stored role and matching profile', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Mentor Example',
    email: 'mentor@example.test',
    password: 'A mentor passphrase 123!',
    role: 'mentor',
  });
  assert.equal(registration.status, 201);
  const registered = (await registration.json()).data;
  assert.equal(registered.user.role, 'mentor');
  assert.equal(registered.profile.role, 'mentor');

  const login = await post('/api/auth/login', {
    email: 'MENTOR@example.test',
    password: 'A mentor passphrase 123!',
  });
  assert.equal(login.status, 200);
  const loggedIn = (await login.json()).data;
  assert.equal(loggedIn.user.role, 'mentor');
  assert.equal(loggedIn.profile.role, 'mentor');

  const wrongPassword = await post('/api/auth/login', {
    email: 'mentor@example.test',
    password: 'A wrong passphrase 123!',
  });
  assert.equal(wrongPassword.status, 401);
});

test('Programme Staff profiles can be retrieved and updated with validated fields', async () => {
  const { id, token } = await provisionStaffAccount('Staff Profile', 'staff-profile@example.test');

  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const update = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ organization: 'Agri Mentor', jobTitle: 'Coordinator' }),
  });
  assert.equal(update.status, 200);
  const profile = (await update.json()).data;
  assert.equal(profile.organization, 'Agri Mentor');
  assert.equal(profile.jobTitle, 'Coordinator');

  const invalidField = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ organization: 'x'.repeat(161) }),
  });
  assert.equal(invalidField.status, 400);
  assert.equal((await invalidField.json()).error.code, 'INVALID_INPUT');

  const roleChange = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ role: 'mentor' }),
  });
  assert.equal(roleChange.status, 400);
  assert.equal((await roleChange.json()).error.code, 'INVALID_INPUT');
  assert.equal((await repository.findUserByEmail('staff-profile@example.test')).role, 'programme_staff');
});

test('profile retrieval rejects an account/profile role mismatch', async () => {
  const user = [...users.values()].find((item) => item.email === 'test.grower@example.test');
  assert.ok(user);
  assert.equal(await repository.getProfile(user.id, 'mentor'), null);
  assert.equal(profiles.get(user.id).role, 'mentee');
});

test('missing role profiles return not found instead of a partial profile', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Missing Profile',
    email: 'missing-profile@example.test',
    password: 'A missing profile passphrase 123!',
    role: 'mentee',
  });
  const { data } = await registration.json();
  profiles.delete(data.user.id);
  const response = await fetch(`${baseUrl}/api/profile`, {
    headers: { authorization: 'Bearer ' + data.token },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'PROFILE_NOT_FOUND');
});

test('authenticated users in all roles can upload profile and agricultural images with validated content', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const upload = async (path, token, bytes = png, type = 'image/png') => {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type }), 'farm.png');
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };

  const unauthorized = await fetch(`${baseUrl}/api/agricultural-images`);
  assert.equal(unauthorized.status, 401);

  for (const role of ['mentee', 'mentor', 'programme_staff']) {
    let data;
    if (role === 'programme_staff') {
      const provisioned = await provisionStaffAccount(`Image ${role}`, `image-${role}@example.test`);
      data = { token: provisioned.token };
    } else {
      const registration = await post('/api/auth/register', {
        fullName: `Image ${role}`,
        email: `image-${role}@example.test`,
        password: 'A profile image passphrase 123!',
        role,
      });
      assert.equal(registration.status, 201);
      data = (await registration.json()).data;
    }
    const profileImage = await upload('/api/profile/image', data.token);
    assert.equal(profileImage.status, 200);
    const profile = (await profileImage.json()).data;
    assert.equal(profile.imageUrl.startsWith('https://'), true);
    assert.equal(Object.hasOwn(profile, 'cloudinaryPublicId'), false);

    const invalidContent = await upload(
      '/api/profile/image',
      data.token,
      png,
      'image/jpeg',
    );
    assert.equal(invalidContent.status, 415);

    if (role === 'mentee') {
      const agricultural = await upload('/api/agricultural-images', data.token);
      assert.equal(agricultural.status, 201);
      const listed = await fetch(`${baseUrl}/api/agricultural-images`, {
        headers: { authorization: `Bearer ${data.token}` },
      });
      assert.equal(listed.status, 200);
      const images = (await listed.json()).data;
      assert.equal(images.length, 1);
      assert.equal(images[0].secureUrl.startsWith('https://'), true);
      assert.equal(agriculturalImages.size, 1);

      const secondMentee = await post('/api/auth/register', {
        fullName: 'Another Image Owner',
        email: 'another-image-owner@example.test',
        password: 'A profile image passphrase 123!',
        role: 'mentee',
      });
      const otherToken = (await secondMentee.json()).data.token;
      const forbiddenDelete = await fetch(`${baseUrl}/api/agricultural-images/${images[0].id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${otherToken}` },
      });
      assert.equal(forbiddenDelete.status, 404);

      const deleted = await fetch(`${baseUrl}/api/agricultural-images/${images[0].id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${data.token}` },
      });
      assert.equal(deleted.status, 200);
      assert.equal(agriculturalImages.size, 0);
    }
  }
});

test('expired sessions are rejected', async () => {
  const registration = await post('/api/auth/register', {
    fullName: 'Expired Session',
    email: 'expired@example.test',
    password: 'An expired session pass 123!',
    role: 'mentee',
  });
  assert.equal(registration.status, 201);
  const { data } = await registration.json();
  const tokenHash = createHash('sha256').update(data.token).digest('hex');
  sessions.get(tokenHash).expiresAt = new Date(Date.now() - 1000);

  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: 'Bearer ' + data.token },
  });
  assert.equal(response.status, 401);
});
