import { LocalData, LocalProfile, LocalUser } from './local-data';

export type MentorMatch = {
  user: LocalUser;
  profile: LocalProfile;
  points: number;
  reasons: string[];
  sharedTopics: string[];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function rankMentors(data: LocalData, menteeId: string): MentorMatch[] {
  const menteeProfile = data.profiles.find((profile) => profile.userId === menteeId);
  if (!menteeProfile) return [];

  return data.users
    .filter((user) => user.role === 'mentor')
    .map((user) => {
      const profile = data.profiles.find((item) => item.userId === user.id);
      if (!profile) return null;

      const interestSet = new Set(menteeProfile.interests.map(normalized));
      const sharedTopics = profile.expertise.filter((topic) => interestSet.has(normalized(topic)));
      const needTerms = normalized(menteeProfile.needs)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 5);
      const specialisationText = normalized(`${profile.specialisation} ${profile.bio} ${profile.expertise.join(' ')}`);
      const needMatches = [...new Set(needTerms.filter((term) => specialisationText.includes(term)))];
      const sameRegion = normalized(profile.location.split(',').slice(-1)[0] ?? '') !== ''
        && normalized(profile.location.split(',').slice(-1)[0] ?? '') === normalized(menteeProfile.location.split(',').slice(-1)[0] ?? '');
      const points = sharedTopics.length * 4 + Math.min(needMatches.length, 3) * 2 + (sameRegion ? 1 : 0);
      const reasons = [
        ...(sharedTopics.length ? [`Expertise matches ${sharedTopics.join(', ')}`] : []),
        ...(needMatches.length ? [`Profile relates to your needs: ${needMatches.slice(0, 3).join(', ')}`] : []),
        ...(sameRegion ? ['Located in the same region'] : []),
      ];
      return { user, profile, points, reasons, sharedTopics };
    })
    .filter((match): match is MentorMatch => match !== null)
    .sort((left, right) => right.points - left.points || left.user.name.localeCompare(right.user.name));
}
