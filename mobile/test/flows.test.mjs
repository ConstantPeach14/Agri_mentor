import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loginErrorMessage } from '../src/lib/auth-errors.ts';
import { APP_ROUTES, canOpenAppRoute, isAppRoute, registrationRole, roleTabRoutes } from '../src/lib/app-routes.ts';
import { passwordValidationMessage } from '../src/lib/password-validation.ts';
import { profileCompletionMessage, profileUpdatePayload } from '../src/lib/profile-workflow.ts';
import { parseLocalDateTime } from '../src/lib/session-date-time.ts';

test('password validation rejects five characters and accepts six or more', () => {
  assert.match(passwordValidationMessage('12345') ?? '', /at least 6 characters/);
  assert.equal(passwordValidationMessage('123456'), null);
  assert.equal(passwordValidationMessage('1234567'), null);
});

test('login error messages distinguish credentials, unavailable service, network, and configuration', () => {
  assert.equal(loginErrorMessage({ code: 'INVALID_CREDENTIALS' }), 'The email or password is incorrect.');
  assert.match(loginErrorMessage({ code: 'AUTH_UNAVAILABLE', status: 503 }), /temporarily unavailable/);
  assert.match(loginErrorMessage(new Error('Could not reach the agriMentor API. Try again.')), /connection/);
  assert.match(loginErrorMessage(new Error('EXPO_PUBLIC_API_URL is not set')), /not configured/);
  assert.match(loginErrorMessage(new Error('database connection metadata')), /could not be completed/);
});

test('profile completion requires role-specific fields without inventing qualifications', () => {
  const mentor = {
    location: 'Rural district',
    bio: 'Farmer and adviser',
    expertise: ['Irrigation'],
    specialisation: 'Smallholder systems',
    experience: '8 years',
    qualifications: '',
    interests: [],
    needs: '',
  };
  assert.equal(profileCompletionMessage('mentor', mentor), null);
  assert.match(profileCompletionMessage('mentor', { ...mentor, expertise: [] }) ?? '', /area of expertise/);

  const mentee = {
    location: 'Rural district',
    bio: 'Early stage grower',
    interests: ['Vegetables'],
    needs: 'Soil health guidance',
    experience: '2 years',
    expertise: [],
    specialisation: '',
    qualifications: '',
  };
  assert.equal(profileCompletionMessage('mentee', mentee), null);
});

test('Mentee profile update payload maps full name and preserves role-specific fields', () => {
  assert.deepEqual(profileUpdatePayload({
    name: 'Updated Grower',
    phone: '+27 72 000 0000',
    location: 'Mbombela',
    bio: 'Smallholder grower',
    interests: ['Soil health'],
    needs: 'Irrigation advice',
    experience: 'Two seasons',
  }), {
    phone: '+27 72 000 0000',
    location: 'Mbombela',
    bio: 'Smallholder grower',
    interests: ['Soil health'],
    needs: 'Irrigation advice',
    experience: 'Two seasons',
    fullName: 'Updated Grower',
  });
});

test('dashboard destinations resolve to role-appropriate existing routes', () => {
  assert.equal(APP_ROUTES.goals, '/(tabs)/goals');
  assert.equal(APP_ROUTES.sessions, '/(tabs)/sessions');
  assert.equal(canOpenAppRoute('mentor', 'goals'), true);
  assert.equal(canOpenAppRoute('mentor', 'requests'), true);
  assert.equal(canOpenAppRoute('mentor', 'sessions'), true);
  assert.equal(canOpenAppRoute('mentee', 'requests'), true);
  assert.equal(canOpenAppRoute('mentee', 'sessions'), true);
  assert.equal(canOpenAppRoute('staff', 'goals'), false);
  assert.equal(canOpenAppRoute('mentor', 'discover'), false);
});

test('role selection carries a valid role to account creation and defaults safely for invalid input', () => {
  assert.equal(registrationRole('mentee'), 'mentee');
  assert.equal(registrationRole('mentor'), 'mentor');
  assert.equal(registrationRole('staff'), 'staff');
  assert.equal(registrationRole(['staff']), 'staff');
  assert.equal(registrationRole('administrator'), null);
  assert.equal(registrationRole(undefined), null);
});

test('role-specific bottom navigation only exposes existing permitted screens', () => {
  assert.deepEqual(roleTabRoutes.mentee, ['dashboard', 'discover', 'mentorship', 'goals', 'profile']);
  assert.deepEqual(roleTabRoutes.mentor, ['dashboard', 'requests', 'mentorship', 'sessions', 'profile']);
  assert.deepEqual(roleTabRoutes.staff, ['dashboard', 'participants', 'profile']);
  for (const route of roleTabRoutes.staff) assert.equal(canOpenAppRoute('staff', route), true);
});

test('direct tab routes are recognized for the shared role guard', () => {
  assert.equal(isAppRoute('discover'), true);
  assert.equal(isAppRoute('participants'), true);
  assert.equal(isAppRoute('programme'), true);
  assert.equal(isAppRoute('mentor'), false);
  assert.equal(isAppRoute(undefined), false);
  assert.equal(canOpenAppRoute('staff', 'participants'), true);
  assert.equal(canOpenAppRoute('staff', 'programme'), true);
  assert.equal(canOpenAppRoute('mentee', 'programme'), false);
  assert.equal(canOpenAppRoute('staff', 'requests'), false);
});

test('session local date-time validation rejects invalid calendar dates and clock values', () => {
  assert.ok(parseLocalDateTime('2028-02-29 14:30'));
  assert.ok(parseLocalDateTime('2027-01-01T14:30'));
  for (const value of [
    '2027-02-29 14:30',
    '2027-02-31 14:30',
    '2027-13-01 14:30',
    '2027-01-01 24:00',
    '2027-01-01 14:60',
    'invalid',
  ]) {
    assert.equal(parseLocalDateTime(value), null, value);
  }
});
