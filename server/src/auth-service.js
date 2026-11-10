const { createHash, randomBytes, randomUUID } = require('node:crypto');

const { HttpError } = require('./http-error');
const { hashPassword, verifyPassword } = require('./passwords');
const { validateImage } = require('./image-validation');

const roles = new Set(['mentee', 'mentor', 'programme_staff']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{6,128}$/;
const passwordRequirementMessage = 'Password must be at least 6 characters and include letters, numbers, and a special character.';
const invalidCredentials = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

function validatePassword(password) {
  if (typeof password !== 'string' || !passwordPattern.test(password)) {
    throw new HttpError(400, 'INVALID_INPUT', passwordRequirementMessage);
  }
}

function authRepositoryUnavailable(error) {
  const isPostgresError = typeof error?.code === 'string' && /^\d{5}$/.test(error.code);
  const isConnectionError = typeof error?.code === 'string'
    && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code);
  return isPostgresError || isConnectionError;
}

function safeAuthRepositoryError(error) {
  if (!authRepositoryUnavailable(error)) return error;
  return new HttpError(503, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please try again shortly.');
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function newSession(userId, sessionTtlHours) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    record: {
      id: randomUUID(),
      userId,
      tokenHash: tokenDigest(token),
      expiresAt,
    },
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    phone: user.phone ?? '',
    role: user.role,
  };
}

function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter valid registration details.');
  }

  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';

  if (fullName.length < 2 || fullName.length > 120
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || phone.length > 40 || !roles.has(input.role)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Check your name, email, password, phone number, and role.');
  }
  validatePassword(password);
  return { fullName, email, password, phone, role: input.role };
}

function validateStaffInvitationRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['token', 'fullName', 'email', 'password', 'phone'].includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter valid programme invitation details.');
  }
  const token = typeof input.token === 'string' ? input.token : '';
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)
    || fullName.length < 2 || fullName.length > 120
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || phone.length > 40) {
    throw new HttpError(400, 'INVALID_INPUT', 'Check the invitation, name, email, password, and phone number.');
  }
  validatePassword(password);
  return { token, fullName, email, password, phone };
}

function validateProfile(input, role) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Enter valid profile details.');
  }
  const allowed = new Set([
    'fullName', 'phone', 'location', 'bio', 'interests', 'expertise', 'needs',
    'experience', 'specialisation', 'qualifications', 'organization', 'jobTitle',
    'maxActiveMentees', 'availabilityNote',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'The profile contains unsupported fields.');
  }
  const roleFields = {
    mentee: new Set(['fullName', 'phone', 'location', 'bio', 'interests', 'needs', 'experience']),
    mentor: new Set(['fullName', 'phone', 'location', 'bio', 'expertise', 'experience', 'specialisation', 'qualifications', 'maxActiveMentees', 'availabilityNote']),
    programme_staff: new Set(['fullName', 'phone', 'organization', 'jobTitle']),
  }[role];
  if (Object.keys(input).some((key) => !roleFields.has(key))) {
    throw new HttpError(403, 'ROLE_RESTRICTED', 'This profile field is not available for your account role.');
  }

  const profile = {};
  if ('fullName' in input) {
    if (typeof input.fullName !== 'string' || input.fullName.trim().length < 2 || input.fullName.trim().length > 120) {
      throw new HttpError(400, 'INVALID_INPUT', 'Enter a name between 2 and 120 characters.');
    }
    profile.fullName = input.fullName.trim();
  }
  if ('phone' in input) {
    if (typeof input.phone !== 'string' || input.phone.trim().length > 40) {
      throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid phone number.');
    }
    profile.phone = input.phone.trim();
  }
  for (const field of ['organization', 'jobTitle']) {
    if (field in input) {
      if (typeof input[field] !== 'string' || input[field].trim().length > 160) {
        throw new HttpError(400, 'INVALID_INPUT', `${field} must be text no longer than 160 characters.`);
      }
      profile[field] = input[field].trim();
    }
  }
  if ('maxActiveMentees' in input) {
    if (role !== 'mentor') {
      throw new HttpError(403, 'ROLE_RESTRICTED', 'Only mentors can update active mentee capacity.');
    }
    if (input.maxActiveMentees !== null
      && (!Number.isInteger(input.maxActiveMentees)
        || input.maxActiveMentees < 1
        || input.maxActiveMentees > 32767)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Maximum active mentees must be a whole number from 1 to 32767, or empty for unlimited.');
    }
    profile.maxActiveMentees = input.maxActiveMentees;
  }
  if ('availabilityNote' in input) {
    if (typeof input.availabilityNote !== 'string' || input.availabilityNote.trim().length > 500) {
      throw new HttpError(400, 'INVALID_INPUT', 'Availability notes must be 500 characters or fewer.');
    }
    profile.availabilityNote = input.availabilityNote.trim();
  }
  for (const field of ['location', 'bio', 'needs', 'experience', 'specialisation', 'qualifications']) {
    if (field in input) {
      if (typeof input[field] !== 'string' || input[field].length > 2000) {
        throw new HttpError(400, 'INVALID_INPUT', `${field} must be text no longer than 2000 characters.`);
      }
      profile[field] = input[field].trim();
    }
  }
  const listField = role === 'mentor' ? 'expertise' : 'interests';
  if (listField in input) {
    if (!Array.isArray(input[listField]) || input[listField].length > 30
      || input[listField].some((item) => typeof item !== 'string' || item.trim().length < 1 || item.trim().length > 80)) {
      throw new HttpError(400, 'INVALID_INPUT', `${listField} must contain up to 30 labels of 1 to 80 characters.`);
    }
    profile[listField] = [...new Set(input[listField].map((item) => item.trim()))];
  }
  return profile;
}

function createAuthService(repository, { sessionTtlHours = 24, imageService = null } = {}) {
  const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));

  async function createSession(user) {
    const session = newSession(user.id, sessionTtlHours);
    await repository.createSession(session.record);
    return { token: session.token, expiresAt: session.expiresAt };
  }

  return {
    async register(input) {
      const account = validateRegistration(input);
      const passwordHash = await hashPassword(account.password);
      const id = randomUUID();
      const session = newSession(id, sessionTtlHours);
      let user;
      try {
        user = await repository.createUser({
          id,
          fullName: account.fullName,
          email: account.email,
          passwordHash,
          role: account.role,
          phone: account.phone,
        }, session.record);
      } catch (error) {
        if (error.code === '23505' || error.code === 'ACCOUNT_EXISTS') {
          throw new HttpError(409, 'ACCOUNT_EXISTS', 'An account could not be created with those details.');
        }
        throw error;
      }
      const profile = await repository.getProfile(user.id, user.role);
      if (!profile) {
        throw new HttpError(500, 'PROFILE_INCONSISTENT', 'The account profile could not be retrieved.');
      }
      return { token: session.token, expiresAt: session.expiresAt, user: publicUser(user), profile };
    },

    async consumeStaffInvitation(input) {
      if (typeof repository.consumeStaffInvitation !== 'function') {
        throw new HttpError(503, 'STAFF_PROVISIONING_UNAVAILABLE', 'Programme Staff invitations are not configured.');
      }
      const invite = validateStaffInvitationRegistration(input);
      const id = randomUUID();
      const session = newSession(id, sessionTtlHours);
      let storedUser;
      try {
        storedUser = await repository.consumeStaffInvitation({
          tokenHash: tokenDigest(invite.token),
          email: invite.email,
          user: {
            id,
            fullName: invite.fullName,
            passwordHash: await hashPassword(invite.password),
            phone: invite.phone,
          },
          session: session.record,
        });
      } catch (error) {
        if (error.code === 'INVITATION_INVALID') {
          throw new HttpError(400, 'INVITATION_INVALID', 'This invitation is invalid, expired, or already used.');
        }
        if (error.code === '23505' || error.code === 'ACCOUNT_EXISTS') {
          throw new HttpError(409, 'ACCOUNT_EXISTS', 'An account could not be created with those details.');
        }
        throw safeAuthRepositoryError(error);
      }
      const user = {
        id: storedUser.id,
        fullName: storedUser.full_name,
        email: storedUser.email,
        phone: storedUser.phone,
        role: storedUser.role,
        accountStatus: storedUser.account_status,
      };
      const profile = await repository.getProfile(user.id, user.role);
      if (!profile) {
        throw new HttpError(500, 'PROFILE_INCONSISTENT', 'The account profile could not be retrieved.');
      }
      return { token: session.token, expiresAt: session.expiresAt, user: publicUser(user), profile };
    },

    async login(input) {
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input?.password === 'string' ? input.password : '';
      if (!email || email.length > 254 || !passwordPattern.test(password)) {
        throw invalidCredentials();
      }
      try {
        const user = await repository.findUserByEmail(email);
        const passwordHash = user?.passwordHash ?? await dummyPasswordHash;
        const passwordMatches = await verifyPassword(password, passwordHash);
        if (!user || user.accountStatus !== 'active' || !passwordMatches) {
          throw invalidCredentials();
        }
        const profile = await repository.getProfile(user.id, user.role);
        if (!profile) {
          throw new HttpError(500, 'PROFILE_INCONSISTENT', 'The account profile could not be retrieved.');
        }
        const session = await createSession(user);
        return { ...session, user: publicUser(user), profile };
      } catch (error) {
        throw safeAuthRepositoryError(error);
      }
    },

    async authenticate(token) {
      if (typeof token !== 'string' || token.length < 40 || token.length > 100) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      }
      const session = await repository.findSession(tokenDigest(token));
      if (!session || session.accountStatus !== 'active') {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      }
      return { user: publicUser(session), sessionId: session.sessionId };
    },

    async getProfile(userId, role) {
      const profile = await repository.getProfile(userId, role);
      if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      return profile;
    },

    async updateProfile(user, input) {
      const changes = validateProfile(input, user.role);
      let profile;
      try {
        profile = await repository.updateProfile(user.id, user.role, changes);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error.constraint === 'mentor_capacity_not_below_active_count') {
          throw new HttpError(
            409,
            'MENTOR_CAPACITY_BELOW_ACTIVE_COUNT',
            'Maximum mentees cannot be lower than your current active mentorship count.',
          );
        }
        if (error.code === '42703' && (error.column === 'availability_note'
          || error.message?.includes('column "availability_note"'))) {
          throw new HttpError(
            503,
            'MENTOR_AVAILABILITY_NOT_CONFIGURED',
            'Mentor availability notes require an approved database migration.',
          );
        }
        throw error;
      }
      if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      return profile;
    },

    async uploadProfileImage(user, file) {
      if (!imageService) throw new HttpError(503, 'IMAGE_UPLOAD_UNAVAILABLE', 'Image uploads are not configured.');
      const metadata = validateImage(file.buffer, file.mimetype);
      const existing = await repository.getProfileImageMetadata(user.id, user.role);
      if (!existing) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      const uploaded = await imageService.upload(file.buffer, {
        userId: user.id,
        category: 'profile',
      });
      let profile;
      try {
        profile = await repository.updateProfileImage(user.id, user.role, {
          ...uploaded,
          contentType: metadata.contentType,
          sizeBytes: metadata.sizeBytes,
        });
      } catch (error) {
        try {
          await imageService.destroy(uploaded.publicId);
        } catch (cleanupError) {
          console.error('Could not clean up an unlinked profile image:', cleanupError.message);
        }
        throw error;
      }
      if (!profile) {
        try {
          await imageService.destroy(uploaded.publicId);
        } catch (error) {
          console.error('Could not clean up an unlinked profile image:', error.message);
        }
        throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      }
      if (existing.publicId && existing.publicId !== uploaded.publicId) {
        try {
          await imageService.destroy(existing.publicId);
        } catch (error) {
          console.error('Could not remove the replaced profile image:', error.message);
        }
      }
      return profile;
    },

    async uploadAgriculturalImage(user, file) {
      if (!imageService) throw new HttpError(503, 'IMAGE_UPLOAD_UNAVAILABLE', 'Image uploads are not configured.');
      const metadata = validateImage(file.buffer, file.mimetype);
      const uploaded = await imageService.upload(file.buffer, {
        userId: user.id,
        category: 'agricultural',
      });
      try {
        return await repository.createAgriculturalImage(user.id, {
          ...uploaded,
          ...metadata,
        });
      } catch (error) {
        try {
          await imageService.destroy(uploaded.publicId);
        } catch (cleanupError) {
          console.error('Could not clean up an unlinked agricultural image:', cleanupError.message);
        }
        throw error;
      }
    },

    async listAgriculturalImages(userId) {
      if (!repository.listAgriculturalImages) {
        throw new HttpError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Image storage is not available.');
      }
      return repository.listAgriculturalImages(userId);
    },

    async deleteAgriculturalImage(user, imageId) {
      if (!uuidPattern.test(imageId ?? '')) {
        throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid image ID.');
      }
      if (!imageService) throw new HttpError(503, 'IMAGE_UPLOAD_UNAVAILABLE', 'Image uploads are not configured.');
      const image = await repository.getAgriculturalImage(user.id, imageId);
      if (!image) throw new HttpError(404, 'IMAGE_NOT_FOUND', 'Agricultural image not found.');
      await imageService.destroy(image.publicId);
      const deleted = await repository.deleteAgriculturalImage(user.id, imageId);
      if (!deleted) throw new HttpError(404, 'IMAGE_NOT_FOUND', 'Agricultural image not found.');
      return { deleted: true };
    },

    async logout(token) {
      if (typeof token === 'string' && token.length >= 40 && token.length <= 100) {
        await repository.revokeSession(tokenDigest(token));
      }
    },
  };
}

module.exports = { createAuthService, publicUser, validateProfile, validateRegistration };
