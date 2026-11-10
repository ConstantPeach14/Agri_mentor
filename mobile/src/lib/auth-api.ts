import { apiRequest } from './api';
import {
  GoalMilestone,
  LocalGoal,
  LocalProfile,
  LocalSession,
  LocalUser,
  Mentorship,
  MentorshipRequest,
  RequestStatus,
  SessionStatus,
  UserRole,
} from './local-data';
import { Platform } from 'react-native';
import { profileUpdatePayload } from './profile-workflow';

type ApiRole = UserRole | 'programme_staff';
type ApiUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: ApiRole;
};

export type StaffProgramme = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  assignedAt: string;
  menteeCount: number;
  mentorCount: number;
};

export type StaffDashboard = {
  summary: {
    programmeCount: number;
    menteeCount: number;
    mentorCount: number;
    activeRelationshipCount: number;
    pendingRequestCount: number;
    upcomingSessionCount: number;
    completedSessionCount: number;
    cancelledSessionCount: number;
    overdueSessionCount: number;
    unmatchedMenteeCount: number;
    unmatchedMentorCount: number;
    activeGoalCount: number;
    activeMilestoneCount: number;
    completedGoalCount: number;
    completedMilestoneCount: number;
  };
  programmes: StaffProgramme[];
  recentActivity: {
    type: string;
    id: string;
    label: string;
    occurredAt: string;
    relationshipId: string | null;
  }[];
};

export type StaffParticipant = {
  id: string;
  name: string;
  role: 'mentee' | 'mentor';
  membershipStatus: 'active' | 'removed';
  assignedAt: string;
  programmeId: string;
  programmeName: string;
  location: string;
  bio: string;
  imageUrl: string | null;
  experience: string;
  interests: string[];
  expertise: string[];
  specialisation: string | null;
  maxActiveMentees: number | null;
  activeMentees: number;
  availabilityNote: string;
};

export type StaffParticipantDetail = {
  id: string;
  name: string;
  role: 'mentee' | 'mentor';
  location: string;
  bio: string;
  imageUrl: string | null;
  experienceLevel: string | null;
  experienceYears: number | null;
  specialisation: string | null;
  interests: string[];
  expertise: string[];
  programmes: {
    id: string;
    name: string;
    membershipStatus: string;
    assignedAt: string;
  }[];
};

export type StaffProgrammeOversight = {
  programme: Pick<StaffProgramme, 'id' | 'name' | 'description'> & { status: string };
  requests: Record<string, string | null>[];
  relationships: Record<string, string | null>[];
  sessions: StaffSessionOversight[];
  goals: Record<string, unknown>[];
  matchProposals: ProgrammeMatchProposal[];
};

export type ProgrammeMatchProposal = {
  id: string;
  programmeId: string;
  menteeId: string;
  menteeName: string;
  menteeLocation: string;
  menteeNeeds: string;
  menteeExperience: string;
  menteeInterests: string[];
  mentorId: string;
  mentorName: string;
  mentorLocation: string;
  mentorSpecialisation: string;
  mentorCapacity: number | null;
  mentorAvailability: string;
  mentorActiveMentees: number;
  mentorExpertise: string[];
  proposedByStaffUserId: string;
  status: 'proposed' | 'awaiting_mentor' | 'awaiting_mentee' | 'accepted' | 'declined' | 'withdrawn';
  menteeResponse: 'pending' | 'accepted' | 'declined';
  menteeRespondedAt: string | null;
  mentorResponse: 'pending' | 'accepted' | 'declined';
  mentorRespondedAt: string | null;
  requestId: string | null;
  relationshipId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffSessionOversight = {
  id: string;
  title: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  completedAt: string | null;
  relationshipId: string;
  menteeName: string;
  mentorName: string;
  coordinatedByStaffUserId: string | null;
  menteeResponse: 'pending' | 'attended' | 'missed' | null;
  mentorResponse: 'pending' | 'attended' | 'missed' | null;
};

type ApiProfile = {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: ApiRole;
  location: string;
  bio: string;
  interests: string[];
  expertise: string[];
  experience: string;
  specialisation: string;
  needs: string;
  qualifications: string;
  organization: string;
  jobTitle: string;
  maxActiveMentees: number | null;
  activeMentees: number;
  availabilityNote: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthAccount = {
  user: LocalUser;
  profile: LocalProfile;
};

type AuthResponse = {
  token: string;
  expiresAt: string;
  user: ApiUser;
  profile: ApiProfile;
};

type Envelope<T> = { data: T };

function localRole(role: ApiRole): UserRole {
  return role === 'programme_staff' ? 'staff' : role;
}

export async function consumeStaffInvitationWithApi(input: {
  token: string;
  name: string;
  email: string;
  password: string;
  phone: string;
}): Promise<{ token: string; account: AuthAccount }> {
  const { data } = await apiRequest<Envelope<AuthResponse>>('/auth/staff-invitations/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: input.token,
      fullName: input.name,
      email: input.email,
      password: input.password,
      phone: input.phone,
    }),
  });
  return { token: data.token, account: mapAccount(data.user, data.profile) };
}

export async function acceptStaffInvitationWithApi(token: string, invitation: string): Promise<StaffProgramme> {
  const { data } = await apiRequest<Envelope<StaffProgramme>>('/staff/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitation }),
  }, token);
  return data;
}

export async function getStaffDashboardWithApi(token: string): Promise<StaffDashboard> {
  const { data } = await apiRequest<Envelope<StaffDashboard>>('/staff/dashboard', {}, token);
  return data;
}

export async function listStaffProgrammesWithApi(token: string): Promise<StaffProgramme[]> {
  const { data } = await apiRequest<Envelope<StaffProgramme[]>>('/staff/programmes', {}, token);
  return data;
}

export async function createStaffProgrammeWithApi(
  token: string,
  input: { name: string; description: string },
): Promise<Pick<StaffProgramme, 'id' | 'name' | 'description' | 'createdAt'>> {
  const { data } = await apiRequest<Envelope<Pick<StaffProgramme, 'id' | 'name' | 'description' | 'createdAt'>>>(
    '/staff/programmes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    token,
  );
  return data;
}

export async function assignStaffParticipantWithApi(
  token: string,
  programmeId: string,
  input: { email: string; role: 'mentee' | 'mentor' },
): Promise<void> {
  await apiRequest<Envelope<{ id: string; role: string; status: string }>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/participants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function updateStaffParticipantMembershipWithApi(
  token: string,
  programmeId: string,
  participantId: string,
  status: 'active' | 'removed',
): Promise<void> {
  await apiRequest<Envelope<{ id: string; role: string; status: string }>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/participants/${encodeURIComponent(participantId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
    token,
  );
}

export async function listStaffParticipantsWithApi(
  token: string,
  programmeId: string,
  filters: { q?: string; role?: 'mentee' | 'mentor'; status?: 'active' | 'removed' | 'all'; page?: number; pageSize?: number } = {},
): Promise<{ items: StaffParticipant[]; page: number; pageSize: number; total: number }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && String(value).trim()) query.set(key, String(value).trim());
  }
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : '';
  const { data } = await apiRequest<Envelope<{ items: StaffParticipant[]; page: number; pageSize: number; total: number }>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/participants${suffix}`,
    {},
    token,
  );
  return data;
}

export async function getStaffParticipantWithApi(token: string, participantId: string): Promise<StaffParticipantDetail> {
  const { data } = await apiRequest<Envelope<StaffParticipantDetail>>(
    `/staff/participants/${encodeURIComponent(participantId)}`,
    {},
    token,
  );
  return data;
}

export async function getStaffProgrammeOversightWithApi(token: string, programmeId: string): Promise<StaffProgrammeOversight> {
  const { data } = await apiRequest<Envelope<StaffProgrammeOversight>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/oversight`,
    {},
    token,
  );
  return data;
}

export async function listStaffMatchProposalsWithApi(token: string, programmeId: string): Promise<ProgrammeMatchProposal[]> {
  const { data } = await apiRequest<Envelope<ProgrammeMatchProposal[]>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/match-proposals`,
    {},
    token,
  );
  return data;
}

export async function createStaffMatchProposalWithApi(
  token: string,
  programmeId: string,
  input: { menteeId: string; mentorId: string },
): Promise<ProgrammeMatchProposal> {
  const { data } = await apiRequest<Envelope<ProgrammeMatchProposal>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/match-proposals`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    token,
  );
  return data;
}

export async function withdrawStaffMatchProposalWithApi(token: string, programmeId: string, proposalId: string): Promise<void> {
  await apiRequest<Envelope<ProgrammeMatchProposal>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/match-proposals/${encodeURIComponent(proposalId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'withdrawn' }) },
    token,
  );
}

export async function listParticipantMatchProposalsWithApi(token: string): Promise<ProgrammeMatchProposal[]> {
  const { data } = await apiRequest<Envelope<ProgrammeMatchProposal[]>>('/mentorship/match-proposals', {}, token);
  return data;
}

export async function respondToMatchProposalWithApi(
  token: string,
  proposalId: string,
  response: 'accepted' | 'declined',
): Promise<ProgrammeMatchProposal> {
  const { data } = await apiRequest<Envelope<ProgrammeMatchProposal>>(
    `/mentorship/match-proposals/${encodeURIComponent(proposalId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) },
    token,
  );
  return data;
}

export async function createStaffProgrammeSessionWithApi(
  token: string,
  programmeId: string,
  input: { relationshipId: string; title: string; scheduledAt: string; preparationNotes: string },
): Promise<LocalSession> {
  const { data } = await apiRequest<Envelope<LocalSession>>(
    `/staff/programmes/${encodeURIComponent(programmeId)}/sessions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    token,
  );
  return { ...data, notes: data.preparationNotes };
}

export async function respondToSessionParticipationWithApi(
  token: string,
  sessionId: string,
  response: 'attended' | 'missed',
): Promise<{ sessionId: string; participantId: string; response: string; status: SessionStatus }> {
  const { data } = await apiRequest<Envelope<{ sessionId: string; participantId: string; response: string; status: SessionStatus }>>(
    `/mentorship/sessions/${encodeURIComponent(sessionId)}/participation`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) },
    token,
  );
  return data;
}

function mapAccount(user: ApiUser, profile: ApiProfile): AuthAccount {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: localRole(user.role),
    },
    profile: {
      userId: profile.userId,
      location: profile.location,
      bio: profile.bio,
      interests: profile.interests,
      expertise: profile.expertise,
      experience: profile.experience,
      specialisation: profile.specialisation,
      needs: profile.needs,
      qualifications: profile.qualifications,
      organization: profile.organization,
      jobTitle: profile.jobTitle,
      maxActiveMentees: profile.maxActiveMentees,
      activeMentees: profile.activeMentees,
      availabilityNote: profile.availabilityNote,
      imageUrl: profile.imageUrl,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
  };
}

export async function registerWithApi(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  phone: string;
}): Promise<{ token: string; account: AuthAccount }> {
  const { data } = await apiRequest<Envelope<AuthResponse>>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: input.name,
      email: input.email,
      password: input.password,
      role: input.role === 'staff' ? 'programme_staff' : input.role,
      phone: input.phone,
    }),
  });
  return { token: data.token, account: mapAccount(data.user, data.profile) };
}

export async function loginWithApi(email: string, password: string): Promise<{ token: string; account: AuthAccount }> {
  const { data } = await apiRequest<Envelope<AuthResponse>>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { token: data.token, account: mapAccount(data.user, data.profile) };
}

export async function restoreApiSession(token: string): Promise<AuthAccount> {
  const { data } = await apiRequest<Envelope<{ user: ApiUser; profile: ApiProfile }>>('/auth/me', {}, token);
  return mapAccount(data.user, data.profile);
}

export async function updateProfileWithApi(
  token: string,
  changes: Partial<Omit<LocalProfile, 'userId' | 'updatedAt'>> & { name?: string; phone?: string },
): Promise<AuthAccount['profile']> {
  const payload = profileUpdatePayload(changes);
  const { data } = await apiRequest<Envelope<ApiProfile>>('/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, token);
  return {
    userId: data.userId,
    location: data.location,
    bio: data.bio,
    interests: data.interests,
    expertise: data.expertise,
    experience: data.experience,
    specialisation: data.specialisation,
    needs: data.needs,
    qualifications: data.qualifications,
    organization: data.organization,
    jobTitle: data.jobTitle,
    maxActiveMentees: data.maxActiveMentees,
    activeMentees: data.activeMentees,
    availabilityNote: data.availabilityNote,
    imageUrl: data.imageUrl,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export type ImageAssetInput = {
  uri: string;
  mimeType: string;
  fileName: string;
  file?: Blob;
};

export type AgriculturalImage = {
  id: string;
  secureUrl: string;
  contentType: string;
  createdAt: string;
};

export type MentorDirectoryProfile = {
  id: string;
  name: string;
  location: string;
  bio: string;
  experienceYears: number | null;
  experience: string;
  specialisation: string;
  qualifications: string;
  imageUrl: string | null;
  expertise: string[];
  activeMentees: number;
  maxActiveMentees: number | null;
  availableSlots: number | null;
  availabilityNote: string;
  updatedAt: string;
};

export type MentorSearchFilters = {
  q?: string;
  expertise?: string;
  location?: string;
  minExperience?: number;
};

function mapMentor(mentor: Omit<MentorDirectoryProfile, 'experience'>): MentorDirectoryProfile {
  return {
    ...mentor,
    experience: mentor.experienceYears === null ? '' : `${mentor.experienceYears} years`,
  };
}

export async function listMentorsWithApi(token: string, filters: MentorSearchFilters = {}): Promise<MentorDirectoryProfile[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && String(value).trim()) query.set(key, String(value).trim());
  }
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : '';
  const { data } = await apiRequest<Envelope<Omit<MentorDirectoryProfile, 'experience'>[]>>(
    `/mentors${suffix}`,
    {},
    token,
  );
  return data.map(mapMentor);
}

export async function getMentorWithApi(token: string, mentorId: string): Promise<MentorDirectoryProfile> {
  const { data } = await apiRequest<Envelope<Omit<MentorDirectoryProfile, 'experience'>>>(
    `/mentors/${encodeURIComponent(mentorId)}`,
    {},
    token,
  );
  return mapMentor(data);
}

export async function listMentorshipRequestsWithApi(token: string): Promise<MentorshipRequest[]> {
  const { data } = await apiRequest<Envelope<MentorshipRequest[]>>('/mentorship/requests', {}, token);
  return data;
}

export async function createMentorshipRequestWithApi(
  token: string,
  input: { mentorId: string; message: string; needs: string; interests: string; goals: string },
): Promise<MentorshipRequest> {
  const { data } = await apiRequest<Envelope<MentorshipRequest>>('/mentorship/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, token);
  return data;
}

export async function updateMentorshipRequestWithApi(
  token: string,
  requestId: string,
  status: Extract<RequestStatus, 'accepted' | 'declined' | 'cancelled'>,
): Promise<MentorshipRequest> {
  const { data } = await apiRequest<Envelope<MentorshipRequest>>(
    `/mentorship/requests/${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
    token,
  );
  return data;
}

export async function listMentorshipRelationshipsWithApi(token: string): Promise<Mentorship[]> {
  const { data } = await apiRequest<Envelope<Mentorship[]>>('/mentorship/relationships', {}, token);
  return data;
}

export async function endMentorshipRelationshipWithApi(
  token: string,
  relationshipId: string,
  reason: string,
): Promise<Mentorship> {
  const { data } = await apiRequest<Envelope<Mentorship>>(
    `/mentorship/relationships/${encodeURIComponent(relationshipId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
    token,
  );
  return data;
}

export async function listMentorshipSessionsWithApi(token: string): Promise<LocalSession[]> {
  const { data } = await apiRequest<Envelope<LocalSession[]>>('/mentorship/sessions', {}, token);
  return data.map((session) => ({
    ...session,
    notes: session.preparationNotes,
  }));
}

export async function createMentorshipSessionWithApi(
  token: string,
  input: Pick<LocalSession, 'title' | 'scheduledAt' | 'preparationNotes'> & { relationshipId: string },
): Promise<LocalSession> {
  const { data } = await apiRequest<Envelope<LocalSession>>('/mentorship/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, token);
  return { ...data, notes: data.preparationNotes };
}

export async function updateMentorshipSessionWithApi(
  token: string,
  sessionId: string,
  changes: {
    title?: string;
    scheduledAt?: string;
    preparationNotes?: string;
    outcomeNotes?: string;
    status?: SessionStatus;
  },
): Promise<LocalSession> {
  const { data } = await apiRequest<Envelope<LocalSession>>(
    `/mentorship/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    },
    token,
  );
  return { ...data, notes: data.preparationNotes };
}

export async function listMentorshipGoalsWithApi(token: string): Promise<LocalGoal[]> {
  const { data } = await apiRequest<Envelope<LocalGoal[]>>('/mentorship/goals', {}, token);
  return data.map((goal) => ({
    ...goal,
    description: goal.measurableOutcome,
    milestones: goal.milestones.map((milestone: GoalMilestone) => ({
      ...milestone,
      completed: milestone.status === 'completed',
    })),
  }));
}

export async function createMentorshipGoalWithApi(
  token: string,
  input: { relationshipId: string; title: string; measurableOutcome: string; targetDate: string },
): Promise<LocalGoal> {
  const { data } = await apiRequest<Envelope<LocalGoal>>('/mentorship/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, token);
  return { ...data, description: data.measurableOutcome };
}

export async function updateMentorshipGoalWithApi(
  token: string,
  goalId: string,
  changes: { title?: string; measurableOutcome?: string; targetDate?: string; status?: LocalGoal['status'] },
): Promise<LocalGoal> {
  const { data } = await apiRequest<Envelope<LocalGoal>>(
    `/mentorship/goals/${encodeURIComponent(goalId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    },
    token,
  );
  return {
    ...data,
    description: data.measurableOutcome,
    milestones: data.milestones.map((milestone: GoalMilestone) => ({
      ...milestone,
      completed: milestone.status === 'completed',
    })),
  };
}

export async function createGoalMilestoneWithApi(token: string, goalId: string, title: string): Promise<void> {
  await apiRequest<Envelope<{ created: boolean }>>(
    `/mentorship/goals/${encodeURIComponent(goalId)}/milestones`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
    token,
  );
}

export async function updateGoalMilestoneWithApi(
  token: string,
  milestoneId: string,
  changes: { title?: string; status?: GoalMilestone['status'] },
): Promise<void> {
  await apiRequest<Envelope<{ updated: boolean }>>(
    `/mentorship/milestones/${encodeURIComponent(milestoneId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    },
    token,
  );
}

async function imageFormData(asset: ImageAssetInput): Promise<FormData> {
  const formData = new FormData();
  if (asset.file) {
    formData.append('image', asset.file, asset.fileName);
  } else if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error('The selected image could not be read.');
    formData.append('image', await response.blob(), asset.fileName);
  } else {
    const nativeFormData = formData as FormData & {
      append(name: string, value: { uri: string; name: string; type: string }): void;
    };
    nativeFormData.append('image', {
      uri: asset.uri,
      name: asset.fileName,
      type: asset.mimeType,
    });
  }
  return formData;
}

export async function uploadProfileImageWithApi(
  token: string,
  asset: ImageAssetInput,
): Promise<AuthAccount['profile']> {
  const { data } = await apiRequest<Envelope<ApiProfile>>('/profile/image', {
    method: 'POST',
    body: await imageFormData(asset),
  }, token);
  return {
    userId: data.userId,
    location: data.location,
    bio: data.bio,
    interests: data.interests,
    expertise: data.expertise,
    experience: data.experience,
    specialisation: data.specialisation,
    needs: data.needs,
    qualifications: data.qualifications,
    organization: data.organization,
    jobTitle: data.jobTitle,
    maxActiveMentees: data.maxActiveMentees,
    activeMentees: data.activeMentees,
    availabilityNote: data.availabilityNote,
    imageUrl: data.imageUrl,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function uploadAgriculturalImageWithApi(
  token: string,
  asset: ImageAssetInput,
): Promise<AgriculturalImage> {
  const { data } = await apiRequest<Envelope<AgriculturalImage>>('/agricultural-images', {
    method: 'POST',
    body: await imageFormData(asset),
  }, token);
  return data;
}

export async function listAgriculturalImagesWithApi(token: string): Promise<AgriculturalImage[]> {
  const { data } = await apiRequest<Envelope<AgriculturalImage[]>>('/agricultural-images', {}, token);
  return data;
}

export async function deleteAgriculturalImageWithApi(token: string, imageId: string): Promise<void> {
  await apiRequest<Envelope<{ deleted: boolean }>>(
    `/agricultural-images/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
    token,
  );
}

export async function logoutFromApi(token: string): Promise<void> {
  await apiRequest<Envelope<{ loggedOut: boolean }>>('/auth/logout', { method: 'POST' }, token);
}
