const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const { createAuthService } = require('../src/auth-service');
const { verifyPassword } = require('../src/passwords');

const invitationToken = 'a'.repeat(43);

function createInvitationHarness({
  expiresAt = new Date(Date.now() + 60_000),
  used = false,
  revoked = false,
} = {}) {
  const assignments = [];
  const users = [];
  const invitation = {
    tokenHash: createHash('sha256').update(invitationToken).digest('hex'),
    email: 'staff@example.test',
    programmeId: '66000000-0000-4000-8000-000000000001',
    expiresAt,
    usedAt: used ? new Date() : null,
    revokedAt: revoked ? new Date() : null,
  };
  const repository = {
    async consumeStaffInvitation({ tokenHash, email, user, session }) {
      if (tokenHash !== invitation.tokenHash || email !== invitation.email
        || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
        const error = new Error('invalid invitation');
        error.code = 'INVITATION_INVALID';
        throw error;
      }
      const stored = {
        id: user.id,
        full_name: user.fullName,
        email,
        phone: user.phone,
        role: 'programme_staff',
        account_status: 'active',
        passwordHash: user.passwordHash,
      };
      users.push(stored);
      assignments.push({ programmeId: invitation.programmeId, staffUserId: user.id });
      invitation.usedAt = new Date();
      invitation.usedBy = user.id;
      invitation.session = session;
      return stored;
    },
    async getProfile(userId, role) {
      return { userId, role, organization: '', jobTitle: '' };
    },
  };
  return { authService: createAuthService(repository), invitation, assignments, users };
}

test('invalid, expired and already consumed invitations do not provision Staff accounts', async (t) => {
  const scenarios = [
    { name: 'invalid', options: {}, token: 'b'.repeat(43) },
    { name: 'expired', options: { expiresAt: new Date(Date.now() - 1000) } },
    { name: 'reused', options: { used: true } },
    { name: 'revoked', options: { revoked: true } },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const harness = createInvitationHarness(scenario.options);
      await assert.rejects(
        harness.authService.consumeStaffInvitation({
          token: scenario.token ?? invitationToken,
          fullName: 'Programme Officer',
          email: 'staff@example.test',
          password: 'Pass1!23',
          phone: '',
        }),
        (error) => error.status === 400 && error.code === 'INVITATION_INVALID',
      );
      assert.equal(harness.users.length, 0);
      assert.equal(harness.assignments.length, 0);
    });
  }
});

test('valid invitation creates a Staff account and assigns only its intended programme', async () => {
  const harness = createInvitationHarness();
  const result = await harness.authService.consumeStaffInvitation({
    token: invitationToken,
    fullName: 'Programme Officer',
    email: ' STAFF@example.test ',
    password: 'Pass1!23',
    phone: '+27 72 000 0000',
  });
  assert.equal(result.user.role, 'programme_staff');
  assert.equal(result.user.email, 'staff@example.test');
  assert.equal(result.profile.role, 'programme_staff');
  assert.equal(await verifyPassword('Pass1!23', harness.users[0].passwordHash), true);
  assert.equal(harness.assignments.length, 1);
  assert.equal(harness.assignments[0].programmeId, harness.invitation.programmeId);
  assert.equal(harness.invitation.usedBy, result.user.id);
  assert.equal(harness.invitation.session.userId, result.user.id);
  assert.notEqual(harness.invitation.tokenHash, invitationToken);
});

test('invitation registration cannot choose an account role or bypass the password policy', async () => {
  const harness = createInvitationHarness();
  await assert.rejects(
    harness.authService.consumeStaffInvitation({
      token: invitationToken,
      fullName: 'Programme Officer',
      email: 'staff@example.test',
      password: 'Pass1!23',
      phone: '',
      role: 'mentor',
    }),
    (error) => error.status === 400 && error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    harness.authService.consumeStaffInvitation({
      token: invitationToken,
      fullName: 'Programme Officer',
      email: 'staff@example.test',
      password: 'Ab1!',
      phone: '',
    }),
    (error) => error.status === 400 && error.code === 'INVALID_INPUT',
  );
  assert.equal(harness.users.length, 0);
});
