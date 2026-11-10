import type { LocalProfile, UserRole } from './local-data';

export type ProfileUpdateChanges = Partial<Omit<LocalProfile, 'userId' | 'updatedAt'>> & {
  name?: string;
  phone?: string;
};

export function profileUpdatePayload(changes: ProfileUpdateChanges): Record<string, unknown> {
  const { name, ...profileChanges } = changes;
  return {
    ...profileChanges,
    ...(name !== undefined ? { fullName: name } : {}),
  };
}

export function profileCompletionMessage(role: UserRole, profile: LocalProfile): string | null {
  const missing: string[] = [];
  if (!profile.location.trim()) missing.push('location');
  if (!profile.bio.trim()) missing.push('short introduction');

  if (role === 'mentor') {
    if (!profile.expertise.length) missing.push('at least one area of expertise');
    if (!profile.specialisation.trim()) missing.push('specialisation');
    if (!profile.experience.trim()) missing.push('experience');
  } else if (role === 'mentee') {
    if (!profile.interests.length) missing.push('at least one agricultural interest');
    if (!profile.needs.trim()) missing.push('guidance needs');
    if (!profile.experience.trim()) missing.push('experience');
  }

  return missing.length ? `Please add ${missing.join(', ')} before saving your profile.` : null;
}
