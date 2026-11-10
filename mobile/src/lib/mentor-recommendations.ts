import { LocalGoal, LocalProfile } from './local-data';
import { MentorDirectoryProfile } from './auth-api';

export type MentorRecommendation = {
  mentor: MentorDirectoryProfile;
  reasons: string[];
  score: number;
};

const ignoredTerms = new Set([
  'about', 'after', 'again', 'could', 'grow', 'growing', 'have', 'help', 'into',
  'need', 'needs', 'that', 'their', 'them', 'there', 'these', 'they', 'this',
  'want', 'with', 'would', 'your',
]);

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function terms(value: string): string[] {
  return [...new Set(
    normalized(value)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4 && !ignoredTerms.has(term)),
  )];
}

export function recommendMentors(
  profile: LocalProfile,
  activeGoals: LocalGoal[],
  mentors: MentorDirectoryProfile[],
): MentorRecommendation[] {
  const needsTerms = terms(profile.needs);
  const goalTerms = terms(activeGoals
    .filter((goal) => goal.status === 'active')
    .map((goal) => `${goal.title} ${goal.measurableOutcome}`)
    .join(' '));

  return mentors.map((mentor) => {
    const expertise = mentor.expertise.map(normalized);
    const sharedInterests = profile.interests.filter((interest) => (
      expertise.some((topic) => topic === normalized(interest))
    ));
    const matchingNeeds = needsTerms.filter((term) => expertise.some((topic) => topic.includes(term)));
    const matchingGoals = goalTerms.filter((term) => expertise.some((topic) => topic.includes(term)));
    const reasons = [
      ...sharedInterests.map((interest) => `Expertise matches your interest in ${interest}`),
      ...(matchingNeeds.length ? [`Expertise relates to your stated needs: ${matchingNeeds.slice(0, 3).join(', ')}`] : []),
      ...(matchingGoals.length ? [`Expertise relates to your active goals: ${matchingGoals.slice(0, 3).join(', ')}`] : []),
    ];
    const capacityScore = mentor.availableSlots === null ? 0 : mentor.availableSlots > 0 ? 1 : -100;
    return {
      mentor,
      reasons: reasons.length ? reasons : ['No direct expertise match found; review the profile before requesting.'],
      score: sharedInterests.length * 5 + matchingNeeds.length * 2 + matchingGoals.length * 3 + capacityScore,
    };
  })
    .filter((item) => item.score > -100)
    .sort((left, right) => right.score - left.score || left.mentor.name.localeCompare(right.mentor.name));
}
